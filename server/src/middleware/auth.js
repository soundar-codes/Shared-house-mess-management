const authService = require('../services/authService');

const SESSION_COOKIE_NAME = 'session_token';

function getClearCookieOptions() {
    const isProduction = process.env.NODE_ENV === 'production';
    const sameSite = process.env.COOKIE_SAME_SITE || (isProduction ? 'none' : 'lax');
    const secure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProduction;
    const options = { httpOnly: true, sameSite, secure, path: '/' };
    if (secure && sameSite === 'none') options.partitioned = true;
    return options;
}

async function requireAuth(req, res, next) {
    try {
        let token = req.cookies && req.cookies[SESSION_COOKIE_NAME];
        if (!token && req.headers && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            token = req.headers.authorization.slice(7).trim();
        }
        
        if (!token) {
            return res.status(401).json({ error: { message: 'Unauthorized: Missing session', status: 401 } });
        }
        
        const user = await authService.getSessionUser(token);
        
        if (!user) {
            // Invalid or expired session
            res.clearCookie(SESSION_COOKIE_NAME, getClearCookieOptions());
            return res.status(401).json({ error: { message: 'Unauthorized: Invalid or expired session', status: 401 } });
        }
        
        // Attach safe user object to request
        req.user = user;
        
        next();
    } catch (err) {
        next(err);
    }
}

function requireRole(role) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: { message: 'Unauthorized: Authentication required', status: 401 } });
        }
        
        if (req.user.role !== role) {
            return res.status(403).json({ error: { message: 'Forbidden: Insufficient permissions', status: 403 } });
        }
        
        next();
    };
}

module.exports = {
    requireAuth,
    requireRole
};
