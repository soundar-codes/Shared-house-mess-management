const request = require('supertest');
require('dotenv').config();
const app = require('../src/app');
const db = require('../src/utils/db');


afterAll(async () => {
    await db.pool.end();
});

describe('Auth API', () => {
    let sessionCookie = '';

    test('Missing session for /me should return 401', async () => {
        const res = await request(app).get('/api/v1/auth/me');
        expect(res.status).toBe(401);
    });

    test('Unknown user login should fail', async () => {
        const res = await request(app).post('/api/v1/auth/login').send({
            userId: 'unknown_user',
            password: 'SomePassword@123'
        });
        expect(res.status).toBe(401);
        expect(res.body.error.message).toBe('Invalid user or password');
    });

    test('Wrong password should fail', async () => {
        const res = await request(app).post('/api/v1/auth/login').send({
            userId: 'Soundar',
            password: 'wrongpassword'
        });
        expect(res.status).toBe(401);
    });

    test('Soundar M can log in with username Soundar and set cookie', async () => {
        const res = await request(app).post('/api/v1/auth/login').send({
            userId: 'Soundar',
            password: 'TestSoundar#2026'
        });
        expect(res.status).toBe(200);
        expect(res.body.user.id).toBe('user_soundar');
        expect(res.body.user.name).toBe('Soundar M');
        expect(res.body.user.role).toBe('ADMIN');
        expect(res.body.user).not.toHaveProperty('password_hash');
        expect(res.body).not.toHaveProperty('token');
        
        const cookies = res.headers['set-cookie'];
        expect(cookies).toBeDefined();
        sessionCookie = cookies.find(c => c.startsWith('session_token='));
        expect(sessionCookie).toBeDefined();
    });

    test('Mukesh S can successfully log in with login username Mukesh', async () => {
        const res = await request(app).post('/api/v1/auth/login').send({
            userId: 'Mukesh',
            password: 'TestMukesh#2026'
        });
        expect(res.status).toBe(200);
        expect(res.body.user.id).toBe('user_mukesh');
        expect(res.body.user.name).toBe('Mukesh S');
        expect(res.body.user.role).toBe('MEMBER');
        expect(res.body.user).not.toHaveProperty('password_hash');
    });

    test('Raj Priyan A can successfully log in with login username Raj', async () => {
        const res = await request(app).post('/api/v1/auth/login').send({
            userId: 'Raj',
            password: 'TestRaj#2026'
        });
        expect(res.status).toBe(200);
        expect(res.body.user.id).toBe('user_raj');
        expect(res.body.user.name).toBe('Raj Priyan A');
        expect(res.body.user.role).toBe('MEMBER');
        expect(res.body.user).not.toHaveProperty('password_hash');
    });

    test('Sanjay K can successfully log in with login username Sanjay', async () => {
        const res = await request(app).post('/api/v1/auth/login').send({
            userId: 'Sanjay',
            password: 'TestSanjay#2026'
        });
        expect(res.status).toBe(200);
        expect(res.body.user.id).toBe('user_sanjay');
        expect(res.body.user.name).toBe('Sanjay K');
        expect(res.body.user.role).toBe('MEMBER');
        expect(res.body.user).not.toHaveProperty('password_hash');
    });

    test('Case-insensitive login works (e.g. soundar)', async () => {
        const res = await request(app).post('/api/v1/auth/login').send({
            userId: 'soundar',
            password: 'TestSoundar#2026'
        });
        expect(res.status).toBe(200);
        expect(res.body.user.id).toBe('user_soundar');
    });

    test('Internal ID backwards compatibility works (user_soundar)', async () => {
        const res = await request(app).post('/api/v1/auth/login').send({
            userId: 'user_soundar',
            password: 'TestSoundar#2026'
        });
        expect(res.status).toBe(200);
        expect(res.body.user.id).toBe('user_soundar');
    });

    test('Successful /me should return user', async () => {
        const res = await request(app)
            .get('/api/v1/auth/me')
            .set('Cookie', sessionCookie);
        
        expect(res.status).toBe(200);
        expect(res.body.user.id).toBe('user_soundar');
        expect(res.body.user).not.toHaveProperty('password_hash');
    });

    test('Invalid session for /me should return 401', async () => {
        const res = await request(app)
            .get('/api/v1/auth/me')
            .set('Cookie', ['session_token=invalidtoken;']);
        expect(res.status).toBe(401);
    });

    test('Successful logout', async () => {
        const res = await request(app)
            .post('/api/v1/auth/logout')
            .set('Cookie', sessionCookie);
        
        expect(res.status).toBe(200);
    });

    test('/me after logout should return 401', async () => {
        const res = await request(app)
            .get('/api/v1/auth/me')
            .set('Cookie', sessionCookie);
        expect(res.status).toBe(401);
    });

    test('Expired session should return 401', async () => {
        const { hashSessionToken } = require('../src/services/authService');
        const expiredToken = 'expired-token-' + Date.now();
        const tokenHash = hashSessionToken(expiredToken);
        const expiresAt = new Date(Date.now() - 10000); // 10 seconds in the past
        
        await db.query(
            'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
            [tokenHash, 'user_soundar', expiresAt]
        );

        const res = await request(app)
            .get('/api/v1/auth/me')
            .set('Cookie', [`session_token=${expiredToken}`]);

        expect(res.status).toBe(401);
        expect(res.body.user).toBeUndefined();
        expect(res.body).not.toHaveProperty('password_hash');
        expect(res.body).not.toHaveProperty('token');
    });
});
