const choreService = require('../services/choreService');

async function getVesselSchedule(req, res, next) {
    try {
        const { householdId } = req.user;
        const schedule = await choreService.getVesselSchedule(householdId);
        res.status(200).json({ schedule });
    } catch (err) {
        next(err);
    }
}

async function updateVesselSchedule(req, res, next) {
    try {
        const { householdId } = req.user;
        const scheduleId = parseInt(req.params.id, 10);
        const { assignedUserId } = req.body;

        if (isNaN(scheduleId)) {
            return res.status(400).json({ error: { message: 'Invalid schedule entry ID', status: 400 } });
        }

        const entry = await choreService.updateVesselSchedule(
            householdId,
            scheduleId,
            { assignedUserId: assignedUserId !== undefined ? assignedUserId : null },
            req.user
        );

        res.status(200).json({ scheduleEntry: entry });
    } catch (err) {
        next(err);
    }
}

async function getAssignments(req, res, next) {
    try {
        const { householdId } = req.user;
        const { userId, status } = req.query;
        const assignments = await choreService.getAssignments(householdId, { userId, status });
        res.status(200).json({ assignments });
    } catch (err) {
        next(err);
    }
}

async function updateAssignmentStatus(req, res, next) {
    try {
        const { householdId } = req.user;
        const assignmentId = parseInt(req.params.id, 10);
        const { status } = req.body;

        if (isNaN(assignmentId)) {
            return res.status(400).json({ error: { message: 'Invalid assignment ID', status: 400 } });
        }

        if (!status) {
            return res.status(400).json({ error: { message: 'Status is required', status: 400 } });
        }

        const updated = await choreService.updateAssignmentStatus(householdId, assignmentId, status, req.user);
        res.status(200).json({ assignment: updated });
    } catch (err) {
        next(err);
    }
}

async function getCurrentDustbinCycle(req, res, next) {
    try {
        const { householdId } = req.user;
        const cycle = await choreService.getCurrentDustbinCycle(householdId);
        res.status(200).json({ cycle });
    } catch (err) {
        next(err);
    }
}

async function claimDustbinCycle(req, res, next) {
    try {
        const { householdId, id: userId } = req.user;
        const { allowTakeover } = req.body;

        const cycle = await choreService.claimDustbinCycle(householdId, userId, {
            allowTakeover: Boolean(allowTakeover),
            actingUser: req.user
        });

        res.status(200).json({ cycle });
    } catch (err) {
        next(err);
    }
}

async function completeDustbinCycle(req, res, next) {
    try {
        const { householdId } = req.user;
        const cycleId = parseInt(req.params.id, 10);

        if (isNaN(cycleId)) {
            return res.status(400).json({ error: { message: 'Invalid cycle ID', status: 400 } });
        }

        const cycle = await choreService.completeDustbinCycle(householdId, cycleId, req.user);
        res.status(200).json({ cycle });
    } catch (err) {
        next(err);
    }
}

async function getDustbinHistory(req, res, next) {
    try {
        const { householdId } = req.user;
        const { limit, offset } = req.query;
        const history = await choreService.getDustbinHistory(householdId, { limit, offset });
        res.status(200).json({ history });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    getVesselSchedule,
    updateVesselSchedule,
    getAssignments,
    updateAssignmentStatus,
    getCurrentDustbinCycle,
    claimDustbinCycle,
    completeDustbinCycle,
    getDustbinHistory
};
