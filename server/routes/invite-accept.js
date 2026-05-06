'use strict';
// ============================================================
// routes/invite-accept.js
//
// GET  /api/invite/verify?token=xxx  — verify token is valid
// POST /api/invite/accept            — set password + activate
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect } = require('../config/db');
const { hashPassword }           = require('../utils/password');
const { signAccessToken, signRefreshToken } = require('../utils/jwt');
const { asyncHandler }           = require('../middleware/errorHandler');
const crypto                     = require('crypto');

// ────────────────────────────────────────────────────────────────
// GET /api/invite/verify?token=xxx
// ────────────────────────────────────────────────────────────────
router.get('/verify', asyncHandler(async (req, res) => {
  await poolConnect;
  const { token } = req.query;

  if (!token) return res.status(400).json({ success: false, error: 'Token required.' });

  const rows = await pool.request()
    .input('token', sql.VarChar(100), token)
    .query(`
      SELECT i.id, i.email, i.role, i.org_id, i.expires_at, i.used_at, i.revoked_at,
             o.name AS org_name
      FROM invites i
      INNER JOIN organisations o ON o.id = i.org_id
      WHERE i.token = @token
    `);

  if (!rows.recordset.length) {
    return res.status(404).json({ success: false, error: 'Invite not found. It may have been revoked.', code: 'INVALID' });
  }

  const invite = rows.recordset[0];

  if (invite.used_at) {
    return res.status(410).json({ success: false, error: 'This invite has already been used.', code: 'USED' });
  }
  if (invite.revoked_at) {
    return res.status(410).json({ success: false, error: 'This invite has been revoked.', code: 'REVOKED' });
  }
  if (new Date(invite.expires_at) < new Date()) {
    return res.status(410).json({ success: false, error: 'This invite has expired. Ask your admin to send a new one.', code: 'EXPIRED' });
  }

  return res.json({
    success: true,
    data: {
      email:    invite.email,
      role:     invite.role,
      orgName:  invite.org_name,
      expiresAt: invite.expires_at,
    },
  });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/invite/accept
// Body: { token, full_name, password }
// ────────────────────────────────────────────────────────────────
router.post('/accept', asyncHandler(async (req, res) => {
  await poolConnect;
  const { token, full_name, password } = req.body;

  if (!token || !full_name || !password) {
    return res.status(400).json({ success: false, error: 'token, full_name and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
  }

  // Re-verify invite
  const inviteRows = await pool.request()
    .input('token', sql.VarChar(100), token)
    .query(`
      SELECT i.*, o.name AS org_name
      FROM invites i
      INNER JOIN organisations o ON o.id = i.org_id
      WHERE i.token = @token AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > GETDATE()
    `);

  if (!inviteRows.recordset.length) {
    return res.status(410).json({ success: false, error: 'Invite is invalid, expired or already used.' });
  }

  const invite     = inviteRows.recordset[0];
  const hash       = await hashPassword(password);

  // Check if user already exists with this email
  const existingUser = await pool.request()
    .input('email', sql.VarChar(200), invite.email)
    .query('SELECT id FROM users WHERE email = @email');

  let userId;

  if (existingUser.recordset.length) {
    // User exists — just update and link to org
    userId = existingUser.recordset[0].id;
    await pool.request()
      .input('id',        sql.Int,           userId)
      .input('full_name', sql.NVarChar(200), full_name.trim())
      .input('hash',      sql.NVarChar(500), hash)
      .query(`
        UPDATE users
        SET full_name = @full_name, password_hash = @hash,
            is_active = 1, email_verified = 1, updated_at = GETDATE()
        WHERE id = @id
      `);
  } else {
    // Create new user
    const userResult = await pool.request()
      .input('email',     sql.VarChar(200),  invite.email)
      .input('full_name', sql.NVarChar(200), full_name.trim())
      .input('hash',      sql.NVarChar(500), hash)
      .query(`
        INSERT INTO users (email, password_hash, full_name, is_active, email_verified, created_at, updated_at)
        OUTPUT INSERTED.id
        VALUES (@email, @hash, @full_name, 1, 1, GETDATE(), GETDATE())
      `);
    userId = userResult.recordset[0].id;
  }

  // Link to org (upsert)
  const memberCheck = await pool.request()
    .input('org_id',  sql.Int, invite.org_id)
    .input('user_id', sql.Int, userId)
    .query('SELECT id FROM org_members WHERE org_id = @org_id AND user_id = @user_id');

  if (memberCheck.recordset.length) {
    await pool.request()
      .input('org_id',  sql.Int,         invite.org_id)
      .input('user_id', sql.Int,         userId)
      .input('role',    sql.VarChar(30), invite.role)
      .query('UPDATE org_members SET role = @role, is_active = 1 WHERE org_id = @org_id AND user_id = @user_id');
  } else {
    await pool.request()
      .input('org_id',  sql.Int,         invite.org_id)
      .input('user_id', sql.Int,         userId)
      .input('role',    sql.VarChar(30), invite.role)
      .input('inv_by',  sql.Int,         invite.invited_by)
      .query(`
        INSERT INTO org_members (org_id, user_id, role, is_active, invited_by, joined_at)
        VALUES (@org_id, @user_id, @role, 1, @inv_by, GETDATE())
      `);
  }

  // Mark invite as used
  await pool.request()
    .input('token',   sql.VarChar(100), token)
    .input('user_id', sql.Int,         userId)
    .query(`
      UPDATE invites SET used_at = GETDATE(), used_by_user_id = @user_id
      WHERE token = @token
    `);

  // Issue tokens so user is logged in immediately
  const tokenPayload = {
    userId, orgId: invite.org_id,
    email: invite.email, role: invite.role, name: full_name.trim(),
  };
  const accessToken  = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken({ userId, orgId: invite.org_id });

  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await pool.request()
    .input('user_id',    sql.Int,          userId)
    .input('org_id',     sql.Int,          invite.org_id)
    .input('token_hash', sql.VarChar(100), tokenHash)
    .input('expires_at', sql.DateTime,     new Date(Date.now() + 7*24*60*60*1000))
    .query(`
      INSERT INTO refresh_tokens (user_id, org_id, token_hash, expires_at, created_at)
      VALUES (@user_id, @org_id, @token_hash, @expires_at, GETDATE())
    `);

  return res.json({
    success: true,
    message: 'Account created successfully.',
    data: {
      accessToken,
      refreshToken,
      user: { id: userId, email: invite.email, name: full_name.trim(), role: invite.role, orgId: invite.org_id, orgName: invite.org_name },
    },
  });
}));

module.exports = router;
