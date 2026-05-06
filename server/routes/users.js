'use strict';
// ============================================================
// routes/users.js
//
// GET    /api/users              — list all users in org (admin+)
// GET    /api/users/:id          — get one user
// POST   /api/users/invite       — invite a new user (admin+)
// PATCH  /api/users/:id          — update user (admin+)
// PATCH  /api/users/:id/role     — change role (admin+)
// DELETE /api/users/:id/deactivate — soft deactivate (admin+)
// GET    /api/users/invites      — list pending invites
// DELETE /api/users/invites/:id  — revoke invite
// ============================================================

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');

const { sql, pool, poolConnect }       = require('../config/db');
const { requireAuth, requireRole }     = require('../middleware/auth');
const { asyncHandler }                 = require('../middleware/errorHandler');
const { hashPassword }                 = require('../utils/password');
const logger                           = require('../config/logger');

// All user routes require authentication
router.use(requireAuth);

// ────────────────────────────────────────────────────────────────
// GET /api/users
// Returns all users in the current org
// ────────────────────────────────────────────────────────────────
router.get('/', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;

  const rows = await pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .query(`
      SELECT
        u.id,
        u.email,
        u.full_name,
        u.phone,
        u.avatar_url,
        u.is_active,
        u.email_verified,
        u.last_login_at,
        u.created_at,
        om.role,
        om.joined_at,
        om.last_active_at
      FROM users u
      INNER JOIN org_members om ON om.user_id = u.id AND om.org_id = @org_id
      ORDER BY u.full_name ASC
    `);

  return res.json({ success: true, data: rows.recordset });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/users/:id
// ────────────────────────────────────────────────────────────────
router.get('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;

  const rows = await pool.request()
    .input('org_id',  sql.Int, req.user.orgId)
    .input('user_id', sql.Int, parseInt(req.params.id))
    .query(`
      SELECT
        u.id, u.email, u.full_name, u.phone,
        u.avatar_url, u.is_active, u.email_verified,
        u.last_login_at, u.created_at,
        om.role, om.joined_at
      FROM users u
      INNER JOIN org_members om ON om.user_id = u.id AND om.org_id = @org_id
      WHERE u.id = @user_id
    `);

  if (!rows.recordset.length) {
    return res.status(404).json({ success: false, error: 'User not found in this organisation.' });
  }

  return res.json({ success: true, data: rows.recordset[0] });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/users/invite
// Body: { email, role, full_name }
// Generates an invite token — in production this emails the link
// ────────────────────────────────────────────────────────────────
router.post('/invite', requireRole('admin'), asyncHandler(async (req, res) => {
  const { email, role, full_name } = req.body;

  if (!email || !role) {
    return res.status(400).json({ success: false, error: 'email and role are required.' });
  }

  const validRoles = ['admin', 'editor', 'viewer'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ success: false, error: `role must be one of: ${validRoles.join(', ')}` });
  }

  await poolConnect;

  // Check if already a member
  const existing = await pool.request()
    .input('org_id', sql.Int,          req.user.orgId)
    .input('email',  sql.VarChar(200), email.trim().toLowerCase())
    .query(`
      SELECT u.id FROM users u
      INNER JOIN org_members om ON om.user_id = u.id AND om.org_id = @org_id
      WHERE u.email = @email AND u.is_active = 1
    `);

  if (existing.recordset.length) {
    return res.status(409).json({ success: false, error: 'This user is already a member of this organisation.' });
  }

  // Generate secure token
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await pool.request()
    .input('org_id',     sql.Int,          req.user.orgId)
    .input('email',      sql.VarChar(200), email.trim().toLowerCase())
    .input('role',       sql.VarChar(30),  role)
    .input('token',      sql.VarChar(100), token)
    .input('invited_by', sql.Int,          req.user.userId)
    .input('expires_at', sql.DateTime,     expiresAt)
    .query(`
      INSERT INTO invites (org_id, email, role, token, invited_by, expires_at, created_at)
      VALUES (@org_id, @email, @role, @token, @invited_by, @expires_at, GETDATE())
    `);

  // TODO: Send email with invite link
  // The invite link is: http://localhost:5173/accept-invite?token=<token>
  const inviteLink = `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/accept-invite?token=${token}`;

  logger.info(`Invite created for [${email}] role=${role} by [${req.user.email}]`);

  return res.status(201).json({
    success: true,
    data: {
      email,
      role,
      token,
      inviteLink,  // In production, email this — don't return it in the API
      expiresAt,
      message: 'Invite created. In development, use the inviteLink directly. In production this will be emailed.'
    }
  });
}));

