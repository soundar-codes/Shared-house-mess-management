const express = require('express');
const router = express.Router();
const cronController = require('../controllers/cronController');

// GET /api/v1/cron/billing - Invoked daily by Vercel Cron
router.get('/billing', cronController.handleBillingCron);

module.exports = router;
