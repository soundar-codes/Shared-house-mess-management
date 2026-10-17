const request = require('supertest');
const app = require('../src/app');
const db = require('../src/utils/db');
const { hashPassword } = require('../src/services/authService');
const billingService = require('../src/services/billingService');

describe('Daily Accumulating Billing Integration Tests', () => {
    let adminCookie;
    let memberCookie;

    beforeAll(async () => {
        // Clean relevant test data
        await db.query('DELETE FROM member_leaves WHERE household_id = 1');
        await db.query('DELETE FROM food_records WHERE household_id = 1 AND record_date >= $1', ['2026-10-01']);
        await db.query('DELETE FROM mess_unavailability_declarations WHERE household_id = 1');
        await db.query("DELETE FROM bills WHERE household_id = 1 AND user_id = 'user_sanjay'");

        // Ensure active food_configuration with Rs 130 (13,000 paise)
        await db.query('DELETE FROM food_configuration WHERE household_id = 1');
        await db.query(
            `INSERT INTO food_configuration (household_id, default_rate_paise, valid_from, valid_to)
             VALUES (1, 13000, '2026-10-01 00:00:00+05:30', NULL)`
        );

        // Set Sanjay's mess start date to 2026-10-10
        await db.query(
            `UPDATE household_memberships 
             SET mess_start_date = '2026-10-10' 
             WHERE household_id = 1 AND user_id = 'user_sanjay'`
        );

        // Login Soundar (ADMIN)
        const adminRes = await request(app).post('/api/v1/auth/login').send({
            userId: 'Soundar',
            password: 'TestSoundar#2026'
        });
        adminCookie = adminRes.headers['set-cookie'].find(c => c.startsWith('session_token='));

        // Login Sanjay (MEMBER)
        const memberRes = await request(app).post('/api/v1/auth/login').send({
            userId: 'Sanjay',
            password: 'TestSanjay#2026'
        });
        memberCookie = memberRes.headers['set-cookie'].find(c => c.startsWith('session_token='));
    });

    afterAll(async () => {
        await db.pool.end();
    });

    test('1. One chargeable day produces exactly Rs 130 (13,000 paise)', async () => {
        // 1 chargeable day: 2026-10-10
        const intervalBreakdown = await billingService.calculateIntervalBreakdown(
            1,
            'user_sanjay',
            '2026-10-10',
            '2026-10-11' // 1 day
        );
        expect(intervalBreakdown.chargeableDays).toBe(1);
        expect(intervalBreakdown.totalPaise).toBe(13000); // Rs 130
    });

    test('2. Five chargeable days produce exactly Rs 650 (65,000 paise)', async () => {
        // 5 chargeable days: 2026-10-10 to 2026-10-15
        const intervalBreakdown = await billingService.calculateIntervalBreakdown(
            1,
            'user_sanjay',
            '2026-10-10',
            '2026-10-15' // 5 days
        );
        expect(intervalBreakdown.chargeableDays).toBe(5);
        expect(intervalBreakdown.totalPaise).toBe(65000); // Rs 650
    });

    test('3. Thirty chargeable days produce exactly Rs 3,900 (390,000 paise)', async () => {
        // 30 chargeable days: 2026-10-10 to 2026-11-09
        const intervalBreakdown = await billingService.calculateIntervalBreakdown(
            1,
            'user_sanjay',
            '2026-10-10',
            '2026-11-09' // 30 days
        );
        const non13 = intervalBreakdown.dailyBreakdown.filter(d => d.chargedPaise !== 13000);
        if (non13.length > 0) {
            console.log('Test 3 non-13000 days:', non13);
        }
        expect(intervalBreakdown.chargeableDays).toBe(30);
        expect(intervalBreakdown.totalPaise).toBe(390000); // Rs 3,900
    });

    test('4. Cancelled day adds Rs 0 and does not increment food amount', async () => {
        // Mark 2026-10-12 as CANCELLED
        await db.query(
            `INSERT INTO food_records (household_id, user_id, record_date, status, rate_paise)
             VALUES (1, 'user_sanjay', '2026-10-12', 'CANCELLED', 0)
             ON CONFLICT (household_id, user_id, record_date) 
             DO UPDATE SET status = 'CANCELLED', rate_paise = 0`
        );

        // 3-day interval: 10, 11, 12 (10 & 11 Ate, 12 Cancelled)
        const intervalBreakdown = await billingService.calculateIntervalBreakdown(
            1,
            'user_sanjay',
            '2026-10-10',
            '2026-10-13' // 3 days
        );
        expect(intervalBreakdown.chargeableDays).toBe(2);
        expect(intervalBreakdown.cancelledDays).toBe(1);
        expect(intervalBreakdown.totalPaise).toBe(26000); // 2 * Rs 130 = Rs 260
    });

    test('5. Approved leave days add Rs 0 under leave-adjusted daily billing', async () => {
        // Record 2 days of approved leave: 2026-10-13 and 2026-10-14
        await db.query(
            `INSERT INTO food_records (household_id, user_id, record_date, status, rate_paise)
             VALUES 
                (1, 'user_sanjay', '2026-10-13', 'ON_LEAVE', 0),
                (1, 'user_sanjay', '2026-10-14', 'ON_LEAVE', 0)
             ON CONFLICT (household_id, user_id, record_date) 
             DO UPDATE SET status = 'ON_LEAVE', rate_paise = 0`
        );

        // Interval 2026-10-10 to 2026-10-15 (5 days: 2 Ate, 1 Cancelled, 2 Leave)
        const intervalBreakdown = await billingService.calculateIntervalBreakdown(
            1,
            'user_sanjay',
            '2026-10-10',
            '2026-10-15'
        );
        expect(intervalBreakdown.chargeableDays).toBe(2);
        expect(intervalBreakdown.cancelledDays).toBe(1);
        expect(intervalBreakdown.leaveDays).toBe(2);
        expect(intervalBreakdown.totalPaise).toBe(26000); // Still Rs 260
    });

    test('6. Member dashboard cycle summary endpoint returns dynamic daily accumulating metrics', async () => {
        const res = await request(app)
            .get('/api/v1/billing/members/cycles')
            .set('Cookie', memberCookie);

        expect(res.status).toBe(200);
        expect(res.body.members).toHaveLength(1);
        const myData = res.body.members[0];
        expect(myData.userId).toBe('user_sanjay');
        expect(myData.currentCycle).toBeDefined();
        expect(myData.currentCycle.accumulatedFoodPaise).toBeGreaterThan(0);
        expect(myData.currentCycle.chargeableDays).toBeDefined();
        expect(myData.currentCycle.cancelledDays).toBeGreaterThanOrEqual(1);
        expect(myData.currentCycle.leaveDays).toBeGreaterThanOrEqual(2);
        expect(myData.currentCycle.todayFoodChargePaise).toBeDefined();
        expect(myData.currentCycle.calculatedAt).toBeDefined();
    });

    test('7. Member cannot see other members amounts (role-based isolation)', async () => {
        // Member request
        const memberRes = await request(app)
            .get('/api/v1/billing/members/cycles')
            .set('Cookie', memberCookie);

        expect(memberRes.status).toBe(200);
        expect(memberRes.body.members).toHaveLength(1);
        expect(memberRes.body.members[0].userId).toBe('user_sanjay');

        // Admin request sees all 4 members
        const adminRes = await request(app)
            .get('/api/v1/billing/members/cycles')
            .set('Cookie', adminCookie);

        expect(adminRes.status).toBe(200);
        expect(adminRes.body.members.length).toBeGreaterThanOrEqual(4);
    });

    test('8. Finalized bills and payment records are preserved', async () => {
        // Create finalized bill for Sanjay
        const finalizedBillRes = await db.query(
            `INSERT INTO bills (household_id, user_id, billing_month, period_start, period_end, total_amount_paise, paid_amount_paise, status)
             VALUES (1, 'user_sanjay', '2026-09', '2026-09-10', '2026-10-10', 390000, 390000, 'FINALIZED')
             ON CONFLICT (household_id, user_id, billing_month)
             DO UPDATE SET status = 'FINALIZED', total_amount_paise = 390000, paid_amount_paise = 390000
             RETURNING id, status, total_amount_paise, paid_amount_paise`
        );
        const billId = finalizedBillRes.rows[0].id;

        // Verify fetching bill preserves finalized status and amount
        const bill = await billingService.getBillById(1, billId, { id: 'user_soundar', role: 'ADMIN' });
        expect(bill.status).toBe('FINALIZED');
        expect(bill.totalAmountPaise).toBe(390000);
        expect(bill.paidAmountPaise).toBe(390000);
    });
});
