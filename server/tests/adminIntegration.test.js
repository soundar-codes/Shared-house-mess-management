const request = require('supertest');
const app = require('../src/app');
const db = require('../src/utils/db');
const { hashPassword } = require('../src/services/authService');
const billingService = require('../src/services/billingService');

describe('Admin Enhancements & ₹130 Food Rate Integration', () => {
    let adminCookie;
    let memberCookie;

    beforeAll(async () => {
        // Login as Soundar (ADMIN)
        const adminRes = await request(app).post('/api/v1/auth/login').send({
            userId: 'Soundar',
            password: 'TestSoundar#2026'
        });
        const cookies = adminRes.headers['set-cookie'];
        adminCookie = cookies.find(c => c.startsWith('session_token='));

        // Login as Sanjay (MEMBER)
        const memberRes = await request(app).post('/api/v1/auth/login').send({
            userId: 'Sanjay',
            password: 'TestSanjay#2026'
        });
        const mCookies = memberRes.headers['set-cookie'];
        memberCookie = mCookies.find(c => c.startsWith('session_token='));
    });

    afterAll(async () => {
        await db.pool.end();
    });

    describe('1. ₹130 Daily Food Rate & Calculations', () => {
        test('Default daily food rate is configured at 13000 paise (₹130)', async () => {
            const overviewRes = await request(app)
                .get('/api/v1/admin/overview')
                .set('Cookie', adminCookie);
            expect(overviewRes.status).toBe(200);
            expect(overviewRes.body.overview.dailyRatePaise).toBe(13000);
            expect(overviewRes.body.overview.dailyRateRupees).toBe(130);
        });

        test('1 eligible food day calculates to ₹130 (13,000 paise)', async () => {
            // Test 1 day interval: [2026-10-25, 2026-10-26) -> Oct 25
            const breakdown = await billingService.calculateIntervalBreakdown(
                1,
                'user_soundar',
                '2026-10-25',
                '2026-10-26'
            );
            expect(breakdown.chargeableDays).toBe(1);
            expect(breakdown.totalPaise).toBe(13000);
        });

        test('5 eligible food days calculate to ₹650 (65,000 paise)', async () => {
            // Test 5 days interval: [2026-10-25, 2026-10-30) -> Oct 25, 26, 27, 28, 29
            const breakdown = await billingService.calculateIntervalBreakdown(
                1,
                'user_soundar',
                '2026-10-25',
                '2026-10-30'
            );
            expect(breakdown.chargeableDays).toBe(5);
            expect(breakdown.totalPaise).toBe(65000);
        });

        test('Cancelled and leave days have zero food charges', async () => {
            // Mark Oct 25 as CANCELLED and Oct 26 as ON_LEAVE
            await db.query(`
                INSERT INTO food_records (household_id, user_id, record_date, status, rate_paise)
                VALUES (1, 'user_raj', '2026-10-25', 'CANCELLED', 13000),
                       (1, 'user_raj', '2026-10-26', 'ON_LEAVE', 13000)
                ON CONFLICT (household_id, user_id, record_date) 
                DO UPDATE SET status = EXCLUDED.status;
            `);

            const breakdown = await billingService.calculateIntervalBreakdown(
                1,
                'user_raj',
                '2026-10-25',
                '2026-10-27'
            );
            expect(breakdown.chargeableDays).toBe(0);
            expect(breakdown.cancelledDays).toBe(1);
            expect(breakdown.leaveDays).toBe(1);
            expect(breakdown.totalPaise).toBe(0);
        });
    });

    describe('2. Security & Role-Based Access Control', () => {
        test('Admin overview rejects non-admin users with 403', async () => {
            const res = await request(app)
                .get('/api/v1/admin/overview')
                .set('Cookie', memberCookie);
            expect(res.status).toBe(403);
        });

        test('Admin settings update rejects non-admin users with 403', async () => {
            const res = await request(app)
                .put('/api/v1/admin/settings')
                .set('Cookie', memberCookie)
                .send({ defaultRatePaise: 14000 });
            expect(res.status).toBe(403);
        });

        test('Admin member status update rejects non-admin users with 403', async () => {
            const res = await request(app)
                .patch('/api/v1/admin/members/user_sanjay')
                .set('Cookie', memberCookie)
                .send({ role: 'ADMIN' });
            expect(res.status).toBe(403);
        });

        test('Unauthenticated requests are rejected with 401', async () => {
            const res = await request(app).get('/api/v1/admin/overview');
            expect(res.status).toBe(401);
        });
    });

    describe('3. Admin Leave Management & Pre-leave Status Preservation', () => {
        test('Long leave includes both From Date and To Date inclusive', async () => {
            // Clean previous test leaves
            await db.query('DELETE FROM member_leaves WHERE household_id = 1');
            await db.query('DELETE FROM food_records WHERE household_id = 1 AND record_date >= $1', ['2026-11-20']);

            const res = await request(app)
                .post('/api/v1/food/leaves')
                .set('Cookie', adminCookie)
                .send({
                    userIds: ['user_mukesh'],
                    startDate: '2026-11-20',
                    endDate: '2026-11-22',
                    reason: 'Family visit'
                });
            expect(res.status).toBe(201);
            expect(res.body.affectedDates).toEqual(['2026-11-20', '2026-11-21', '2026-11-22']);
        });

        test('Cancelling leave does not overwrite pre-existing CANCELLED attendance with FOOD_REQUIRED', async () => {
            // Suppose Sanjay had manually cancelled his food on 2026-11-25 before leave was booked
            await db.query(`
                INSERT INTO food_records (household_id, user_id, record_date, status, rate_paise)
                VALUES (1, 'user_sanjay', '2026-11-25', 'CANCELLED', 13000)
                ON CONFLICT (household_id, user_id, record_date)
                DO UPDATE SET status = 'CANCELLED';
            `);

            // Soundar books leave for Sanjay covering 2026-11-25 to 2026-11-26
            const leaveRes = await request(app)
                .post('/api/v1/food/leaves')
                .set('Cookie', adminCookie)
                .send({
                    userIds: ['user_sanjay'],
                    startDate: '2026-11-25',
                    endDate: '2026-11-26',
                    reason: 'Holiday'
                });
            expect(leaveRes.status).toBe(201);
            const leaveId = leaveRes.body.leaves[0].id;

            // Now cancel the leave
            const cancelRes = await request(app)
                .patch(`/api/v1/food/leaves/${leaveId}/cancel`)
                .set('Cookie', adminCookie)
                .send({ reason: 'Trip was cancelled' });
            expect(cancelRes.status).toBe(200);

            // 2026-11-25 MUST be restored to CANCELLED, not FOOD_REQUIRED!
            const checkRes = await db.query(
                `SELECT status FROM food_records WHERE household_id = 1 AND user_id = 'user_sanjay' AND record_date = '2026-11-25'`
            );
            expect(checkRes.rows[0].status).toBe('CANCELLED');
        });

        test('Normal food tracking resumes the day after leave ends', async () => {
            // For user_mukesh whose leave ended on 2026-11-22:
            // 2026-11-23 should automatically resolve to chargeable if no record exists
            const postBreakdown = await billingService.calculateIntervalBreakdown(
                1,
                'user_mukesh',
                '2026-11-23',
                '2026-11-24'
            );
            expect(postBreakdown.chargeableDays).toBe(1);
            expect(postBreakdown.totalPaise).toBe(13000);
        });

        test('Member cannot cancel food on a date covered by approved leave', async () => {
            // Soundar books leave for Sanjay on 2026-11-28
            await request(app)
                .post('/api/v1/food/leaves')
                .set('Cookie', adminCookie)
                .send({
                    userIds: ['user_sanjay'],
                    startDate: '2026-11-28',
                    endDate: '2026-11-28',
                    reason: 'Single day leave'
                });

            // Mock time so that 2026-11-28 is "tomorrow"
            app.locals.mockTime = new Date('2026-11-27T10:00:00.000Z');

            // Sanjay tries to update food for 2026-11-28 -> 403 with explanation
            const cancelFoodRes = await request(app)
                .put('/api/v1/food/2026-11-28')
                .set('Cookie', memberCookie)
                .send({
                    status: 'CANCELLED'
                });
            expect(cancelFoodRes.status).toBe(403);
            expect(cancelFoodRes.body.error.message).toContain('already marked on approved leave');
        });
    });

    describe('4. Admin Household Settings & Food Rate Updates', () => {
        test('Admin can update cancellation cutoff time and household timezone', async () => {
            const updateRes = await request(app)
                .put('/api/v1/admin/settings')
                .set('Cookie', adminCookie)
                .send({
                    timezone: 'Asia/Kolkata',
                    cancellationCutoffTime: '22:30',
                    defaultRatePaise: 13000
                });
            expect(updateRes.status).toBe(200);
            expect(updateRes.body.household.cancellation_cutoff_time).toBe('22:30');
            expect(updateRes.body.household.timezone).toBe('Asia/Kolkata');
        });

        test('Admin settings rejects invalid daily rate (<= 0)', async () => {
            const badRateRes = await request(app)
                .put('/api/v1/admin/settings')
                .set('Cookie', adminCookie)
                .send({
                    defaultRatePaise: -500
                });
            expect(badRateRes.status).toBe(400);
        });

        test('Admin settings update creates an audit log entry', async () => {
            const auditRes = await request(app)
                .get('/api/v1/admin/audit-logs?limit=10')
                .set('Cookie', adminCookie);
            expect(auditRes.status).toBe(200);
            const logs = auditRes.body.logs;
            expect(logs.length).toBeGreaterThan(0);
            const settingsLog = logs.find(l => l.action === 'ADMIN_UPDATE_SETTINGS');
            expect(settingsLog).toBeDefined();
            expect(settingsLog.actor_id).toBe('user_soundar');
        });
    });

    describe('5. Admin Member Management', () => {
        test('Admin can view all members with roles and financial summaries', async () => {
            const res = await request(app)
                .get('/api/v1/admin/members')
                .set('Cookie', adminCookie);
            expect(res.status).toBe(200);
            expect(res.body.members).toHaveLength(4);
            const soundar = res.body.members.find(m => m.id === 'user_soundar');
            expect(soundar.role).toBe('ADMIN');
            expect(soundar.financials).toBeDefined();
            expect(soundar.financials.totalBilledPaise).toBeDefined();
            // Ensure no sensitive password hash is exposed
            expect(soundar.password_hash).toBeUndefined();
        });

        test('Admin can toggle member active status', async () => {
            const res = await request(app)
                .patch('/api/v1/admin/members/user_raj')
                .set('Cookie', adminCookie)
                .send({ isActive: false });
            expect(res.status).toBe(200);
            expect(res.body.member.isActive).toBe(false);

            // Re-activate Raj
            const reactivateRes = await request(app)
                .patch('/api/v1/admin/members/user_raj')
                .set('Cookie', adminCookie)
                .send({ isActive: true });
            expect(reactivateRes.status).toBe(200);
            expect(reactivateRes.body.member.isActive).toBe(true);
        });
    });

    describe('6. Automatic Billing Check Trigger via Admin', () => {
        test('Admin can safely trigger automatic billing check without duplicates', async () => {
            const triggerRes = await request(app)
                .post('/api/v1/admin/scheduler/trigger')
                .set('Cookie', adminCookie);
            expect(triggerRes.status).toBe(200);
            expect(triggerRes.body.message).toContain('Manual automatic billing check completed');
            expect(Array.isArray(triggerRes.body.results)).toBe(true);
        });
    });
});
