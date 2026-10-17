const express = require('express');
const router = express.Router();
const foodController = require('../controllers/foodController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', foodController.getMemberFood);
router.get('/config', foodController.getFoodConfig);
router.get('/unavailable', foodController.getMonthlyUnavailable);
router.put('/:date', foodController.updateMemberFood);

// Admin-only mess unavailability endpoints
router.post('/unavailable', requireRole('ADMIN'), foodController.declareUnavailable);
router.patch('/unavailable/:date/revoke', requireRole('ADMIN'), foodController.revokeUnavailable);

// Admin-only food attendance and leave endpoints
router.get('/attendance', requireRole('ADMIN'), foodController.getAttendance);
router.put('/attendance/members/:userId/dates/:date', requireRole('ADMIN'), foodController.adminUpdateAttendance);
router.post('/attendance/bulk', requireRole('ADMIN'), foodController.adminBulkAttendance);
router.get('/leaves', requireRole('ADMIN'), foodController.getLeaves);
router.post('/leaves', requireRole('ADMIN'), foodController.createLeave);
router.patch('/leaves/:id/cancel', requireRole('ADMIN'), foodController.cancelLeave);

module.exports = router;
