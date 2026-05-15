'use strict';
// ============================================================
// server.js — Spitwater ERP Express backend
// ============================================================

require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const compression  = require('compression');
const rateLimit    = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path         = require('path');

const logger                            = require('./config/logger');
const { poolConnect }                   = require('./config/db');
const { notFound, globalErrorHandler }  = require('./middleware/errorHandler');
require('./services/cronJobs');

// ── Import routes ─────────────────────────────────────────────
const authRoutes      = require('./routes/auth');
const usersRoutes     = require('./routes/users');
const dashboardRoutes  = require('./routes/dashboard');
const contactsRoutes   = require('./routes/contacts');
const settingsRoutes   = require('./routes/settings');
const inviteRoutes      = require('./routes/invite-accept');
const permissionsRoutes = require('./routes/permissions');
const numberingRoutes      = require('./routes/numbering');
const fieldValidationRoutes = require('./routes/field-validation');
const currencyRoutes        = require('./routes/currency');
const productUomRoutes      = require('./routes/product-uom');
const priceListRoutes       = require('./routes/price-lists');
const productsRoutes        = require('./routes/products');
const productSuppliersRoutes = require('./routes/product-suppliers');
const productAssociationTypesRoutes = require('./routes/product-association-types');
const productAssociationsRoutes = require('./routes/product-associations');
const customFieldsRoutes    = require('./routes/custom-fields');
const warehouseRoutes       = require('./routes/warehouse');
const accountingRoutes      = require('./routes/accounting');
const wmsInboundRoutes      = require('./routes/wmsInbound');
const wmsPutawayRulesRoutes = require('./routes/wmsPutawayRules');
const p2pPRRoutes            = require('./routes/p2pPR');
const p2pRFQRoutes           = require('./routes/p2pRFQ');
const p2pPORoutes            = require('./routes/p2pPO');
const p2pApprovalLevelsRoutes = require('./routes/p2pApprovalLevels');
const p2pReportsRoutes        = require('./routes/p2pReports');
const o2cQuotesRoutes         = require('./routes/o2cQuotes');
const o2cSORoutes             = require('./routes/o2cSO');
const o2cPricingRoutes        = require('./routes/o2cPricing');
const o2cOutboundRoutes          = require('./routes/o2cOutbound');
const customerCategoriesRoutes   = require('./routes/customerCategories');
const pirRoutes                  = require('./routes/pir');
const bpRoutes                   = require('./routes/bpAddresses');
const businessPartnersRoutes     = require('./routes/businessPartners');

// ── Create app ────────────────────────────────────────────────
const app  = express();
const PORT = parseInt(process.env.PORT) || 3000;

// ── Security headers (helmet) ─────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── CORS ──────────────────────────────────────────────────────
// In dev: allows requests from Vite's dev server (port 5173)
// In production: restrict to your actual domain
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (Postman, mobile apps, curl)
    if (!origin) return callback(null, true);
    if (corsOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials:      true,
  allowedHeaders:   ['Content-Type', 'Authorization'],
  methods:          ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// ── Cookie parsing ────────────────────────────────────────────
app.use(cookieParser());

// ── Body parsing ──────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ── Compression ───────────────────────────────────────────────
app.use(compression());

// ── Global rate limit (generous — per-route limits are tighter) ──
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      500,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, error: 'Too many requests, please slow down.' }
}));

// ── Request logger (dev only) ─────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  app.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.originalUrl}`);
    next();
  });
}

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    await poolConnect;
    res.json({
      success: true,
      status:  'ok',
      version: '1.0.0',
      env:     process.env.NODE_ENV,
      time:    new Date().toISOString(),
    });
  } catch {
    res.status(503).json({ success: false, status: 'db_unavailable' });
  }
});

// ── API routes ────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/users',     usersRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/contacts',  contactsRoutes);
app.use('/api/settings',  settingsRoutes);
app.use('/api/invite',       inviteRoutes);
app.use('/api/permissions',  permissionsRoutes);
app.use('/api/numbering',        numberingRoutes);
app.use('/api/field-validation', fieldValidationRoutes);
app.use('/api/currency',         currencyRoutes);
app.use('/api/product-uom',       productUomRoutes);
app.use('/api/price-lists',       priceListRoutes);
app.use('/api/products',          productsRoutes);
app.use('/api/products',          productSuppliersRoutes);
app.use('/api/product-association-types', productAssociationTypesRoutes);
app.use('/api/products/:id',      productAssociationsRoutes);
app.use('/api/custom-fields',     customFieldsRoutes);
app.use('/api/warehouse',         warehouseRoutes);
app.use('/api/accounting',        accountingRoutes);
app.use('/api/wms/inbound',           wmsInboundRoutes);
app.use('/api/wms/putaway-rules',     wmsPutawayRulesRoutes);
app.use('/api/p2p/requisitions',      p2pPRRoutes);
app.use('/api/p2p/rfq',               p2pRFQRoutes);
app.use('/api/p2p/orders',            p2pPORoutes);
app.use('/api/p2p/approval-levels',   p2pApprovalLevelsRoutes);
app.use('/api/p2p/reports',           p2pReportsRoutes);
app.use('/api/o2c/quotes',            o2cQuotesRoutes);
app.use('/api/o2c/so',                o2cSORoutes);
app.use('/api/o2c/pricing',           o2cPricingRoutes);
app.use('/api/o2c/outbound',          o2cOutboundRoutes);
app.use('/api/customer-categories',  customerCategoriesRoutes);
app.use('/api/pir',                  pirRoutes);
app.use('/api/bp',                   bpRoutes);
app.use('/api/business-partners',    businessPartnersRoutes);

// ── Serve uploaded files (images, documents) ─────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Serve React build in production ──────────────────────────
// In dev, React runs on its own Vite server (port 5173).
// In production (npm run build), React is built to /client/dist
// and Express serves those static files.
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  // For React Router — send all non-API requests to index.html
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(clientDist, 'index.html'));
    }
  });
}

// ── 404 + Error handlers (must be last) ───────────────────────
app.use(notFound);
app.use(globalErrorHandler);

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`Server running on http://localhost:${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`CORS origin:  ${corsOrigins.join(', ')}`);
});

// ── Graceful shutdown ─────────────────────────────────────────
process.on('SIGTERM', () => {
  logger.info('SIGTERM received — shutting down gracefully');
  process.exit(0);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection:', reason);
});

module.exports = app;
