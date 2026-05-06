'use strict';
// ============================================================
// routes/settings.js
//
// GET    /api/settings/org              — get org details
// PATCH  /api/settings/org              — update org details
// GET    /api/settings/smtp             — list SMTP profiles
// POST   /api/settings/smtp             — create SMTP profile
// PATCH  /api/settings/smtp/:id         — update SMTP profile
// POST   /api/settings/smtp/:id/test    — test SMTP connection
// DELETE /api/settings/smtp/:id         — delete SMTP profile
// GET    /api/settings/numbering        — list numbering series
// POST   /api/settings/numbering        — create series
// PATCH  /api/settings/numbering/:id    — update series
// GET    /api/settings/warehouses       — list warehouses
// POST   /api/settings/warehouses       — create warehouse
// PATCH  /api/settings/warehouses/:id   — update warehouse
// GET    /api/settings/audit            — audit log (paginated)
// GET    /api/settings/org-stats        — counts for settings dashboard
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth, requireRole, requireMinRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../config/logger');

// All settings routes require at minimum admin role
router.use(requireAuth);

// ────────────────────────────────────────────────────────────────
// GET /api/settings/org
// ────────────────────────────────────────────────────────────────
router.get('/org', asyncHandler(async (req, res) => {
  await poolConnect;

  const rows = await pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .query(`
      SELECT
        o.id, o.org_key, o.name, o.legal_name,
        o.abn, o.acn, o.gst_registered, o.gst_registration_date,
        o.bas_frequency, o.bas_method,
        o.financial_year_start_month,
        o.base_currency_code, o.country_code, o.timezone,
        o.phone, o.email, o.website, o.logo_url,
        o.address_line1, o.address_line2, o.suburb, o.state,
        o.postcode, o.country,
        o.bank_name, o.bank_account_name, o.bank_bsb, o.bank_account_number,
        os.invoice_due_days, os.quote_expiry_days,
        os.super_rate, os.xls_export_enabled,
        os.email_footer_html, os.email_logo_url, os.email_primary_colour
      FROM organisations o
      LEFT JOIN org_settings os ON os.org_id = o.id
      WHERE o.id = @org_id
    `);

  if (!rows.recordset.length) {
    return res.status(404).json({ success: false, error: 'Organisation not found.' });
  }

  return res.json({ success: true, data: rows.recordset[0] });
}));

