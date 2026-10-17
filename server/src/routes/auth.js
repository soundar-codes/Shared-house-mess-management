const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { createRateLimiter } = require('../middleware/rateLimiter');

// Rate limit: maximum 10 login attempts per minute per IP
const loginLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Too many login attempts. Please wait a minute before trying again.'
});

router.post('/login', loginLimiter, authController.login);
router.post('/logout', authController.logout);
router.get('/me', authController.getMe);

module.exports = router;
