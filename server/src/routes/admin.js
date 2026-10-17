const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAuth, requireRole } = require('../middleware/auth');

// All admin routes require ADMIN role
router.use(requireAuth);
router.use(requireRole('ADMIN'));

// 1. Overview
router.get('/overview', adminController.getOverview);

// 2. Member Management
router.get('/members', adminController.getMembers);
router.post('/members', adminController.createMember);
router.patch('/members/:userId', adminController.updateMember);

// 3. Household Settings (Rate, Cutoff, Timezone)
router.patch('/settings', adminController.updateSettings);
router.put('/settings', adminController.updateSettings);

// 4. Audit Logs
router.get('/audit-logs', adminController.getAuditLogs);

// 5. Automatic Billing Manual Run
router.post('/billing/run-check', adminController.triggerManualBillingCheck);
router.post('/scheduler/trigger', adminController.triggerManualBillingCheck);

module.exports = router;