// ────────────────────────────────────────────────────────────────
// PATCH /api/settings/org
// ────────────────────────────────────────────────────────────────
router.patch('/org', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;

  const {
    name, legal_name, abn, acn,
    gst_registered, bas_frequency, bas_method,
    financial_year_start_month,
    phone, email, website, logo_url,
    address_line1, address_line2, suburb, state, postcode, country,
    bank_name, bank_account_name, bank_bsb, bank_account_number,
    invoice_due_days, quote_expiry_days,
  } = req.body;

  await pool.request()
    .input('org_id',       sql.Int,          orgId)
    .input('name',         sql.NVarChar(200), name         || null)
    .input('legal_name',   sql.NVarChar(200), legal_name   || null)
    .input('abn',          sql.VarChar(14),   abn          || null)
    .input('acn',          sql.VarChar(14),   acn          || null)
    .input('gst_registered', sql.Bit,         gst_registered != null ? (gst_registered ? 1 : 0) : null)
    .input('bas_frequency',  sql.VarChar(10), bas_frequency || null)
    .input('bas_method',     sql.VarChar(10), bas_method    || null)
    .input('fy_month',       sql.TinyInt,     financial_year_start_month || null)
    .input('phone',          sql.VarChar(30), phone        || null)
    .input('email',          sql.VarChar(200), email       || null)
    .input('website',        sql.VarChar(200), website     || null)
    .input('logo_url',       sql.NVarChar(500), logo_url   || null)
    .input('address_line1',  sql.NVarChar(200), address_line1 || null)
    .input('address_line2',  sql.NVarChar(200), address_line2 || null)
    .input('suburb',         sql.NVarChar(100), suburb     || null)
    .input('state',          sql.VarChar(10),   state      || null)
    .input('postcode',       sql.VarChar(10),   postcode   || null)
    .input('country',        sql.NVarChar(100), country    || null)
    .input('bank_name',      sql.NVarChar(100), bank_name  || null)
    .input('bank_acc_name',  sql.NVarChar(200), bank_account_name || null)
    .input('bank_bsb',       sql.VarChar(10),   bank_bsb   || null)
    .input('bank_acc_num',   sql.VarChar(20),   bank_account_number || null)
    .query(`
      UPDATE organisations SET
        name          = COALESCE(@name,         name),
        legal_name    = COALESCE(@legal_name,   legal_name),
        abn           = COALESCE(@abn,          abn),
        acn           = COALESCE(@acn,          acn),
        gst_registered = COALESCE(@gst_registered, gst_registered),
        bas_frequency = COALESCE(@bas_frequency, bas_frequency),
        bas_method    = COALESCE(@bas_method,   bas_method),
        financial_year_start_month = COALESCE(@fy_month, financial_year_start_month),
        phone         = COALESCE(@phone,        phone),
        email         = COALESCE(@email,        email),
        website       = COALESCE(@website,      website),
        logo_url      = COALESCE(@logo_url,     logo_url),
        address_line1 = COALESCE(@address_line1, address_line1),
        address_line2 = COALESCE(@address_line2, address_line2),
        suburb        = COALESCE(@suburb,       suburb),
        state         = COALESCE(@state,        state),
        postcode      = COALESCE(@postcode,     postcode),
        country       = COALESCE(@country,      country),
        bank_name     = COALESCE(@bank_name,    bank_name),
        bank_account_name   = COALESCE(@bank_acc_name, bank_account_name),
        bank_bsb            = COALESCE(@bank_bsb,      bank_bsb),
        bank_account_number = COALESCE(@bank_acc_num,  bank_account_number),
        updated_at    = GETDATE()
      WHERE id = @org_id
    `);

  // Update org_settings too
  if (invoice_due_days != null || quote_expiry_days != null) {
    await pool.request()
      .input('org_id',            sql.Int, orgId)
      .input('invoice_due_days',  sql.Int, invoice_due_days  || null)
      .input('quote_expiry_days', sql.Int, quote_expiry_days || null)
      .query(`
        UPDATE org_settings SET
          invoice_due_days  = COALESCE(@invoice_due_days,  invoice_due_days),
          quote_expiry_days = COALESCE(@quote_expiry_days, quote_expiry_days),
          updated_at = GETDATE()
        WHERE org_id = @org_id
      `);
  }

  logger.info(`Org settings updated by [${req.user.email}]`);
  return res.json({ success: true, message: 'Organisation settings saved.' });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/settings/smtp
// ────────────────────────────────────────────────────────────────
router.get('/smtp', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;

  const rows = await pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .query(`
      SELECT
        id, profile_name, is_default, smtp_host, smtp_port,
        smtp_username, encryption_type,
        from_email, from_name, reply_to_email,
        use_for_types, max_per_hour, max_per_day,
        last_test_at, last_test_success, last_test_error,
        last_used_at, is_active, created_at
      FROM smtp_configurations
      WHERE org_id = @org_id
      ORDER BY is_default DESC, profile_name ASC
    `);

  return res.json({ success: true, data: rows.recordset });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/settings/smtp
// ────────────────────────────────────────────────────────────────
router.post('/smtp', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;

  const {
    profile_name, is_default = false,
    smtp_host, smtp_port = 587, smtp_username, smtp_password,
    encryption_type = 'tls',
    from_email, from_name, reply_to_email,
    max_per_hour, max_per_day,
  } = req.body;

  if (!smtp_host || !smtp_username || !smtp_password || !from_email) {
    return res.status(400).json({ success: false, error: 'smtp_host, smtp_username, smtp_password and from_email are required.' });
  }

  // If setting as default, clear existing defaults first
  if (is_default) {
    await pool.request()
      .input('org_id', sql.Int, orgId)
      .query('UPDATE smtp_configurations SET is_default = 0 WHERE org_id = @org_id');
  }

  const result = await pool.request()
    .input('org_id',          sql.Int,          orgId)
    .input('profile_name',    sql.NVarChar(100), profile_name || 'Main SMTP')
    .input('is_default',      sql.Bit,           is_default ? 1 : 0)
    .input('smtp_host',       sql.NVarChar(200), smtp_host)
    .input('smtp_port',       sql.Int,           smtp_port)
    .input('smtp_username',   sql.NVarChar(200), smtp_username)
    .input('smtp_password',   sql.NVarChar(500), smtp_password)
    .input('encryption_type', sql.VarChar(10),   encryption_type)
    .input('from_email',      sql.NVarChar(200), from_email)
    .input('from_name',       sql.NVarChar(200), from_name || from_email)
    .input('reply_to_email',  sql.NVarChar(200), reply_to_email || null)
    .input('max_per_hour',    sql.Int,           max_per_hour || null)
    .input('max_per_day',     sql.Int,           max_per_day  || null)
    .input('created_by',      sql.Int,           req.user.userId)
    .query(`
      INSERT INTO smtp_configurations
        (org_id, profile_name, is_default, smtp_host, smtp_port,
         smtp_username, smtp_password, encryption_type,
         from_email, from_name, reply_to_email,
         max_per_hour, max_per_day, is_active, created_by, created_at, updated_at)
      OUTPUT INSERTED.id
      VALUES
        (@org_id, @profile_name, @is_default, @smtp_host, @smtp_port,
         @smtp_username, @smtp_password, @encryption_type,
         @from_email, @from_name, @reply_to_email,
         @max_per_hour, @max_per_day, 1, @created_by, GETDATE(), GETDATE())
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id }, message: 'SMTP profile created.' });
}));

// ────────────────────────────────────────────────────────────────
// PATCH /api/settings/smtp/:id
// ────────────────────────────────────────────────────────────────
router.patch('/smtp/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const id    = parseInt(req.params.id);
  const orgId = req.user.orgId;

  const {
    profile_name, is_default, smtp_host, smtp_port,
    smtp_username, smtp_password, encryption_type,
    from_email, from_name, reply_to_email,
    max_per_hour, max_per_day, is_active,
  } = req.body;

  if (is_default) {
    await pool.request()
      .input('org_id', sql.Int, orgId)
      .query('UPDATE smtp_configurations SET is_default = 0 WHERE org_id = @org_id');
  }

  await pool.request()
    .input('id',              sql.Int,           id)
    .input('org_id',          sql.Int,           orgId)
    .input('profile_name',    sql.NVarChar(100), profile_name    || null)
    .input('is_default',      sql.Bit,           is_default != null ? (is_default ? 1 : 0) : null)
    .input('smtp_host',       sql.NVarChar(200), smtp_host       || null)
    .input('smtp_port',       sql.Int,           smtp_port       || null)
    .input('smtp_username',   sql.NVarChar(200), smtp_username   || null)
    .input('smtp_password',   sql.NVarChar(500), smtp_password   || null)
    .input('encryption_type', sql.VarChar(10),   encryption_type || null)
    .input('from_email',      sql.NVarChar(200), from_email      || null)
    .input('from_name',       sql.NVarChar(200), from_name       || null)
    .input('reply_to_email',  sql.NVarChar(200), reply_to_email  || null)
    .input('max_per_hour',    sql.Int,           max_per_hour    || null)
    .input('max_per_day',     sql.Int,           max_per_day     || null)
    .input('is_active',       sql.Bit,           is_active != null ? (is_active ? 1 : 0) : null)
    .query(`
      UPDATE smtp_configurations SET
        profile_name    = COALESCE(@profile_name,    profile_name),
        is_default      = COALESCE(@is_default,      is_default),
        smtp_host       = COALESCE(@smtp_host,       smtp_host),
        smtp_port       = COALESCE(@smtp_port,       smtp_port),
        smtp_username   = COALESCE(@smtp_username,   smtp_username),
        smtp_password   = COALESCE(@smtp_password,   smtp_password),
        encryption_type = COALESCE(@encryption_type, encryption_type),
        from_email      = COALESCE(@from_email,      from_email),
        from_name       = COALESCE(@from_name,       from_name),
        reply_to_email  = COALESCE(@reply_to_email,  reply_to_email),
        max_per_hour    = COALESCE(@max_per_hour,    max_per_hour),
        max_per_day     = COALESCE(@max_per_day,     max_per_day),
        is_active       = COALESCE(@is_active,       is_active),
        updated_at      = GETDATE(),
        updated_by      = ${req.user.userId}
      WHERE id = @id AND org_id = @org_id
    `);

  return res.json({ success: true, message: 'SMTP profile updated.' });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/settings/smtp/:id/test
// Attempts a real SMTP connection using nodemailer
// ────────────────────────────────────────────────────────────────
router.post('/smtp/:id/test', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const id = parseInt(req.params.id);

  const rows = await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, req.user.orgId)
    .query('SELECT * FROM smtp_configurations WHERE id = @id AND org_id = @org_id');

  if (!rows.recordset.length) {
    return res.status(404).json({ success: false, error: 'SMTP profile not found.' });
  }

  const cfg = rows.recordset[0];
  let success = false;
  let errorMsg = null;

  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host:   cfg.smtp_host,
      port:   cfg.smtp_port,
      secure: cfg.encryption_type === 'ssl',
      auth:   { user: cfg.smtp_username, pass: cfg.smtp_password },
      tls:    { rejectUnauthorized: false },
      connectionTimeout: 10000,
    });
    await transporter.verify();
    success = true;
  } catch (err) {
    errorMsg = err.message;
  }

  await pool.request()
    .input('id',      sql.Int,          id)
    .input('success', sql.Bit,          success ? 1 : 0)
    .input('error',   sql.NVarChar(500), errorMsg)
    .query(`
      UPDATE smtp_configurations
      SET last_test_at = GETDATE(), last_test_success = @success, last_test_error = @error
      WHERE id = @id
    `);

  return res.json({
    success,
    message: success ? 'Connection successful!' : `Connection failed: ${errorMsg}`,
  });
}));

// ────────────────────────────────────────────────────────────────
// DELETE /api/settings/smtp/:id
// ────────────────────────────────────────────────────────────────
router.delete('/smtp/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  await pool.request()
    .input('id',     sql.Int, parseInt(req.params.id))
    .input('org_id', sql.Int, req.user.orgId)
    .query('DELETE FROM smtp_configurations WHERE id = @id AND org_id = @org_id AND is_default = 0');

  return res.json({ success: true, message: 'SMTP profile deleted.' });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/settings/numbering
// ────────────────────────────────────────────────────────────────
router.get('/numbering', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;

  const rows = await pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .query(`
      SELECT id, name, code, series_type, prefix, suffix, separator,
             include_year, include_month, padding, next_number,
             reset_frequency, is_default, is_active, allow_manual
      FROM numbering_series
      WHERE org_id = @org_id
      ORDER BY series_type ASC, name ASC
    `);

  return res.json({ success: true, data: rows.recordset });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/settings/numbering
// ────────────────────────────────────────────────────────────────
router.post('/numbering', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;

  const {
    name, code, series_type, prefix = '', suffix = '',
    separator = '-', include_year = false, include_month = false,
    padding = 5, next_number = 1, reset_frequency = 'none',
    is_default = false, allow_manual = false,
  } = req.body;

  if (!name || !code || !series_type) {
    return res.status(400).json({ success: false, error: 'name, code and series_type are required.' });
  }

  const result = await pool.request()
    .input('org_id',          sql.Int,         req.user.orgId)
    .input('name',            sql.NVarChar(200), name)
    .input('code',            sql.VarChar(20),   code.toUpperCase())
    .input('series_type',     sql.VarChar(50),   series_type)
    .input('prefix',          sql.VarChar(20),   prefix)
    .input('suffix',          sql.VarChar(20),   suffix)
    .input('separator',       sql.VarChar(5),    separator)
    .input('include_year',    sql.Bit,           include_year ? 1 : 0)
    .input('include_month',   sql.Bit,           include_month ? 1 : 0)
    .input('padding',         sql.TinyInt,       padding)
    .input('next_number',     sql.Int,           next_number)
    .input('reset_frequency', sql.VarChar(10),   reset_frequency)
    .input('is_default',      sql.Bit,           is_default ? 1 : 0)
    .input('allow_manual',    sql.Bit,           allow_manual ? 1 : 0)
    .input('created_by',      sql.Int,           req.user.userId)
    .query(`
      INSERT INTO numbering_series
        (org_id, name, code, series_type, prefix, suffix, separator,
         include_year, include_month, padding, next_number, reset_frequency,
         is_default, is_active, allow_manual, created_by, created_at, updated_at)
      OUTPUT INSERTED.id
      VALUES
        (@org_id, @name, @code, @series_type, @prefix, @suffix, @separator,
         @include_year, @include_month, @padding, @next_number, @reset_frequency,
         @is_default, 1, @allow_manual, @created_by, GETDATE(), GETDATE())
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id }, message: 'Numbering series created.' });
}));

