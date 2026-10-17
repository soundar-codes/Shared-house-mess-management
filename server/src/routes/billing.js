const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billingController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// Member mess cycles & start date configuration
router.get('/members/cycles', billingController.getMemberCycles);
router.patch('/members/:userId/mess-start-date', requireRole('ADMIN'), billingController.updateMemberMessStartDate);

// Admin-only automation status
router.get('/automation-status', requireRole('ADMIN'), billingController.getAutomationStatus);

// Monthly bill retrieval & details
router.get('/', billingController.getBills);
router.get('/:id', billingController.getBillById);

// Payment recording (Admin only) & payment history
router.post('/:id/pay', requireRole('ADMIN'), billingController.recordPayment);
router.patch('/:id/paid-amount', requireRole('ADMIN'), billingController.updatePaidAmount);
router.post('/payments/:paymentId/revoke', requireRole('ADMIN'), billingController.revokePayment);
router.get('/:id/payments', billingController.getBillPayments);

// Admin-only operations
router.post('/generate', requireRole('ADMIN'), billingController.generateMonthlyBills);
router.post('/:id/finalize', requireRole('ADMIN'), billingController.finalizeBill);
router.post('/:id/reopen', requireRole('ADMIN'), billingController.reopenBill);

module.exports = router;

