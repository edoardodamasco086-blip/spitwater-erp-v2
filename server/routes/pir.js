'use strict';
// ============================================================
// routes/pir.js
//
// Purchasing Info Records (PIR) + Conditions + Scales + Source List
//
// GET    /api/pir                                  list PIRs for org
// POST   /api/pir                                  create PIR
// PATCH  /api/pir/:id                              update PIR
// DELETE /api/pir/:id                              delete PIR
//
// GET    /api/pir/source-list                      get source list entries
// POST   /api/pir/source-list                      create source list entry
// PATCH  /api/pir/source-list/:id                  update source list entry
// DELETE /api/pir/source-list/:id                  delete source list entry
//
// POST   /api/pir/determine-price                  price determination
//
// GET    /api/pir/:id/conditions                   list conditions (with scales)
// POST   /api/pir/:id/conditions                   create condition
// PATCH  /api/pir/:id/conditions/:cid              update condition
// DELETE /api/pir/:id/conditions/:cid              delete condition
//
// POST   /api/pir/:id/conditions/:cid/scales       add scale
// PATCH  /api/pir/:id/conditions/:cid/scales/:sid  update scale
// DELETE /api/pir/:id/conditions/:cid/scales/:sid  delete scale
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth }            = require('../middleware/auth');
const { requirePermission }      = require('../middleware/permissions');
const { asyncHandler }           = require('../middleware/errorHandler');

router.use(requireAuth);

// ── Helper: verify PIR belongs to org ───────────────────────
async function getPirOrg(pirId, orgId) {
  const r = await pool.request()
    .input('id',     sql.Int, pirId)
    .input('org_id', sql.Int, orgId)
    .query('SELECT id FROM purchase_info_records WHERE id=@id AND org_id=@org_id');
  return r.recordset.length > 0;
}

// ────────────────────────────────────────────────────────────────
// Static sub-routes must come before /:id to avoid conflicts
// ────────────────────────────────────────────────────────────────

// ── GET /api/pir/source-list ─────────────────────────────────
router.get('/source-list', requirePermission('products', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId     = req.user.orgId;
  const productId = req.query.product_id || null;

  const rows = await pool.request()
    .input('org_id',     sql.Int, orgId)
    .input('product_id', sql.Int, productId || null)
    .query(`
      SELECT sl.id, sl.product_id, sl.vendor_id, sl.pir_id,
             sl.rank, sl.is_preferred, sl.is_blocked,
             sl.valid_from, sl.valid_to,
             p.name AS product_name, p.product_code,
             c.full_name AS vendor_name
      FROM item_source_list sl
      JOIN products p  ON p.id = sl.product_id
      JOIN contacts c  ON c.id = sl.vendor_id
      WHERE sl.org_id = @org_id
        AND (@product_id IS NULL OR sl.product_id = @product_id)
      ORDER BY sl.product_id, sl.rank ASC
    `);

  return res.json({ success: true, data: rows.recordset });
}));

