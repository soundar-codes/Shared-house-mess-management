const request = require('supertest');
const app = require('../src/app');
const db = require('../src/utils/db');
const authService = require('../src/services/authService');

// Mock db
jest.mock('../src/utils/db', () => ({
    query: jest.fn(),
    pool: {
        connect: jest.fn()
    }
}));

// Mock authService
jest.mock('../src/services/authService');

describe('Notifications API', () => {
    const testSessionToken = 'test-token-notifications';
    const testUser = {
        id: 'user-1',
        name: 'Soundar M',
        householdId: 1,
        role: 'ADMIN'
    };

    beforeEach(() => {
        jest.clearAllMocks();
        authService.getSessionUser.mockResolvedValue(testUser);
    });

    describe('GET /api/v1/notifications', () => {
        it('requires authentication', async () => {
            const res = await request(app).get('/api/v1/notifications');
            expect(res.status).toBe(401);
        });

        it('returns user notifications', async () => {
            const mockRows = [
                {
                    id: 1,
                    user_id: 'user-1',
                    title: 'Food Cancelled',
                    message: 'User user-2 cancelled food for 2026-10-15',
                    deduplication_key: 'food_cancel_1',
                    is_read: false,
                    created_at: '2026-10-14T10:00:00Z'
                },
                {
                    id: 2,
                    user_id: 'user-1',
                    title: 'Chore Duty',
                    message: 'You have water duty today',
                    deduplication_key: null,
                    is_read: true,
                    created_at: '2026-10-13T08:00:00Z'
                }
            ];

            db.query.mockResolvedValueOnce({ rows: mockRows });

            const res = await request(app)
                .get('/api/v1/notifications')
                .set('Cookie', [`session_token=${testSessionToken}`]);

            expect(res.status).toBe(200);
            expect(res.body.notifications).toHaveLength(2);
            expect(res.body.notifications[0].title).toBe('Food Cancelled');
            expect(res.body.notifications[0].isRead).toBe(false);
            expect(res.body.notifications[1].isRead).toBe(true);

            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('ORDER BY created_at DESC'),
                ['user-1', 50, 0]
            );
        });

        it('supports unreadOnly filter and pagination parameters', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .get('/api/v1/notifications?unreadOnly=true&limit=10&offset=20')
                .set('Cookie', [`session_token=${testSessionToken}`]);

            expect(res.status).toBe(200);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('AND is_read = FALSE'),
                ['user-1', 10, 20]
            );
        });
    });

    describe('GET /api/v1/notifications/unread-count', () => {
        it('returns unread count for user', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ count: 3 }] });

            const res = await request(app)
                .get('/api/v1/notifications/unread-count')
                .set('Cookie', [`session_token=${testSessionToken}`]);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ unreadCount: 3 });
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('is_read = FALSE'),
                ['user-1']
            );
        });
    });

    describe('PATCH /api/v1/notifications/:id/read', () => {
        it('returns 400 for invalid notification ID', async () => {
            const res = await request(app)
                .patch('/api/v1/notifications/abc/read')
                .set('Cookie', [`session_token=${testSessionToken}`]);

            expect(res.status).toBe(400);
            expect(res.body.error.message).toBe('Invalid notification ID');
        });

        it('returns 404 if notification is not found or belongs to another user', async () => {
            db.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

            const res = await request(app)
                .patch('/api/v1/notifications/999/read')
                .set('Cookie', [`session_token=${testSessionToken}`]);

            expect(res.status).toBe(404);
            expect(res.body.error.message).toBe('Notification not found');
        });

        it('marks notification as read successfully', async () => {
            db.query.mockResolvedValueOnce({
                rowCount: 1,
                rows: [{
                    id: 10,
                    user_id: 'user-1',
                    title: 'Bill Generated',
                    message: 'Your bill is ready',
                    deduplication_key: null,
                    is_read: true,
                    created_at: '2026-10-14T12:00:00Z'
                }]
            });

            const res = await request(app)
                .patch('/api/v1/notifications/10/read')
                .set('Cookie', [`session_token=${testSessionToken}`]);

            expect(res.status).toBe(200);
            expect(res.body.notification.id).toBe(10);
            expect(res.body.notification.isRead).toBe(true);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('SET is_read = TRUE'),
                [10, 'user-1']
            );
        });
    });

    describe('PATCH /api/v1/notifications/read-all', () => {
        it('marks all unread notifications as read', async () => {
            db.query.mockResolvedValueOnce({ rowCount: 5, rows: [] });

            const res = await request(app)
                .patch('/api/v1/notifications/read-all')
                .set('Cookie', [`session_token=${testSessionToken}`]);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ updatedCount: 5 });
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE notifications'),
                ['user-1']
            );
        });
    });
});
