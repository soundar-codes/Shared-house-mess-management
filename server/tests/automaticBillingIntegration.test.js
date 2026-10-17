const request = require('supertest');
const app = require('../src/app');
const db = require('../src/utils/db');
const { hashPassword } = require('../src/services/authService');
const { 
    runAutomaticBillingCheck, 
    getLatestAutomationStatus 
} = require('../src/services/billingService');
const { 
    startBillingScheduler, 
    stopBillingScheduler, 
    executeBillingAutomationCycle 
} = require('../src/services/billingScheduler');

describe('Automatic Billing & Scheduler Integration', () => {
    let adminCookie;
    let memberCookie;

    beforeAll(async () => {
        // Login as Soundar (admin)
        const adminRes = await request(app).post('/api/v1/auth/login').send({
            userId: 'Soundar',
            password: 'TestSoundar#2026'
        });
        const cookies = adminRes.headers['set-cookie'];
        adminCookie = cookies.find(c => c.startsWith('session_token='));

        // Login as Sanjay (member)
        const memberRes = await request(app).post('/api/v1/auth/login').send({
            userId: 'Sanjay',
            password: 'TestSanjay#2026'
        });
        const mCookies = memberRes.headers['set-cookie'];
        memberCookie = mCookies.find(c => c.startsWith('session_token='));
    });

    afterAll(async () => {
        stopBillingScheduler();
        await db.pool.end();
    });

    test('1. Runs automatic billing check for members with different start dates', async () => {
        // Set distinct mess start dates
        await db.query(`UPDATE household_memberships SET mess_start_date = '2026-10-10' WHERE user_id = 'user_soundar'`);
        await db.query(`UPDATE household_memberships SET mess_start_date = '2026-10-15' WHERE user_id = 'user_sanjay'`);
        await db.query(`UPDATE household_memberships SET mess_start_date = '2026-10-12' WHERE user_id = 'user_mukesh'`);
        await db.query(`UPDATE household_memberships SET mess_start_date = NULL WHERE user_id = 'user_raj'`); // calendar fallback

        // Clean any existing test bills for clean assertion
        await db.query('DELETE FROM payments');
        await db.query('DELETE FROM bills');

        // Execute automatic billing check on 2026-10-17
        const results = await runAutomaticBillingCheck({ todayStr: '2026-10-17' });
        expect(results).toBeDefined();
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].status).toBe('SUCCESS');
        expect(results[0].generatedCount).toBe(4);

        // Check generated bills in database
        const billsRes = await db.query(
            `SELECT user_id, TO_CHAR(period_start, 'YYYY-MM-DD') as period_start, 
                    TO_CHAR(period_end, 'YYYY-MM-DD') as period_end, status 
             FROM bills ORDER BY user_id ASC`
        );
        expect(billsRes.rows.length).toBe(4);

        const soundarBill = billsRes.rows.find(b => b.user_id === 'user_soundar');
        expect(soundarBill.period_start).toBe('2026-10-10');
        expect(soundarBill.period_end).toBe('2026-11-10');

        const sanjayBill = billsRes.rows.find(b => b.user_id === 'user_sanjay');
        expect(sanjayBill.period_start).toBe('2026-10-15');
        expect(sanjayBill.period_end).toBe('2026-11-15');

        const mukeshBill = billsRes.rows.find(b => b.user_id === 'user_mukesh');
        expect(mukeshBill.period_start).toBe('2026-10-12');
        expect(mukeshBill.period_end).toBe('2026-11-12');

        const rajBill = billsRes.rows.find(b => b.user_id === 'user_raj');
        expect(rajBill.period_start).toBe('2026-10-01');
        expect(rajBill.period_end).toBe('2026-11-01');
    });

    test('2. Duplicate prevention: running scheduler multiple times does not duplicate bills', async () => {
        // Run scheduler again immediately for the same date
        const secondRun = await runAutomaticBillingCheck({ todayStr: '2026-10-17' });
        expect(secondRun[0].status).toBe('SUCCESS');
        expect(secondRun[0].generatedCount).toBe(0);
        expect(secondRun[0].preservedCount).toBe(4);

        const billsRes = await db.query('SELECT COUNT(*) as total FROM bills');
        expect(parseInt(billsRes.rows[0].total, 10)).toBe(4);
    });

    test('3. Payment preservation: existing payments and balances are never lost on auto-check', async () => {
        // Find Soundar's bill and record a payment
        const bRes = await db.query(`SELECT id, total_amount_paise FROM bills WHERE user_id = 'user_soundar'`);
        const billId = bRes.rows[0].id;
        
        await db.query(
            `INSERT INTO payments (bill_id, amount_paise, idempotency_key, status)
             VALUES ($1, 100000, 'pay_test_preserve', 'VALID')`,
            [billId]
        );
        await db.query(
            `UPDATE bills SET paid_amount_paise = 100000 WHERE id = $1`,
            [billId]
        );

        // Run automatic check again
        await runAutomaticBillingCheck({ todayStr: '2026-10-17' });

        // Verify paid amount is still intact
        const verifyRes = await db.query(`SELECT paid_amount_paise, total_amount_paise FROM bills WHERE id = $1`, [billId]);
        expect(verifyRes.rows[0].paid_amount_paise).toBe(100000);
    });

    test('4. Finalized bill protection: FINALIZED bills are never overwritten', async () => {
        const bRes = await db.query(`SELECT id FROM bills WHERE user_id = 'user_soundar'`);
        const billId = bRes.rows[0].id;
        
        await db.query(`UPDATE bills SET status = 'FINALIZED' WHERE id = $1`, [billId]);

        // Run auto check again
        await runAutomaticBillingCheck({ todayStr: '2026-10-17' });

        const checkRes = await db.query(`SELECT status FROM bills WHERE id = $1`, [billId]);
        expect(checkRes.rows[0].status).toBe('FINALIZED');
    });

    test('5. Handles leap years, month-end transitions, and Asia/Kolkata date calculations', async () => {
        // Leap year start date: 2024-01-31 -> 2024-02-29
        await db.query(`UPDATE household_memberships SET mess_start_date = '2024-01-31' WHERE user_id = 'user_mukesh'`);
        
        const runLeap = await runAutomaticBillingCheck({ todayStr: '2024-02-15' });
        expect(runLeap[0].status).toBe('SUCCESS');

        const leapBill = await db.query(
            `SELECT TO_CHAR(period_start, 'YYYY-MM-DD') as period_start, 
                    TO_CHAR(period_end, 'YYYY-MM-DD') as period_end 
             FROM bills WHERE user_id = 'user_mukesh' AND period_start = '2024-01-31'`
        );
        expect(leapBill.rows.length).toBe(1);
        expect(leapBill.rows[0].period_start).toBe('2024-01-31');
        expect(leapBill.rows[0].period_end).toBe('2024-02-29');
    });

    test('6. executeBillingAutomationCycle handles background execution safely', async () => {
        const results = await executeBillingAutomationCycle({ todayStr: '2026-10-17' });
        expect(results).toBeDefined();
        expect(results.length).toBeGreaterThan(0);
    });

    test('7. Admin can view /api/v1/billing/automation-status and member cannot (403)', async () => {
        const adminStatusRes = await request(app)
            .get('/api/v1/billing/automation-status')
            .set('Cookie', adminCookie);
        expect(adminStatusRes.status).toBe(200);
        expect(adminStatusRes.body.automationStatus).toBeDefined();
        expect(adminStatusRes.body.automationStatus.status).toBeDefined();

        const memberStatusRes = await request(app)
            .get('/api/v1/billing/automation-status')
            .set('Cookie', memberCookie);
        expect(memberStatusRes.status).toBe(403);
    });

    test('8. /api/v1/billing/members/cycles reflects isBillGenerated status accurately', async () => {
        const res = await request(app)
            .get('/api/v1/billing/members/cycles')
            .set('Cookie', adminCookie);
        expect(res.status).toBe(200);
        expect(res.body.members).toBeDefined();
        expect(res.body.members.length).toBe(4);

        const soundarMember = res.body.members.find(m => m.userId === 'user_soundar');
        expect(soundarMember).toBeDefined();
        expect(soundarMember.isBillGenerated).toBe(true);
    });
});
