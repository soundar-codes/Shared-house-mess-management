const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Enforce test database connection BEFORE loading anything else
const TEST_DB_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/shared_house_test';
process.env.DATABASE_URL = TEST_DB_URL;

if (!process.env.DATABASE_URL.includes('_test')) {
    console.error("FATAL: Refusing to run integration tests against a non-test database.");
    process.exit(1);
}

const app = require('../src/app');
const db = require('../src/utils/db');
const { createSession } = require('../src/services/authService');

describe('Food API Integration (Real PostgreSQL)', () => {
    let adminSessionCookie = '';
    let memberSessionCookie = '';
    let memberId = 'member_integration_test';
    let adminId = 'admin_integration_test';
    let householdId = 999;
    
    // Seed and clear the DB
    beforeAll(async () => {
        // Run migrations
        const client = await db.pool.connect();
        try {
            await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
            
            const migrationsDir = path.join(__dirname, '../migrations');
            const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
            for (const file of files) {
                const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
                await client.query(sql);
            }

            // Seed test data
            await client.query('INSERT INTO households (id, name) VALUES ($1, $2)', [householdId, 'Test Household']);
            await client.query('INSERT INTO users (id, name) VALUES ($1, $2), ($3, $4)', 
                [adminId, 'Admin User', memberId, 'Member User']);
            await client.query('INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, $3), ($1, $4, $5)', 
                [householdId, adminId, 'ADMIN', memberId, 'MEMBER']);
            
            // Seed config with rate 12345
            await client.query(
                `INSERT INTO food_configuration (household_id, default_rate_paise, valid_from) 
                 VALUES ($1, 12345, CURRENT_TIMESTAMP - interval '1 day')`,
                [householdId]
            );

            // Create sessions
            const adminToken = await createSession(adminId);
            const memberToken = await createSession(memberId);
            adminSessionCookie = `session_token=${adminToken.token}`;
            memberSessionCookie = `session_token=${memberToken.token}`;
        } finally {
            client.release();
        }
    });

    afterAll(async () => {
        await db.pool.end();
    });

    afterEach(() => {
        delete app.locals.mockTime;
    });

    it('returns missing records as sparse data and valid rate config', async () => {
        const configRes = await request(app).get('/api/v1/food/config').set('Cookie', memberSessionCookie);
        expect(configRes.status).toBe(200);
        expect(configRes.body.config.default_rate_paise).toBe(12345);

        const foodRes = await request(app).get('/api/v1/food?month=2026-10').set('Cookie', memberSessionCookie);
        expect(foodRes.status).toBe(200);
        expect(foodRes.body.records).toEqual([]); // Sparse representation of FOOD_REQUIRED
    });

    it('allows cancelling tomorrow before 23:00 IST and creates exactly one notification', async () => {
        // Set mock time to 2026-10-10 17:29:59.999 UTC (22:59:59.999 IST)
        app.locals.mockTime = new Date('2026-10-10T17:29:59.999Z');
        
        const res = await request(app)
            .put('/api/v1/food/2026-10-11')
            .set('Cookie', memberSessionCookie)
            .send({ status: 'CANCELLED' });
            
        if (res.status !== 200) console.log(res.body);
        expect(res.status).toBe(200);
        expect(res.body.record.status).toBe('CANCELLED');
        expect(res.body.record.ratePaise).toBe(12345); // Active rate captured

        // Check notification created
        const { rows: notifs } = await db.query('SELECT * FROM notifications WHERE user_id = $1', [adminId]);
        expect(notifs).toHaveLength(1);
        expect(notifs[0].message).toContain(memberId);
        expect(notifs[0].deduplication_key).toContain(`food_cancel_${householdId}_${memberId}_2026-10-11`);
    });

    it('rejects exactly at 23:00:00.000 IST', async () => {
        app.locals.mockTime = new Date('2026-10-10T17:30:00.000Z');
        
        const res = await request(app)
            .put('/api/v1/food/2026-10-11')
            .set('Cookie', memberSessionCookie)
            .send({ status: 'FOOD_REQUIRED' });
            
        expect(res.status).toBe(403);
    });

    it('prevents duplicate notifications on repeated CANCELLED requests (concurrency test)', async () => {
        app.locals.mockTime = new Date('2026-10-11T12:00:00Z'); // Next day, updating for 2026-10-12

        // Send 3 requests concurrently
        const results = await Promise.all([
            request(app).put('/api/v1/food/2026-10-12').set('Cookie', memberSessionCookie).send({ status: 'CANCELLED' }),
            request(app).put('/api/v1/food/2026-10-12').set('Cookie', memberSessionCookie).send({ status: 'CANCELLED' }),
            request(app).put('/api/v1/food/2026-10-12').set('Cookie', memberSessionCookie).send({ status: 'CANCELLED' })
        ]);

        results.forEach(res => expect(res.status).toBe(200));

        // Ensure only one row exists for this date
        const { rows: records } = await db.query('SELECT * FROM food_records WHERE user_id = $1 AND record_date = $2', [memberId, '2026-10-12']);
        expect(records).toHaveLength(1);

        // Ensure only one notification exists for this transition
        const { rows: notifs } = await db.query('SELECT * FROM notifications WHERE deduplication_key LIKE $1', [`food_cancel_${householdId}_${memberId}_2026-10-12%`]);
        expect(notifs).toHaveLength(1);
    });

    it('preserves historical rate when config changes', async () => {
        app.locals.mockTime = new Date('2026-10-12T12:00:00Z'); // Updating for 2026-10-13

        // Step 1: Create record at old rate
        await request(app).put('/api/v1/food/2026-10-13').set('Cookie', memberSessionCookie).send({ status: 'CANCELLED' });

        // Step 2: Admin changes global config to 99999
        await db.query(
            `INSERT INTO food_configuration (household_id, default_rate_paise, valid_from) 
             VALUES ($1, 99999, CURRENT_TIMESTAMP)`, [householdId]
        );

        // Step 3: Member restores food (switches to FOOD_REQUIRED)
        const res = await request(app).put('/api/v1/food/2026-10-13').set('Cookie', memberSessionCookie).send({ status: 'FOOD_REQUIRED' });
        
        expect(res.status).toBe(200);
        // The historical rate (12345) should be preserved on the record, not overwritten by 99999
        expect(res.body.record.ratePaise).toBe(12345);
    });

    it('generates distinct notification identities for genuine re-cancellations without assuming timestamp uniqueness', async () => {
        app.locals.mockTime = new Date('2026-10-13T12:00:00Z'); // Updating for 2026-10-14
        
        // 1. Initial cancel
        const res1 = await request(app)
            .put('/api/v1/food/2026-10-14')
            .set('Cookie', memberSessionCookie)
            .send({ status: 'CANCELLED' });
        expect(res1.status).toBe(200);
        
        // 2. Restore food (switches to FOOD_REQUIRED)
        const res2 = await request(app)
            .put('/api/v1/food/2026-10-14')
            .set('Cookie', memberSessionCookie)
            .send({ status: 'FOOD_REQUIRED' });
        expect(res2.status).toBe(200);
        
        // Note: We deliberately do NOT delete the initial notification.
        // Timestamp uniqueness is NOT assumed (even with identical mockTime).
        // Each genuine cancellation event gets a robust per-event identifier (UUID),
        // preventing deduplication collisions and ensuring the admin receives all genuine cancellation alerts.
        
        // 3. Second cancel
        const res3 = await request(app)
            .put('/api/v1/food/2026-10-14')
            .set('Cookie', memberSessionCookie)
            .send({ status: 'CANCELLED' });
        expect(res3.status).toBe(200);
        
        // Both genuine cancellation events generated distinct notifications with unique deduplication keys
        const { rows: notifs } = await db.query(
            'SELECT deduplication_key FROM notifications WHERE deduplication_key LIKE $1 ORDER BY id ASC',
            [`food_cancel_${householdId}_${memberId}_2026-10-14%`]
        );
        expect(notifs).toHaveLength(2);
        expect(notifs[0].deduplication_key).not.toBe(notifs[1].deduplication_key);
    });

    it('handles zero-row upsert as a non-transition outcome while returning the existing record and suppressing duplicate notifications', async () => {
        app.locals.mockTime = new Date('2026-10-14T12:00:00Z'); // Updating for 2026-10-15
        
        // 1. First cancellation creates record and notification
        const firstRes = await request(app)
            .put('/api/v1/food/2026-10-15')
            .set('Cookie', memberSessionCookie)
            .send({ status: 'CANCELLED' });
        expect(firstRes.status).toBe(200);
        expect(firstRes.body.record.status).toBe('CANCELLED');
        
        const { rows: notifsBefore } = await db.query(
            'SELECT * FROM notifications WHERE deduplication_key LIKE $1',
            [`food_cancel_${householdId}_${memberId}_2026-10-15%`]
        );
        expect(notifsBefore).toHaveLength(1);
        
        // 2. Second request with identical status triggers zero-row upsert
        // (DO UPDATE skipped because food_records.status == EXCLUDED.status)
        const secondRes = await request(app)
            .put('/api/v1/food/2026-10-15')
            .set('Cookie', memberSessionCookie)
            .send({ status: 'CANCELLED' });
            
        expect(secondRes.status).toBe(200);
        expect(secondRes.body.record.id).toBe(firstRes.body.record.id);
        expect(secondRes.body.record.status).toBe('CANCELLED');
        
        // 3. Confirm duplicate notification was suppressed and existing count remains 1
        const { rows: notifsAfter } = await db.query(
            'SELECT * FROM notifications WHERE deduplication_key LIKE $1',
            [`food_cancel_${householdId}_${memberId}_2026-10-15%`]
        );
        expect(notifsAfter).toHaveLength(1);
    });

    it('rolls back transaction and propagates error on genuine database errors', async () => {
        const foodService = require('../src/services/foodService');
        
        // Attempt to update with a non-existent householdId to trigger a Postgres foreign key violation
        let error;
        try {
            await foodService.updateMemberFood(-1, memberId, '2026-10-16', 'CANCELLED', { default_rate_paise: 100 });
        } catch (err) {
            error = err;
        }
        
        expect(error).toBeDefined();
        // Postgres foreign key violation code is 23503
        expect(error.code).toBe('23503');

        // Verify transaction was rolled back: no record or notification persisted
        const { rows: records } = await db.query(
            'SELECT * FROM food_records WHERE record_date = $1',
            ['2026-10-16']
        );
        expect(records).toHaveLength(0);

        const { rows: notifs } = await db.query(
            'SELECT * FROM notifications WHERE deduplication_key LIKE $1',
            ['%2026-10-16%']
        );
        expect(notifs).toHaveLength(0);
    });

    describe('Admin Mess Unavailability Integration Workflow', () => {
        beforeEach(async () => {
            await db.query('DELETE FROM mess_unavailability_declarations');
            await db.query('DELETE FROM notifications');
        });

        it('admin can declare mess unavailable for past, present, or future dates', async () => {
            const pastDate = '2026-10-10';
            const res = await request(app)
                .post('/api/v1/food/unavailable')
                .set('Cookie', adminSessionCookie)
                .send({ date: pastDate, reason: 'Gas cylinder leak' });

            expect(res.status).toBe(201);
            expect(res.body.declaration.declarationDate).toBe(pastDate);
            expect(res.body.declaration.status).toBe('ACTIVE');

            // Audit log check
            const audit = await db.query(
                `SELECT * FROM audit_logs WHERE action = 'DECLARE_MESS_UNAVAILABLE' AND entity_id = $1`,
                [String(res.body.declaration.id)]
            );
            expect(audit.rows).toHaveLength(1);
            expect(audit.rows[0].actor_id).toBe(adminId);

            // Notification check: both admin and member receive notification
            const notifs = await db.query('SELECT * FROM notifications WHERE title = $1', ['Mess Food Unavailable']);
            expect(notifs.rows.length).toBeGreaterThanOrEqual(2);
        });

        it('prevents duplicate active declarations for the same household and date', async () => {
            await request(app)
                .post('/api/v1/food/unavailable')
                .set('Cookie', adminSessionCookie)
                .send({ date: '2026-10-25', reason: 'Cook holiday' });

            const res = await request(app)
                .post('/api/v1/food/unavailable')
                .set('Cookie', adminSessionCookie)
                .send({ date: '2026-10-25', reason: 'Duplicate attempt' });

            expect(res.status).toBe(409);
            expect(res.body.error.message).toContain('already declared unavailable');
        });

        it('locks out member food updates on declared unavailable dates', async () => {
            const tomorrowStr = '2026-10-15';
            await request(app)
                .post('/api/v1/food/unavailable')
                .set('Cookie', adminSessionCookie)
                .send({ date: tomorrowStr, reason: 'Kitchen renovation' });

            // Set mock time so tomorrowStr is tomorrow before 23:00 IST
            app.locals.mockTime = new Date('2026-10-14T12:00:00Z');

            // Member attempts to cancel food for that date
            const res = await request(app)
                .put(`/api/v1/food/${tomorrowStr}`)
                .set('Cookie', memberSessionCookie)
                .send({ status: 'CANCELLED' });

            expect(res.status).toBe(403);
            expect(res.body.error.message).toContain('Mess food is declared unavailable by administrator');
        });

        it('admin can revoke an active declaration with a reason and members are notified', async () => {
            const dateStr = '2026-10-28';
            await request(app)
                .post('/api/v1/food/unavailable')
                .set('Cookie', adminSessionCookie)
                .send({ date: dateStr, reason: 'Maintenance' });

            const revokeRes = await request(app)
                .patch(`/api/v1/food/unavailable/${dateStr}/revoke`)
                .set('Cookie', adminSessionCookie)
                .send({ reason: 'Maintenance postponed, regular food service resumed' });

            expect(revokeRes.status).toBe(200);
            expect(revokeRes.body.declaration.status).toBe('REVOKED');
            expect(revokeRes.body.declaration.revocationReason).toContain('Maintenance postponed');

            // Notification check
            const notifs = await db.query('SELECT * FROM notifications WHERE title = $1', ['Mess Food Resumed']);
            expect(notifs.rows.length).toBeGreaterThanOrEqual(2);

            // Allows redeclaring the date after revocation
            const redeclareRes = await request(app)
                .post('/api/v1/food/unavailable')
                .set('Cookie', adminSessionCookie)
                .send({ date: dateStr, reason: 'Rescheduled maintenance' });
            expect(redeclareRes.status).toBe(201);
        });
    });
});
