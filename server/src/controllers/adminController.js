const adminService = require('../services/adminService');
const { executeBillingAutomationCycle } = require('../services/billingScheduler');

async function getOverview(req, res, next) {
    try {
        const { householdId } = req.user;
        const overview = await adminService.getAdminOverview(householdId);
        res.status(200).json({ overview });
    } catch (err) {
        next(err);
    }
}

async function getMembers(req, res, next) {
    try {
        const { householdId } = req.user;
        const members = await adminService.getAdminMembers(householdId);
        res.status(200).json({ members });
    } catch (err) {
        next(err);
    }
}

async function createMember(req, res, next) {
    try {
        const { householdId } = req.user;
        const { userId, name, password, role, messStartDate } = req.body;
        const newMember = await adminService.createHouseholdMember(householdId, { userId, name, password, role, messStartDate }, req.user);
        res.status(201).json({ member: newMember });
    } catch (err) {
        next(err);
    }
}

async function updateMember(req, res, next) {
    try {
        const { householdId } = req.user;
        const { userId } = req.params;
        const { role, isActive, reason } = req.body;
        const updated = await adminService.updateMemberAccount(householdId, userId, { role, isActive, reason }, req.user);
        res.status(200).json({ member: updated });
    } catch (err) {
        next(err);
    }
}

async function updateSettings(req, res, next) {
    try {
        const { householdId } = req.user;
        const { defaultRatePaise, cancellationCutoffTime, timezone } = req.body;
        const result = await adminService.updateHouseholdSettings(householdId, { defaultRatePaise, cancellationCutoffTime, timezone }, req.user);
        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
}

async function getAuditLogs(req, res, next) {
    try {
        const { householdId } = req.user;
        const { limit, offset, action } = req.query;
        const logs = await adminService.getAuditLogs(householdId, {
            limit: limit ? parseInt(limit, 10) : 50,
            offset: offset ? parseInt(offset, 10) : 0,
            action
        });
        res.status(200).json({ logs });
    } catch (err) {
        next(err);
    }
}

async function triggerManualBillingCheck(req, res, next) {
    try {
        const results = await executeBillingAutomationCycle({ actingUser: req.user });
        res.status(200).json({ message: 'Manual automatic billing check completed', results });
    } catch (err) {
        next(err);
    }
}

async function getHouseholdInfo(req, res, next) {
    try {
        const { householdId } = req.user;
        const info = await adminService.getHouseholdInformation(householdId);
        res.status(200).json({ info });
    } catch (err) {
        next(err);
    }
}

async function updateHouseholdInfo(req, res, next) {
    try {
        const { householdId } = req.user;
        const info = await adminService.updateHouseholdInformation(householdId, req.body, req.user);
        res.status(200).json({ info });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    getOverview,
    getMembers,
    createMember,
    updateMember,
    updateSettings,
    getAuditLogs,
    triggerManualBillingCheck,
    getHouseholdInfo,
    updateHouseholdInfo
};
