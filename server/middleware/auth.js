'use strict';
// ============================================================
// middleware/auth.js — JWT verification + role guards
//
// Usage in routes:
//   router.get('/users', requireAuth, requireRole('admin'), handler)
//   router.get('/me',    requireAuth, handler)
// ============================================================

const jwt    = require('jsonwebtoken');
const logger = require('../config/logger');

// ── requireAuth ───────────────────────────────────────────────
// Verifies the Bearer token in the Authorization header.
// On success: attaches req.user = { userId, orgId, email, role }
// On failure: returns 401
// ─────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error:   'No token provided. Include Authorization: Bearer <token>'
      });
    }

    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach decoded payload to request
    req.user = {
      userId: decoded.userId,
      orgId:  decoded.orgId,
      email:  decoded.email,
      role:   decoded.role,
      name:   decoded.name,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error:   'Token expired',
        code:    'TOKEN_EXPIRED'
      });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error:   'Invalid token',
        code:    'TOKEN_INVALID'
      });
    }
    logger.error('Auth middleware error:', err);
    return res.status(500).json({ success: false, error: 'Authentication error' });
  }
}

// ── requireRole ───────────────────────────────────────────────
// Call AFTER requireAuth.
// Accepts a single role string or an array of allowed roles.
//
// Role hierarchy (highest to lowest):
//   super_admin → admin → editor → viewer
// ─────────────────────────────────────────────────────────────
const ROLE_RANK = {
  super_admin: 4,
  admin:       3,
  editor:      2,
  viewer:      1,
};

function requireRole(...allowedRoles) {
  // Flatten in case called as requireRole(['admin','editor']) or requireRole('admin','editor')
  const roles = allowedRoles.flat();

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const userRole = req.user.role;

    // super_admin can always do everything
    if (userRole === 'super_admin') return next();

    if (roles.includes(userRole)) return next();

    logger.warn(`Access denied: user ${req.user.email} (${userRole}) tried to access ${req.method} ${req.originalUrl}`);

    return res.status(403).json({
      success: false,
      error:   `Access denied. Required role: ${roles.join(' or ')}. Your role: ${userRole}`,
      code:    'INSUFFICIENT_ROLE'
    });
  };
}

// ── requireMinRole ────────────────────────────────────────────
// Allows a role AND anything above it in the hierarchy.
// e.g. requireMinRole('editor') allows editor, admin, super_admin
// ─────────────────────────────────────────────────────────────
function requireMinRole(minRole) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const userRank = ROLE_RANK[req.user.role] || 0;
    const minRank  = ROLE_RANK[minRole]        || 0;

    if (userRank >= minRank) return next();

    return res.status(403).json({
      success: false,
      error:   `Access denied. Minimum role required: ${minRole}`,
      code:    'INSUFFICIENT_ROLE'
    });
  };
}

// ── requireSameOrgOrAdmin ─────────────────────────────────────
// Ensures user can only access resources within their own org,
// unless they are super_admin.
// ─────────────────────────────────────────────────────────────
function requireSameOrg(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  // super_admin can access any org
  if (req.user.role === 'super_admin') return next();

  // All queries are automatically scoped to req.user.orgId in routes
  next();
}

module.exports = { requireAuth, requireRole, requireMinRole, requireSameOrg };
