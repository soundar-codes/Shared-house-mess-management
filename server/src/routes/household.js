const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// All members can view household information
router.get('/info', adminController.getHouseholdInfo);

// Only administrators can edit/create household information
router.put('/info', requireRole('ADMIN'), adminController.updateHouseholdInfo);
router.patch('/info', requireRole('ADMIN'), adminController.updateHouseholdInfo);

module.exports = router;
