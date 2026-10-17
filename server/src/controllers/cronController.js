const billingScheduler = require('../services/billingScheduler');

/**
 * Handles Vercel Cron invocation for automatic billing check.
 * Protected by exact Authorization: Bearer <CRON_SECRET> header check.
 */
async function handleBillingCron(req, res, next) {
    try {
        const cronSecret = process.env.CRON_SECRET;
        const authHeader = req.headers.authorization;

        // Reject if CRON_SECRET is not configured in environment
        if (!cronSecret || typeof cronSecret !== 'string' || cronSecret.trim().length === 0) {
            return res.status(401).json({
                error: {
                    message: 'Unauthorized: Cron authentication is not configured',
                    status: 401
                }
            });
        }

        // Reject if Authorization header is missing or does not match Bearer token
        if (!authHeader || authHeader !== `Bearer ${cronSecret.trim()}`) {
            return res.status(401).json({
                error: {
                    message: 'Unauthorized: Invalid cron authorization token',
                    status: 401
                }
            });
        }

        // Execute billing cycle using the existing automated service
        const results = await billingScheduler.executeBillingAutomationCycle({ triggeredBy: 'vercel_cron' });

        return res.status(200).json({
            status: 'ok',
            message: 'Billing automation cycle completed successfully',
            results: results || []
        });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    handleBillingCron
};
