'use strict';
// ============================================================
// routes/wmsPutawayRules.js
//
// GET    /api/wms/putaway-rules             list rules
// POST   /api/wms/putaway-rules             create rule
// PATCH  /api/wms/putaway-rules/:id         update rule
// DELETE /api/wms/putaway-rules/:id         delete rule
//
// Rule types:
//   fixed_bin     — route product/category to a specific bin
//   next_empty    — first empty bin in a zone
//   by_category   — first available bin in a zone for a category
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect }  = require('../config/db');
const { requireAuth }             = require('../middleware/auth');
const { asyncHandler }            = require('../middleware/errorHandler');

router.use(requireAuth);

const VALID_TYPES = ['fixed_bin', 'next_empty', 'by_category'];

// ── LIST ──────────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId       = req.user.orgId;
  const warehouseId = req.query.warehouse_id ? parseInt(req.query.warehouse_id) : null;

  const request = pool.request().input('org_id', sql.Int, orgId);
  let filter = 'r.org_id = @org_id';
  if (warehouseId) { request.input('wh_id', sql.Int, warehouseId); filter += ' AND (r.warehouse_id = @wh_id OR r.warehouse_id IS NULL)'; }

  const rows = await request.query(`
    SELECT
      r.id, r.rule_name, r.rule_type, r.priority, r.is_active,
      r.warehouse_id,  w.name  AS warehouse_name,
      r.product_id,    p.name  AS product_name,  p.product_code,
      r.category_id,   cat.name AS category_name,
      r.zone_id,       z.name  AS zone_name,
      r.bin_id,        wb.bin_code,
      r.created_at
    FROM putaway_rules r
    LEFT JOIN warehouses      w   ON w.id   = r.warehouse_id
    LEFT JOIN products        p   ON p.id   = r.product_id
    LEFT JOIN product_categories cat ON cat.id = r.category_id
    LEFT JOIN warehouse_zones z   ON z.id   = r.zone_id
    LEFT JOIN warehouse_bins  wb  ON wb.id  = r.bin_id
    WHERE ${filter}
    ORDER BY r.priority ASC, r.id ASC
  `);

  res.json({ success: true, data: rows.recordset });
}));

// ── CREATE ────────────────────────────────────────────────────
router.post('/', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const { rule_name, rule_type, priority = 100, warehouse_id, product_id, category_id, zone_id, bin_id, is_active = true } = req.body;

  if (!rule_name) return res.status(400).json({ success: false, error: 'rule_name is required.' });
  if (!VALID_TYPES.includes(rule_type)) return res.status(400).json({ success: false, error: `rule_type must be one of: ${VALID_TYPES.join(', ')}.` });
  if (rule_type === 'fixed_bin' && !bin_id) return res.status(400).json({ success: false, error: 'bin_id is required for fixed_bin rules.' });
  if ((rule_type === 'next_empty' || rule_type === 'by_category') && !zone_id) {
    return res.status(400).json({ success: false, error: 'zone_id is required for next_empty and by_category rules.' });
  }

  const r = await pool.request()
    .input('org_id',       sql.Int,          orgId)
    .input('rule_name',    sql.NVarChar(100), rule_name)
    .input('rule_type',    sql.VarChar(30),   rule_type)
    .input('priority',     sql.Int,           Number(priority))
    .input('warehouse_id', sql.Int,           warehouse_id || null)
    .input('product_id',   sql.Int,           product_id   || null)
    .input('category_id',  sql.Int,           category_id  || null)
    .input('zone_id',      sql.Int,           zone_id      || null)
    .input('bin_id',       sql.Int,           bin_id       || null)
    .input('is_active',    sql.Bit,           is_active ? 1 : 0)
    .query(`
      INSERT INTO putaway_rules
        (org_id, rule_name, rule_type, priority, warehouse_id, product_id, category_id, zone_id, bin_id, is_active, created_at)
      OUTPUT INSERTED.id
      VALUES
        (@org_id, @rule_name, @rule_type, @priority, @warehouse_id, @product_id, @category_id, @zone_id, @bin_id, @is_active, GETDATE())
    `);

  res.status(201).json({ success: true, data: { id: r.recordset[0].id } });
}));

// ── UPDATE ────────────────────────────────────────────────────
router.patch('/:id', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);
  const { rule_name, rule_type, priority, warehouse_id, product_id, category_id, zone_id, bin_id, is_active } = req.body;

  if (rule_type && !VALID_TYPES.includes(rule_type)) {
    return res.status(400).json({ success: false, error: `Invalid rule_type.` });
  }

  const existing = await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query('SELECT id FROM putaway_rules WHERE id=@id AND org_id=@org_id');
  if (!existing.recordset.length) return res.status(404).json({ success: false, error: 'Rule not found.' });

  const fields = [];
  const req2 = pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId);
  if (rule_name    != null) { req2.input('rule_name',    sql.NVarChar(100), rule_name);    fields.push('rule_name=@rule_name'); }
  if (rule_type    != null) { req2.input('rule_type',    sql.VarChar(30),   rule_type);    fields.push('rule_type=@rule_type'); }
  if (priority     != null) { req2.input('priority',     sql.Int,           Number(priority)); fields.push('priority=@priority'); }
  if (warehouse_id !== undefined) { req2.input('warehouse_id', sql.Int, warehouse_id || null); fields.push('warehouse_id=@warehouse_id'); }
  if (product_id   !== undefined) { req2.input('product_id',   sql.Int, product_id   || null); fields.push('product_id=@product_id'); }
  if (category_id  !== undefined) { req2.input('category_id',  sql.Int, category_id  || null); fields.push('category_id=@category_id'); }
  if (zone_id      !== undefined) { req2.input('zone_id',      sql.Int, zone_id      || null); fields.push('zone_id=@zone_id'); }
  if (bin_id       !== undefined) { req2.input('bin_id',       sql.Int, bin_id       || null); fields.push('bin_id=@bin_id'); }
  if (is_active    != null) { req2.input('is_active', sql.Bit, is_active ? 1 : 0); fields.push('is_active=@is_active'); }

  if (!fields.length) return res.status(400).json({ success: false, error: 'No fields to update.' });

  await req2.query(`UPDATE putaway_rules SET ${fields.join(', ')} WHERE id=@id AND org_id=@org_id`);
  res.json({ success: true });
}));

// ── DELETE ────────────────────────────────────────────────────
router.delete('/:id', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);

  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query('DELETE FROM putaway_rules WHERE id=@id AND org_id=@org_id');

  res.json({ success: true });
}));

module.exports = router;
