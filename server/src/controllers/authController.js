const authService = require('../services/authService');

const SESSION_COOKIE_NAME = 'session_token';

async function login(req, res, next) {
    try {
        const { userId, username, password } = req.body;
        const loginIdentifier = userId || username;
        
        if (!loginIdentifier || !password) {
            return res.status(400).json({ error: { message: 'userId and password are required', status: 400 } });
        }
        
        const user = await authService.authenticateUser(loginIdentifier, password);
        
        if (!user) {
            return res.status(401).json({ error: { message: 'Invalid user or password', status: 401 } });
        }
        
        const session = await authService.createSession(user.id);
        
        const isProduction = process.env.NODE_ENV === 'production';
        
        res.cookie(SESSION_COOKIE_NAME, session.token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: isProduction,
            expires: session.expiresAt
        });
        
        res.status(200).json({ user });
    } catch (err) {
        next(err);
    }
}

async function logout(req, res, next) {
    try {
        const token = req.cookies[SESSION_COOKIE_NAME];
        
        if (token) {
            await authService.revokeSession(token);
        }
        
        res.clearCookie(SESSION_COOKIE_NAME);
        res.status(200).json({ status: 'ok' });
    } catch (err) {
        next(err);
    }
}

async function getMe(req, res, next) {
    try {
        const token = req.cookies[SESSION_COOKIE_NAME];
        
        if (!token) {
            return res.status(401).json({ error: { message: 'Unauthorized', status: 401 } });
        }
        
        const user = await authService.getSessionUser(token);
        
        if (!user) {
            res.clearCookie(SESSION_COOKIE_NAME);
            return res.status(401).json({ error: { message: 'Session invalid or expired', status: 401 } });
        }
        
        res.status(200).json({ user });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    login,
    logout,
    getMe
};
