const argon2 = require('argon2');
const crypto = require('crypto');
const db = require('../utils/db');

async function hashPassword(password) {
    return await argon2.hash(password, { type: argon2.argon2id });
}

async function verifyPassword(hash, password) {
    try {
        return await argon2.verify(hash, password);
    } catch (err) {
        return false;
    }
}

function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

function hashSessionToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

async function authenticateUser(loginId, password) {
    if (!loginId || !password) {
        return null;
    }
    
    // Find the user by username (exact or case-insensitive) or by internal ID
    const userResult = await db.query(
        `SELECT u.id, u.name, u.username, u.password_hash, m.role 
         FROM users u 
         JOIN household_memberships m ON u.id = m.user_id 
         WHERE u.username = $1 OR LOWER(u.username) = LOWER($1) OR u.id = $1`,
        [loginId.trim()]
    );
    
    if (userResult.rows.length === 0) {
        return null;
    }
    
    const user = userResult.rows[0];
    
    if (!user.password_hash) {
        return null;
    }
    
    const isValid = await verifyPassword(user.password_hash, password);
    if (!isValid) {
        return null;
    }
    
    return {
        id: user.id,
        name: user.name,
        role: user.role
    };
}

async function createSession(userId) {
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    
    // Set expiry to 7 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    
    await db.query(
        'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
        [tokenHash, userId, expiresAt]
    );
    
    return { token, expiresAt };
}

async function getSessionUser(token) {
    if (!token) return null;
    
    const tokenHash = hashSessionToken(token);
    
    const result = await db.query(
        `SELECT u.id, u.name, m.role, m.household_id, s.expires_at 
         FROM sessions s
         JOIN users u ON s.user_id = u.id
         JOIN household_memberships m ON u.id = m.user_id
         WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
        [tokenHash]
    );
    
    if (result.rows.length === 0) {
        return null;
    }
    
    const row = result.rows[0];
    return {
        id: row.id,
        name: row.name,
        role: row.role,
        householdId: row.household_id
    };
}

async function revokeSession(token) {
    if (!token) return;
    const tokenHash = hashSessionToken(token);
    await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

async function invalidateUserSessions(userId) {
    if (!userId) return;
    await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

module.exports = {
    hashPassword,
    verifyPassword,
    generateSessionToken,
    hashSessionToken,
    authenticateUser,
    createSession,
    getSessionUser,
    revokeSession,
    invalidateUserSessions
};
