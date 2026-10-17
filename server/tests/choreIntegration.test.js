const request = require('supertest');
const fs = require('fs');
const path = require('path');

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
const choreService = require('../src/services/choreService');

describe('Chores API Integration (Real PostgreSQL)', () => {
    let adminSessionCookie = '';
    let member1SessionCookie = '';
    let member2SessionCookie = '';

    const adminId = 'user_soundar';
    const member1Id = 'user_sanjay';
    const member2Id = 'user_mukesh';
    const householdId = 1;

    beforeAll(async () => {
        // Run all migrations against test database
        const client = await db.pool.connect();
        try {
            await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

            const migrationsDir = path.join(__dirname, '../migrations');
            const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
            for (const file of files) {
                const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
                await client.query(sql);
            }

            const tokenAdmin = await createSession(adminId);
            const tokenMember1 = await createSession(member1Id);
            const tokenMember2 = await createSession(member2Id);

            adminSessionCookie = `session_token=${tokenAdmin.token}`;
            member1SessionCookie = `session_token=${tokenMember1.token}`;
            member2SessionCookie = `session_token=${tokenMember2.token}`;
        } finally {
            client.release();
        }
    });

    afterAll(async () => {
        await db.pool.end();
    });

    describe('Vessel Washing Rotation', () => {
        it('returns all 9 seeded schedule entries with Sunday group assignment', async () => {
            const res = await request(app)
                .get('/api/v1/chores/vessel-schedule')
                .set('Cookie', member1SessionCookie);

            expect(res.status).toBe(200);
            expect(res.body.schedule).toHaveLength(9);

            const monday = res.body.schedule.find(s => s.dayOfWeek === 'Monday');
            expect(monday.assignedUserId).toBe('user_soundar');
            expect(monday.assignedUserName).toBe('Soundar M');
            expect(monday.isGroupDuty).toBe(false);

            const fridayMorning = res.body.schedule.find(s => s.dayOfWeek === 'Friday' && s.timePeriod === 'MORNING');
            expect(fridayMorning.assignedUserId).toBe('user_soundar');

            const fridayEvening = res.body.schedule.find(s => s.dayOfWeek === 'Friday' && s.timePeriod === 'EVENING');
            expect(fridayEvening.assignedUserId).toBe('user_raj');

            const sunday = res.body.schedule.find(s => s.dayOfWeek === 'Sunday');
            expect(sunday.assignedUserId).toBeNull();
            expect(sunday.isGroupDuty).toBe(true);
            expect(sunday.assignedUserName).toBe('All Members (Group Duty)');
        });

        it('all four members can fetch the same shared vessel-cleaning schedule', async () => {
            const resAdmin = await request(app).get('/api/v1/chores/vessel-schedule').set('Cookie', adminSessionCookie);
            const resMember1 = await request(app).get('/api/v1/chores/vessel-schedule').set('Cookie', member1SessionCookie);
            const resMember2 = await request(app).get('/api/v1/chores/vessel-schedule').set('Cookie', member2SessionCookie);

            expect(resAdmin.status).toBe(200);
            expect(resMember1.status).toBe(200);
            expect(resMember2.status).toBe(200);
            expect(resAdmin.body.schedule).toEqual(resMember1.body.schedule);
            expect(resMember1.body.schedule).toEqual(resMember2.body.schedule);
        });

        it('allows admin to persistently update a vessel schedule assignment and writes audit log', async () => {
            // Monday is schedule id 1
            const scheduleRes = await request(app).get('/api/v1/chores/vessel-schedule').set('Cookie', adminSessionCookie);
            const monday = scheduleRes.body.schedule.find(s => s.dayOfWeek === 'Monday');

            const patchRes = await request(app)
                .patch(`/api/v1/chores/vessel-schedule/${monday.id}`)
                .set('Cookie', adminSessionCookie)
                .send({ assignedUserId: member1Id }); // Reassign Monday to Sanjay K

            expect(patchRes.status).toBe(200);
            expect(patchRes.body.scheduleEntry.assignedUserId).toBe(member1Id);
            expect(patchRes.body.scheduleEntry.assignedUserName).toBe('Sanjay K');

            // Verify in database
            const dbCheck = await db.query('SELECT assigned_user_id FROM vessel_schedules WHERE id = $1', [monday.id]);
            expect(dbCheck.rows[0].assigned_user_id).toBe(member1Id);

            // Verify audit log
            const auditCheck = await db.query(
                `SELECT * FROM audit_logs WHERE entity_type = 'vessel_schedule' AND entity_id = $1`,
                [String(monday.id)]
            );
            expect(auditCheck.rows.length).toBeGreaterThan(0);
            expect(auditCheck.rows[0].actor_id).toBe(adminId);
            expect(auditCheck.rows[0].action).toBe('UPDATE_VESSEL_SCHEDULE');

            // Reset back to user_soundar
            await request(app)
                .patch(`/api/v1/chores/vessel-schedule/${monday.id}`)
                .set('Cookie', adminSessionCookie)
                .send({ assignedUserId: adminId });
        });

        it('forbids ordinary member from updating vessel schedule', async () => {
            const scheduleRes = await request(app).get('/api/v1/chores/vessel-schedule').set('Cookie', member1SessionCookie);
            const monday = scheduleRes.body.schedule.find(s => s.dayOfWeek === 'Monday');

            const res = await request(app)
                .patch(`/api/v1/chores/vessel-schedule/${monday.id}`)
                .set('Cookie', member1SessionCookie)
                .send({ assignedUserId: member2Id });

            expect(res.status).toBe(403);
        });
    });

    describe('Chore Assignment & Role Enforcement', () => {
        let testAssignmentId;

        beforeEach(async () => {
            await db.query('DELETE FROM chore_assignments');
            // Create an assignment for member1
            const res = await db.query(
                `INSERT INTO chore_assignments (chore_id, user_id, assigned_date, due_date, status)
                 VALUES (1, $1, '2026-10-18', '2026-10-20', 'PENDING')
                 RETURNING id`,
                [member1Id]
            );
            testAssignmentId = res.rows[0].id;
        });

        it('member can update their own assignment and generates audit log', async () => {
            const res = await request(app)
                .patch(`/api/v1/chores/assignments/${testAssignmentId}/status`)
                .set('Cookie', member1SessionCookie)
                .send({ status: 'COMPLETED' });

            expect(res.status).toBe(200);
            expect(res.body.assignment.status).toBe('COMPLETED');

            // Verify in database
            const dbCheck = await db.query('SELECT status FROM chore_assignments WHERE id = $1', [testAssignmentId]);
            expect(dbCheck.rows[0].status).toBe('COMPLETED');

            // Verify audit log
            const auditCheck = await db.query(
                `SELECT * FROM audit_logs WHERE entity_type = 'chore_assignment' AND entity_id = $1`,
                [String(testAssignmentId)]
            );
            expect(auditCheck.rows.length).toBeGreaterThan(0);
            expect(auditCheck.rows[0].actor_id).toBe(member1Id);
            expect(auditCheck.rows[0].action).toBe('UPDATE_CHORE_STATUS');
        });

        it('member cannot update another member assignment', async () => {
            const res = await request(app)
                .patch(`/api/v1/chores/assignments/${testAssignmentId}/status`)
                .set('Cookie', member2SessionCookie)
                .send({ status: 'COMPLETED' });

            expect(res.status).toBe(403);
            expect(res.body.error.message).toContain('Members can only update their own assignments');

            // Verify unchanged
            const dbCheck = await db.query('SELECT status FROM chore_assignments WHERE id = $1', [testAssignmentId]);
            expect(dbCheck.rows[0].status).toBe('PENDING');
        });

        it('admin can update any member assignment', async () => {
            const res = await request(app)
                .patch(`/api/v1/chores/assignments/${testAssignmentId}/status`)
                .set('Cookie', adminSessionCookie)
                .send({ status: 'EXCUSED' });

            expect(res.status).toBe(200);
            expect(res.body.assignment.status).toBe('EXCUSED');

            const dbCheck = await db.query('SELECT status FROM chore_assignments WHERE id = $1', [testAssignmentId]);
            expect(dbCheck.rows[0].status).toBe('EXCUSED');
        });

        it('rejects duplicate assignment for the same chore, date, and user', async () => {
            const client = await db.pool.connect();
            try {
                let duplicateErrorCaught = false;
                try {
                    await client.query(
                        `INSERT INTO chore_assignments (chore_id, user_id, assigned_date, due_date, status)
                         VALUES (1, $1, '2026-10-18', '2026-10-20', 'PENDING')`,
                        [member1Id]
                    );
                } catch (err) {
                    duplicateErrorCaught = err.code === '23505'; // Unique violation
                }
                expect(duplicateErrorCaught).toBe(true);
            } finally {
                client.release();
            }
        });
    });

    describe('Dustbin Cyclic Handoff Workflow & Concurrency', () => {
        beforeEach(async () => {
            await db.query('DELETE FROM dustbin_cycles');
        });

        it('allows claiming open cycle when none exists', async () => {
            const res = await request(app)
                .post('/api/v1/chores/dustbin/claim')
                .set('Cookie', member1SessionCookie)
                .send({});

            expect(res.status).toBe(200);
            expect(res.body.cycle.status).toBe('OPEN');
            expect(res.body.cycle.claimantUserId).toBe(member1Id);

            const current = await request(app)
                .get('/api/v1/chores/dustbin/current')
                .set('Cookie', member2SessionCookie);
            expect(current.status).toBe(200);
            expect(current.body.cycle.claimantUserId).toBe(member1Id);
        });

        it('rejects claim by another member with 409 conflict when already claimed', async () => {
            // member1 claims
            await request(app)
                .post('/api/v1/chores/dustbin/claim')
                .set('Cookie', member1SessionCookie)
                .send({});

            // member2 tries without allowTakeover
            const res = await request(app)
                .post('/api/v1/chores/dustbin/claim')
                .set('Cookie', member2SessionCookie)
                .send({ allowTakeover: false });

            expect(res.status).toBe(409);
            expect(res.body.error.message).toContain('Takeover confirmation required');
        });

        it('allows explicit takeover and records in audit logs', async () => {
            // member1 claims
            await request(app)
                .post('/api/v1/chores/dustbin/claim')
                .set('Cookie', member1SessionCookie)
                .send({});

            // member2 takes over
            const res = await request(app)
                .post('/api/v1/chores/dustbin/claim')
                .set('Cookie', member2SessionCookie)
                .send({ allowTakeover: true });

            expect(res.status).toBe(200);
            expect(res.body.cycle.claimantUserId).toBe(member2Id);

            // Verify audit log
            const audit = await db.query(
                `SELECT * FROM audit_logs WHERE action = 'TAKEOVER_DUSTBIN_CYCLE'`
            );
            expect(audit.rows.length).toBeGreaterThan(0);
            expect(audit.rows[0].actor_id).toBe(member2Id);
        });

        it('only current claimant or admin can complete cycle', async () => {
            // member1 claims
            const claimRes = await request(app)
                .post('/api/v1/chores/dustbin/claim')
                .set('Cookie', member1SessionCookie)
                .send({});
            const cycleId = claimRes.body.cycle.id;

            // member2 tries to complete -> 403
            const forbiddenRes = await request(app)
                .post(`/api/v1/chores/dustbin/${cycleId}/complete`)
                .set('Cookie', member2SessionCookie);
            expect(forbiddenRes.status).toBe(403);

            // member1 completes -> 200
            const completeRes = await request(app)
                .post(`/api/v1/chores/dustbin/${cycleId}/complete`)
                .set('Cookie', member1SessionCookie);
            expect(completeRes.status).toBe(200);
            expect(completeRes.body.cycle.status).toBe('COMPLETED');

            // Current is now null
            const current = await request(app)
                .get('/api/v1/chores/dustbin/current')
                .set('Cookie', member1SessionCookie);
            expect(current.body.cycle).toBeNull();

            // Completed cycle shows in history
            const history = await request(app)
                .get('/api/v1/chores/dustbin/history')
                .set('Cookie', member1SessionCookie);
            expect(history.body.history).toHaveLength(1);
            expect(history.body.history[0].status).toBe('COMPLETED');
        });

        it('enforces single open cycle constraint under concurrent requests', async () => {
            // Two parallel requests attempting to claim
            const [res1, res2] = await Promise.all([
                request(app).post('/api/v1/chores/dustbin/claim').set('Cookie', member1SessionCookie).send({}),
                request(app).post('/api/v1/chores/dustbin/claim').set('Cookie', member2SessionCookie).send({})
            ]);

            // Exactly one must succeed with 200, the other gets 409
            const statuses = [res1.status, res2.status].sort();
            expect(statuses).toEqual([200, 409]);

            // Database must have only 1 OPEN cycle
            const openCycles = await db.query("SELECT * FROM dustbin_cycles WHERE household_id = 1 AND status = 'OPEN'");
            expect(openCycles.rows).toHaveLength(1);
        });
    });
});
