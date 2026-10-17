const db = require('../utils/db');

/**
 * Fetch notifications for a specific user.
 * @param {string} userId 
 * @param {object} options 
 * @returns {Promise<Array>}
 */
async function getUserNotifications(userId, { unreadOnly = false, limit = 50, offset = 0 } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    let queryText = `
        SELECT id, user_id, title, message, deduplication_key, is_read, created_at
        FROM notifications
        WHERE user_id = $1
    `;
    const params = [userId];

    if (unreadOnly) {
        queryText += ` AND is_read = FALSE`;
    }

    queryText += ` ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`;
    params.push(safeLimit, safeOffset);

    const res = await db.query(queryText, params);
    return res.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        title: row.title,
        message: row.message,
        deduplicationKey: row.deduplication_key,
        isRead: Boolean(row.is_read),
        createdAt: row.created_at
    }));
}

/**
 * Get count of unread notifications for a user.
 * @param {string} userId 
 * @returns {Promise<number>}
 */
async function getUnreadCount(userId) {
    const res = await db.query(
        `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
        [userId]
    );
    return res.rows[0]?.count || 0;
}

/**
 * Mark a single notification as read for a given user.
 * @param {string} userId 
 * @param {number|string} notificationId 
 * @returns {Promise<object|null>}
 */
async function markAsRead(userId, notificationId) {
    const res = await db.query(
        `UPDATE notifications
         SET is_read = TRUE
         WHERE id = $1 AND user_id = $2
         RETURNING id, user_id, title, message, deduplication_key, is_read, created_at`,
        [notificationId, userId]
    );

    if (res.rowCount === 0) {
        return null;
    }

    const row = res.rows[0];
    return {
        id: row.id,
        userId: row.user_id,
        title: row.title,
        message: row.message,
        deduplicationKey: row.deduplication_key,
        isRead: Boolean(row.is_read),
        createdAt: row.created_at
    };
}

/**
 * Mark all notifications as read for a given user.
 * @param {string} userId 
 * @returns {Promise<number>}
 */
async function markAllAsRead(userId) {
    const res = await db.query(
        `UPDATE notifications
         SET is_read = TRUE
         WHERE user_id = $1 AND is_read = FALSE`,
        [userId]
    );
    return res.rowCount || 0;
}

/**
 * Create a new notification, safely deduplicating if a key is provided.
 * @param {string} userId 
 * @param {string} title 
 * @param {string} message 
 * @param {string|null} deduplicationKey 
 * @param {object} [client] - Optional transactional pool client
 * @returns {Promise<object|null>}
 */
async function createNotification(userId, title, message, deduplicationKey = null, client = db) {
    const res = await client.query(
        `INSERT INTO notifications (user_id, title, message, deduplication_key)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING
         RETURNING id, user_id, title, message, deduplication_key, is_read, created_at`,
        [userId, title, message, deduplicationKey]
    );

    if (res.rowCount === 0) {
        return null;
    }

    const row = res.rows[0];
    return {
        id: row.id,
        userId: row.user_id,
        title: row.title,
        message: row.message,
        deduplicationKey: row.deduplication_key,
        isRead: Boolean(row.is_read),
        createdAt: row.created_at
    };
}

module.exports = {
    getUserNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    createNotification
};
