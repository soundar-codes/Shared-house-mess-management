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
const billingService = require('../src/services/billingService');

describe('Billing API Integration (Real PostgreSQL)', () => {
    let adminSessionCookie = '';
    let member1SessionCookie = '';
    let member2SessionCookie = '';

    const adminId = 'user_soundar';
    const member1Id = 'user_sanjay';
    const member2Id = 'user_mukesh';
    const householdId = 1;
    const testMonth = '2026-09'; // 30 days

    beforeAll(async () => {
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

    describe('Monthly Bill Generation & Calculation Accuracy', () => {
        beforeEach(async () => {
            await db.query('DELETE FROM payments');
            await db.query('DELETE FROM bills');
            await db.query('DELETE FROM food_records');

            // Set food records for member1 in September 2026:
            // 2 cancelled days (Sept 5, Sept 10)
            await db.query(
                `INSERT INTO food_records (household_id, user_id, record_date, status, rate_paise)
                 VALUES 
                    (1, $1, '2026-09-05', 'CANCELLED', 10000),
                    (1, $1, '2026-09-10', 'CANCELLED', 10000)`,
                [member1Id]
            );

            // 1 day with custom historical rate: 12000 paise (Sept 15)
            await db.query(
                `INSERT INTO food_records (household_id, user_id, record_date, status, rate_paise)
                 VALUES (1, $1, '2026-09-15', 'FOOD_REQUIRED', 12000)`,
                [member1Id]
            );
        });

        it('generates accurate monthly bills preserving historical rate and treating sparse records as FOOD_REQUIRED', async () => {
            const res = await request(app)
                .post('/api/v1/billing/generate')
                .set('Cookie', adminSessionCookie)
                .send({ billingMonth: testMonth });

            expect(res.status).toBe(200);
            expect(res.body.bills).toHaveLength(4); // 4 household members

            const member1Bill = res.body.bills.find(b => b.user_id === member1Id);
            expect(member1Bill).toBeDefined();

            // Total days in September = 30.
            // Member1:
            // - 2 cancelled days = 0 paise
            // - 1 custom day = 12000 paise
            // - 27 sparse days defaulting to 10000 paise = 270000 paise
            // Expected total = 282000 paise (₹2820.00)
            expect(member1Bill.total_amount_paise).toBe(282000);
            expect(member1Bill.paid_amount_paise).toBe(0);
            expect(member1Bill.status).toBe('OPEN');

            // Check snapshot breakdown
            const snapshot = typeof member1Bill.snapshot_data === 'string'
                ? JSON.parse(member1Bill.snapshot_data)
                : member1Bill.snapshot_data;
            expect(snapshot.cancelledDays).toBe(2);
            expect(snapshot.chargeableDays).toBe(28);
            expect(snapshot.totalDays).toBe(30);

            // Member2 had 0 records -> all 30 days charged at 10000 = 300000 paise
            const member2Bill = res.body.bills.find(b => b.user_id === member2Id);
            expect(member2Bill.total_amount_paise).toBe(300000);
        });

        it('repeated generation does not create duplicate bills and recalculates open bills safely', async () => {
            // First generation
            await request(app)
                .post('/api/v1/billing/generate')
                .set('Cookie', adminSessionCookie)
                .send({ billingMonth: testMonth });

            // Member cancels an additional day (Sept 20)
            await db.query(
                `INSERT INTO food_records (household_id, user_id, record_date, status, rate_paise)
                 VALUES (1, $1, '2026-09-20', 'CANCELLED', 10000)`,
                [member1Id]
            );

            // Re-generate
            const res2 = await request(app)
                .post('/api/v1/billing/generate')
                .set('Cookie', adminSessionCookie)
                .send({ billingMonth: testMonth });

            expect(res2.status).toBe(200);

            // Must still have exactly 4 bills in database
            const countRes = await db.query('SELECT count(*) FROM bills WHERE billing_month = $1', [testMonth]);
            expect(parseInt(countRes.rows[0].count, 10)).toBe(4);

            // Member1 bill updated to 272000 paise
            const updatedBill = res2.body.bills.find(b => b.user_id === member1Id);
            expect(updatedBill.total_amount_paise).toBe(272000);
        });
    });

    describe('Payment Idempotency & Overpayment Protection', () => {
        let testBillId;

        beforeEach(async () => {
            await db.query('DELETE FROM payments');
            await db.query('DELETE FROM bills');

            const res = await db.query(
                `INSERT INTO bills (household_id, user_id, billing_month, total_amount_paise, paid_amount_paise, status)
                 VALUES (1, $1, '2026-09', 200000, 0, 'OPEN')
                 RETURNING id`,
                [member1Id]
            );
            testBillId = res.rows[0].id;
        });

        it('rejects regular members from recording payments with 403 Forbidden', async () => {
            const res = await request(app)
                .post(`/api/v1/billing/${testBillId}/pay`)
                .set('Cookie', member1SessionCookie)
                .send({ amountPaise: 50000, idempotencyKey: 'idemp_forbidden_member' });

            expect(res.status).toBe(403);
            expect(res.body.error.message).toContain('Forbidden');
        });

        it('records payment by admin and updates paid_amount_paise and balance correctly', async () => {
            const res = await request(app)
                .post(`/api/v1/billing/${testBillId}/pay`)
                .set('Cookie', adminSessionCookie)
                .send({ amountPaise: 80000, idempotencyKey: 'idemp_test_1' });

            expect(res.status).toBe(201);
            expect(res.body.payment.amountPaise).toBe(80000);

            // Check bill
            const billRes = await request(app)
                .get(`/api/v1/billing/${testBillId}`)
                .set('Cookie', member1SessionCookie);

            expect(billRes.body.bill.paidAmountPaise).toBe(80000);
            expect(billRes.body.bill.balancePaise).toBe(120000);
            expect(billRes.body.bill.paymentStatus).toBe('PARTIAL');
        });

        it('idempotency: repeated payment request with same key returns existing payment without double charging', async () => {
            // First payment
            const res1 = await request(app)
                .post(`/api/v1/billing/${testBillId}/pay`)
                .set('Cookie', adminSessionCookie)
                .send({ amountPaise: 50000, idempotencyKey: 'idemp_repeat_key' });
            expect(res1.status).toBe(201);

            // Second identical request
            const res2 = await request(app)
                .post(`/api/v1/billing/${testBillId}/pay`)
                .set('Cookie', adminSessionCookie)
                .send({ amountPaise: 50000, idempotencyKey: 'idemp_repeat_key' });
            expect(res2.status).toBe(200);
            expect(res2.body.payment.isIdempotentReplay).toBe(true);
            expect(res2.body.payment.id).toBe(res1.body.payment.id);

            // Verify database paid_amount_paise is 50000, NOT 100000
            const bill = await db.query('SELECT paid_amount_paise FROM bills WHERE id = $1', [testBillId]);
            expect(bill.rows[0].paid_amount_paise).toBe(50000);
        });

        it('returns 409 conflict if idempotency key is reused with different details', async () => {
            await request(app)
                .post(`/api/v1/billing/${testBillId}/pay`)
                .set('Cookie', adminSessionCookie)
                .send({ amountPaise: 50000, idempotencyKey: 'idemp_collision_test' });

            // Send different amount with same key
            const res = await request(app)
                .post(`/api/v1/billing/${testBillId}/pay`)
                .set('Cookie', adminSessionCookie)
                .send({ amountPaise: 60000, idempotencyKey: 'idemp_collision_test' });

            expect(res.status).toBe(409);
            expect(res.body.error.message).toContain('Idempotency key collision');
        });

        it('prevents overpayment beyond total amount', async () => {
            // Bill total is 200000 paise. Try to pay 250000 paise
            const res = await request(app)
                .post(`/api/v1/billing/${testBillId}/pay`)
                .set('Cookie', adminSessionCookie)
                .send({ amountPaise: 250000, idempotencyKey: 'idemp_overpay' });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toContain('Overpayment not permitted');

            // Bill paid_amount_paise remains 0
            const bill = await db.query('SELECT paid_amount_paise FROM bills WHERE id = $1', [testBillId]);
            expect(bill.rows[0].paid_amount_paise).toBe(0);
        });

        it('enforces safe balance update under concurrent payment requests', async () => {
            // Two parallel requests attempting to pay 100000 paise each on 200000 total bill
            const [res1, res2] = await Promise.all([
                request(app).post(`/api/v1/billing/${testBillId}/pay`).set('Cookie', adminSessionCookie).send({ amountPaise: 100000, idempotencyKey: 'conc_key_1' }),
                request(app).post(`/api/v1/billing/${testBillId}/pay`).set('Cookie', adminSessionCookie).send({ amountPaise: 100000, idempotencyKey: 'conc_key_2' })
            ]);

            expect(res1.status).toBe(201);
            expect(res2.status).toBe(201);

            const bill = await db.query('SELECT paid_amount_paise, total_amount_paise FROM bills WHERE id = $1', [testBillId]);
            expect(bill.rows[0].paid_amount_paise).toBe(200000);
        });

        it('allows admin to revoke a paid amount, recalculating the bill paid total and status', async () => {
            // Record a payment first
            const payRes = await request(app)
                .post(`/api/v1/billing/${testBillId}/pay`)
                .set('Cookie', adminSessionCookie)
                .send({ amountPaise: 60000, idempotencyKey: 'revoke_test_key' });
            expect(payRes.status).toBe(201);
            const paymentId = payRes.body.payment.id;

            // Non-admin attempting to revoke should get 403
            const memberRevokeRes = await request(app)
                .post(`/api/v1/billing/payments/${paymentId}/revoke`)
                .set('Cookie', member1SessionCookie)
                .send({ reason: 'Member attempt' });
            expect(memberRevokeRes.status).toBe(403);

            // Admin revoking payment
            const adminRevokeRes = await request(app)
                .post(`/api/v1/billing/payments/${paymentId}/revoke`)
                .set('Cookie', adminSessionCookie)
                .send({ reason: 'Incorrect entry' });
            expect(adminRevokeRes.status).toBe(200);
            expect(adminRevokeRes.body.payment.status).toBe('REVOKED');

            // Verify bill paid amount decremented back to 0
            const billRes = await request(app)
                .get(`/api/v1/billing/${testBillId}`)
                .set('Cookie', member1SessionCookie);
            expect(billRes.body.bill.paidAmountPaise).toBe(0);
            expect(billRes.body.bill.balancePaise).toBe(200000);
            expect(billRes.body.bill.paymentStatus).toBe('PENDING');

            // Attempting to revoke again should fail with 400
            const doubleRevokeRes = await request(app)
                .post(`/api/v1/billing/payments/${paymentId}/revoke`)
                .set('Cookie', adminSessionCookie);
            expect(doubleRevokeRes.status).toBe(400);
            expect(doubleRevokeRes.body.error.message).toContain('already been revoked');
        });
    });

    describe('Bill Finalization, Reopening & Authorization', () => {
        let testBillId;

        beforeEach(async () => {
            await db.query('DELETE FROM payments');
            await db.query('DELETE FROM bills');

            const res = await db.query(
                `INSERT INTO bills (household_id, user_id, billing_month, total_amount_paise, paid_amount_paise, status)
                 VALUES (1, $1, '2026-09', 200000, 200000, 'OPEN')
                 RETURNING id`,
                [member1Id]
            );
            testBillId = res.rows[0].id;
        });

        it('member cannot finalize bill; only admin can finalize', async () => {
            const forbiddenRes = await request(app)
                .post(`/api/v1/billing/${testBillId}/finalize`)
                .set('Cookie', member1SessionCookie);
            expect(forbiddenRes.status).toBe(403);

            const adminRes = await request(app)
                .post(`/api/v1/billing/${testBillId}/finalize`)
                .set('Cookie', adminSessionCookie);
            expect(adminRes.status).toBe(200);
            expect(adminRes.body.bill.status).toBe('FINALIZED');
        });

        it('reopening a finalized bill requires non-empty reason and updates status to REOPENED', async () => {
            // First finalize
            await request(app)
                .post(`/api/v1/billing/${testBillId}/finalize`)
                .set('Cookie', adminSessionCookie);

            // Try to reopen without reason -> 400
            const badRes = await request(app)
                .post(`/api/v1/billing/${testBillId}/reopen`)
                .set('Cookie', adminSessionCookie)
                .send({ reason: '' });
            expect(badRes.status).toBe(400);

            // Reopen with reason -> 200
            const okRes = await request(app)
                .post(`/api/v1/billing/${testBillId}/reopen`)
                .set('Cookie', adminSessionCookie)
                .send({ reason: 'Adjustment for guest meal charge' });
            expect(okRes.status).toBe(200);
            expect(okRes.body.bill.status).toBe('REOPENED');

            // Audit log check
            const audit = await db.query(
                `SELECT * FROM audit_logs WHERE action = 'REOPEN_BILL' AND entity_id = $1`,
                [String(testBillId)]
            );
            expect(audit.rows.length).toBeGreaterThan(0);
            expect(audit.rows[0].reason).toBe('Adjustment for guest meal charge');
        });

        it('generation preserves finalized bill without recalculating or overwriting', async () => {
            // Finalize bill with total 200000
            await request(app)
                .post(`/api/v1/billing/${testBillId}/finalize`)
                .set('Cookie', adminSessionCookie);

            // Run generation
            const genRes = await request(app)
                .post('/api/v1/billing/generate')
                .set('Cookie', adminSessionCookie)
                .send({ billingMonth: '2026-09' });

            const preserved = genRes.body.bills.find(b => b.id === testBillId);
            expect(preserved.action).toBe('PRESERVED_FINALIZED');
            expect(preserved.total_amount_paise).toBe(200000);
            expect(preserved.status).toBe('FINALIZED');
        });
    });

    describe('Mess Unavailability Billing Integration', () => {
        beforeEach(async () => {
            await db.query('DELETE FROM payments');
            await db.query('DELETE FROM bills');
            await db.query('DELETE FROM food_records');
            await db.query('DELETE FROM mess_unavailability_declarations');
        });

        it('active declaration overrides daily food charges to 0 paise for all household members', async () => {
            // Member 1 cancels food on 2026-09-05 (already 0)
            await db.query(
                `INSERT INTO food_records (household_id, user_id, record_date, status, rate_paise)
                 VALUES ($1, $2, '2026-09-05', 'CANCELLED', 10000)`,
                [householdId, member1Id]
            );

            // Admin declares mess unavailable on 2026-09-05 (which member1 already cancelled) and 2026-09-10
            await request(app)
                .post('/api/v1/food/unavailable')
                .set('Cookie', adminSessionCookie)
                .send({ date: '2026-09-05', reason: 'Cook on leave' });

            await request(app)
                .post('/api/v1/food/unavailable')
                .set('Cookie', adminSessionCookie)
                .send({ date: '2026-09-10', reason: 'Kitchen renovation' });

            // Generate bills for 2026-09 (30 days)
            // Rate is 10000 paise/day (Rs 100/day).
            // For 2026-09-05: member1 was cancelled, now mess unavailable -> still 0 charges (no duplicate credit).
            // For 2026-09-10: mess unavailable -> 0 charges for everyone.
            // Every member has 2 mess unavailable days (Sept 5 and Sept 10).
            // Member 1: 30 - 2 = 28 charged days -> 28 * 10000 = 280000 paise.
            // Member 2: 30 - 2 = 28 charged days -> 28 * 10000 = 280000 paise.
            const res = await request(app)
                .post('/api/v1/billing/generate')
                .set('Cookie', adminSessionCookie)
                .send({ billingMonth: '2026-09' });

            expect(res.status).toBe(200);
            expect(res.body.bills.length).toBe(4);

            const m1Bill = res.body.bills.find(b => b.user_id === member1Id);
            const m2Bill = res.body.bills.find(b => b.user_id === member2Id);

            expect(m1Bill.total_amount_paise).toBe(280000);
            expect(m2Bill.total_amount_paise).toBe(280000);

            // Check snapshot breakdown for 2026-09-05 and 2026-09-10
            const m1Snapshot = typeof m1Bill.snapshot_data === 'string'
                ? JSON.parse(m1Bill.snapshot_data)
                : m1Bill.snapshot_data;
            const m2Snapshot = typeof m2Bill.snapshot_data === 'string'
                ? JSON.parse(m2Bill.snapshot_data)
                : m2Bill.snapshot_data;

            const day5 = m1Snapshot.dailyBreakdown.find(d => d.date === '2026-09-05');
            expect(day5.status).toBe('MESS_UNAVAILABLE');
            expect(day5.chargedPaise).toBe(0);

            const day10 = m2Snapshot.dailyBreakdown.find(d => d.date === '2026-09-10');
            expect(day10.status).toBe('MESS_UNAVAILABLE');
            expect(day10.chargedPaise).toBe(0);
        });

        it('revoking a declaration and regenerating recalculates OPEN bills to restore normal rate', async () => {
            // Declare 2026-09-15 unavailable
            await request(app)
                .post('/api/v1/food/unavailable')
                .set('Cookie', adminSessionCookie)
                .send({ date: '2026-09-15', reason: 'Flooding' });

            // Generate bills: 29 charged days = 290000 paise
            const gen1 = await request(app)
                .post('/api/v1/billing/generate')
                .set('Cookie', adminSessionCookie)
                .send({ billingMonth: '2026-09' });
            expect(gen1.status).toBe(200);
            const bill1 = gen1.body.bills.find(b => b.user_id === member1Id);
            expect(bill1.total_amount_paise).toBe(290000);

            // Revoke declaration
            const revokeRes = await request(app)
                .patch('/api/v1/food/unavailable/2026-09-15/revoke')
                .set('Cookie', adminSessionCookie)
                .send({ reason: 'Water receded, mess operational' });
            expect(revokeRes.status).toBe(200);

            // Regenerate bills: now all 30 days charged = 300000 paise
            const gen2 = await request(app)
                .post('/api/v1/billing/generate')
                .set('Cookie', adminSessionCookie)
                .send({ billingMonth: '2026-09' });
            expect(gen2.status).toBe(200);
            const bill2 = gen2.body.bills.find(b => b.user_id === member1Id);
            expect(bill2.total_amount_paise).toBe(300000);
            expect(bill2.action).toBe('GENERATED');
        });

        it('FINALIZED bills remain completely untouched when a declaration is created or revoked', async () => {
            // Generate standard bills (300000 paise each)
            const gen = await request(app)
                .post('/api/v1/billing/generate')
                .set('Cookie', adminSessionCookie)
                .send({ billingMonth: '2026-09' });

            const targetBill = gen.body.bills.find(b => b.user_id === member1Id);

            // Finalize target bill
            await request(app)
                .post(`/api/v1/billing/${targetBill.id}/finalize`)
                .set('Cookie', adminSessionCookie);

            // Admin declares 2026-09-20 unavailable
            await request(app)
                .post('/api/v1/food/unavailable')
                .set('Cookie', adminSessionCookie)
                .send({ date: '2026-09-20', reason: 'Gas cylinder shortage' });

            // Run generate: finalized bill must be preserved
            const gen2 = await request(app)
                .post('/api/v1/billing/generate')
                .set('Cookie', adminSessionCookie)
                .send({ billingMonth: '2026-09' });

            const preservedBill = gen2.body.bills.find(b => b.id === targetBill.id);
            expect(preservedBill.action).toBe('PRESERVED_FINALIZED');
            expect(preservedBill.total_amount_paise).toBe(300000);

            // Verify in DB directly
            const dbCheck = await db.query('SELECT total_amount_paise, status FROM bills WHERE id = $1', [targetBill.id]);
            expect(dbCheck.rows[0].total_amount_paise).toBe(300000);
            expect(dbCheck.rows[0].status).toBe('FINALIZED');
        });
    });

    describe('Custom Member Mess Billing Cycles', () => {
        beforeEach(async () => {
            await db.query('DELETE FROM payments');
            await db.query('DELETE FROM bills');
            await db.query('DELETE FROM food_records');
            await db.query('DELETE FROM mess_unavailability_declarations');
            await db.query('UPDATE household_memberships SET mess_start_date = NULL');
        });

        it('admin can set and edit member mess service start dates, while members cannot', async () => {
            // Member attempts to update start date -> 403 Forbidden
            const memberRes = await request(app)
                .patch(`/api/v1/billing/members/${member1Id}/mess-start-date`)
                .set('Cookie', member1SessionCookie)
                .send({ messStartDate: '2026-10-10' });
            expect(memberRes.status).toBe(403);

            // Admin updates member1's start date -> 200 OK
            const adminRes = await request(app)
                .patch(`/api/v1/billing/members/${member1Id}/mess-start-date`)
                .set('Cookie', adminSessionCookie)
                .send({ messStartDate: '2026-10-10' });
            expect(adminRes.status).toBe(200);
            expect(adminRes.body.membership.mess_start_date).toBe('2026-10-10');

            // Admin updates member2's start date differently -> 2026-10-15
            await request(app)
                .patch(`/api/v1/billing/members/${member2Id}/mess-start-date`)
                .set('Cookie', adminSessionCookie)
                .send({ messStartDate: '2026-10-15' });

            // Fetch member cycle summary as admin
            const summaryRes = await request(app)
                .get('/api/v1/billing/members/cycles')
                .set('Cookie', adminSessionCookie);
            expect(summaryRes.status).toBe(200);

            const m1 = summaryRes.body.members.find(m => m.userId === member1Id);
            const m2 = summaryRes.body.members.find(m => m.userId === member2Id);

            expect(m1.messStartDate).toBe('2026-10-10');
            expect(m1.currentCycle.periodStart).toBe('2026-10-10');
            expect(m1.currentCycle.periodEnd).toBe('2026-11-10');
            expect(m1.currentCycle.nextBillingDate).toBe('2026-11-10');

            expect(m2.messStartDate).toBe('2026-10-15');
            expect(m2.currentCycle.periodStart).toBe('2026-10-15');
            expect(m2.currentCycle.periodEnd).toBe('2026-11-15');
            expect(m2.currentCycle.nextBillingDate).toBe('2026-11-15');
        });

        it('calculates custom billing cycles with start-inclusive, end-exclusive interval and integrates food cancellations', async () => {
            // Set member1 mess start date: 2026-10-10
            await request(app)
                .patch(`/api/v1/billing/members/${member1Id}/mess-start-date`)
                .set('Cookie', adminSessionCookie)
                .send({ messStartDate: '2026-10-10' });

            // Food cancellation inside the cycle (2026-10-15)
            await db.query(
                `INSERT INTO food_records (household_id, user_id, record_date, status, rate_paise)
                 VALUES ($1, $2, '2026-10-15', 'CANCELLED', 10000)`,
                [householdId, member1Id]
            );

            // Food cancellation ON THE END DATE (2026-11-10) -> Should NOT affect the first cycle (end-exclusive)
            await db.query(
                `INSERT INTO food_records (household_id, user_id, record_date, status, rate_paise)
                 VALUES ($1, $2, '2026-11-10', 'CANCELLED', 10000)`,
                [householdId, member1Id]
            );

            // Generate bills for 2026-10
            const genRes = await request(app)
                .post('/api/v1/billing/generate')
                .set('Cookie', adminSessionCookie)
                .send({ billingMonth: '2026-10' });
            expect(genRes.status).toBe(200);

            const m1Bill = genRes.body.bills.find(b => b.user_id === member1Id);
            expect(m1Bill.period_start).toBe('2026-10-10');
            expect(m1Bill.period_end).toBe('2026-11-10');

            const snapshot = typeof m1Bill.snapshot_data === 'string'
                ? JSON.parse(m1Bill.snapshot_data)
                : m1Bill.snapshot_data;

            // Total days from 2026-10-10 to 2026-11-10 (end-exclusive) = 31 days (Oct 10 to Nov 9)
            expect(snapshot.totalDays).toBe(31);
            expect(snapshot.cancelledDays).toBe(1); // Only Oct 15, NOT Nov 10
            expect(snapshot.chargeableDays).toBe(30);

            // Total paise = 30 * 13000 = 390000 paise (₹130/day)
            expect(m1Bill.total_amount_paise).toBe(390000);
        });

        it('correctly tracks Paid and Pending status and prevents payment collision across cycles', async () => {
            // Set member1 mess start date: 2026-10-10
            await request(app)
                .patch(`/api/v1/billing/members/${member1Id}/mess-start-date`)
                .set('Cookie', adminSessionCookie)
                .send({ messStartDate: '2026-10-10' });

            // Generate bill
            const genRes = await request(app)
                .post('/api/v1/billing/generate')
                .set('Cookie', adminSessionCookie)
                .send({ billingMonth: '2026-10' });
            expect(genRes.status).toBe(200);

            const m1Bill = genRes.body.bills.find(b => b.user_id === member1Id);

            // Make full payment (admin only)
            const payRes = await request(app)
                .post(`/api/v1/billing/${m1Bill.id}/pay`)
                .set('Cookie', adminSessionCookie)
                .send({
                    amountPaise: m1Bill.total_amount_paise,
                    idempotencyKey: `cycle_pay_${m1Bill.id}_1`
                });
            expect(payRes.status).toBe(201);

            // Fetch bills -> verify status is PAID and balance is 0
            const billsRes = await request(app)
                .get('/api/v1/billing')
                .set('Cookie', member1SessionCookie);
            expect(billsRes.status).toBe(200);

            const paidBill = billsRes.body.bills.find(b => b.id === m1Bill.id);
            expect(paidBill.paymentStatus).toBe('PAID');
            expect(paidBill.balancePaise).toBe(0);
            expect(paidBill.paidAmountPaise).toBe(m1Bill.total_amount_paise);
        });
    });

    describe('Privacy & Role-Based Authorization Isolation', () => {
        let adminBillId;
        let member1BillId;
        let member2BillId;

        beforeAll(async () => {
            // Generate bills for September
            const res = await request(app)
                .post('/api/v1/billing/generate')
                .set('Cookie', adminSessionCookie)
                .send({ billingMonth: testMonth });

            const bills = res.body.bills;
            adminBillId = bills.find(b => b.user_id === adminId)?.id;
            member1BillId = bills.find(b => b.user_id === member1Id)?.id;
            member2BillId = bills.find(b => b.user_id === member2Id)?.id;
        });

        it('member cannot access another member private bill via /api/v1/billing/:id (IDOR protection)', async () => {
            // member1 attempts to access member2's bill
            const res = await request(app)
                .get(`/api/v1/billing/${member2BillId}`)
                .set('Cookie', member1SessionCookie);

            expect(res.status).toBe(403);
            expect(res.body.error.message).toMatch(/Forbidden/i);
        });

        it('member cannot view another member payment history via /api/v1/billing/:id/payments', async () => {
            // member1 attempts to access member2's bill payment history
            const res = await request(app)
                .get(`/api/v1/billing/${member2BillId}/payments`)
                .set('Cookie', member1SessionCookie);

            expect(res.status).toBe(403);
            expect(res.body.error.message).toMatch(/Forbidden/i);
        });

        it('member querying /api/v1/billing receives ONLY their own bills even if querying without filter', async () => {
            const res = await request(app)
                .get('/api/v1/billing')
                .set('Cookie', member1SessionCookie);

            expect(res.status).toBe(200);
            expect(res.body.bills.length).toBeGreaterThan(0);
            // Every bill returned must belong to member1
            res.body.bills.forEach(bill => {
                expect(bill.userId).toBe(member1Id);
            });
        });

        it('member querying /api/v1/billing with another user userId param is still restricted to their own bills', async () => {
            const res = await request(app)
                .get(`/api/v1/billing?userId=${member2Id}`)
                .set('Cookie', member1SessionCookie);

            expect(res.status).toBe(200);
            // Cannot see member2's bills; only sees their own
            res.body.bills.forEach(bill => {
                expect(bill.userId).toBe(member1Id);
            });
        });

        it('admin can view household-wide bills and specific member bills', async () => {
            const res = await request(app)
                .get('/api/v1/billing')
                .set('Cookie', adminSessionCookie);

            expect(res.status).toBe(200);
            const userIds = res.body.bills.map(b => b.userId);
            expect(userIds).toContain(adminId);
            expect(userIds).toContain(member1Id);
            expect(userIds).toContain(member2Id);
        });

        it('ordinary member cannot perform admin-only billing operations (generate, finalize, reopen, update start date)', async () => {
            const genRes = await request(app)
                .post('/api/v1/billing/generate')
                .set('Cookie', member1SessionCookie)
                .send({ billingMonth: '2026-11' });
            expect(genRes.status).toBe(403);

            const finRes = await request(app)
                .post(`/api/v1/billing/${member1BillId}/finalize`)
                .set('Cookie', member1SessionCookie);
            expect(finRes.status).toBe(403);

            const reopenRes = await request(app)
                .post(`/api/v1/billing/${member1BillId}/reopen`)
                .set('Cookie', member1SessionCookie)
                .send({ reason: 'testing' });
            expect(reopenRes.status).toBe(403);

            const patchRes = await request(app)
                .patch(`/api/v1/billing/members/${member2Id}/mess-start-date`)
                .set('Cookie', member1SessionCookie)
                .send({ messStartDate: '2026-10-15' });
            expect(patchRes.status).toBe(403);
        });

        it('member requesting /members/cycles only sees their own cycle, while admin sees all members', async () => {
            const memberRes = await request(app)
                .get('/api/v1/billing/members/cycles')
                .set('Cookie', member1SessionCookie);
            expect(memberRes.status).toBe(200);
            expect(memberRes.body.members).toHaveLength(1);
            expect(memberRes.body.members[0].userId).toBe(member1Id);

            const adminRes = await request(app)
                .get('/api/v1/billing/members/cycles')
                .set('Cookie', adminSessionCookie);
            expect(adminRes.status).toBe(200);
            expect(adminRes.body.members.length).toBeGreaterThanOrEqual(4);
        });
    });
});


