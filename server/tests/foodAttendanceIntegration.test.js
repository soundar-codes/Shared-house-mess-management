const request = require('supertest');
const app = require('../src/app');
const db = require('../src/utils/db');
const { hashPassword } = require('../src/services/authService');
const foodService = require('../src/services/foodService');
const billingService = require('../src/services/billingService');

describe('Food Attendance & Leave Management Integration', () => {
    let adminCookie;
    let memberCookie;

    beforeAll(async () => {
        // Clean test leaves and records to avoid overlap from previous test runs
        await db.query('DELETE FROM member_leaves WHERE household_id = 1');
        await db.query('DELETE FROM food_records WHERE household_id = 1 AND record_date >= $1', ['2026-10-10']);
        await db.query('DELETE FROM food_configuration WHERE household_id = 1');
        await db.query(
            `INSERT INTO food_configuration (household_id, default_rate_paise, valid_from, valid_to)
             VALUES (1, 13000, '2026-10-01 00:00:00+05:30', NULL)`
        );

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
        await db.pool.end();
    });

    test('1. Admin can update attendance for Monday-Wednesday and entries persist accurately', async () => {
        // Monday 2026-10-12: All ate
        for (const u of ['user_soundar', 'user_sanjay', 'user_mukesh', 'user_raj']) {
            const res = await request(app)
                .put(`/api/v1/food/attendance/members/${u}/dates/2026-10-12`)
                .set('Cookie', adminCookie)
                .send({ status: 'FOOD_REQUIRED' });
            expect(res.status).toBe(200);
            expect(res.body.record.status).toBe('FOOD_REQUIRED');
        }

        // Tuesday 2026-10-13: Soundar, Sanjay, Mukesh Did not eat; Raj Priyan Ate
        await request(app)
            .put('/api/v1/food/attendance/members/user_soundar/dates/2026-10-13')
            .set('Cookie', adminCookie)
            .send({ status: 'CANCELLED' });
        await request(app)
            .put('/api/v1/food/attendance/members/user_sanjay/dates/2026-10-13')
            .set('Cookie', adminCookie)
            .send({ status: 'CANCELLED' });
        await request(app)
            .put('/api/v1/food/attendance/members/user_mukesh/dates/2026-10-13')
            .set('Cookie', adminCookie)
            .send({ status: 'CANCELLED' });
        await request(app)
            .put('/api/v1/food/attendance/members/user_raj/dates/2026-10-13')
            .set('Cookie', adminCookie)
            .send({ status: 'FOOD_REQUIRED' });

        // Wednesday 2026-10-14: All ate
        for (const u of ['user_soundar', 'user_sanjay', 'user_mukesh', 'user_raj']) {
            await request(app)
                .put(`/api/v1/food/attendance/members/${u}/dates/2026-10-14`)
                .set('Cookie', adminCookie)
                .send({ status: 'FOOD_REQUIRED' });
        }

        // Fetch attendance matrix and verify
        const attRes = await request(app)
            .get('/api/v1/food/attendance?startDate=2026-10-12&endDate=2026-10-14')
            .set('Cookie', adminCookie);
        expect(attRes.status).toBe(200);
        expect(attRes.body.records).toBeDefined();

        const tueSoundar = attRes.body.records.find(r => r.user_id === 'user_soundar' && r.date === '2026-10-13');
        expect(tueSoundar.status).toBe('CANCELLED');

        const tueRaj = attRes.body.records.find(r => r.user_id === 'user_raj' && r.date === '2026-10-13');
        expect(tueRaj.status).toBe('FOOD_REQUIRED');
    });

    test('2. Regular member receives 403 Forbidden when calling admin attendance APIs', async () => {
        const forbiddenRes = await request(app)
            .put('/api/v1/food/attendance/members/user_sanjay/dates/2026-10-13')
            .set('Cookie', memberCookie)
            .send({ status: 'FOOD_REQUIRED' });
        expect(forbiddenRes.status).toBe(403);

        const forbiddenGet = await request(app)
            .get('/api/v1/food/attendance?startDate=2026-10-12&endDate=2026-10-14')
            .set('Cookie', memberCookie);
        expect(forbiddenGet.status).toBe(403);
    });

    test('3. Admin can schedule leave period from Thursday 2026-10-15 to Wednesday 2026-10-21 for all 4 members', async () => {
        const leaveRes = await request(app)
            .post('/api/v1/food/leaves')
            .set('Cookie', adminCookie)
            .send({
                userIds: 'ALL',
                startDate: '2026-10-15',
                endDate: '2026-10-21',
                reason: 'All members scheduled leave'
            });
        expect(leaveRes.status).toBe(201);
        expect(leaveRes.body.affectedMembersCount).toBe(4);
        expect(leaveRes.body.affectedDates.length).toBe(7);

        // Verify food_records for all 4 members across 15-21 are ON_LEAVE
        const dbRecords = await db.query(
            `SELECT user_id, TO_CHAR(record_date, 'YYYY-MM-DD') as date, status 
             FROM food_records 
             WHERE record_date >= '2026-10-15' AND record_date <= '2026-10-21'`
        );
        expect(dbRecords.rows.length).toBe(28); // 4 members * 7 days
        expect(dbRecords.rows.every(r => r.status === 'ON_LEAVE')).toBe(true);
    });

    test('4. Leave dates are excluded from food charges in calculateIntervalBreakdown', async () => {
        const breakdown = await billingService.calculateIntervalBreakdown(
            1, 
            'user_soundar', 
            '2026-10-12', 
            '2026-10-22' // [12, 22) = Oct 12 to Oct 21 inclusive (10 days)
        );

        // 10 days total:
        // Oct 12: FOOD_REQUIRED (13000)
        // Oct 13: CANCELLED (0)
        // Oct 14: FOOD_REQUIRED (13000)
        // Oct 15-21 (7 days): ON_LEAVE (0)
        expect(breakdown.chargeableDays).toBe(2);
        expect(breakdown.cancelledDays).toBe(1);
        expect(breakdown.leaveDays).toBe(7);
        expect(breakdown.totalPaise).toBe(26000); // 2 chargeable days * 13000
    });

    test('5. Normal mess food tracking and billing resumes automatically after leave ends', async () => {
        // Oct 22 is after the leave period [15-21]
        const postLeaveBreakdown = await billingService.calculateIntervalBreakdown(
            1,
            'user_soundar',
            '2026-10-22',
            '2026-10-25' // 3 days: Oct 22, 23, 24
        );
        // By default, members without cancellations or leaves resume normal charge
        expect(postLeaveBreakdown.chargeableDays).toBe(3);
        expect(postLeaveBreakdown.leaveDays).toBe(0);
        expect(postLeaveBreakdown.totalPaise).toBe(39000); // 3 days * 13000
    });

    test('6. Validates invalid date ranges and bad inputs', async () => {
        const reversedDateRes = await request(app)
            .post('/api/v1/food/leaves')
            .set('Cookie', adminCookie)
            .send({
                userIds: 'ALL',
                startDate: '2026-10-25',
                endDate: '2026-10-20', // reversed!
                reason: 'Bad range'
            });
        expect(reversedDateRes.status).toBe(400);

        const invalidStatusRes = await request(app)
            .put('/api/v1/food/attendance/members/user_soundar/dates/2026-10-12')
            .set('Cookie', adminCookie)
            .send({ status: 'INVALID_STATUS' });
        expect(invalidStatusRes.status).toBe(400);
    });

    test('7. Admin can cancel a leave period and restore normal food records', async () => {
        // Create an isolated test leave for Sanjay
        const testLeaveRes = await request(app)
            .post('/api/v1/food/leaves')
            .set('Cookie', adminCookie)
            .send({
                userIds: ['user_sanjay'],
                startDate: '2026-11-05',
                endDate: '2026-11-07',
                reason: 'Weekend test leave'
            });
        expect(testLeaveRes.status).toBe(201);
        const leaveId = testLeaveRes.body.leaves[0].id;

        // Cancel the leave
        const cancelRes = await request(app)
            .patch(`/api/v1/food/leaves/${leaveId}/cancel`)
            .set('Cookie', adminCookie)
            .send({ reason: 'Trip cancelled' });
        expect(cancelRes.status).toBe(200);

        // Verify status reverted to FOOD_REQUIRED
        const revertedRecords = await db.query(
            `SELECT status FROM food_records WHERE user_id = 'user_sanjay' AND record_date = '2026-11-05'`
        );
        expect(revertedRecords.rows[0].status).toBe('FOOD_REQUIRED');
    });
});
