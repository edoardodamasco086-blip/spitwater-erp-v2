'use strict';
// ============================================================
// routes/numbering.js
//
// GET    /api/numbering                   — list all series for org
// POST   /api/numbering                   — create series
// PATCH  /api/numbering/:id               — update series
// DELETE /api/numbering/:id               — deactivate series
// GET    /api/numbering/preview/:id       — preview next number (no increment)
// POST   /api/numbering/next/:type        — get + consume next number (internal use)
// POST   /api/numbering/seed-defaults     — seed standard AU series
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect }     = require('../config/db');
const { requireAuth, requireRole }   = require('../middleware/auth');
const { asyncHandler }               = require('../middleware/errorHandler');
const { getNextNumber, previewNumber, formatNumber, getCurrentFinancialYear, ensureColumns } = require('../utils/numbering');
const logger                         = require('../config/logger');

router.use(requireAuth);

// Ensure DB columns exist on first use
let columnsEnsured = false;
async function ensureOnce() {
  if (!columnsEnsured) { await ensureColumns(pool); columnsEnsured = true; }
}

// ── Default series to seed ────────────────────────────────────
const DEFAULT_SERIES = [
  { name: 'Sales Invoice',      code: 'SLS', series_type: 'invoice',        prefix: 'SLS', separator: '-', include_year: true,  include_month: false, padding: 5, reset_frequency: 'yearly' },
  { name: 'Quote',              code: 'QT',  series_type: 'quote',          prefix: 'QT',  separator: '-', include_year: true,  include_month: false, padding: 5, reset_frequency: 'yearly' },
  { name: 'Credit Note',        code: 'CN',  series_type: 'credit_note',    prefix: 'CN',  separator: '-', include_year: true,  include_month: false, padding: 5, reset_frequency: 'yearly' },
  { name: 'Purchase Order',     code: 'PO',  series_type: 'purchase_order', prefix: 'PO',  separator: '-', include_year: true,  include_month: false, padding: 5, reset_frequency: 'yearly' },
  { name: 'Goods Receipt',      code: 'GR',  series_type: 'goods_receipt',  prefix: 'GR',  separator: '-', include_year: true,  include_month: false, padding: 5, reset_frequency: 'yearly' },
  { name: 'Service Job',        code: 'SRV', series_type: 'service_job',    prefix: 'SRV', separator: '-', include_year: true,  include_month: false, padding: 4, reset_frequency: 'yearly' },
  { name: 'Delivery Docket',    code: 'DEL', series_type: 'delivery',       prefix: 'DEL', separator: '-', include_year: false, include_month: false, padding: 5, reset_frequency: 'none'   },
  { name: 'Journal Entry',      code: 'JNL', series_type: 'journal',        prefix: 'JNL', separator: '-', include_year: true,  include_month: false, padding: 5, reset_frequency: 'yearly' },
  { name: 'Product Code',       code: 'SW',  series_type: 'product',        prefix: 'SW',  separator: '-', include_year: false, include_month: false, padding: 5, reset_frequency: 'none'   },
  { name: 'Warranty',           code: 'WRN', series_type: 'warranty',       prefix: 'WRN', separator: '-', include_year: true,  include_month: false, padding: 5, reset_frequency: 'yearly' },
  { name: 'Stocktake',          code: 'ST',  series_type: 'stocktake',      prefix: 'ST',  separator: '-', include_year: true,  include_month: false, padding: 4, reset_frequency: 'yearly' },
];

// ────────────────────────────────────────────────────────────────
// GET /api/numbering
// ────────────────────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  await poolConnect;
  await ensureOnce();

  const rows = await pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .query(`
      SELECT
        id, name, code, series_type, prefix, suffix, separator,
        include_year, include_month, padding, next_number,
        reset_frequency, last_reset_at, fy_start_month,
        is_default, is_active, allow_manual, created_at,
        -- Preview of next number
        next_number AS sequence_preview
      FROM numbering_series
      WHERE org_id = @org_id
      ORDER BY series_type ASC, name ASC
    `);

  // Add formatted preview to each row
  const data = rows.recordset.map(s => ({
    ...s,
    preview: previewNumber(s),
    financial_year: getCurrentFinancialYear(s.fy_start_month || 7),
  }));

  return res.json({ success: true, data });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/numbering/types  — all valid series_type values
