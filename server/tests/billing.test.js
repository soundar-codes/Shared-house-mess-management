const request = require('supertest');
const app = require('../src/app');
const billingService = require('../src/services/billingService');
const authService = require('../src/services/authService');

jest.mock('../src/services/billingService');
jest.mock('../src/services/authService');

describe('Billing API Unit Tests', () => {
    const testSessionToken = 'test-token-billing';
    const testMember = {
        id: 'user_sanjay',
        name: 'Sanjay K',
        householdId: 1,
        role: 'MEMBER'
    };
    const testAdmin = {
        id: 'user_soundar',
        name: 'Soundar M',
        householdId: 1,
        role: 'ADMIN'
    };

    beforeEach(() => {
        jest.clearAllMocks();
        authService.getSessionUser.mockResolvedValue(testMember);
    });

    describe('GET /api/v1/billing', () => {
        it('requires authentication', async () => {
            const res = await request(app).get('/api/v1/billing');
            expect(res.status).toBe(401);
        });

        it('returns bills list for member', async () => {
            billingService.getBills.mockResolvedValueOnce([
                { id: 1, userId: 'user_sanjay', totalAmountPaise: 300000, paidAmountPaise: 100000, balancePaise: 200000, status: 'OPEN' }
            ]);

            const res = await request(app)
                .get('/api/v1/billing?month=2026-10')
                .set('Cookie', `session_token=${testSessionToken}`);

            expect(res.status).toBe(200);
            expect(res.body.bills).toHaveLength(1);
            expect(res.body.bills[0].balancePaise).toBe(200000);
        });
    });

    describe('POST /api/v1/billing/generate', () => {
        it('rejects non-admin members with 403 Forbidden', async () => {
            authService.getSessionUser.mockResolvedValue(testMember);

            const res = await request(app)
                .post('/api/v1/billing/generate')
                .set('Cookie', `session_token=${testSessionToken}`)
                .send({ billingMonth: '2026-10' });

            expect(res.status).toBe(403);
            expect(res.body.error.message).toContain('Forbidden');
        });

        it('allows admin to generate bills', async () => {
            authService.getSessionUser.mockResolvedValue(testAdmin);
            billingService.generateMonthlyBills.mockResolvedValueOnce([
                { id: 1, totalAmountPaise: 310000, action: 'GENERATED' }
            ]);

            const res = await request(app)
                .post('/api/v1/billing/generate')
                .set('Cookie', `session_token=${testSessionToken}`)
                .send({ billingMonth: '2026-10' });

            expect(res.status).toBe(200);
            expect(res.body.bills).toHaveLength(1);
        });
    });

    describe('POST /api/v1/billing/:id/pay', () => {
        it('rejects member from recording payment with 403 Forbidden', async () => {
            authService.getSessionUser.mockResolvedValue(testMember);

            const res = await request(app)
                .post('/api/v1/billing/1/pay')
                .set('Cookie', `session_token=${testSessionToken}`)
                .send({ amountPaise: 50000, idempotencyKey: 'key-1' });

            expect(res.status).toBe(403);
        });

        it('validates bill ID and payment fields for admin', async () => {
            authService.getSessionUser.mockResolvedValue(testAdmin);

            const res = await request(app)
                .post('/api/v1/billing/abc/pay')
                .set('Cookie', `session_token=${testSessionToken}`)
                .send({ amountPaise: 50000, idempotencyKey: 'key-1' });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toContain('Invalid bill ID');
        });

        it('records payment successfully and returns 201 for fresh payments', async () => {
            authService.getSessionUser.mockResolvedValue(testAdmin);
            billingService.recordPayment.mockResolvedValueOnce({
                id: 10,
                billId: 1,
                amountPaise: 100000,
                isIdempotentReplay: false
            });

            const res = await request(app)
                .post('/api/v1/billing/1/pay')
                .set('Cookie', `session_token=${testSessionToken}`)
                .send({ amountPaise: 100000, idempotencyKey: 'idemp-key-1' });

            expect(res.status).toBe(201);
            expect(res.body.payment.id).toBe(10);
        });

        it('returns 200 for idempotent replay of previous payment', async () => {
            authService.getSessionUser.mockResolvedValue(testAdmin);
            billingService.recordPayment.mockResolvedValueOnce({
                id: 10,
                billId: 1,
                amountPaise: 100000,
                isIdempotentReplay: true
            });

            const res = await request(app)
                .post('/api/v1/billing/1/pay')
                .set('Cookie', `session_token=${testSessionToken}`)
                .send({ amountPaise: 100000, idempotencyKey: 'idemp-key-1' });

            expect(res.status).toBe(200);
            expect(res.body.payment.isIdempotentReplay).toBe(true);
        });
    });

    describe('POST /api/v1/billing/payments/:paymentId/revoke', () => {
        it('rejects regular member from revoking payment with 403 Forbidden', async () => {
            authService.getSessionUser.mockResolvedValue(testMember);

            const res = await request(app)
                .post('/api/v1/billing/payments/10/revoke')
                .set('Cookie', `session_token=${testSessionToken}`);

            expect(res.status).toBe(403);
        });

        it('allows admin to revoke a payment and returns updated status', async () => {
            authService.getSessionUser.mockResolvedValue(testAdmin);
            billingService.revokePayment.mockResolvedValueOnce({
                id: 10,
                billId: 1,
                amountPaise: 100000,
                status: 'REVOKED'
            });

            const res = await request(app)
                .post('/api/v1/billing/payments/10/revoke')
                .set('Cookie', `session_token=${testSessionToken}`)
                .send({ reason: 'Admin revoked payment' });

            expect(res.status).toBe(200);
            expect(res.body.payment.status).toBe('REVOKED');
        });
    });

    describe('POST /api/v1/billing/:id/finalize and reopen', () => {
        it('requires admin role to finalize', async () => {
            authService.getSessionUser.mockResolvedValue(testMember);

            const res = await request(app)
                .post('/api/v1/billing/1/finalize')
                .set('Cookie', `session_token=${testSessionToken}`);

            expect(res.status).toBe(403);
        });

        it('admin can finalize bill', async () => {
            authService.getSessionUser.mockResolvedValue(testAdmin);
            billingService.finalizeBill.mockResolvedValueOnce({ id: 1, status: 'FINALIZED' });

            const res = await request(app)
                .post('/api/v1/billing/1/finalize')
                .set('Cookie', `session_token=${testSessionToken}`);

            expect(res.status).toBe(200);
            expect(res.body.bill.status).toBe('FINALIZED');
        });

        it('admin can reopen bill with reason', async () => {
            authService.getSessionUser.mockResolvedValue(testAdmin);
            billingService.reopenBill.mockResolvedValueOnce({ id: 1, status: 'REOPENED' });

            const res = await request(app)
                .post('/api/v1/billing/1/reopen')
                .set('Cookie', `session_token=${testSessionToken}`)
                .send({ reason: 'Adjustment required for guest count' });

            expect(res.status).toBe(200);
            expect(res.body.bill.status).toBe('REOPENED');
        });
    });

    describe('Member Mess Cycles Endpoints', () => {
        it('GET /api/v1/billing/members/cycles returns member cycle summaries', async () => {
            billingService.getMemberCycleSummary.mockResolvedValueOnce([
                {
                    userId: 'user_sanjay',
                    userName: 'Sanjay K',
                    messStartDate: '2026-10-10',
                    currentCycle: {
                        periodStart: '2026-10-10',
                        periodEnd: '2026-11-10',
                        nextBillingDate: '2026-11-10'
                    }
                }
            ]);

            const res = await request(app)
                .get('/api/v1/billing/members/cycles')
                .set('Cookie', `session_token=${testSessionToken}`);

            expect(res.status).toBe(200);
            expect(res.body.members).toHaveLength(1);
            expect(res.body.members[0].messStartDate).toBe('2026-10-10');
        });

        it('PATCH /api/v1/billing/members/:userId/mess-start-date requires admin role', async () => {
            authService.getSessionUser.mockResolvedValue(testMember);

            const res = await request(app)
                .patch('/api/v1/billing/members/user_sanjay/mess-start-date')
                .set('Cookie', `session_token=${testSessionToken}`)
                .send({ messStartDate: '2026-10-10' });

            expect(res.status).toBe(403);
        });

        it('PATCH /api/v1/billing/members/:userId/mess-start-date allows admin to update', async () => {
            authService.getSessionUser.mockResolvedValue(testAdmin);
            billingService.updateMemberMessStartDate.mockResolvedValueOnce({
                household_id: 1,
                user_id: 'user_sanjay',
                mess_start_date: '2026-10-10'
            });

            const res = await request(app)
                .patch('/api/v1/billing/members/user_sanjay/mess-start-date')
                .set('Cookie', `session_token=${testSessionToken}`)
                .send({ messStartDate: '2026-10-10' });

            expect(res.status).toBe(200);
            expect(res.body.membership.mess_start_date).toBe('2026-10-10');
        });
    });
});

