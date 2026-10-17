const request = require('supertest');
const fs = require('fs');
const path = require('path');

const app = require('../src/app');
const db = require('../src/utils/db');
const { createSession } = require('../src/services/authService');
const { getKolkataDateParts, getTomorrowDateStr } = require('../src/utils/dateUtils');

describe('Phase 8 — Security Hardening & Authorization Isolation Tests', () => {
    let adminToken, member1Token, member2Token;
    let adminCookie, member1Cookie, member2Cookie;

    const adminId = 'user_soundar';
    const member1Id = 'user_sanjay';
    const member2Id = 'user_mukesh';
    const householdId = 1;

    beforeAll(async () => {
        // Run all migrations against the test database
        const client = await db.pool.connect();
        try {
            await client.query(`
                SELECT pg_terminate_backend(pid) 
                FROM pg_stat_activity 
                WHERE datname = current_database() AND pid <> pg_backend_pid();
            `);
            await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
            const migrationsDir = path.join(__dirname, '../migrations');
            const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
            for (const file of files) {
                const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
                await client.query(sql);
            }
        } finally {
            client.release();
        }

        const tokenAdmin = await createSession(adminId);
        const tokenMember1 = await createSession(member1Id);
        const tokenMember2 = await createSession(member2Id);

        adminCookie = `session_token=${tokenAdmin.token}`;
        member1Cookie = `session_token=${tokenMember1.token}`;
        member2Cookie = `session_token=${tokenMember2.token}`;
    });

    afterAll(async () => {
        await db.pool.end();
    });

    // -------------------------------------------------------------
    // 8.1 Unauthenticated requests to protected APIs
    // -------------------------------------------------------------
    describe('8.1 Unauthenticated Requests Protection', () => {
        it('rejects unauthenticated GET /api/v1/admin/overview with 401', async () => {
            const res = await request(app).get('/api/v1/admin/overview');
            expect(res.status).toBe(401);
            expect(res.body.error).toBeDefined();
        });

        it('rejects unauthenticated GET /api/v1/billing/my-cycles with 401', async () => {
            const res = await request(app).get('/api/v1/billing/my-cycles');
            expect(res.status).toBe(401);
        });

        it('rejects unauthenticated GET /api/v1/food with 401', async () => {
            const res = await request(app).get('/api/v1/food?month=2026-10');
            expect(res.status).toBe(401);
        });

        it('rejects unauthenticated GET /api/v1/household/info with 401', async () => {
            const res = await request(app).get('/api/v1/household/info');
            expect(res.status).toBe(401);
        });

        it('rejects unauthenticated GET /api/v1/notifications with 401', async () => {
            const res = await request(app).get('/api/v1/notifications');
            expect(res.status).toBe(401);
        });
    });

    // -------------------------------------------------------------
    // 8.2 Member requests to Admin endpoints (RBAC)
    // -------------------------------------------------------------
    describe('8.2 Role-Based Access Control (RBAC)', () => {
        it('rejects member accessing GET /api/v1/admin/overview with 403', async () => {
            const res = await request(app)
                .get('/api/v1/admin/overview')
                .set('Cookie', member1Cookie);
            expect(res.status).toBe(403);
            expect(res.body.error.message).toMatch(/forbidden|insufficient|admin/i);
        });

        it('rejects member accessing GET /api/v1/admin/members with 403', async () => {
            const res = await request(app)
                .get('/api/v1/admin/members')
                .set('Cookie', member1Cookie);
            expect(res.status).toBe(403);
        });

        it('rejects member accessing PATCH /api/v1/admin/settings with 403', async () => {
            const res = await request(app)
                .patch('/api/v1/admin/settings')
                .set('Cookie', member1Cookie)
                .send({ cancellation_cutoff_time: '20:00' });
            expect(res.status).toBe(403);
        });

        it('rejects member accessing PUT /api/v1/household/info with 403', async () => {
            const res = await request(app)
                .put('/api/v1/household/info')
                .set('Cookie', member1Cookie)
                .send({ address: 'Hacked Address' });
            expect(res.status).toBe(403);
        });

        it('rejects member attempting to trigger manual billing check with 403', async () => {
            const res = await request(app)
                .post('/api/v1/admin/billing/run-check')
                .set('Cookie', member1Cookie);
            expect(res.status).toBe(403);
        });

        it('rejects member attempting to pay/record payment directly with 403', async () => {
            const res = await request(app)
                .post('/api/v1/billing/1/pay')
                .set('Cookie', member1Cookie)
                .send({ amountPaise: 13000 });
            expect(res.status).toBe(403);
        });

        it('rejects member attempting to update paid amount with 403', async () => {
            const res = await request(app)
                .patch('/api/v1/billing/1/paid-amount')
                .set('Cookie', member1Cookie)
                .send({ paidAmountPaise: 0 });
            expect(res.status).toBe(403);
        });
    });

    // -------------------------------------------------------------
    // 8.3 Long Leave & Member Food Permission Isolation
    // -------------------------------------------------------------
    describe('8.3 Long Leave Permissions & Isolation', () => {
        it('rejects direct API attempt by member to create long leave with 403', async () => {
            const res = await request(app)
                .post('/api/v1/food/leaves')
                .set('Cookie', member1Cookie)
                .send({
                    userIds: [member1Id],
                    startDate: '2026-10-20',
                    endDate: '2026-10-25',
                    reason: 'Unapproved Vacation'
                });
            expect(res.status).toBe(403);
            expect(res.body.error.message).toMatch(/forbidden|insufficient|admin/i);
        });

        it('rejects member attempting to cancel leave via PATCH /api/v1/food/leaves/:id/cancel with 403', async () => {
            const res = await request(app)
                .patch('/api/v1/food/leaves/999/cancel')
                .set('Cookie', member1Cookie);
            expect(res.status).toBe(403);
        });

        it('allows admin to create long leave', async () => {
            const res = await request(app)
                .post('/api/v1/food/leaves')
                .set('Cookie', adminCookie)
                .send({
                    userIds: [member1Id],
                    startDate: '2026-10-28',
                    endDate: '2026-10-30',
                    reason: 'Official Travel'
                });
            expect(res.status).toBe(201);
            expect(res.body.leaves).toBeDefined();
            expect(res.body.leaves[0].user_id).toBe(member1Id);
        });
    });

    // -------------------------------------------------------------
    // 8.4 Food Cancellation Boundary & IDOR Isolation
    // -------------------------------------------------------------
    describe('8.4 Food Cancellation Cutoff, Boundaries & IDOR Isolation', () => {
        const mockTime = new Date('2026-10-17T10:00:00.000Z');
        const tomorrow = getTomorrowDateStr(mockTime);

        beforeEach(() => {
            app.locals.mockTime = mockTime;
        });

        afterEach(() => {
            delete app.locals.mockTime;
        });

        it('rejects cancellation for yesterday with 403', async () => {
            const res = await request(app)
                .put('/api/v1/food/2026-10-16')
                .set('Cookie', member1Cookie)
                .send({ status: 'CANCELLED' });
            expect(res.status).toBe(403);
            expect(res.body.error.message).toMatch(/tomorrow/i);
        });

        it('rejects cancellation for dates beyond tomorrow with 403', async () => {
            const res = await request(app)
                .put('/api/v1/food/2026-12-25')
                .set('Cookie', member1Cookie)
                .send({ status: 'CANCELLED' });
            expect(res.status).toBe(403);
            expect(res.body.error.message).toMatch(/tomorrow/i);
        });

        it('rejects cancellation if user is on approved leave for that date', async () => {
            // Admin creates leave for member2 on tomorrow's date
            const resLeave = await request(app)
                .post('/api/v1/food/leaves')
                .set('Cookie', adminCookie)
                .send({
                    userIds: [member2Id],
                    startDate: tomorrow,
                    endDate: tomorrow,
                    reason: 'Medical Leave'
                });
            expect(resLeave.status).toBe(201);

            // Member2 tries to cancel food on that date
            const resCancel = await request(app)
                .put(`/api/v1/food/${tomorrow}`)
                .set('Cookie', member2Cookie)
                .send({ status: 'CANCELLED' });
            expect(resCancel.status).toBe(403);
            expect(resCancel.body.error.message).toMatch(/approved leave/i);
        });

        it('member updating food cannot specify another userId in request body to cancel their food', async () => {
            // Member1 attempts to cancel food for Member2 by injecting userId into body
            const res = await request(app)
                .put(`/api/v1/food/${tomorrow}`)
                .set('Cookie', member1Cookie)
                .send({ status: 'CANCELLED', userId: member2Id });
            
            expect(res.status).toBe(200);
            expect(res.body.record.userId).toBe(member1Id); // Enforced to member1, NOT member2

            // Verify member2 record was NOT affected
            const checkRes = await db.query(
                `SELECT status FROM food_records WHERE household_id = 1 AND user_id = $1 AND record_date = $2`,
                [member2Id, tomorrow]
            );
            // Member2 should not have a record set to CANCELLED by member1
            if (checkRes.rows.length > 0) {
                expect(checkRes.rows[0].status).not.toBe('CANCELLED');
            }
        });
    });

    // -------------------------------------------------------------
    // 8.5 IDOR Protection on Financial and Billing Records
    // -------------------------------------------------------------
    describe('8.5 IDOR Protection on Financial & Billing Records', () => {
        let member2BillId;

        beforeAll(async () => {
            // Generate bills as admin
            const genRes = await request(app)
                .post('/api/v1/billing/generate')
                .set('Cookie', adminCookie)
                .send({ billingMonth: '2026-09' });
            
            const bills = genRes.body.bills || [];
            const m2Bill = bills.find(b => b.user_id === member2Id);
            member2BillId = m2Bill ? m2Bill.id : 1;
        });

        it('rejects member1 attempting to view member2 bill details with 403', async () => {
            const res = await request(app)
                .get(`/api/v1/billing/${member2BillId}`)
                .set('Cookie', member1Cookie);
            expect(res.status).toBe(403);
            expect(res.body.error.message).toMatch(/forbidden|access denied|only view your own/i);
        });

        it('allows member2 to view their own bill details with 200', async () => {
            const res = await request(app)
                .get(`/api/v1/billing/${member2BillId}`)
                .set('Cookie', member2Cookie);
            expect(res.status).toBe(200);
            expect(res.body.bill.userId).toBe(member2Id);
        });

        it('allows admin to view any member bill with 200', async () => {
            const res = await request(app)
                .get(`/api/v1/billing/${member2BillId}`)
                .set('Cookie', adminCookie);
            expect(res.status).toBe(200);
            expect(res.body.bill.id).toBe(member2BillId);
        });
    });

    // -------------------------------------------------------------
    // 8.6 Input Validation, Missing Fields, and Malformed Requests
    // -------------------------------------------------------------
    describe('8.6 Input Validation & Payload Safeguards', () => {
        it('rejects malformed date in PUT /api/v1/food/:date with 400', async () => {
            const res = await request(app)
                .put('/api/v1/food/not-a-valid-date')
                .set('Cookie', member1Cookie)
                .send({ status: 'CANCELLED' });
            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/valid date/i);
        });

        it('rejects invalid enum status in PUT /api/v1/food/:date with 400', async () => {
            const now = new Date();
            const tomorrow = getTomorrowDateStr(now);
            const res = await request(app)
                .put(`/api/v1/food/${tomorrow}`)
                .set('Cookie', member1Cookie)
                .send({ status: 'MAYBE_EATING' });
            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/status must be/i);
        });

        it('rejects payload exceeding request size limit (100kb) with 413', async () => {
            const largeString = 'a'.repeat(120 * 1024); // 120KB
            const res = await request(app)
                .post('/api/v1/auth/login')
                .set('Content-Type', 'application/json')
                .send(JSON.stringify({ username: 'soundar', password: largeString }));
            expect(res.status).toBe(413);
        });
    });

    // -------------------------------------------------------------
    // 8.7 Rate Limiting on Login Endpoint
    // -------------------------------------------------------------
    describe('8.7 Login Rate Limiting', () => {
        it('blocks excessive login attempts (>10) with 429 when rate limiter is active', async () => {
            // Send 10 failed login attempts with x-test-rate-limit header
            for (let i = 0; i < 10; i++) {
                await request(app)
                    .post('/api/v1/auth/login')
                    .set('x-test-rate-limit', 'true')
                    .send({ username: 'soundar', password: 'wrongpassword' });
            }

            // 11th request should be rate-limited
            const rateLimitedRes = await request(app)
                .post('/api/v1/auth/login')
                .set('x-test-rate-limit', 'true')
                .send({ username: 'soundar', password: 'wrongpassword' });
            
            expect(rateLimitedRes.status).toBe(429);
            expect(rateLimitedRes.body.error.message).toMatch(/too many login attempts/i);
        });
    });
});
