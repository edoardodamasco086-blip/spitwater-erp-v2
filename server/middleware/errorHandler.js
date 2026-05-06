'use strict';
// ============================================================
// middleware/errorHandler.js
// Global error handler + asyncHandler wrapper
// ============================================================

const logger = require('../config/logger');

// ── asyncHandler ──────────────────────────────────────────────
// Wraps async route handlers so you don't need try/catch in every route.
// Usage: router.get('/users', asyncHandler(async (req, res) => { ... }))
// ─────────────────────────────────────────────────────────────
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ── 404 handler ───────────────────────────────────────────────
function notFound(req, res, next) {
  const err = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  err.status = 404;
  next(err);
}

// ── Global error handler ──────────────────────────────────────
// Express recognises 4-argument middleware as error handlers.
// Must be registered LAST in server.js — after all routes.
// ─────────────────────────────────────────────────────────────
function globalErrorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;

  // SQL Server errors have a 'number' property
  const isSqlError = err.number !== undefined;

  if (isSqlError) {
    logger.error('SQL Error:', {
      number:    err.number,
      message:   err.message,
      procedure: err.procName,
      line:      err.lineNumber,
      route:     `${req.method} ${req.originalUrl}`,
    });

    // Unique constraint violation — friendly message
    if (err.number === 2627 || err.number === 2601) {
      return res.status(409).json({
        success: false,
        error:   'A record with that value already exists.',
        code:    'DUPLICATE_KEY',
      });
    }

    return res.status(500).json({
      success: false,
      error:   process.env.NODE_ENV === 'development'
        ? `Database error: ${err.message}`
        : 'A database error occurred.',
      code:    'DB_ERROR',
    });
  }

  if (status >= 500) {
    logger.error('Server Error:', {
      message: err.message,
      stack:   err.stack,
      route:   `${req.method} ${req.originalUrl}`,
    });
  }

  res.status(status).json({
    success: false,
    error:   process.env.NODE_ENV === 'development'
      ? err.message
      : status >= 500 ? 'Internal server error' : err.message,
    ...(process.env.NODE_ENV === 'development' && status >= 500 && { stack: err.stack }),
  });
}

module.exports = { asyncHandler, notFound, globalErrorHandler };
