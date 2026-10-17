const { runAutomaticBillingCheck } = require('./billingService');

let schedulerInterval = null;
let isRunning = false;

/**
 * Executes a single automatic billing check cycle with error handling and concurrency lock.
 */
async function executeBillingAutomationCycle(options = {}) {
    if (isRunning) {
        console.log('[Scheduler] Automatic billing check already in progress. Skipping concurrent run.');
        return;
    }

    isRunning = true;
    try {
        console.log('[Scheduler] Starting automatic billing cycle check...');
        const results = await runAutomaticBillingCheck(options);
        console.log('[Scheduler] Automatic billing check completed successfully:', JSON.stringify(results));
        return results;
    } catch (err) {
        console.error('[Scheduler] Automatic billing check encountered error:', err.message);
    } finally {
        isRunning = false;
    }
}

/**
 * Starts the automatic billing background scheduler.
 * Runs once immediately upon invocation, then every intervalMs (defaults to 1 hour = 3,600,000 ms).
 */
function startBillingScheduler(intervalMs = 60 * 60 * 1000) {
    if (schedulerInterval) {
        console.log('[Scheduler] Scheduler is already active.');
        return;
    }

    console.log(`[Scheduler] Initializing billing automation scheduler (interval: ${intervalMs}ms)...`);
    
    // Run an initial check after a brief startup delay (e.g. 5 seconds) to allow DB pool warmup
    setTimeout(() => {
        executeBillingAutomationCycle().catch(err => {
            console.error('[Scheduler] Initial cycle failed:', err);
        });
    }, 5000);

    // Schedule regular background intervals
    schedulerInterval = setInterval(() => {
        executeBillingAutomationCycle().catch(err => {
            console.error('[Scheduler] Periodic cycle failed:', err);
        });
    }, intervalMs);

    // Ensure timer does not prevent graceful process termination if needed
    if (schedulerInterval.unref) {
        schedulerInterval.unref();
    }
}

/**
 * Stops the background scheduler (useful for cleanup and tests).
 */
function stopBillingScheduler() {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
        console.log('[Scheduler] Billing automation scheduler stopped.');
    }
}

module.exports = {
    startBillingScheduler,
    stopBillingScheduler,
    executeBillingAutomationCycle
};
