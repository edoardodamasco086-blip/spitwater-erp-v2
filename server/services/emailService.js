'use strict';
// ============================================================
// services/emailService.js
// Sends transactional emails using the org's active SMTP profile.
// Falls back gracefully if no profile is configured.
// ============================================================

const nodemailer = require('nodemailer');
const logger     = require('../config/logger');
const { sql, pool, poolConnect } = require('../config/db');

// ── Fetch the default (or any active) SMTP profile for an org ─
async function getSmtpProfile(orgId) {
  await poolConnect;
  const rows = await pool.request()
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT TOP 1
        smtp_host, smtp_port, smtp_username, smtp_password,
        encryption_type, from_email, from_name
      FROM smtp_configurations
      WHERE org_id = @org_id AND is_active = 1
      ORDER BY is_default DESC, id ASC
    `);
  return rows.recordset[0] || null;
}

// ── Build a nodemailer transporter from a DB profile ──────────
function buildTransporter(cfg) {
  return nodemailer.createTransport({
    host:   cfg.smtp_host,
    port:   cfg.smtp_port || 587,
    secure: cfg.encryption_type === 'ssl',
    auth:   cfg.smtp_username ? { user: cfg.smtp_username, pass: cfg.smtp_password } : undefined,
    tls:    { rejectUnauthorized: false },
    connectionTimeout: 10000,
  });
}

// ── Send a single email ────────────────────────────────────────
// opts: { orgId, to, subject, html, text? }
// Returns true on success, false if SMTP not configured or send fails.
async function sendEmail({ orgId, to, subject, html, text }) {
  const cfg = await getSmtpProfile(orgId);

  if (!cfg) {
    logger.warn(`[Email] No active SMTP profile for org ${orgId} — skipping send to ${to}`);
    return false;
  }

  try {
    const transporter = buildTransporter(cfg);
    await transporter.sendMail({
      from:    `"${cfg.from_name || 'Spitwater ERP'}" <${cfg.from_email}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ''),
    });
    logger.info(`[Email] Sent "${subject}" to ${to}`);
    return true;
  } catch (err) {
    logger.error(`[Email] Failed to send "${subject}" to ${to}: ${err.message}`);
    return false;
  }
}

// ── Invite email template ─────────────────────────────────────
async function sendInviteEmail({ orgId, orgName, toEmail, role, inviteLink, invitedByName }) {
  const subject = `You've been invited to ${orgName} on Spitwater ERP`;
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
      <h2 style="color:#1a1a2e;margin-bottom:8px;">You've been invited</h2>
      <p style="color:#555;margin-bottom:24px;">
        <strong>${invitedByName || 'An admin'}</strong> has invited you to join
        <strong>${orgName}</strong> on Spitwater ERP as <strong>${role}</strong>.
      </p>
      <a href="${inviteLink}"
         style="display:inline-block;background:#2F7FE8;color:#fff;padding:12px 28px;
                border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;">
        Accept Invitation
      </a>
      <p style="color:#888;font-size:13px;margin-top:24px;">
        This link expires in 7 days. If you didn't expect this invitation, you can safely ignore it.
      </p>
    </div>
  `;

  return sendEmail({ orgId, to: toEmail, subject, html });
}

module.exports = { sendEmail, sendInviteEmail };
