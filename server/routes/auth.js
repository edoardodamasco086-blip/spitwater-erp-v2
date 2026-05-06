'use strict';
// ============================================================
// routes/auth.js
//
// POST /api/auth/login        — email + password → tokens
// POST /api/auth/refresh      — refresh token   → new access token
// POST /api/auth/logout       — revoke refresh token
// GET  /api/auth/me           — return current user from JWT
// POST /api/auth/change-password — change own password
// ============================================================

const express    = require('express');
const router     = express.Router();
const rateLimit  = require('express-rate-limit');
const crypto     = require('crypto');

const { sql, pool, poolConnect } = require('../config/db');
const { signAccessToken, signRefreshToken, verifyToken } = require('../utils/jwt');
const { hashPassword, verifyPassword } = require('../utils/password');
const { requireAuth }                  = require('../middleware/auth');
const { asyncHandler }                 = require('../middleware/errorHandler');
const logger                           = require('../config/logger');

// ── Rate limit login attempts ─────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      10,              // 10 attempts per window per IP
  message:  { success: false, error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── Helper: get client IP ──────────────────────────────────────
function getIP(req) {
  return req.ip || req.headers['x-forwarded-for'] || 'unknown';
}

// ── Helper: hash token for DB storage (never store raw tokens) ─
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ────────────────────────────────────────────────────────────────
// POST /api/auth/login
// Body: { email, password }
// Returns: { accessToken, refreshToken, user }
// ────────────────────────────────────────────────────────────────
router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error:   'Email and password are required.'
    });
  }

  await poolConnect;

  // ── 1. Look up user by email ──────────────────────────────
  const userResult = await pool.request()
    .input('email', sql.VarChar(200), email.trim().toLowerCase())
    .query(`
      SELECT
        u.id,
        u.email,
        u.password_hash,
        u.full_name,
        u.is_active,
        u.failed_login_count,
        u.locked_until,
        u.email_verified,
        om.org_id,
        om.role,
        om.custom_role_id,
        o.name AS org_name,
        o.is_active AS org_active
      FROM users u
      LEFT JOIN org_members om ON om.user_id = u.id AND om.is_active = 1
      LEFT JOIN organisations o ON o.id = om.org_id
      WHERE u.email = @email
    `);

  const user = userResult.recordset[0];

  // ── 2. User not found — generic message (don't leak existence) ──
  if (!user) {
    logger.warn(`Login: unknown email [${email}] from IP ${getIP(req)}`);
    return res.status(401).json({
      success: false,
      error:   'Invalid email or password.'
    });
  }

  // ── 3. Account locked? ─────────────────────────────────────
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    return res.status(401).json({
      success: false,
      error:   `Account temporarily locked. Try again in ${mins} minute(s).`,
      code:    'ACCOUNT_LOCKED'
    });
  }

  // ── 4. Account inactive ─────────────────────────────────────
  if (!user.is_active) {
    return res.status(401).json({
      success: false,
      error:   'Account is deactivated. Contact your administrator.',
      code:    'ACCOUNT_INACTIVE'
    });
  }

  // ── 5. Verify password ─────────────────────────────────────
  const passwordMatch = await verifyPassword(password, user.password_hash);

  if (!passwordMatch) {
    // Increment failed login counter
    const newCount = (user.failed_login_count || 0) + 1;
    let lockUntil  = null;

    // Lock after 5 failed attempts for 15 minutes
    if (newCount >= 5) {
      lockUntil = new Date(Date.now() + 15 * 60 * 1000);
      logger.warn(`Login: account [${email}] locked after ${newCount} failed attempts`);
    }

    await pool.request()
      .input('id',          sql.Int,      user.id)
      .input('count',       sql.Int,      newCount)
      .input('locked_until', sql.DateTime, lockUntil)
      .query(`
        UPDATE users
        SET failed_login_count = @count,
            locked_until       = @locked_until
        WHERE id = @id
      `);

    logger.warn(`Login: wrong password for [${email}] (attempt ${newCount})`);
    return res.status(401).json({
      success: false,
      error:   'Invalid email or password.',
      ...(newCount >= 3 && {
        hint: `${5 - newCount} attempt(s) remaining before account lock.`
      })
    });
  }

  // ── 6. Password correct — reset failed count ───────────────
  await pool.request()
    .input('id', sql.Int, user.id)
    .query(`
      UPDATE users
      SET failed_login_count = 0,
          locked_until       = NULL,
          last_login_at      = GETDATE()
      WHERE id = @id
    `);

  // ── 7. Build token payload ──────────────────────────────────
  const tokenPayload = {
    userId: user.id,
    orgId:  user.org_id,
    email:  user.email,
    role:   user.role || 'viewer',
    name:   user.full_name,
  };

  const accessToken  = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken({ userId: user.id, orgId: user.org_id });

  // ── 8. Store hashed refresh token in DB ────────────────────
  const tokenHash  = hashToken(refreshToken);
  const expiresAt  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await pool.request()
    .input('user_id',    sql.Int,          user.id)
    .input('org_id',     sql.Int,          user.org_id)
    .input('token_hash', sql.VarChar(100), tokenHash)
    .input('expires_at', sql.DateTime,     expiresAt)
    .input('ip_address', sql.VarChar(45),  getIP(req))
    .input('user_agent', sql.NVarChar(500), req.headers['user-agent'] || '')
    .query(`
      INSERT INTO refresh_tokens (user_id, org_id, token_hash, expires_at, ip_address, user_agent, created_at)
      VALUES (@user_id, @org_id, @token_hash, @expires_at, @ip_address, @user_agent, GETDATE())
    `);

  // ── 9. Log login to audit_log ──────────────────────────────
  await pool.request()
    .input('org_id',      sql.Int,           user.org_id)
    .input('user_id',     sql.Int,           user.id)
    .input('user_email',  sql.VarChar(200),  user.email)
    .input('user_name',   sql.NVarChar(200), user.full_name)
    .input('ip_address',  sql.VarChar(45),   getIP(req))
    .input('description', sql.NVarChar(1000), `User logged in from ${getIP(req)}`)
    .query(`
      INSERT INTO audit_log (org_id, user_id, user_email, user_name, ip_address, action_type, description, occurred_at)
      VALUES (@org_id, @user_id, @user_email, @user_name, @ip_address, 'auth.login', @description, GETDATE())
    `);

  logger.info(`Login: success for [${email}] org=${user.org_id} role=${user.role}`);

  // ── 10. Return tokens + safe user object ───────────────────
  return res.json({
    success: true,
    data: {
      accessToken,
      refreshToken,
      user: {
        id:       user.id,
        email:    user.email,
        name:     user.full_name,
        role:     user.role || 'viewer',
        orgId:    user.org_id,
        orgName:  user.org_name,
      }
    }
  });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/auth/refresh
