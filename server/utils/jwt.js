'use strict';
// ============================================================
// utils/jwt.js — JWT helpers
// Signs access tokens and refresh tokens consistently
// ============================================================

const jwt = require('jsonwebtoken');

// ── Sign access token ──────────────────────────────────────────
// Payload stored in token (do NOT include sensitive data):
//   userId, orgId, email, role, name
// ─────────────────────────────────────────────────────────────
function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    issuer:    'spitwater-erp',
    audience:  'erp-client',
  });
}

// ── Sign refresh token ────────────────────────────────────────
// Longer-lived — stored in DB (refresh_tokens table)
// Only contains userId + orgId — no role (role may change)
// ─────────────────────────────────────────────────────────────
function signRefreshToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    issuer:    'spitwater-erp',
    audience:  'erp-refresh',
  });
}

// ── Verify any token ──────────────────────────────────────────
function verifyToken(token, audience = 'erp-client') {
  return jwt.verify(token, process.env.JWT_SECRET, {
    issuer:   'spitwater-erp',
    audience,
  });
}

// ── Decode without verifying ──────────────────────────────────
// Safe for reading expired tokens to get userId before refresh
function decodeToken(token) {
  return jwt.decode(token);
}

module.exports = { signAccessToken, signRefreshToken, verifyToken, decodeToken };
