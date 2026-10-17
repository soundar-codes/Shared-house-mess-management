const request = require('supertest');
const app = require('../src/app');
const choreService = require('../src/services/choreService');
const authService = require('../src/services/authService');

jest.mock('../src/services/choreService');
jest.mock('../src/services/authService');

describe('Chores API Unit Tests', () => {
    const testSessionToken = 'test-token-chores';
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

    describe('GET /api/v1/chores/vessel-schedule', () => {
        it('requires authentication', async () => {
            const res = await request(app).get('/api/v1/chores/vessel-schedule');
            expect(res.status).toBe(401);
        });

        it('returns vessel rotation schedule including Sunday group assignment', async () => {
            const mockSchedule = [
                { id: 1, dayOfWeek: 'Monday', timePeriod: 'ALL_DAY', assignedUserId: 'user_soundar', assignedUserName: 'Soundar M', isGroupDuty: false },
                { id: 9, dayOfWeek: 'Sunday', timePeriod: 'ALL_DAY', assignedUserId: null, assignedUserName: 'All Members (Group Duty)', isGroupDuty: true }
            ];
            choreService.getVesselSchedule.mockResolvedValueOnce(mockSchedule);

            const res = await request(app)
                .get('/api/v1/chores/vessel-schedule')
                .set('Cookie', `session_token=${testSessionToken}`);

            expect(res.status).toBe(200);
            expect(res.body.schedule).toHaveLength(2);
            expect(res.body.schedule[1].isGroupDuty).toBe(true);
            expect(res.body.schedule[1].assignedUserName).toContain('All Members');
        });
    });

    describe('GET /api/v1/chores/assignments', () => {
        it('returns list of chore assignments', async () => {
            const mockAssignments = [
                { id: 1, choreName: 'Bathroom Cleaning', userId: 'user_sanjay', status: 'PENDING' }
            ];
            choreService.getAssignments.mockResolvedValueOnce(mockAssignments);

            const res = await request(app)
                .get('/api/v1/chores/assignments')
                .set('Cookie', `session_token=${testSessionToken}`);

            expect(res.status).toBe(200);
            expect(res.body.assignments).toHaveLength(1);
        });
    });

    describe('PATCH /api/v1/chores/assignments/:id/status', () => {
        it('validates assignment ID', async () => {
            const res = await request(app)
                .patch('/api/v1/chores/assignments/invalid/status')
                .set('Cookie', `session_token=${testSessionToken}`)
                .send({ status: 'COMPLETED' });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toContain('Invalid assignment ID');
        });

        it('validates status is provided', async () => {
            const res = await request(app)
                .patch('/api/v1/chores/assignments/1/status')
                .set('Cookie', `session_token=${testSessionToken}`)
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.error.message).toContain('Status is required');
        });

        it('updates assignment status successfully', async () => {
            choreService.updateAssignmentStatus.mockResolvedValueOnce({
                id: 1,
                status: 'COMPLETED'
            });

            const res = await request(app)
                .patch('/api/v1/chores/assignments/1/status')
                .set('Cookie', `session_token=${testSessionToken}`)
                .send({ status: 'COMPLETED' });

            expect(res.status).toBe(200);
            expect(res.body.assignment.status).toBe('COMPLETED');
            expect(choreService.updateAssignmentStatus).toHaveBeenCalledWith(1, 1, 'COMPLETED', testMember);
        });

        it('returns 403 when forbidden by service', async () => {
            const forbiddenErr = new Error('Forbidden: Members can only update their own assignments');
            forbiddenErr.status = 403;
            choreService.updateAssignmentStatus.mockRejectedValueOnce(forbiddenErr);

            const res = await request(app)
                .patch('/api/v1/chores/assignments/1/status')
                .set('Cookie', `session_token=${testSessionToken}`)
                .send({ status: 'COMPLETED' });

            expect(res.status).toBe(403);
            expect(res.body.error.message).toContain('Forbidden');
        });
    });

    describe('Dustbin Cycle Endpoints', () => {
        it('GET /dustbin/current returns active cycle', async () => {
            choreService.getCurrentDustbinCycle.mockResolvedValueOnce({
                id: 10,
                claimantUserId: 'user_sanjay',
                status: 'OPEN'
            });

            const res = await request(app)
                .get('/api/v1/chores/dustbin/current')
                .set('Cookie', `session_token=${testSessionToken}`);

            expect(res.status).toBe(200);
            expect(res.body.cycle.status).toBe('OPEN');
        });

        it('POST /dustbin/claim claims cycle successfully', async () => {
            choreService.claimDustbinCycle.mockResolvedValueOnce({
                id: 11,
                claimantUserId: 'user_sanjay',
                status: 'OPEN'
            });

            const res = await request(app)
                .post('/api/v1/chores/dustbin/claim')
                .set('Cookie', `session_token=${testSessionToken}`)
                .send({ allowTakeover: false });

            expect(res.status).toBe(200);
            expect(res.body.cycle.id).toBe(11);
        });

        it('POST /dustbin/claim returns 409 conflict when claimed by another without takeover', async () => {
            const conflictErr = new Error('Dustbin duty is currently claimed by Soundar M. Takeover confirmation required.');
            conflictErr.status = 409;
            choreService.claimDustbinCycle.mockRejectedValueOnce(conflictErr);

            const res = await request(app)
                .post('/api/v1/chores/dustbin/claim')
                .set('Cookie', `session_token=${testSessionToken}`)
                .send({ allowTakeover: false });

            expect(res.status).toBe(409);
            expect(res.body.error.message).toContain('Takeover confirmation required');
        });

        it('POST /dustbin/:id/complete marks cycle completed', async () => {
            choreService.completeDustbinCycle.mockResolvedValueOnce({
                id: 11,
                status: 'COMPLETED'
            });

            const res = await request(app)
                .post('/api/v1/chores/dustbin/11/complete')
                .set('Cookie', `session_token=${testSessionToken}`);

            expect(res.status).toBe(200);
            expect(res.body.cycle.status).toBe('COMPLETED');
        });

        it('GET /dustbin/history returns past cycles', async () => {
            choreService.getDustbinHistory.mockResolvedValueOnce([
                { id: 9, status: 'COMPLETED' }
            ]);

            const res = await request(app)
                .get('/api/v1/chores/dustbin/history')
                .set('Cookie', `session_token=${testSessionToken}`);

            expect(res.status).toBe(200);
            expect(res.body.history).toHaveLength(1);
        });
    });
});