// Body: { refreshToken }
// Returns: { accessToken }
// ────────────────────────────────────────────────────────────────
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ success: false, error: 'Refresh token required.' });
  }

  // ── Verify token signature & expiry ────────────────────────
  let decoded;
  try {
    decoded = verifyToken(refreshToken, 'erp-refresh');
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired refresh token.', code: 'REFRESH_INVALID' });
  }

  await poolConnect;

  // ── Check token exists in DB and not revoked ───────────────
  const tokenHash = hashToken(refreshToken);
  const rows = await pool.request()
    .input('token_hash', sql.VarChar(100), tokenHash)
    .query(`
      SELECT id, user_id, org_id, expires_at, revoked_at
      FROM refresh_tokens
      WHERE token_hash = @token_hash
    `);

  if (!rows.recordset.length || rows.recordset[0].revoked_at) {
    return res.status(401).json({ success: false, error: 'Refresh token has been revoked.', code: 'REFRESH_REVOKED' });
  }

  // ── Fetch current user + role (may have changed since last login) ──
  const users = await pool.request()
    .input('user_id', sql.Int, decoded.userId)
    .query(`
      SELECT u.id, u.email, u.full_name, u.is_active,
             om.org_id, om.role
      FROM users u
      LEFT JOIN org_members om ON om.user_id = u.id AND om.org_id = @user_id
      WHERE u.id = @user_id AND u.is_active = 1
    `);

  // Better: get user+org separately
  const userRow = await pool.request()
    .input('user_id', sql.Int, decoded.userId)
    .input('org_id',  sql.Int, decoded.orgId)
    .query(`
      SELECT u.id, u.email, u.full_name, u.is_active,
             om.org_id, om.role
      FROM users u
      INNER JOIN org_members om ON om.user_id = u.id AND om.org_id = @org_id AND om.is_active = 1
      WHERE u.id = @user_id AND u.is_active = 1
    `);

  if (!userRow.recordset.length) {
    return res.status(401).json({ success: false, error: 'User not found or deactivated.', code: 'USER_INVALID' });
  }

  const user = userRow.recordset[0];

  const newAccessToken = signAccessToken({
    userId: user.id,
    orgId:  user.org_id,
    email:  user.email,
    role:   user.role || 'viewer',
    name:   user.full_name,
  });

  return res.json({ success: true, data: { accessToken: newAccessToken } });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/auth/logout
