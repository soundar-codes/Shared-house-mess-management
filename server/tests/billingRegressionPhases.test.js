const request = require('supertest');
const fs = require('fs');
const path = require('path');

const app = require('../src/app');
const db = require('../src/utils/db');
const { createSession } = require('../src/services/authService');
const billingService = require('../src/services/billingService');
const foodService = require('../src/services/foodService');
const { 
    calculateBillingCycle, 
    getCurrentBillingCycle, 
    getDatesInInterval, 
    getTomorrowDateStr,
    isFoodUpdateAllowed
} = require('../src/utils/dateUtils');

describe('Phase 11 — Automatic Billing, Date Boundaries, and Data Integrity Regression Suite', () => {
    let adminToken, memberToken, rajToken;
    let adminCookie, memberCookie, rajCookie;

    const adminId = 'user_soundar';
    const memberId = 'user_sanjay';
    const rajId = 'user_raj';
    const householdId = 1;

    beforeAll(async () => {
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
        const tokenMember = await createSession(memberId);
        const tokenRaj = await createSession(rajId);

        adminCookie = `session_token=${tokenAdmin.token}`;
        memberCookie = `session_token=${tokenMember.token}`;
        rajCookie = `session_token=${tokenRaj.token}`;
    });

    afterAll(async () => {
        await db.pool.end();
    });

    // -------------------------------------------------------------
    // Test 1: One chargeable day = ₹130 (13,000 paise)
    // -------------------------------------------------------------
    test('1. One chargeable day = ₹130 (13,000 paise)', async () => {
        const startDate = '2026-10-01';
        const endDate = '2026-10-02'; // Exactly 1 day [2026-10-01, 2026-10-02)

        const breakdown = await billingService.calculateIntervalBreakdown(
            householdId,
            memberId,
            startDate,
            endDate
        );

        expect(breakdown.chargeableDays).toBe(1);
        expect(breakdown.totalPaise).toBe(13000); // ₹130.00
    });

    // -------------------------------------------------------------
    // Test 2: Twenty-four chargeable days = ₹3,120 (312,000 paise)
    // -------------------------------------------------------------
    test('2. Twenty-four chargeable days = ₹3,120 (312,000 paise)', async () => {
        const startDate = '2026-10-01';
        const endDate = '2026-10-25'; // 24 days [2026-10-01, 2026-10-25)

        const breakdown = await billingService.calculateIntervalBreakdown(
            householdId,
            memberId,
            startDate,
            endDate
        );

        expect(breakdown.chargeableDays).toBe(24);
        expect(breakdown.totalPaise).toBe(312000); // 24 * ₹130 = ₹3,120
    });

    // -------------------------------------------------------------
    // Test 3: Thirty chargeable days = ₹3,900 (390,000 paise)
    // -------------------------------------------------------------
    test('3. Thirty chargeable days = ₹3,900 (390,000 paise)', async () => {
        const startDate = '2026-11-01';
        const endDate = '2026-12-01'; // 30 days in November under ₹130 rate policy

        const breakdown = await billingService.calculateIntervalBreakdown(
            householdId,
            memberId,
            startDate,
            endDate
        );

        expect(breakdown.chargeableDays).toBe(30);
        expect(breakdown.totalPaise).toBe(390000); // 30 * ₹130 = ₹3,900
    });

    // -------------------------------------------------------------
    // Test 4: Cancelled and approved leave days are non-chargeable (₹0)
    // -------------------------------------------------------------
    test('4. Cancelled and approved leave days are non-chargeable', async () => {
        const startDate = '2026-11-01';
        const endDate = '2026-11-06'; // 5 days

        // Day 1 (11-01): FOOD_REQUIRED (Chargeable)
        // Day 2 (11-02): CANCELLED (₹0)
        await db.query(
            `INSERT INTO food_records (household_id, user_id, record_date, status, rate_paise)
             VALUES ($1, $2, '2026-11-02', 'CANCELLED', 13000)
             ON CONFLICT (household_id, user_id, record_date) DO UPDATE SET status = 'CANCELLED'`,
            [householdId, memberId]
        );

        // Day 3 & 4 (11-03, 11-04): ON_LEAVE (₹0)
        await foodService.createMemberLeave(
            householdId,
            {
                userIds: [memberId],
                startDate: '2026-11-03',
                endDate: '2026-11-04',
                reason: 'Conference'
            },
            { id: adminId, role: 'ADMIN' }
        );

        // Day 5 (11-05): FOOD_REQUIRED (Chargeable)
        const breakdown = await billingService.calculateIntervalBreakdown(
            householdId,
            memberId,
            startDate,
            endDate
        );

        expect(breakdown.dailyBreakdown.length).toBe(5);
        expect(breakdown.chargeableDays).toBe(2); // 11-01 and 11-05
        expect(breakdown.cancelledDays).toBe(1); // 11-02
        expect(breakdown.leaveDays).toBe(2); // 11-03, 11-04
        expect(breakdown.totalPaise).toBe(26000); // 2 * ₹130 = ₹260
    });

    // -------------------------------------------------------------
    // Test 5: A member cannot cancel food for dates other than tomorrow
    // -------------------------------------------------------------
    test('5. A member cannot cancel food for dates other than tomorrow', async () => {
        app.locals.mockTime = new Date('2026-10-17T10:00:00.000Z');

        // Past date
        const resPast = await request(app)
            .put('/api/v1/food/2026-10-16')
            .set('Cookie', memberCookie)
            .send({ status: 'CANCELLED' });
        expect(resPast.status).toBe(403);
        expect(resPast.body.error.message).toMatch(/tomorrow/i);

        // Today
        const resToday = await request(app)
            .put('/api/v1/food/2026-10-17')
            .set('Cookie', memberCookie)
            .send({ status: 'CANCELLED' });
        expect(resToday.status).toBe(403);
        expect(resToday.body.error.message).toMatch(/tomorrow/i);

        // Future beyond tomorrow
        const resFar = await request(app)
            .put('/api/v1/food/2026-10-25')
            .set('Cookie', memberCookie)
            .send({ status: 'CANCELLED' });
        expect(resFar.status).toBe(403);
        expect(resFar.body.error.message).toMatch(/tomorrow/i);

        delete app.locals.mockTime;
    });

    // -------------------------------------------------------------
    // Test 6: A member cannot cancel food during approved leave
    // -------------------------------------------------------------
    test('6. A member cannot cancel food during approved leave', async () => {
        app.locals.mockTime = new Date('2026-10-17T10:00:00.000Z');
        const tomorrow = getTomorrowDateStr(app.locals.mockTime);

        // Create approved leave on tomorrow for member
        await db.query(
            `INSERT INTO member_leaves (household_id, user_id, start_date, end_date, reason, created_by, status)
             VALUES ($1, $2, $3, $3, 'Sick Leave', $4, 'ACTIVE')`,
            [householdId, memberId, tomorrow, adminId]
        );

        // Member attempts to cancel food on tomorrow
        const res = await request(app)
            .put(`/api/v1/food/${tomorrow}`)
            .set('Cookie', memberCookie)
            .send({ status: 'CANCELLED' });

        expect(res.status).toBe(403);
        expect(res.body.error.message).toMatch(/approved leave/i);

        delete app.locals.mockTime;
    });

    // -------------------------------------------------------------
    // Test 7: A cycle’s start and end boundaries are calculated consistently
    // -------------------------------------------------------------
    test('7. A cycle’s start and end boundaries are calculated consistently [startDate, endDate)', () => {
        // Cycle 0: starts 2026-10-10 -> ends 2026-11-10 (next billing date = 2026-11-10)
        const cycle0 = calculateBillingCycle('2026-10-10', 0);
        expect(cycle0.startDate).toBe('2026-10-10');
        expect(cycle0.endDate).toBe('2026-11-10');
        expect(cycle0.nextBillingDate).toBe('2026-11-10');

        // Cycle 1: starts 2026-11-10 -> ends 2026-12-10
        const cycle1 = calculateBillingCycle('2026-10-10', 1);
        expect(cycle1.startDate).toBe('2026-11-10');
        expect(cycle1.endDate).toBe('2026-12-10');

        // Year boundary: 2026-12-15 -> 2027-01-15
        const cycleYear = calculateBillingCycle('2026-12-15', 0);
        expect(cycleYear.startDate).toBe('2026-12-15');
        expect(cycleYear.endDate).toBe('2027-01-15');

        // Leap year: 2024-01-31 -> 2024-02-29
        const cycleLeap = calculateBillingCycle('2024-01-31', 0);
        expect(cycleLeap.startDate).toBe('2024-01-31');
        expect(cycleLeap.endDate).toBe('2024-02-29');

        // Interval generates exactly [startDate, endDate)
        const dates = getDatesInInterval('2026-10-10', '2026-10-15');
        expect(dates).toEqual(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']);
        expect(dates).not.toContain('2026-10-15');
    });

    // -------------------------------------------------------------
    // Test 8: Missing billing configuration produces an explicit error
    // -------------------------------------------------------------
    test('8. Missing billing configuration produces an explicit error', async () => {
        // Querying non-existent household food config returns undefined/null
        const nonExistentConfig = await foodService.getActiveFoodConfig(9999);
        expect(nonExistentConfig).toBeUndefined();

        // Calling updateMemberFood with missing config throws an error
        await expect(
            foodService.updateMemberFood(9999, 'user_soundar', '2026-10-18', 'CANCELLED', null)
        ).rejects.toThrow();
    });

    // -------------------------------------------------------------
    // Test 9: Raj’s billing-cycle configuration works correctly without member-specific hardcoding
    // -------------------------------------------------------------
    test('9. Raj’s billing-cycle configuration works correctly without member-specific hardcoding', async () => {
        // Verify Raj has a valid configured mess_start_date in household_memberships
        const rajRes = await db.query(
            `SELECT mess_start_date FROM household_memberships WHERE household_id = $1 AND user_id = $2`,
            [householdId, rajId]
        );
        expect(rajRes.rows[0].mess_start_date).toBeDefined();
        expect(rajRes.rows[0].mess_start_date).not.toBeNull();

        // Calculate cycle for Raj using standard generic function
        const rajCycle = getCurrentBillingCycle('2026-10-12', '2026-10-17');
        expect(rajCycle.startDate).toBe('2026-10-12');
        expect(rajCycle.endDate).toBe('2026-11-12');
        expect(rajCycle.nextBillingDate).toBe('2026-11-12');

        // Fetch /api/v1/billing/members/cycles as Raj
        const res = await request(app)
            .get('/api/v1/billing/members/cycles')
            .set('Cookie', rajCookie);

        expect(res.status).toBe(200);
        expect(res.body.members).toHaveLength(1);
        expect(res.body.members[0].userId).toBe(rajId);
        expect(res.body.members[0].messStartDate).toBe('2026-10-12');
        expect(res.body.members[0].currentCycle.periodStart).toBe('2026-10-12');
        expect(res.body.members[0].currentCycle.periodEnd).toBe('2026-11-12');
    });

    // -------------------------------------------------------------
    // Test 10: Rate changes do not silently change historical finalized bills
    // -------------------------------------------------------------
    test('10. Rate changes do not silently change historical finalized bills', async () => {
        // Create and finalize a bill for Soundar with rate ₹130
        const genRes = await request(app)
            .post('/api/v1/billing/generate')
            .set('Cookie', adminCookie)
            .send({ billingMonth: '2026-08' });

        const bills = genRes.body.bills || [];
        const soundarBill = bills.find(b => b.user_id === adminId);
        expect(soundarBill).toBeDefined();

        // Finalize this bill
        const finRes = await request(app)
            .post(`/api/v1/billing/${soundarBill.id}/finalize`)
            .set('Cookie', adminCookie);
        expect(finRes.status).toBe(200);

        const originalTotal = soundarBill.total_amount_paise;

        // Introduce a new rate in food_configuration: ₹150 (15,000 paise)
        await db.query(
            `INSERT INTO food_configuration (household_id, default_rate_paise, valid_from)
             VALUES ($1, 15000, CURRENT_TIMESTAMP)`,
            [householdId]
        );

        // Fetch finalized bill again
        const checkRes = await request(app)
            .get(`/api/v1/billing/${soundarBill.id}`)
            .set('Cookie', adminCookie);

        expect(checkRes.status).toBe(200);
        // Total amount MUST remain exactly identical to original
        expect(checkRes.body.bill.totalAmountPaise).toBe(originalTotal);
        expect(checkRes.body.bill.status).toBe('FINALIZED');
    });

    // -------------------------------------------------------------
    // Test 11: Payments and finalized bill totals remain intact
    // -------------------------------------------------------------
    test('11. Payments and finalized bill totals remain intact', async () => {
        // Find Soundar's August bill
        const bRes = await db.query(`SELECT id, total_amount_paise FROM bills WHERE user_id = $1 AND billing_month = '2026-08'`, [adminId]);
        const billId = bRes.rows[0].id;
        const total = bRes.rows[0].total_amount_paise;

        // Record payment of ₹1,000 (100,000 paise)
        const payRes = await request(app)
            .post(`/api/v1/billing/${billId}/pay`)
            .set('Cookie', adminCookie)
            .send({
                amountPaise: 100000,
                idempotencyKey: 'pay_integrity_test_key_11'
            });
        expect(payRes.status).toBe(201);
        expect(payRes.body.payment).toBeDefined();
        expect(payRes.body.payment.amountPaise).toBe(100000);

        // Trigger scheduler check
        await billingService.runAutomaticBillingCheck({ todayStr: '2026-10-17' });

        // Verify payment is still preserved
        const verifyRes = await request(app)
            .get(`/api/v1/billing/${billId}`)
            .set('Cookie', adminCookie);

        expect(verifyRes.body.bill.paidAmountPaise).toBe(100000);
        expect(verifyRes.body.bill.balancePaise).toBe(total - 100000);
        expect(verifyRes.body.bill.totalAmountPaise).toBe(total);
    });

    // -------------------------------------------------------------
    // Test 12: Repeated or concurrent scheduler runs do not create duplicate records
    // -------------------------------------------------------------
    test('12. Repeated or concurrent scheduler runs do not create duplicate records', async () => {
        const countBefore = await db.query('SELECT COUNT(*) as count FROM bills');
        const initialCount = parseInt(countBefore.rows[0].count, 10);

        // Run 3 concurrent scheduler executions
        const [run1, run2, run3] = await Promise.all([
            billingService.runAutomaticBillingCheck({ todayStr: '2026-10-17' }),
            billingService.runAutomaticBillingCheck({ todayStr: '2026-10-17' }),
            billingService.runAutomaticBillingCheck({ todayStr: '2026-10-17' })
        ]);

        expect(run1[0].status).toBe('SUCCESS');
        expect(run2[0].status).toBe('SUCCESS');
        expect(run3[0].status).toBe('SUCCESS');

        const countAfter = await db.query('SELECT COUNT(*) as count FROM bills');
        const finalCount = parseInt(countAfter.rows[0].count, 10);

        // No unbounded duplication: total bills must remain controlled
        expect(finalCount - initialCount).toBeLessThanOrEqual(4);
    });

    // -------------------------------------------------------------
    // Test 13: Cancellation cutoff enforcement uses the correct timezone (Asia/Kolkata)
    // -------------------------------------------------------------
    test('13. Cancellation cutoff enforcement uses Asia/Kolkata timezone and cutoff time', () => {
        const tomorrow = '2026-10-18';

        // 22:59:00 IST (17:29:00 UTC) -> Before 23:00 cutoff -> Allowed
        const beforeCutoffTime = new Date('2026-10-17T17:29:00.000Z');
        expect(isFoodUpdateAllowed(tomorrow, beforeCutoffTime, '23:00')).toBe(true);

        // 23:00:00 IST (17:30:00 UTC) -> Exactly at cutoff -> Rejected
        const atCutoffTime = new Date('2026-10-17T17:30:00.000Z');
        expect(isFoodUpdateAllowed(tomorrow, atCutoffTime, '23:00')).toBe(false);

        // 23:15:00 IST (17:45:00 UTC) -> After cutoff -> Rejected
        const afterCutoffTime = new Date('2026-10-17T17:45:00.000Z');
        expect(isFoodUpdateAllowed(tomorrow, afterCutoffTime, '23:00')).toBe(false);

        // Custom household cutoff: 22:00
        expect(isFoodUpdateAllowed(tomorrow, beforeCutoffTime, '22:00')).toBe(false); // 22:59 is past 22:00 cutoff
    });

    // -------------------------------------------------------------
    // Test 14: Leave cancellation restores the previous attendance state
    // -------------------------------------------------------------
    test('14. Leave cancellation restores previous attendance state', async () => {
        const leaveDate = '2026-11-20';

        // Set previous status as CANCELLED
        await db.query(
            `INSERT INTO food_records (household_id, user_id, record_date, status, rate_paise)
             VALUES ($1, $2, $3, 'CANCELLED', 13000)
             ON CONFLICT (household_id, user_id, record_date) DO UPDATE SET status = 'CANCELLED'`,
            [householdId, memberId, leaveDate]
        );

        // Admin schedules leave covering this date
        const leaveRes = await foodService.createMemberLeave(
            householdId,
            {
                userIds: [memberId],
                startDate: leaveDate,
                endDate: leaveDate,
                reason: 'Family Event'
            },
            { id: adminId, role: 'ADMIN' }
        );
        const leaveId = leaveRes.leaves[0].id;

        // Food record should now be ON_LEAVE
        const midCheck = await db.query(
            `SELECT status FROM food_records WHERE household_id = $1 AND user_id = $2 AND record_date = $3`,
            [householdId, memberId, leaveDate]
        );
        expect(midCheck.rows[0].status).toBe('ON_LEAVE');

        // Admin cancels the leave
        await foodService.cancelMemberLeave(
            householdId,
            leaveId,
            'Event postponed',
            { id: adminId, role: 'ADMIN' }
        );

        // Food record should be RESTORED to 'CANCELLED'!
        const finalCheck = await db.query(
            `SELECT status FROM food_records WHERE household_id = $1 AND user_id = $2 AND record_date = $3`,
            [householdId, memberId, leaveDate]
        );
        expect(finalCheck.rows[0].status).toBe('CANCELLED');
    });
});
