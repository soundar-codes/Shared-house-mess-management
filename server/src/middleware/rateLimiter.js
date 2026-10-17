/**
 * Simple in-memory sliding window rate limiter middleware.
 * Zero external dependencies.
 */
function createRateLimiter({ windowMs = 60 * 1000, max = 30, message = 'Too many requests, please try again later.' } = {}) {
    const hits = new Map();

    // Periodic cleanup of expired entries
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [key, timestamps] of hits.entries()) {
            const valid = timestamps.filter(t => now - t < windowMs);
            if (valid.length === 0) {
                hits.delete(key);
            } else {
                hits.set(key, valid);
            }
        }
    }, windowMs);
    if (timer.unref) timer.unref();

    return (req, res, next) => {
        // Skip in test environment if DISABLE_RATE_LIMIT is set
        if (process.env.NODE_ENV === 'test' && !req.headers['x-test-rate-limit']) {
            return next();
        }

        const ip = req.ip || req.connection?.remoteAddress || '127.0.0.1';
        const key = `${req.baseUrl || ''}${req.path}_${ip}`;
        const now = Date.now();

        const timestamps = (hits.get(key) || []).filter(t => now - t < windowMs);
        timestamps.push(now);
        hits.set(key, timestamps);

        if (timestamps.length > max) {
            return res.status(429).json({
                error: {
                    message,
                    status: 429,
                    retryAfterSeconds: Math.ceil((windowMs - (now - timestamps[0])) / 1000)
                }
            });
        }

        next();
    };
}

module.exports = {
    createRateLimiter
};
