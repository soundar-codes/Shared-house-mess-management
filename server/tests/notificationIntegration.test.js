const request = require('supertest');
const fs = require('fs');
const path = require('path');

// Enforce test database connection BEFORE loading anything else
const TEST_DB_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/shared_house_test';
process.env.DATABASE_URL = TEST_DB_URL;

if (!process.env.DATABASE_URL.includes('_test')) {
    console.error("FATAL: Refusing to run integration tests against a non-test database.");
    process.exit(1);
}

const app = require('../src/app');
const db = require('../src/utils/db');
const { createSession } = require('../src/services/authService');
const notificationService = require('../src/services/notificationService');

describe('Notifications API Integration (Real PostgreSQL)', () => {
    let user1SessionCookie = '';
    let user2SessionCookie = '';
    const user1Id = 'user_notif_1';
    const user2Id = 'user_notif_2';
    const householdId = 888;

    beforeAll(async () => {
        const client = await db.pool.connect();
        try {
            await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

            const migrationsDir = path.join(__dirname, '../migrations');
            const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
            for (const file of files) {
                const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
                await client.query(sql);
            }

            // Seed test household and users
            await client.query('INSERT INTO households (id, name) VALUES ($1, $2)', [householdId, 'Notif Test Household']);
            await client.query('INSERT INTO users (id, name) VALUES ($1, $2), ($3, $4)', [user1Id, 'Notif User 1', user2Id, 'Notif User 2']);
            await client.query('INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, $3), ($1, $4, $5)',
                [householdId, user1Id, 'ADMIN', user2Id, 'MEMBER']);

            await client.query(
                `INSERT INTO food_configuration (household_id, default_rate_paise, valid_from) 
                 VALUES ($1, 10000, CURRENT_TIMESTAMP - interval '1 day')`,
                [householdId]
            );

            const token1 = await createSession(user1Id);
            const token2 = await createSession(user2Id);
            user1SessionCookie = `session_token=${token1.token}`;
            user2SessionCookie = `session_token=${token2.token}`;
        } finally {
            client.release();
        }
    });

    beforeEach(async () => {
        await db.query('DELETE FROM notifications');
    });

    afterAll(async () => {
        await db.pool.end();
    });

    it('creates notifications with deduplication key idempotently', async () => {
        const dedupKey = 'dedup_test_key_123';
        
        // 1. Create first notification
        const first = await notificationService.createNotification(
            user1Id,
            'First Alert',
            'This is the first alert message',
            dedupKey
        );
        expect(first).toBeDefined();
        expect(first.title).toBe('First Alert');
        expect(first.deduplicationKey).toBe(dedupKey);

        // 2. Attempt creating with same key
        const duplicate = await notificationService.createNotification(
            user1Id,
            'Duplicate Alert',
            'This should be suppressed by unique deduplication key',
            dedupKey
        );
        expect(duplicate).toBeNull();

        // 3. Verify exactly 1 notification exists in DB
        const { rows } = await db.query('SELECT * FROM notifications WHERE user_id = $1', [user1Id]);
        expect(rows).toHaveLength(1);
        expect(rows[0].title).toBe('First Alert');
    });

    it('fetches unread count and filters correctly', async () => {
        await notificationService.createNotification(user1Id, 'Notif 1', 'Msg 1');
        await notificationService.createNotification(user1Id, 'Notif 2', 'Msg 2');
        const notif3 = await notificationService.createNotification(user1Id, 'Notif 3', 'Msg 3');
        // Seed an unread notif for user2
        await notificationService.createNotification(user2Id, 'User2 Notif', 'Msg');

        // Mark notif3 as read
        await notificationService.markAsRead(user1Id, notif3.id);

        // Check unread count API for user1
        const countRes = await request(app)
            .get('/api/v1/notifications/unread-count')
            .set('Cookie', user1SessionCookie);
        expect(countRes.status).toBe(200);
        expect(countRes.body.unreadCount).toBe(2);

        // Check list all API for user1
        const listAllRes = await request(app)
            .get('/api/v1/notifications')
            .set('Cookie', user1SessionCookie);
        expect(listAllRes.status).toBe(200);
        expect(listAllRes.body.notifications).toHaveLength(3);

        // Check unreadOnly filter
        const unreadRes = await request(app)
            .get('/api/v1/notifications?unreadOnly=true')
            .set('Cookie', user1SessionCookie);
        expect(unreadRes.status).toBe(200);
        expect(unreadRes.body.notifications).toHaveLength(2);
        expect(unreadRes.body.notifications.every(n => n.isRead === false)).toBe(true);
    });

    it('enforces user isolation when marking a notification as read', async () => {
        // Create notif for user2
        const user2Notif = await notificationService.createNotification(user2Id, 'Private Alert', 'For user 2 only');

        // User 1 tries to mark user 2's notification as read -> should fail with 404
        const unauthorizedRes = await request(app)
            .patch(`/api/v1/notifications/${user2Notif.id}/read`)
            .set('Cookie', user1SessionCookie);
        expect(unauthorizedRes.status).toBe(404);

        // Verify it is still unread in DB
        const { rows } = await db.query('SELECT is_read FROM notifications WHERE id = $1', [user2Notif.id]);
        expect(rows[0].is_read).toBe(false);

        // User 2 marks it as read -> succeeds
        const authorizedRes = await request(app)
            .patch(`/api/v1/notifications/${user2Notif.id}/read`)
            .set('Cookie', user2SessionCookie);
        expect(authorizedRes.status).toBe(200);
        expect(authorizedRes.body.notification.isRead).toBe(true);
    });

    it('marks all notifications as read for current user only', async () => {
        await notificationService.createNotification(user1Id, 'Alert 1', 'M1');
        await notificationService.createNotification(user1Id, 'Alert 2', 'M2');
        const user2Notif = await notificationService.createNotification(user2Id, 'Alert User2', 'M3');

        const readAllRes = await request(app)
            .patch('/api/v1/notifications/read-all')
            .set('Cookie', user1SessionCookie);

        expect(readAllRes.status).toBe(200);
        expect(readAllRes.body.updatedCount).toBe(2);

        // User 1 now has 0 unread
        const user1Count = await notificationService.getUnreadCount(user1Id);
        expect(user1Count).toBe(0);

        // User 2 still has 1 unread
        const user2Count = await notificationService.getUnreadCount(user2Id);
        expect(user2Count).toBe(1);
    });

    it('verifies complete end-to-end food cancellation, mark-read, restore, re-cancel, and polling workflow', async () => {
        app.locals.mockTime = new Date('2026-10-18T10:00:00Z');
        
        // 1. Member cancels food for tomorrow (2026-10-19) before cutoff
        const cancelRes1 = await request(app)
            .put('/api/v1/food/2026-10-19')
            .set('Cookie', user2SessionCookie)
            .send({ status: 'CANCELLED' });
        expect(cancelRes1.status).toBe(200);

        // 2. Admin unread count is 1
        const countRes1 = await request(app)
            .get('/api/v1/notifications/unread-count')
            .set('Cookie', user1SessionCookie);
        expect(countRes1.status).toBe(200);
        expect(countRes1.body.unreadCount).toBe(1);

        // Admin fetches notifications list
        const notifRes1 = await request(app)
            .get('/api/v1/notifications')
            .set('Cookie', user1SessionCookie);
        expect(notifRes1.status).toBe(200);
        expect(notifRes1.body.notifications).toHaveLength(1);
        const firstNotif = notifRes1.body.notifications[0];
        expect(firstNotif.title).toBe('Food Cancelled');
        expect(firstNotif.isRead).toBe(false);

        // 3. Admin marks notification as read -> unread count becomes 0
        const markRes = await request(app)
            .patch(`/api/v1/notifications/${firstNotif.id}/read`)
            .set('Cookie', user1SessionCookie);
        expect(markRes.status).toBe(200);
        expect(markRes.body.notification.isRead).toBe(true);

        const countRes2 = await request(app)
            .get('/api/v1/notifications/unread-count')
            .set('Cookie', user1SessionCookie);
        expect(countRes2.body.unreadCount).toBe(0);

        // Repeated polling does not create notifications or alter unread count
        for (let i = 0; i < 3; i++) {
            const pollCount = await request(app).get('/api/v1/notifications/unread-count').set('Cookie', user1SessionCookie);
            expect(pollCount.body.unreadCount).toBe(0);
            const pollList = await request(app).get('/api/v1/notifications').set('Cookie', user1SessionCookie);
            expect(pollList.body.notifications).toHaveLength(1);
        }

        // 4. Member restores food (FOOD_REQUIRED) -> no extra notification for admin
        const restoreRes = await request(app)
            .put('/api/v1/food/2026-10-19')
            .set('Cookie', user2SessionCookie)
            .send({ status: 'FOOD_REQUIRED' });
        expect(restoreRes.status).toBe(200);

        const notifAfterRestore = await request(app)
            .get('/api/v1/notifications')
            .set('Cookie', user1SessionCookie);
        expect(notifAfterRestore.body.notifications).toHaveLength(1);

        // Member re-cancels food (genuine second cancellation) -> new notification appears
        const cancelRes2 = await request(app)
            .put('/api/v1/food/2026-10-19')
            .set('Cookie', user2SessionCookie)
            .send({ status: 'CANCELLED' });
        expect(cancelRes2.status).toBe(200);

        // 5. Verify notification list and unread count after simulated refresh
        const refreshedList = await request(app)
            .get('/api/v1/notifications')
            .set('Cookie', user1SessionCookie);
        expect(refreshedList.body.notifications).toHaveLength(2);
        
        const refreshedCount = await request(app)
            .get('/api/v1/notifications/unread-count')
            .set('Cookie', user1SessionCookie);
        expect(refreshedCount.body.unreadCount).toBe(1);

        // Second notification is unread and distinct from the first read notification
        const unreadOnly = await request(app)
            .get('/api/v1/notifications?unreadOnly=true')
            .set('Cookie', user1SessionCookie);
        expect(unreadOnly.body.notifications).toHaveLength(1);
        expect(unreadOnly.body.notifications[0].id).not.toBe(firstNotif.id);
        expect(unreadOnly.body.notifications[0].isRead).toBe(false);
    });
});