// ── POST /api/pir/source-list ────────────────────────────────
router.post('/source-list', requirePermission('products', 'update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const { product_id, vendor_id, pir_id, rank, is_preferred, is_blocked, valid_from, valid_to } = req.body;

  if (!product_id || !vendor_id) {
    return res.status(400).json({ success: false, error: 'product_id and vendor_id are required.' });
  }

  const result = await pool.request()
    .input('org_id',       sql.Int,      orgId)
    .input('product_id',   sql.Int,      product_id)
    .input('vendor_id',    sql.Int,      vendor_id)
    .input('pir_id',       sql.Int,      pir_id      || null)
    .input('rank',         sql.Int,      rank        ?? 1)
    .input('is_preferred', sql.Bit,      is_preferred ? 1 : 0)
    .input('is_blocked',   sql.Bit,      is_blocked   ? 1 : 0)
    .input('valid_from',   sql.Date,     valid_from  || null)
    .input('valid_to',     sql.Date,     valid_to    || null)
    .query(`
      INSERT INTO item_source_list
        (org_id, product_id, vendor_id, pir_id, rank, is_preferred, is_blocked, valid_from, valid_to)
      OUTPUT INSERTED.id
      VALUES (@org_id, @product_id, @vendor_id, @pir_id, @rank, @is_preferred, @is_blocked, @valid_from, @valid_to)
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id }, message: 'Source list entry created.' });
}));

// ── PATCH /api/pir/source-list/:id ──────────────────────────
router.patch('/source-list/:id', requirePermission('products', 'update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);
  const { rank, is_preferred, is_blocked, valid_from, valid_to, pir_id } = req.body;

  const affected = await pool.request()
    .input('id',           sql.Int,  id)
    .input('org_id',       sql.Int,  orgId)
    .input('rank',         sql.Int,  rank         ?? null)
    .input('is_preferred', sql.Bit,  is_preferred != null ? (is_preferred ? 1 : 0) : null)
    .input('is_blocked',   sql.Bit,  is_blocked   != null ? (is_blocked   ? 1 : 0) : null)
    .input('pir_id',       sql.Int,  pir_id       || null)
    .input('valid_from',   sql.Date, valid_from   || null)
    .input('valid_to',     sql.Date, valid_to     || null)
    .query(`
      UPDATE item_source_list SET
        rank         = COALESCE(@rank,         rank),
        is_preferred = COALESCE(@is_preferred, is_preferred),
        is_blocked   = COALESCE(@is_blocked,   is_blocked),
        pir_id       = COALESCE(@pir_id,       pir_id),
        valid_from   = COALESCE(@valid_from,   valid_from),
        valid_to     = COALESCE(@valid_to,     valid_to)
      WHERE id = @id AND org_id = @org_id
    `);

  return res.json({ success: true, message: 'Source list entry updated.' });
}));

// ── DELETE /api/pir/source-list/:id ─────────────────────────
router.delete('/source-list/:id', requirePermission('products', 'update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);

  await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query('DELETE FROM item_source_list WHERE id=@id AND org_id=@org_id');

  return res.json({ success: true, message: 'Source list entry deleted.' });
}));

// ── POST /api/pir/determine-price ────────────────────────────
router.post('/determine-price', requirePermission('products', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { product_id, vendor_id, qty, date } = req.body;

  if (!product_id || qty == null) {
    return res.status(400).json({ success: false, error: 'product_id and qty are required.' });
  }

  const { determinePurchasePrice, determinePriceFromSourceList } = require('../utils/purchasePricingEngine');

  let result;
  if (vendor_id) {
    result = await determinePurchasePrice({ product_id, vendor_id, qty, date: date || null, orgId: req.user.orgId, pool, sql });
  } else {
    result = await determinePriceFromSourceList({ product_id, qty, date: date || null, orgId: req.user.orgId, pool, sql });
  }

  return res.json({ success: true, data: result });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/pir  — list PIRs
// ────────────────────────────────────────────────────────────────
router.get('/', requirePermission('products', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId     = req.user.orgId;
  const productId = req.query.product_id || null;
  const vendorId  = req.query.vendor_id  || null;

  const rows = await pool.request()
    .input('org_id',     sql.Int, orgId)
    .input('product_id', sql.Int, productId || null)
    .input('vendor_id',  sql.Int, vendorId  || null)
    .query(`
      SELECT pir.*, p.name AS product_name, p.product_code,
             c.full_name AS vendor_name,
             u.code AS purchase_uom_code
      FROM purchase_info_records pir
      JOIN products p ON p.id = pir.product_id
      JOIN contacts c ON c.id = pir.vendor_id
      LEFT JOIN units_of_measure u ON u.id = pir.purchase_uom_id
      WHERE pir.org_id = @org_id
        AND (@product_id IS NULL OR pir.product_id = @product_id)
        AND (@vendor_id  IS NULL OR pir.vendor_id  = @vendor_id)
      ORDER BY p.name, c.full_name
    `);

  return res.json({ success: true, data: rows.recordset });
}));

// ── POST /api/pir ────────────────────────────────────────────
router.post('/', requirePermission('products', 'update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const {
    product_id, vendor_id, purchase_uom_id,
    lead_time_days, moq, vendor_material_number, is_active = true,
  } = req.body;

  if (!product_id || !vendor_id) {
    return res.status(400).json({ success: false, error: 'product_id and vendor_id are required.' });
  }

  const result = await pool.request()
    .input('org_id',                sql.Int,         orgId)
    .input('product_id',            sql.Int,         product_id)
    .input('vendor_id',             sql.Int,         vendor_id)
    .input('purchase_uom_id',       sql.Int,         purchase_uom_id        || null)
    .input('lead_time_days',        sql.Int,         lead_time_days         ?? null)
    .input('moq',                   sql.Decimal(18,4), moq                  ?? null)
    .input('vendor_material_number', sql.NVarChar(100), vendor_material_number || null)
    .input('is_active',             sql.Bit,         is_active ? 1 : 0)
    .query(`
      INSERT INTO purchase_info_records
        (org_id, product_id, vendor_id, purchase_uom_id, lead_time_days, moq, vendor_material_number, is_active, created_at, updated_at)
      OUTPUT INSERTED.id
      VALUES (@org_id, @product_id, @vendor_id, @purchase_uom_id, @lead_time_days, @moq, @vendor_material_number, @is_active, GETDATE(), GETDATE())
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id }, message: 'PIR created.' });
}));