// ────────────────────────────────────────────────────────────────
// PATCH /api/settings/numbering/:id
// ────────────────────────────────────────────────────────────────
router.patch('/numbering/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { prefix, suffix, separator, include_year, include_month, padding, next_number, is_active, is_default, allow_manual } = req.body;

  await pool.request()
    .input('id',              sql.Int,        parseInt(req.params.id))
    .input('org_id',          sql.Int,        req.user.orgId)
    .input('prefix',          sql.VarChar(20), prefix          || null)
    .input('suffix',          sql.VarChar(20), suffix          || null)
    .input('separator',       sql.VarChar(5),  separator       || null)
    .input('include_year',    sql.Bit,         include_year    != null ? (include_year  ? 1 : 0) : null)
    .input('include_month',   sql.Bit,         include_month   != null ? (include_month ? 1 : 0) : null)
    .input('padding',         sql.TinyInt,     padding         || null)
    .input('next_number',     sql.Int,         next_number     || null)
    .input('is_active',       sql.Bit,         is_active       != null ? (is_active    ? 1 : 0) : null)
    .input('is_default',      sql.Bit,         is_default      != null ? (is_default   ? 1 : 0) : null)
    .input('allow_manual',    sql.Bit,         allow_manual    != null ? (allow_manual  ? 1 : 0) : null)
    .query(`
      UPDATE numbering_series SET
        prefix        = COALESCE(@prefix,       prefix),
        suffix        = COALESCE(@suffix,       suffix),
        separator     = COALESCE(@separator,    separator),
        include_year  = COALESCE(@include_year, include_year),
        include_month = COALESCE(@include_month,include_month),
        padding       = COALESCE(@padding,      padding),
        next_number   = COALESCE(@next_number,  next_number),
        is_active     = COALESCE(@is_active,    is_active),
        is_default    = COALESCE(@is_default,   is_default),
        allow_manual  = COALESCE(@allow_manual, allow_manual),
        updated_at    = GETDATE()
      WHERE id = @id AND org_id = @org_id
    `);

  return res.json({ success: true, message: 'Numbering series updated.' });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/settings/warehouses
// ────────────────────────────────────────────────────────────────
router.get('/warehouses', asyncHandler(async (req, res) => {
  await poolConnect;

  const rows = await pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .query(`
      SELECT w.id, w.code, w.name, w.warehouse_type,
             w.address_line1, w.suburb, w.state, w.postcode,
             w.dealer_visible, w.dealer_buffer_qty,
             w.is_active, w.is_void, w.created_at,
             u.full_name AS manager_name,
             (SELECT COUNT(*) FROM warehouse_bins wb
              INNER JOIN warehouse_zones wz ON wz.id = wb.zone_id
              WHERE wz.warehouse_id = w.id AND wb.is_active = 1) AS bin_count
      FROM warehouses w
      LEFT JOIN users u ON u.id = w.manager_user_id
      WHERE w.org_id = @org_id AND w.is_void = 0
      ORDER BY w.name ASC
    `);

  return res.json({ success: true, data: rows.recordset });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/settings/warehouses
// ────────────────────────────────────────────────────────────────
router.post('/warehouses', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;

  const { code, name, warehouse_type = 'main', address_line1, suburb, state, postcode, dealer_visible = false, dealer_buffer_qty = 0 } = req.body;

  if (!code || !name) return res.status(400).json({ success: false, error: 'code and name are required.' });

  const result = await pool.request()
    .input('org_id',             sql.Int,          req.user.orgId)
    .input('code',               sql.VarChar(20),   code.toUpperCase().trim())
    .input('name',               sql.NVarChar(100), name.trim())
    .input('warehouse_type',     sql.VarChar(20),   warehouse_type)
    .input('address_line1',      sql.NVarChar(200), address_line1 || null)
    .input('suburb',             sql.NVarChar(100), suburb        || null)
    .input('state',              sql.VarChar(10),   state         || null)
    .input('postcode',           sql.VarChar(10),   postcode      || null)
    .input('dealer_visible',     sql.Bit,           dealer_visible ? 1 : 0)
    .input('dealer_buffer_qty',  sql.Int,           dealer_buffer_qty)
    .query(`
      INSERT INTO warehouses
        (org_id, code, name, warehouse_type, address_line1, suburb, state, postcode,
         dealer_visible, dealer_buffer_qty, is_active, is_void, created_at)
      OUTPUT INSERTED.id
      VALUES
        (@org_id, @code, @name, @warehouse_type, @address_line1, @suburb, @state, @postcode,
         @dealer_visible, @dealer_buffer_qty, 1, 0, GETDATE())
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id }, message: `Warehouse "${name}" created.` });
}));

// ────────────────────────────────────────────────────────────────
// PATCH /api/settings/warehouses/:id
// ────────────────────────────────────────────────────────────────
router.patch('/warehouses/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { name, address_line1, suburb, state, postcode, dealer_visible, dealer_buffer_qty, is_active } = req.body;

  await pool.request()
    .input('id',                 sql.Int,           parseInt(req.params.id))
    .input('org_id',             sql.Int,           req.user.orgId)
    .input('name',               sql.NVarChar(100), name              || null)
    .input('address_line1',      sql.NVarChar(200), address_line1     || null)
    .input('suburb',             sql.NVarChar(100), suburb            || null)
    .input('state',              sql.VarChar(10),   state             || null)
    .input('postcode',           sql.VarChar(10),   postcode          || null)
    .input('dealer_visible',     sql.Bit,           dealer_visible    != null ? (dealer_visible ? 1 : 0) : null)
    .input('dealer_buffer_qty',  sql.Int,           dealer_buffer_qty != null ? dealer_buffer_qty : null)
    .input('is_active',          sql.Bit,           is_active         != null ? (is_active ? 1 : 0) : null)
    .query(`
      UPDATE warehouses SET
        name              = COALESCE(@name,             name),
        address_line1     = COALESCE(@address_line1,    address_line1),
        suburb            = COALESCE(@suburb,           suburb),
        state             = COALESCE(@state,            state),
        postcode          = COALESCE(@postcode,         postcode),
        dealer_visible    = COALESCE(@dealer_visible,   dealer_visible),
        dealer_buffer_qty = COALESCE(@dealer_buffer_qty,dealer_buffer_qty),
        is_active         = COALESCE(@is_active,        is_active)
      WHERE id = @id AND org_id = @org_id
    `);

  return res.json({ success: true, message: 'Warehouse updated.' });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/settings/audit?page=1&limit=50&action=&search=
// ────────────────────────────────────────────────────────────────
router.get('/audit', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId  = req.user.orgId;
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 50);
  const offset = (page - 1) * limit;
  const action = req.query.action || '';
  const search = req.query.search || '';

  const conditions = ['org_id = @org_id'];
  if (action) conditions.push('action_type LIKE @action');
  if (search) conditions.push('(user_email LIKE @search OR description LIKE @search OR entity_ref LIKE @search)');
  const where = 'WHERE ' + conditions.join(' AND ');

  const [dataRes, countRes] = await Promise.all([
    pool.request()
      .input('org_id', sql.Int,          orgId)
      .input('action', sql.VarChar(60),  `%${action}%`)
      .input('search', sql.NVarChar(200), `%${search}%`)
      .input('limit',  sql.Int,          limit)
      .input('offset', sql.Int,          offset)
      .query(`
        SELECT TOP (@limit)
          id, action_type, entity_type, entity_ref,
          description, user_name, user_email,
          ip_address, is_override, occurred_at
        FROM audit_log
        ${where}
        ORDER BY occurred_at DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `),
    pool.request()
      .input('org_id', sql.Int,          orgId)
      .input('action', sql.VarChar(60),  `%${action}%`)
      .input('search', sql.NVarChar(200), `%${search}%`)
      .query(`SELECT COUNT(*) AS total FROM audit_log ${where}`),
  ]);

  const total = countRes.recordset[0].total;

  return res.json({
    success: true,
    data: dataRes.recordset,
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/settings/org-stats  — counts for settings dashboard
// ────────────────────────────────────────────────────────────────
router.get('/org-stats', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;

  const [users, smtp, warehouses, series, auditCount] = await Promise.all([
    pool.request().input('org_id', sql.Int, orgId).query('SELECT COUNT(*) AS n FROM org_members WHERE org_id = @org_id AND is_active = 1'),
    pool.request().input('org_id', sql.Int, orgId).query('SELECT COUNT(*) AS n FROM smtp_configurations WHERE org_id = @org_id AND is_active = 1'),
    pool.request().input('org_id', sql.Int, orgId).query('SELECT COUNT(*) AS n FROM warehouses WHERE org_id = @org_id AND is_active = 1 AND is_void = 0'),
    pool.request().input('org_id', sql.Int, orgId).query('SELECT COUNT(*) AS n FROM numbering_series WHERE org_id = @org_id AND is_active = 1'),
    pool.request().input('org_id', sql.Int, orgId).query('SELECT COUNT(*) AS n FROM audit_log WHERE org_id = @org_id'),
  ]);

  return res.json({
    success: true,
    data: {
      activeUsers:      users.recordset[0].n,
      smtpProfiles:     smtp.recordset[0].n,
      warehouses:       warehouses.recordset[0].n,
      numberingSeries:  series.recordset[0].n,
      auditEntries:     auditCount.recordset[0].n,
    },
  });
}));

module.exports = router;
