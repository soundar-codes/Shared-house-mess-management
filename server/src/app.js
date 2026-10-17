const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Configure trusted reverse proxies (e.g. Nginx, Caddy) for accurate forwarded client IP & HTTPS protocol
app.set('trust proxy', process.env.TRUST_PROXY ? (process.env.TRUST_PROXY === 'true' ? true : (isNaN(Number(process.env.TRUST_PROXY)) ? process.env.TRUST_PROXY : Number(process.env.TRUST_PROXY))) : 1);

// Middleware
app.use(helmet());

// Secure CORS configuration with origin whitelist and credential support
const allowedOrigins = process.env.CLIENT_ORIGIN 
    ? process.env.CLIENT_ORIGIN.split(',').map(s => s.trim()) 
    : ['http://localhost:5173', 'http://127.0.0.1:5173'];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Blocked by CORS policy'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Request body size limit to prevent Denial of Service
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Routes
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'shared-house-management-api'
  });
});

const authRoutes = require('./routes/auth');
app.use('/api/v1/auth', authRoutes);

const foodRoutes = require('./routes/food');
app.use('/api/v1/food', foodRoutes);

const notificationRoutes = require('./routes/notifications');
app.use('/api/v1/notifications', notificationRoutes);

const choreRoutes = require('./routes/chores');
app.use('/api/v1/chores', choreRoutes);

const billingRoutes = require('./routes/billing');
app.use('/api/v1/billing', billingRoutes);

const adminRoutes = require('./routes/admin');
app.use('/api/v1/admin', adminRoutes);

const householdRoutes = require('./routes/household');
app.use('/api/v1/household', householdRoutes);

// Handle unknown routes
app.use((req, res, next) => {
  res.status(404).json({
    error: {
      message: 'Not Found',
      status: 404
    }
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  const status = err.status || 500;

  if (err.message === 'Blocked by CORS policy') {
    return res.status(403).json({
      error: {
        message: 'Forbidden: Request origin not allowed by CORS policy',
        status: 403
      }
    });
  }

  // In production, mask internal server error details to prevent leaking database schemas or stack traces
  const isProduction = process.env.NODE_ENV === 'production';
  const message = (isProduction && status >= 500)
    ? 'An unexpected error occurred. Please contact the administrator.'
    : (err.message || 'Internal Server Error');

  res.status(status).json({
    error: {
      message,
      status
    }
  });
});

// Background schedulers
const { startBillingScheduler } = require('./services/billingScheduler');

// Only listen if this file is run directly (useful if tests want to import app)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startBillingScheduler();
  });
}

module.exports = app;