// ── PATCH /api/pir/:id ───────────────────────────────────────
router.patch('/:id', requirePermission('products', 'update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);

  if (!(await getPirOrg(id, orgId))) {
    return res.status(404).json({ success: false, error: 'PIR not found.' });
  }

  const { lead_time_days, moq, vendor_material_number, is_active, purchase_uom_id } = req.body;

  await pool.request()
    .input('id',                     sql.Int,          id)
    .input('lead_time_days',         sql.Int,          lead_time_days         ?? null)
    .input('moq',                    sql.Decimal(18,4), moq                   ?? null)
    .input('vendor_material_number', sql.NVarChar(100), vendor_material_number || null)
    .input('is_active',              sql.Bit,          is_active != null ? (is_active ? 1 : 0) : null)
    .input('purchase_uom_id',        sql.Int,          purchase_uom_id        || null)
    .query(`
      UPDATE purchase_info_records SET
        lead_time_days         = COALESCE(@lead_time_days,         lead_time_days),
        moq                    = COALESCE(@moq,                    moq),
        vendor_material_number = COALESCE(@vendor_material_number, vendor_material_number),
        is_active              = COALESCE(@is_active,              is_active),
        purchase_uom_id        = COALESCE(@purchase_uom_id,        purchase_uom_id),
        updated_at             = GETDATE()
      WHERE id = @id
    `);

  return res.json({ success: true, message: 'PIR updated.' });
}));

