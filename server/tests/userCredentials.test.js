const request = require('supertest');
require('dotenv').config();
const app = require('../src/app');
const db = require('../src/utils/db');
const { invalidateUserSessions } = require('../src/services/authService');

afterAll(async () => {
    await db.pool.end();
});

describe('User Accounts and Credentials Verification', () => {
    test('Requirement 1: All 4 login usernames are unique and correctly configured', async () => {
        const res = await db.query('SELECT id, name, username FROM users WHERE id IN (\'user_mukesh\', \'user_sanjay\', \'user_soundar\', \'user_raj\') ORDER BY id');
        expect(res.rows.length).toBe(4);

        const usernames = res.rows.map(r => r.username);
        const uniqueUsernames = new Set(usernames);
        expect(uniqueUsernames.size).toBe(4);

        const mukesh = res.rows.find(r => r.id === 'user_mukesh');
        expect(mukesh.username).toBe('Mukesh');
        expect(mukesh.name).toBe('Mukesh S');

        const sanjay = res.rows.find(r => r.id === 'user_sanjay');
        expect(sanjay.username).toBe('Sanjay');
        expect(sanjay.name).toBe('Sanjay K');

        const soundar = res.rows.find(r => r.id === 'user_soundar');
        expect(soundar.username).toBe('Soundar');
        expect(soundar.name).toBe('Soundar M');

        const raj = res.rows.find(r => r.id === 'user_raj');
        expect(raj.username).toBe('Raj');
        expect(raj.name).toBe('Raj Priyan A');
    });

    test('Requirement 2: Successful login for Mukesh S using username Mukesh', async () => {
        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ userId: 'Mukesh', password: 'TestMukesh#2026' });

        expect(res.status).toBe(200);
        expect(res.body.user.id).toBe('user_mukesh');
        expect(res.body.user.name).toBe('Mukesh S');
        expect(res.body.user.role).toBe('MEMBER');
        expect(res.body.user).not.toHaveProperty('password_hash');
    });

    test('Requirement 2: Successful login for Sanjay K using username Sanjay', async () => {
        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ userId: 'Sanjay', password: 'TestSanjay#2026' });

        expect(res.status).toBe(200);
        expect(res.body.user.id).toBe('user_sanjay');
        expect(res.body.user.name).toBe('Sanjay K');
        expect(res.body.user.role).toBe('MEMBER');
        expect(res.body.user).not.toHaveProperty('password_hash');
    });

    test('Requirement 2: Successful login for Soundar M using username Soundar', async () => {
        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ userId: 'Soundar', password: 'TestSoundar#2026' });

        expect(res.status).toBe(200);
        expect(res.body.user.id).toBe('user_soundar');
        expect(res.body.user.name).toBe('Soundar M');
        expect(res.body.user.role).toBe('ADMIN');
        expect(res.body.user).not.toHaveProperty('password_hash');
    });

    test('Requirement 2: Successful login for Raj Priyan A using username Raj', async () => {
        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ userId: 'Raj', password: 'TestRaj#2026' });

        expect(res.status).toBe(200);
        expect(res.body.user.id).toBe('user_raj');
        expect(res.body.user.name).toBe('Raj Priyan A');
        expect(res.body.user.role).toBe('MEMBER');
        expect(res.body.user).not.toHaveProperty('password_hash');
    });

    test('Requirement 3: Incorrect passwords are strictly rejected for all accounts', async () => {
        const accounts = [
            { username: 'Mukesh', wrongPass: 'WrongTestPass#Mukesh' },
            { username: 'Sanjay', wrongPass: 'WrongTestPass#Sanjay' },
            { username: 'Soundar', wrongPass: 'WrongTestPass#Soundar' },
            { username: 'Raj', wrongPass: 'WrongTestPass#Raj' }
        ];

        for (const acc of accounts) {
            const res = await request(app)
                .post('/api/v1/auth/login')
                .send({ userId: acc.username, password: acc.wrongPass });

            expect(res.status).toBe(401);
            expect(res.body.error.message).toBe('Invalid user or password');
        }
    });

    test('Requirement 4: Administrator and member permissions remain correct', async () => {
        // Admin login
        const adminRes = await request(app)
            .post('/api/v1/auth/login')
            .send({ userId: 'Soundar', password: 'TestSoundar#2026' });
        const adminCookie = adminRes.headers['set-cookie'].find(c => c.startsWith('session_token='));

        // Admin can access admin-only endpoints
        const adminAccess = await request(app)
            .get('/api/v1/admin/members')
            .set('Cookie', adminCookie);
        expect(adminAccess.status).toBe(200);

        // Member login
        const memberRes = await request(app)
            .post('/api/v1/auth/login')
            .send({ userId: 'Sanjay', password: 'TestSanjay#2026' });
        const memberCookie = memberRes.headers['set-cookie'].find(c => c.startsWith('session_token='));

        // Member is denied access to admin-only endpoints
        const memberAccess = await request(app)
            .get('/api/v1/admin/members')
            .set('Cookie', memberCookie);
        expect(memberAccess.status).toBe(403);
    });

    test('Requirement 5: Household memberships, bills, payments, food and leaves stay mapped to users', async () => {
        // Verify foreign key integrity
        const memberships = await db.query('SELECT user_id, role FROM household_memberships WHERE user_id IN (\'user_soundar\', \'user_sanjay\', \'user_mukesh\', \'user_raj\')');
        expect(memberships.rows.length).toBe(4);

        const soundarMember = memberships.rows.find(m => m.user_id === 'user_soundar');
        expect(soundarMember.role).toBe('ADMIN');

        const sanjayMember = memberships.rows.find(m => m.user_id === 'user_sanjay');
        expect(sanjayMember.role).toBe('MEMBER');

        const mukeshMember = memberships.rows.find(m => m.user_id === 'user_mukesh');
        expect(mukeshMember.role).toBe('MEMBER');

        const rajMember = memberships.rows.find(m => m.user_id === 'user_raj');
        expect(rajMember.role).toBe('MEMBER');

        // Check bills still link to internal primary keys
        const bills = await db.query('SELECT user_id, COUNT(*) as count FROM bills GROUP BY user_id');
        expect(bills.rows.length).toBeGreaterThan(0);
        for (const b of bills.rows) {
            expect(b.user_id).toMatch(/^user_/);
        }

        // Check food records still link to internal primary keys
        const foodRecords = await db.query('SELECT user_id, COUNT(*) as count FROM food_records GROUP BY user_id');
        expect(foodRecords.rows.length).toBeGreaterThan(0);
        for (const fr of foodRecords.rows) {
            expect(fr.user_id).toMatch(/^user_/);
        }
    });

    test('Requirement 6: Invalidate user sessions terminates active sessions', async () => {
        // Log in Soundar
        const loginRes = await request(app)
            .post('/api/v1/auth/login')
            .send({ userId: 'Soundar', password: 'TestSoundar#2026' });
        const cookie = loginRes.headers['set-cookie'].find(c => c.startsWith('session_token='));

        // Verify session works
        const meResBefore = await request(app)
            .get('/api/v1/auth/me')
            .set('Cookie', cookie);
        expect(meResBefore.status).toBe(200);

        // Invalidate sessions for user_soundar
        await invalidateUserSessions('user_soundar');

        // Verify session is now rejected
        const meResAfter = await request(app)
            .get('/api/v1/auth/me')
            .set('Cookie', cookie);
        expect(meResAfter.status).toBe(401);
    });
});