// ────────────────────────────────────────────────────────────────
router.get('/types', asyncHandler(async (_req, res) => {
  const types = DEFAULT_SERIES.map(s => ({ type: s.series_type, label: s.name, suggested_prefix: s.prefix }));
  return res.json({ success: true, data: types });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/numbering/preview/:id   — preview without consuming
// ────────────────────────────────────────────────────────────────
router.get('/preview/:id', asyncHandler(async (req, res) => {
  await poolConnect;
  await ensureOnce();

  const rows = await pool.request()
    .input('id',     sql.Int, parseInt(req.params.id))
    .input('org_id', sql.Int, req.user.orgId)
    .query(`
      SELECT prefix, suffix, separator, padding,
             include_year, include_month, fy_start_month, next_number
      FROM numbering_series
      WHERE id = @id AND org_id = @org_id AND is_active = 1
    `);

  if (!rows.recordset.length) return res.status(404).json({ success: false, error: 'Series not found.' });

  const series  = rows.recordset[0];
  const preview = previewNumber(series);

  return res.json({ success: true, data: { preview, financial_year: getCurrentFinancialYear(series.fy_start_month || 7) } });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/numbering/next/:type
// Consumes the next number — called internally by other routes
// Body: { orgId } (uses req.user.orgId)
// Returns: { number: "SLS-2026-00001", seriesId, sequence }
// ────────────────────────────────────────────────────────────────
router.post('/next/:type', asyncHandler(async (req, res) => {
  await poolConnect;
  await ensureOnce();

  try {
    const result = await getNextNumber(req.params.type, req.user.orgId, pool, sql);
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
}));

// ────────────────────────────────────────────────────────────────
// POST /api/numbering/seed-defaults
// Seeds all standard Australian series in one click
// ────────────────────────────────────────────────────────────────
router.post('/seed-defaults', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  await ensureOnce();

  const orgId = req.user.orgId;
  const fyStartMonth = req.body.fy_start_month || 7; // July default
  const created = [];
  const skipped = [];

  for (const def of DEFAULT_SERIES) {
    // Check if a series of this type already exists
    const existing = await pool.request()
      .input('org_id',      sql.Int,         orgId)
      .input('series_type', sql.VarChar(50), def.series_type)
      .query('SELECT id FROM numbering_series WHERE org_id=@org_id AND series_type=@series_type AND is_active=1');

    if (existing.recordset.length) {
      skipped.push(def.name);
      continue;
    }

    await pool.request()
      .input('org_id',          sql.Int,          orgId)
      .input('name',            sql.NVarChar(200), def.name)
      .input('code',            sql.VarChar(20),   def.code)
      .input('series_type',     sql.VarChar(50),   def.series_type)
      .input('prefix',          sql.VarChar(20),   def.prefix)
      .input('suffix',          sql.VarChar(20),   '')
      .input('separator',       sql.VarChar(5),    def.separator)
      .input('include_year',    sql.Bit,           def.include_year  ? 1 : 0)
      .input('include_month',   sql.Bit,           def.include_month ? 1 : 0)
      .input('padding',         sql.TinyInt,       def.padding)
      .input('next_number',     sql.Int,           1)
      .input('reset_frequency', sql.VarChar(10),   def.reset_frequency)
      .input('fy_start_month',  sql.TinyInt,       fyStartMonth)
      .input('is_default',      sql.Bit,           1)
      .input('is_active',       sql.Bit,           1)
      .input('allow_manual',    sql.Bit,           def.series_type === 'product' ? 1 : 0)
      .input('created_by',      sql.Int,           req.user.userId)
      .query(`
        INSERT INTO numbering_series
          (org_id, name, code, series_type, prefix, suffix, separator,
           include_year, include_month, padding, next_number, reset_frequency,
           fy_start_month, is_default, is_active, allow_manual,
           created_by, created_at, updated_at)
        VALUES
          (@org_id, @name, @code, @series_type, @prefix, @suffix, @separator,
           @include_year, @include_month, @padding, @next_number, @reset_frequency,
           @fy_start_month, @is_default, @is_active, @allow_manual,
           @created_by, GETDATE(), GETDATE())
      `);
    created.push(def.name);
  }

  logger.info(`Seeded ${created.length} numbering series for org ${orgId}`);
  return res.json({
    success: true,
    data: { created, skipped },
    message: `Created ${created.length} series. ${skipped.length} already existed.`,
  });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/numbering
// ────────────────────────────────────────────────────────────────
router.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  await ensureOnce();

  const {
    name, code, series_type, prefix = '', suffix = '',
    separator = '-', include_year = false, include_month = false,
    padding = 5, next_number = 1, reset_frequency = 'none',
    fy_start_month = 7, is_default = false, allow_manual = false,
  } = req.body;

  if (!name || !code || !series_type) {
    return res.status(400).json({ success: false, error: 'name, code and series_type are required.' });
  }

  // If this will be default, remove default from existing same-type series
  if (is_default) {
    await pool.request()
      .input('org_id',      sql.Int,         req.user.orgId)
      .input('series_type', sql.VarChar(50), series_type)
      .query('UPDATE numbering_series SET is_default=0 WHERE org_id=@org_id AND series_type=@series_type');
  }

  const result = await pool.request()
    .input('org_id',          sql.Int,          req.user.orgId)
    .input('name',            sql.NVarChar(200), name)
    .input('code',            sql.VarChar(20),   code.toUpperCase())
    .input('series_type',     sql.VarChar(50),   series_type)
    .input('prefix',          sql.VarChar(20),   prefix)
    .input('suffix',          sql.VarChar(20),   suffix)
    .input('separator',       sql.VarChar(5),    separator)
    .input('include_year',    sql.Bit,           include_year  ? 1 : 0)
    .input('include_month',   sql.Bit,           include_month ? 1 : 0)
    .input('padding',         sql.TinyInt,       padding)
    .input('next_number',     sql.Int,           next_number)
    .input('reset_frequency', sql.VarChar(10),   reset_frequency)
    .input('fy_start_month',  sql.TinyInt,       fy_start_month)
    .input('is_default',      sql.Bit,           is_default  ? 1 : 0)
    .input('allow_manual',    sql.Bit,           allow_manual ? 1 : 0)
    .input('created_by',      sql.Int,           req.user.userId)
    .query(`
      INSERT INTO numbering_series
        (org_id, name, code, series_type, prefix, suffix, separator,
         include_year, include_month, padding, next_number, reset_frequency,
         fy_start_month, is_default, is_active, allow_manual,
         created_by, created_at, updated_at)
      OUTPUT INSERTED.id
      VALUES
        (@org_id, @name, @code, @series_type, @prefix, @suffix, @separator,
         @include_year, @include_month, @padding, @next_number, @reset_frequency,
         @fy_start_month, @is_default, 1, @allow_manual,
         @created_by, GETDATE(), GETDATE())
    `);

  const id = result.recordset[0].id;
  return res.status(201).json({ success: true, data: { id }, message: `Series "${name}" created.` });
}));

// ────────────────────────────────────────────────────────────────
// PATCH /api/numbering/:id
// ────────────────────────────────────────────────────────────────
router.patch('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  await ensureOnce();

  const id = parseInt(req.params.id);
  const {
    name, prefix, suffix, separator,
    include_year, include_month, padding, next_number,
    reset_frequency, fy_start_month,
    is_active, is_default, allow_manual,
  } = req.body;

  await pool.request()
    .input('id',              sql.Int,          id)
    .input('org_id',          sql.Int,          req.user.orgId)
    .input('name',            sql.NVarChar(200), name            || null)
    .input('prefix',          sql.VarChar(20),   prefix          !== undefined ? prefix  : null)
    .input('suffix',          sql.VarChar(20),   suffix          !== undefined ? suffix  : null)
    .input('separator',       sql.VarChar(5),    separator       || null)
    .input('include_year',    sql.Bit,           include_year    != null ? (include_year    ? 1 : 0) : null)
    .input('include_month',   sql.Bit,           include_month   != null ? (include_month   ? 1 : 0) : null)
    .input('padding',         sql.TinyInt,       padding         || null)
    .input('next_number',     sql.Int,           next_number     || null)
    .input('reset_frequency', sql.VarChar(10),   reset_frequency || null)
    .input('fy_start_month',  sql.TinyInt,       fy_start_month  || null)
    .input('is_active',       sql.Bit,           is_active       != null ? (is_active     ? 1 : 0) : null)
    .input('is_default',      sql.Bit,           is_default      != null ? (is_default    ? 1 : 0) : null)
    .input('allow_manual',    sql.Bit,           allow_manual    != null ? (allow_manual   ? 1 : 0) : null)
    .query(`
      UPDATE numbering_series SET
        name            = COALESCE(@name,            name),
        prefix          = COALESCE(@prefix,          prefix),
        suffix          = COALESCE(@suffix,          suffix),
        separator       = COALESCE(@separator,       separator),
        include_year    = COALESCE(@include_year,    include_year),
        include_month   = COALESCE(@include_month,   include_month),
        padding         = COALESCE(@padding,         padding),
        next_number     = COALESCE(@next_number,     next_number),
        reset_frequency = COALESCE(@reset_frequency, reset_frequency),
        fy_start_month  = COALESCE(@fy_start_month,  fy_start_month),
        is_active       = COALESCE(@is_active,       is_active),
        is_default      = COALESCE(@is_default,      is_default),
        allow_manual    = COALESCE(@allow_manual,    allow_manual),
        updated_at      = GETDATE()
      WHERE id = @id AND org_id = @org_id
    `);

  return res.json({ success: true, message: 'Series updated.' });
}));

// ────────────────────────────────────────────────────────────────
// DELETE /api/numbering/:id  (soft — sets is_active = 0)
// ────────────────────────────────────────────────────────────────
router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;

  // Don't allow deleting if it's the only series for that type
  const series = await pool.request()
    .input('id',     sql.Int, parseInt(req.params.id))
    .input('org_id', sql.Int, req.user.orgId)
    .query('SELECT series_type FROM numbering_series WHERE id=@id AND org_id=@org_id');

  if (!series.recordset.length) return res.status(404).json({ success: false, error: 'Series not found.' });

  const type = series.recordset[0].series_type;
  const count = await pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .input('type',   sql.VarChar(50), type)
    .query('SELECT COUNT(*) AS n FROM numbering_series WHERE org_id=@org_id AND series_type=@type AND is_active=1');

  if (count.recordset[0].n <= 1) {
    return res.status(409).json({ success: false, error: 'Cannot delete the only active series for this type.' });
  }

  await pool.request()
    .input('id',     sql.Int, parseInt(req.params.id))
    .input('org_id', sql.Int, req.user.orgId)
    .query('UPDATE numbering_series SET is_active=0, is_default=0, updated_at=GETDATE() WHERE id=@id AND org_id=@org_id');

  return res.json({ success: true, message: 'Series deactivated.' });
}));

module.exports = router;
