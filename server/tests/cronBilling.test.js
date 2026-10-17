const request = require('supertest');
require('dotenv').config();
const app = require('../src/app');
const db = require('../src/utils/db');
const billingScheduler = require('../src/services/billingScheduler');

describe('Vercel Cron Billing Route (GET /api/v1/cron/billing)', () => {
    const originalEnv = process.env;
    let schedulerSpy;

    beforeEach(() => {
        process.env = { ...originalEnv };
        process.env.CRON_SECRET = 'TestCronSecretKey#987654';

        // Mock executeBillingAutomationCycle to avoid database writes and ensure isolated execution
        schedulerSpy = jest.spyOn(billingScheduler, 'executeBillingAutomationCycle')
            .mockImplementation(async (opts) => {
                return [
                    {
                        householdId: 1,
                        status: 'SUCCESS',
                        generatedCount: 4,
                        preservedCount: 0,
                        details: [{ userId: 'user_soundar', status: 'GENERATED_NEW' }]
                    }
                ];
            });
    });

    afterEach(() => {
        if (schedulerSpy) {
            schedulerSpy.mockRestore();
        }
    });

    afterAll(async () => {
        process.env = originalEnv;
        await db.pool.end();
    });

    test('1. Returns 401 when CRON_SECRET is not configured in process.env', async () => {
        delete process.env.CRON_SECRET;

        const res = await request(app)
            .get('/api/v1/cron/billing')
            .set('Authorization', 'Bearer SomeToken');

        expect(res.status).toBe(401);
        expect(res.body.error).toBeDefined();
        expect(res.body.error.message).toContain('Cron authentication is not configured');
        expect(schedulerSpy).not.toHaveBeenCalled();
    });

    test('2. Returns 401 when Authorization header is missing', async () => {
        const res = await request(app)
            .get('/api/v1/cron/billing');

        expect(res.status).toBe(401);
        expect(res.body.error.message).toContain('Invalid cron authorization token');
        expect(schedulerSpy).not.toHaveBeenCalled();
    });

    test('3. Returns 401 when Authorization token is incorrect', async () => {
        const res = await request(app)
            .get('/api/v1/cron/billing')
            .set('Authorization', 'Bearer WrongTokenValue');

        expect(res.status).toBe(401);
        expect(res.body.error.message).toContain('Invalid cron authorization token');
        expect(schedulerSpy).not.toHaveBeenCalled();
    });

    test('4. Returns 401 when Authorization header is malformed', async () => {
        const res = await request(app)
            .get('/api/v1/cron/billing')
            .set('Authorization', 'Basic TestCronSecretKey#987654');

        expect(res.status).toBe(401);
        expect(res.body.error.message).toContain('Invalid cron authorization token');
        expect(schedulerSpy).not.toHaveBeenCalled();
    });

    test('5. Successfully authorizes with exact Bearer token and runs billing cycle', async () => {
        const res = await request(app)
            .get('/api/v1/cron/billing')
            .set('Authorization', 'Bearer TestCronSecretKey#987654');

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.results).toBeDefined();
        expect(res.body.results.length).toBe(1);
        expect(schedulerSpy).toHaveBeenCalledTimes(1);
        expect(schedulerSpy).toHaveBeenCalledWith({ triggeredBy: 'vercel_cron' });
    });

    test('6. Error responses and payloads never leak the CRON_SECRET value', async () => {
        const res = await request(app)
            .get('/api/v1/cron/billing')
            .set('Authorization', 'Bearer LeakingAttempt');

        const bodyStr = JSON.stringify(res.body);
        expect(bodyStr).not.toContain('TestCronSecretKey#987654');
    });

    test('7. Handles unexpected execution errors gracefully without leaking secrets', async () => {
        schedulerSpy.mockRejectedValueOnce(new Error('Simulated scheduler error'));

        const res = await request(app)
            .get('/api/v1/cron/billing')
            .set('Authorization', 'Bearer TestCronSecretKey#987654');

        expect(res.status).toBe(500);
        expect(res.body.error).toBeDefined();
        const bodyStr = JSON.stringify(res.body);
        expect(bodyStr).not.toContain('TestCronSecretKey#987654');
    });
});