// ── DELETE /api/pir/:id ──────────────────────────────────────
router.delete('/:id', requirePermission('products', 'update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);

  if (!(await getPirOrg(id, orgId))) {
    return res.status(404).json({ success: false, error: 'PIR not found.' });
  }

  await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM purchase_info_records WHERE id=@id');

  return res.json({ success: true, message: 'PIR deleted.' });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/pir/:id/conditions  — list conditions with nested scales
// ────────────────────────────────────────────────────────────────
router.get('/:id/conditions', requirePermission('products', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const pirId = parseInt(req.params.id);

  if (!(await getPirOrg(pirId, orgId))) {
    return res.status(404).json({ success: false, error: 'PIR not found.' });
  }

  const rows = await pool.request()
    .input('pir_id', sql.Int, pirId)
    .query(`
      SELECT c.id, c.pir_id, c.valid_from, c.valid_to, c.base_price, c.currency_code, c.incoterm,
             s.id AS scale_id, s.min_qty, s.max_qty, s.unit_price
      FROM pir_conditions c
      LEFT JOIN pir_scales s ON s.pir_condition_id = c.id
      WHERE c.pir_id = @pir_id
      ORDER BY c.valid_from DESC, s.min_qty ASC
    `);

  // Group scales under each condition
  const condMap = new Map();
  for (const row of rows.recordset) {
    if (!condMap.has(row.id)) {
      condMap.set(row.id, {
        id:            row.id,
        pir_id:        row.pir_id,
        valid_from:    row.valid_from,
        valid_to:      row.valid_to,
        base_price:    row.base_price,
        currency_code: row.currency_code,
        incoterm:      row.incoterm,
        scales:        [],
      });
    }
    if (row.scale_id != null) {
      condMap.get(row.id).scales.push({
        id:         row.scale_id,
        min_qty:    row.min_qty,
        max_qty:    row.max_qty,
        unit_price: row.unit_price,
      });
    }
  }

  return res.json({ success: true, data: Array.from(condMap.values()) });
}));

// ── POST /api/pir/:id/conditions ─────────────────────────────
router.post('/:id/conditions', requirePermission('products', 'update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const pirId = parseInt(req.params.id);

  if (!(await getPirOrg(pirId, orgId))) {
    return res.status(404).json({ success: false, error: 'PIR not found.' });
  }

  const { valid_from, valid_to, base_price, currency_code, incoterm } = req.body;
  if (base_price == null) {
    return res.status(400).json({ success: false, error: 'base_price is required.' });
  }

  const result = await pool.request()
    .input('pir_id',        sql.Int,          pirId)
    .input('valid_from',    sql.Date,         valid_from    || null)
    .input('valid_to',      sql.Date,         valid_to      || null)
    .input('base_price',    sql.Decimal(18,4), parseFloat(base_price))
    .input('currency_code', sql.VarChar(3),   currency_code || 'AUD')
    .input('incoterm',      sql.VarChar(10),  incoterm      || null)
    .query(`
      INSERT INTO pir_conditions (pir_id, valid_from, valid_to, base_price, currency_code, incoterm)
      OUTPUT INSERTED.id
      VALUES (@pir_id, @valid_from, @valid_to, @base_price, @currency_code, @incoterm)
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id }, message: 'Condition created.' });
}));

// ── PATCH /api/pir/:id/conditions/:cid ──────────────────────
router.patch('/:id/conditions/:cid', requirePermission('products', 'update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const pirId = parseInt(req.params.id);
  const cid   = parseInt(req.params.cid);

  if (!(await getPirOrg(pirId, orgId))) {
    return res.status(404).json({ success: false, error: 'PIR not found.' });
  }

  const { valid_from, valid_to, base_price, currency_code, incoterm } = req.body;

  await pool.request()
    .input('id',            sql.Int,          cid)
    .input('pir_id',        sql.Int,          pirId)
    .input('valid_from',    sql.Date,         valid_from    || null)
    .input('valid_to',      sql.Date,         valid_to      || null)
    .input('base_price',    sql.Decimal(18,4), base_price   ?? null)
    .input('currency_code', sql.VarChar(3),   currency_code || null)
    .input('incoterm',      sql.VarChar(10),  incoterm      || null)
    .query(`
      UPDATE pir_conditions SET
        valid_from    = COALESCE(@valid_from,    valid_from),
        valid_to      = COALESCE(@valid_to,      valid_to),
        base_price    = COALESCE(@base_price,    base_price),
        currency_code = COALESCE(@currency_code, currency_code),
        incoterm      = COALESCE(@incoterm,      incoterm)
      WHERE id = @id AND pir_id = @pir_id
    `);

  return res.json({ success: true, message: 'Condition updated.' });
}));

// ── DELETE /api/pir/:id/conditions/:cid ─────────────────────
router.delete('/:id/conditions/:cid', requirePermission('products', 'update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const pirId = parseInt(req.params.id);
  const cid   = parseInt(req.params.cid);

  if (!(await getPirOrg(pirId, orgId))) {
    return res.status(404).json({ success: false, error: 'PIR not found.' });
  }

  await pool.request()
    .input('id',     sql.Int, cid)
    .input('pir_id', sql.Int, pirId)
    .query('DELETE FROM pir_conditions WHERE id=@id AND pir_id=@pir_id');

  return res.json({ success: true, message: 'Condition deleted.' });
}));

// ── POST /api/pir/:id/conditions/:cid/scales ────────────────
router.post('/:id/conditions/:cid/scales', requirePermission('products', 'update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const pirId = parseInt(req.params.id);
  const cid   = parseInt(req.params.cid);

  if (!(await getPirOrg(pirId, orgId))) {
    return res.status(404).json({ success: false, error: 'PIR not found.' });
  }

  // Verify condition belongs to PIR
  const condCheck = await pool.request()
    .input('id',     sql.Int, cid)
    .input('pir_id', sql.Int, pirId)
    .query('SELECT id FROM pir_conditions WHERE id=@id AND pir_id=@pir_id');
  if (!condCheck.recordset.length) {
    return res.status(404).json({ success: false, error: 'Condition not found.' });
  }

  const { min_qty, max_qty, unit_price } = req.body;
  if (min_qty == null || unit_price == null) {
    return res.status(400).json({ success: false, error: 'min_qty and unit_price are required.' });
  }

  const result = await pool.request()
    .input('pir_condition_id', sql.Int,          cid)
    .input('min_qty',          sql.Decimal(18,4), parseFloat(min_qty))
    .input('max_qty',          sql.Decimal(18,4), max_qty != null ? parseFloat(max_qty) : null)
    .input('unit_price',       sql.Decimal(18,4), parseFloat(unit_price))
    .query(`
      INSERT INTO pir_scales (pir_condition_id, min_qty, max_qty, unit_price)
      OUTPUT INSERTED.id
      VALUES (@pir_condition_id, @min_qty, @max_qty, @unit_price)
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id }, message: 'Scale added.' });
}));

