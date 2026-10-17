const notificationService = require('../services/notificationService');

async function getNotifications(req, res, next) {
    try {
        const userId = req.user.id;
        const unreadOnly = req.query.unreadOnly === 'true';
        const limit = req.query.limit;
        const offset = req.query.offset;

        const notifications = await notificationService.getUserNotifications(userId, {
            unreadOnly,
            limit,
            offset
        });

        res.status(200).json({ notifications });
    } catch (err) {
        next(err);
    }
}

async function getUnreadCount(req, res, next) {
    try {
        const userId = req.user.id;
        const count = await notificationService.getUnreadCount(userId);
        res.status(200).json({ unreadCount: count });
    } catch (err) {
        next(err);
    }
}

async function markAsRead(req, res, next) {
    try {
        const userId = req.user.id;
        const notificationId = parseInt(req.params.id, 10);

        if (isNaN(notificationId)) {
            return res.status(400).json({
                error: { message: 'Invalid notification ID', status: 400 }
            });
        }

        const updated = await notificationService.markAsRead(userId, notificationId);
        if (!updated) {
            return res.status(404).json({
                error: { message: 'Notification not found', status: 404 }
            });
        }

        res.status(200).json({ notification: updated });
    } catch (err) {
        next(err);
    }
}

async function markAllAsRead(req, res, next) {
    try {
        const userId = req.user.id;
        const updatedCount = await notificationService.markAllAsRead(userId);
        res.status(200).json({ updatedCount });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead
};