// Headers: Authorization: Bearer <accessToken>
// Body: { refreshToken }
// ────────────────────────────────────────────────────────────────
router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    await poolConnect;
    const tokenHash = hashToken(refreshToken);
    await pool.request()
      .input('token_hash', sql.VarChar(100), tokenHash)
      .query(`
        UPDATE refresh_tokens
        SET revoked_at     = GETDATE(),
            revoked_reason = 'logout'
        WHERE token_hash = @token_hash
      `);
  }

  // Audit log
  await pool.request()
    .input('user_id',     sql.Int,           req.user.userId)
    .input('org_id',      sql.Int,           req.user.orgId)
    .input('user_email',  sql.VarChar(200),  req.user.email)
    .input('user_name',   sql.NVarChar(200), req.user.name)
    .input('ip_address',  sql.VarChar(45),   getIP(req))
    .input('description', sql.NVarChar(1000), 'User logged out')
    .query(`
      INSERT INTO audit_log (org_id, user_id, user_email, user_name, ip_address, action_type, description, occurred_at)
      VALUES (@org_id, @user_id, @user_email, @user_name, @ip_address, 'auth.logout', @description, GETDATE())
    `);

  logger.info(`Logout: [${req.user.email}]`);
  return res.json({ success: true, message: 'Logged out successfully.' });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/auth/me
// Returns the current user's profile from the DB (fresh, not just JWT)
// ────────────────────────────────────────────────────────────────
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  await poolConnect;

  const rows = await pool.request()
    .input('user_id', sql.Int, req.user.userId)
    .input('org_id',  sql.Int, req.user.orgId)
    .query(`
      SELECT
        u.id,
        u.email,
        u.full_name,
        u.phone,
        u.avatar_url,
        u.email_verified,
        u.last_login_at,
        u.created_at,
        om.role,
        om.org_id,
        o.name        AS org_name,
        o.abn         AS org_abn,
        o.logo_url    AS org_logo,
        o.timezone    AS org_timezone,
        o.base_currency_code AS org_currency
      FROM users u
      INNER JOIN org_members om ON om.user_id = u.id AND om.org_id = @org_id AND om.is_active = 1
      INNER JOIN organisations o ON o.id = om.org_id
      WHERE u.id = @user_id AND u.is_active = 1
    `);

  if (!rows.recordset.length) {
    return res.status(404).json({ success: false, error: 'User not found.' });
  }

  const u = rows.recordset[0];

  return res.json({
    success: true,
    data: {
      id:            u.id,
      email:         u.email,
      name:          u.full_name,
      phone:         u.phone,
      avatarUrl:     u.avatar_url,
      emailVerified: u.email_verified,
      lastLoginAt:   u.last_login_at,
      role:          u.role,
      org: {
        id:       u.org_id,
        name:     u.org_name,
        abn:      u.org_abn,
        logoUrl:  u.org_logo,
        timezone: u.org_timezone,
        currency: u.org_currency,
      }
    }
  });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/auth/change-password
// Body: { currentPassword, newPassword }
// ────────────────────────────────────────────────────────────────
router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'Both currentPassword and newPassword are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'New password must be at least 8 characters.' });
  }

  await poolConnect;

  const rows = await pool.request()
    .input('id', sql.Int, req.user.userId)
    .query('SELECT id, password_hash FROM users WHERE id = @id');

  const user = rows.recordset[0];
  if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

  const match = await verifyPassword(currentPassword, user.password_hash);
  if (!match) {
    return res.status(401).json({ success: false, error: 'Current password is incorrect.' });
  }

  const newHash = await hashPassword(newPassword);

  await pool.request()
    .input('id',   sql.Int,          req.user.userId)
    .input('hash', sql.NVarChar(500), newHash)
    .query('UPDATE users SET password_hash = @hash, updated_at = GETDATE() WHERE id = @id');

  // Revoke all existing refresh tokens (force re-login everywhere)
  await pool.request()
    .input('user_id', sql.Int, req.user.userId)
    .query(`
      UPDATE refresh_tokens
      SET revoked_at = GETDATE(), revoked_reason = 'password_changed'
      WHERE user_id = @user_id AND revoked_at IS NULL
    `);

  logger.info(`Password changed for user [${req.user.email}]`);

  return res.json({ success: true, message: 'Password changed. Please log in again.' });
}));

module.exports = router;
