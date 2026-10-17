const authService = require('../services/authService');

const SESSION_COOKIE_NAME = 'session_token';

function getSessionCookieOptions(expiresAt) {
    const isProduction = process.env.NODE_ENV === 'production';
    const sameSite = process.env.COOKIE_SAME_SITE || (isProduction ? 'none' : 'lax');
    const secure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProduction;

    const options = {
        httpOnly: true,
        sameSite,
        secure,
        path: '/'
    };

    if (expiresAt) {
        options.expires = expiresAt;
    }

    if (secure && sameSite === 'none') {
        options.partitioned = true;
    }

    return options;
}

function extractToken(req) {
    if (req.cookies && req.cookies[SESSION_COOKIE_NAME]) {
        return req.cookies[SESSION_COOKIE_NAME];
    }
    if (req.headers && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        return req.headers.authorization.slice(7).trim();
    }
    return null;
}

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

        res.cookie(SESSION_COOKIE_NAME, session.token, getSessionCookieOptions(session.expiresAt));

        res.status(200).json({ user });
    } catch (err) {
        next(err);
    }
}

async function logout(req, res, next) {
    try {
        const token = extractToken(req);

        if (token) {
            await authService.revokeSession(token);
        }

        res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions());
        res.status(200).json({ status: 'ok' });
    } catch (err) {
        next(err);
    }
}

async function getMe(req, res, next) {
    try {
        const token = extractToken(req);

        if (!token) {
            return res.status(401).json({ error: { message: 'Unauthorized', status: 401 } });
        }

        const user = await authService.getSessionUser(token);

        if (!user) {
            res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions());
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