// ────────────────────────────────────────────────────────────────
// PATCH /api/users/:id
// Body: { full_name, phone }
// ────────────────────────────────────────────────────────────────
router.patch('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id);
  const { full_name, phone } = req.body;

  await poolConnect;

  // Ensure user is in this org
  const check = await pool.request()
    .input('org_id',  sql.Int, req.user.orgId)
    .input('user_id', sql.Int, userId)
    .query('SELECT u.id FROM users u INNER JOIN org_members om ON om.user_id = u.id AND om.org_id = @org_id WHERE u.id = @user_id');

  if (!check.recordset.length) {
    return res.status(404).json({ success: false, error: 'User not found in this organisation.' });
  }

  await pool.request()
    .input('id',        sql.Int,          userId)
    .input('full_name', sql.NVarChar(200), full_name)
    .input('phone',     sql.VarChar(30),   phone || null)
    .query(`
      UPDATE users
      SET full_name  = COALESCE(@full_name, full_name),
          phone      = @phone,
          updated_at = GETDATE()
      WHERE id = @id
    `);

  return res.json({ success: true, message: 'User updated.' });
}));

// ────────────────────────────────────────────────────────────────
// PATCH /api/users/:id/role
// Body: { role }
// ────────────────────────────────────────────────────────────────
router.patch('/:id/role', requireRole('admin'), asyncHandler(async (req, res) => {
  const userId  = parseInt(req.params.id);
  const { role } = req.body;

  const validRoles = ['admin', 'editor', 'viewer'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ success: false, error: `role must be one of: ${validRoles.join(', ')}` });
  }

  // Prevent changing your own role
  if (userId === req.user.userId) {
    return res.status(400).json({ success: false, error: 'You cannot change your own role.' });
  }

  await poolConnect;

  await pool.request()
    .input('org_id',  sql.Int,         req.user.orgId)
    .input('user_id', sql.Int,         userId)
    .input('role',    sql.VarChar(30), role)
    .query(`
      UPDATE org_members
      SET role = @role
      WHERE org_id = @org_id AND user_id = @user_id
    `);

  logger.info(`Role changed: user ${userId} → ${role} by [${req.user.email}]`);
  return res.json({ success: true, message: `User role updated to ${role}.` });
}));

// ────────────────────────────────────────────────────────────────
// PATCH /api/users/:id/deactivate  (soft delete — no DELETE in ERP)
// ────────────────────────────────────────────────────────────────
router.patch('/:id/deactivate', requireRole('admin'), asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id);

  if (userId === req.user.userId) {
    return res.status(400).json({ success: false, error: 'You cannot deactivate your own account.' });
  }

  await poolConnect;

  await pool.request()
    .input('id', sql.Int, userId)
    .query(`UPDATE users SET is_active = 0, updated_at = GETDATE() WHERE id = @id`);

  // Also revoke all refresh tokens
  await pool.request()
    .input('user_id', sql.Int, userId)
    .query(`
      UPDATE refresh_tokens
      SET revoked_at = GETDATE(), revoked_reason = 'account_deactivated'
      WHERE user_id = @user_id AND revoked_at IS NULL
    `);

  logger.info(`User ${userId} deactivated by [${req.user.email}]`);
  return res.json({ success: true, message: 'User deactivated.' });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/users/invites
// ────────────────────────────────────────────────────────────────
router.get('/invites/list', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;

  const rows = await pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .query(`
      SELECT
        i.id, i.email, i.role, i.token,
        i.expires_at, i.used_at, i.revoked_at,
        i.created_at,
        u.full_name AS invited_by_name
      FROM invites i
      LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.org_id = @org_id AND i.used_at IS NULL AND i.revoked_at IS NULL
        AND i.expires_at > GETDATE()
      ORDER BY i.created_at DESC
    `);

  return res.json({ success: true, data: rows.recordset });
}));

// ────────────────────────────────────────────────────────────────
// DELETE /api/users/invites/:id  (revoke invite)
// ────────────────────────────────────────────────────────────────
router.delete('/invites/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;

  await pool.request()
    .input('id',          sql.Int,      parseInt(req.params.id))
    .input('org_id',      sql.Int,      req.user.orgId)
    .input('revoked_by',  sql.Int,      req.user.userId)
    .query(`
      UPDATE invites
      SET revoked_at = GETDATE(), revoked_by = @revoked_by
      WHERE id = @id AND org_id = @org_id AND used_at IS NULL
    `);

  return res.json({ success: true, message: 'Invite revoked.' });
}));

module.exports = router;