// ── PATCH /api/pir/:id/conditions/:cid/scales/:sid ──────────
router.patch('/:id/conditions/:cid/scales/:sid', requirePermission('products', 'update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const pirId = parseInt(req.params.id);
  const cid   = parseInt(req.params.cid);
  const sid   = parseInt(req.params.sid);

  if (!(await getPirOrg(pirId, orgId))) {
    return res.status(404).json({ success: false, error: 'PIR not found.' });
  }

  const { min_qty, max_qty, unit_price } = req.body;

  await pool.request()
    .input('id',               sql.Int,          sid)
    .input('pir_condition_id', sql.Int,          cid)
    .input('min_qty',          sql.Decimal(18,4), min_qty    ?? null)
    .input('max_qty',          sql.Decimal(18,4), max_qty    ?? null)
    .input('unit_price',       sql.Decimal(18,4), unit_price ?? null)
    .query(`
      UPDATE pir_scales SET
        min_qty    = COALESCE(@min_qty,    min_qty),
        max_qty    = COALESCE(@max_qty,    max_qty),
        unit_price = COALESCE(@unit_price, unit_price)
      WHERE id = @id AND pir_condition_id = @pir_condition_id
    `);

  return res.json({ success: true, message: 'Scale updated.' });
}));

// ── DELETE /api/pir/:id/conditions/:cid/scales/:sid ─────────
router.delete('/:id/conditions/:cid/scales/:sid', requirePermission('products', 'update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const pirId = parseInt(req.params.id);
  const cid   = parseInt(req.params.cid);
  const sid   = parseInt(req.params.sid);

  if (!(await getPirOrg(pirId, orgId))) {
    return res.status(404).json({ success: false, error: 'PIR not found.' });
  }

  await pool.request()
    .input('id',               sql.Int, sid)
    .input('pir_condition_id', sql.Int, cid)
    .query('DELETE FROM pir_scales WHERE id=@id AND pir_condition_id=@pir_condition_id');

  return res.json({ success: true, message: 'Scale deleted.' });
}));

module.exports = router;
