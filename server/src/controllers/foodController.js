const foodService = require('../services/foodService');
const { isFoodUpdateAllowed } = require('../utils/dateUtils');

async function getFoodConfig(req, res, next) {
    try {
        const { householdId } = req.user;
        const config = await foodService.getActiveFoodConfig(householdId);
        
        if (!config) {
            return res.status(404).json({ error: { message: 'Food configuration not found', status: 404 } });
        }
        
        res.status(200).json({ config });
    } catch (err) {
        next(err);
    }
}

async function getMemberFood(req, res, next) {
    try {
        const { id: userId, householdId } = req.user;
        const { month } = req.query; // Expecting 'YYYY-MM'
        
        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ error: { message: 'Valid month (YYYY-MM) query parameter is required', status: 400 } });
        }
        
        const result = await foodService.getMemberFoodRecords(householdId, userId, month);
        res.status(200).json({ records: result.records, unavailableDates: result.unavailList });
    } catch (err) {
        next(err);
    }
}

async function updateMemberFood(req, res, next) {
    try {
        const { id: userId, householdId } = req.user;
        const { date } = req.params; // Expecting 'YYYY-MM-DD'
        const { status } = req.body;
        
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: { message: 'Valid date (YYYY-MM-DD) path parameter is required', status: 400 } });
        }
        
        if (status !== 'FOOD_REQUIRED' && status !== 'CANCELLED') {
            return res.status(400).json({ error: { message: 'Status must be FOOD_REQUIRED or CANCELLED', status: 400 } });
        }

        const config = await foodService.getActiveFoodConfig(householdId);
        if (!config) {
            return res.status(500).json({ error: { message: 'System configuration error: Missing food config', status: 500 } });
        }

        // Allow passing a mock 'now' time for tests if injected, otherwise use current
        const now = req.app.locals.mockTime || new Date();
        const cutoffTime = config.cancellation_cutoff_time || '23:00';

        if (!isFoodUpdateAllowed(date, now, cutoffTime)) {
            return res.status(403).json({ error: { message: `Food updates are only allowed for tomorrow before ${cutoffTime} IST`, status: 403 } });
        }

        const updatedRecord = await foodService.updateMemberFood(householdId, userId, date, status, config);
        
        res.status(200).json({ record: updatedRecord });
    } catch (err) {
        next(err);
    }
}

async function getMonthlyUnavailable(req, res, next) {
    try {
        const { householdId } = req.user;
        const { month } = req.query; // Expecting 'YYYY-MM'

        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ error: { message: 'Valid month (YYYY-MM) query parameter is required', status: 400 } });
        }

        const declarations = await foodService.getActiveMessUnavailability(householdId, month);
        res.status(200).json({ declarations });
    } catch (err) {
        next(err);
    }
}

async function declareUnavailable(req, res, next) {
    try {
        const { householdId } = req.user;
        const { date, reason } = req.body;

        const declaration = await foodService.declareMessUnavailable(householdId, date, reason, req.user);
        res.status(201).json({ declaration });
    } catch (err) {
        next(err);
    }
}

async function revokeUnavailable(req, res, next) {
    try {
        const { householdId } = req.user;
        const { date } = req.params;
        const { reason } = req.body;

        const declaration = await foodService.revokeMessUnavailable(householdId, date, reason, req.user);
        res.status(200).json({ declaration });
    } catch (err) {
        next(err);
    }
}

async function getAttendance(req, res, next) {
    try {
        const { householdId } = req.user;
        const { startDate, endDate } = req.query;

        const data = await foodService.getHouseholdAttendance(householdId, startDate, endDate);
        res.status(200).json(data);
    } catch (err) {
        next(err);
    }
}

async function adminUpdateAttendance(req, res, next) {
    try {
        const { householdId } = req.user;
        const { userId, date } = req.params;
        const { status, reason } = req.body;

        const updated = await foodService.adminUpdateMemberAttendance(householdId, userId, date, status, req.user, { reason });
        res.status(200).json({ record: updated });
    } catch (err) {
        next(err);
    }
}

async function adminBulkAttendance(req, res, next) {
    try {
        const { householdId } = req.user;
        const { updates, reason } = req.body;

        const result = await foodService.adminBulkUpdateAttendance(householdId, updates, req.user, reason);
        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
}

async function getLeaves(req, res, next) {
    try {
        const { householdId } = req.user;
        const leaves = await foodService.getHouseholdLeaves(householdId);
        res.status(200).json({ leaves });
    } catch (err) {
        next(err);
    }
}

async function createLeave(req, res, next) {
    try {
        const { householdId } = req.user;
        const { userIds, startDate, endDate, reason } = req.body;

        const result = await foodService.createMemberLeave(householdId, { userIds, startDate, endDate, reason }, req.user);
        res.status(201).json(result);
    } catch (err) {
        next(err);
    }
}

async function cancelLeave(req, res, next) {
    try {
        const { householdId } = req.user;
        const { id } = req.params;
        const { reason } = req.body;

        const result = await foodService.cancelMemberLeave(householdId, parseInt(id, 10), reason, req.user);
        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
}

module.exports = {
    getFoodConfig,
    getMemberFood,
    updateMemberFood,
    getMonthlyUnavailable,
    declareUnavailable,
    revokeUnavailable,
    getAttendance,
    adminUpdateAttendance,
    adminBulkAttendance,
    getLeaves,
    createLeave,
    cancelLeave
};
