const express = require('express');
const router = express.Router();
const choreController = require('../controllers/choreController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// Vessel Washing Rotation
router.get('/vessel-schedule', choreController.getVesselSchedule);
router.patch('/vessel-schedule/:id', requireRole('ADMIN'), choreController.updateVesselSchedule);

// Chore Assignments
router.get('/assignments', choreController.getAssignments);
router.patch('/assignments/:id/status', choreController.updateAssignmentStatus);

// Dustbin Cyclic Handoff
router.get('/dustbin/current', choreController.getCurrentDustbinCycle);
router.post('/dustbin/claim', choreController.claimDustbinCycle);
router.post('/dustbin/:id/complete', choreController.completeDustbinCycle);
router.get('/dustbin/history', choreController.getDustbinHistory);

module.exports = router;
