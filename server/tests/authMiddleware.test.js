const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const db = require('../src/utils/db');
const { hashPassword, createSession, hashSessionToken } = require('../src/services/authService');
const { requireAuth, requireRole } = require('../src/middleware/auth');

const app = express();
app.use(express.json());
app.use(cookieParser());

// Test routes for middleware
app.get('/test/auth', requireAuth, (req, res) => {
    res.status(200).json({ user: req.user });
});

app.get('/test/admin', requireAuth, requireRole('ADMIN'), (req, res) => {
    res.status(200).json({ user: req.user });
});



afterAll(async () => {
    await db.pool.end();
});

describe('Auth Middleware', () => {
    let soundarSession;
    let sanjaySession;

    beforeAll(async () => {
        soundarSession = await createSession('user_soundar');
        sanjaySession = await createSession('user_sanjay');
    });

    test('Missing session returns 401', async () => {
        const res = await request(app).get('/test/auth');
        expect(res.status).toBe(401);
    });

    test('Invalid session returns 401', async () => {
        const res = await request(app)
            .get('/test/auth')
            .set('Cookie', ['session_token=invalid_token']);
        expect(res.status).toBe(401);
    });

    test('Expired session returns 401', async () => {
        const expiredToken = 'expired_middleware_' + Date.now();
        const tokenHash = hashSessionToken(expiredToken);
        const expiresAt = new Date(Date.now() - 10000); // 10s past
        
        await db.query(
            'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
            [tokenHash, 'user_soundar', expiresAt]
        );

        const res = await request(app)
            .get('/test/auth')
            .set('Cookie', [`session_token=${expiredToken}`]);
        
        expect(res.status).toBe(401);
    });

    test('Valid Soundar session returns 200 with ADMIN role', async () => {
        const res = await request(app)
            .get('/test/auth')
            .set('Cookie', [`session_token=${soundarSession.token}`]);
        
        expect(res.status).toBe(200);
        expect(res.body.user.id).toBe('user_soundar');
        expect(res.body.user.role).toBe('ADMIN');
    });

    test('Valid Sanjay session returns 200 with MEMBER role', async () => {
        const res = await request(app)
            .get('/test/auth')
            .set('Cookie', [`session_token=${sanjaySession.token}`]);
        
        expect(res.status).toBe(200);
        expect(res.body.user.id).toBe('user_sanjay');
        expect(res.body.user.role).toBe('MEMBER');
    });

    test('requireRole(ADMIN) allows Soundar', async () => {
        const res = await request(app)
            .get('/test/admin')
            .set('Cookie', [`session_token=${soundarSession.token}`]);
        
        expect(res.status).toBe(200);
    });

    test('requireRole(ADMIN) rejects Sanjay with 403', async () => {
        const res = await request(app)
            .get('/test/admin')
            .set('Cookie', [`session_token=${sanjaySession.token}`]);
        
        expect(res.status).toBe(403);
    });

    test('Authenticated request contains only safe user information', async () => {
        const res = await request(app)
            .get('/test/auth')
            .set('Cookie', [`session_token=${soundarSession.token}`]);
        
        expect(res.status).toBe(200);
        const { user } = res.body;
        
        // Expected safe properties
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('name');
        expect(user).toHaveProperty('role');
        expect(user).toHaveProperty('householdId');
        
        // Ensure no sensitive properties
        expect(user).not.toHaveProperty('password_hash');
        expect(user).not.toHaveProperty('token');
        expect(user).not.toHaveProperty('token_hash');
    });
});
