'use strict';
// ============================================================
// routes/o2cPricing.js  — Pricing Conditions CRUD
//
// GET    /api/o2c/pricing                  list all conditions
// POST   /api/o2c/pricing                  create condition
// PATCH  /api/o2c/pricing/:id              update condition
// DELETE /api/o2c/pricing/:id              delete condition
// POST   /api/o2c/pricing/simulate         simulate price for a product+customer+qty
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth }            = require('../middleware/auth');
const { asyncHandler }           = require('../middleware/errorHandler');
const { requirePermission }      = require('../middleware/permissions');
const { calculatePrice }         = require('../utils/pricingEngine');

router.use(requireAuth);
const perm    = action => requirePermission('price_lists', action);
const parseId = v => parseInt(v, 10);

// ── LIST ──────────────────────────────────────────────────────
router.get('/', perm('read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const type  = req.query.type || null;

  const rows = await pool.request()
    .input('org_id', sql.Int,          orgId)
    .input('type',   sql.VarChar(30),  type)
    .query(`
      SELECT pc.*,
             c.full_name  AS customer_name,
             p.name       AS product_name,
             p.product_code,
             cat.name     AS category_name,
             cc.name      AS customer_category_name,
             cc.color     AS customer_category_color
      FROM pricing_conditions pc
      LEFT JOIN contacts            c   ON c.id   = pc.customer_id
      LEFT JOIN products            p   ON p.id   = pc.product_id
      LEFT JOIN product_categories  cat ON cat.id  = pc.category_id
      LEFT JOIN customer_categories cc  ON cc.id   = pc.customer_category_id
      WHERE pc.org_id = @org_id
        AND (@type IS NULL OR pc.condition_type = @type)
      ORDER BY pc.condition_type, pc.priority, pc.id
    `);
  res.json({ success: true, data: rows.recordset });
}));

// ── CREATE ────────────────────────────────────────────────────
router.post('/', perm('write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const { condition_type, priority, customer_id, customer_category_id, product_id, category_id,
          price_list_id, min_qty, max_qty, discount_type, discount_value, tax_rate,
          valid_from, valid_to, notes } = req.body;

  if (!condition_type) return res.status(400).json({ success: false, error: 'condition_type is required.' });

  const r = await pool.request()
    .input('org_id',         sql.Int,           orgId)
    .input('condition_type', sql.VarChar(30),   condition_type)
    .input('priority',       sql.Int,           priority != null ? Number(priority) : 10)
    .input('customer_id',          sql.Int, customer_id          || null)
    .input('customer_category_id', sql.Int, customer_category_id || null)
    .input('product_id',           sql.Int, product_id           || null)
    .input('category_id',          sql.Int, category_id          || null)
    .input('price_list_id',        sql.Int, price_list_id        || null)
    .input('min_qty',        sql.Decimal(18,4), min_qty != null ? Number(min_qty) : null)
    .input('max_qty',        sql.Decimal(18,4), max_qty != null ? Number(max_qty) : null)
    .input('discount_type',  sql.VarChar(10),   discount_type  || 'percent')
    .input('discount_value', sql.Decimal(12,4), Number(discount_value || 0))
    .input('tax_rate',       sql.Decimal(5,2),  Number(tax_rate || 0))
    .input('valid_from',     sql.Date,          valid_from ? new Date(valid_from) : null)
    .input('valid_to',       sql.Date,          valid_to   ? new Date(valid_to)   : null)
    .input('notes',          sql.NVarChar(500), notes || null)
    .input('created_by',     sql.Int,           req.user.userId)
    .query(`
      DECLARE @out TABLE (id INT);
      INSERT INTO pricing_conditions
        (org_id, condition_type, priority, customer_id, customer_category_id,
         product_id, category_id, price_list_id,
         min_qty, max_qty, discount_type, discount_value, tax_rate, valid_from, valid_to,
         is_active, notes, created_by, created_at)
      OUTPUT INSERTED.id INTO @out
      VALUES (@org_id, @condition_type, @priority, @customer_id, @customer_category_id,
              @product_id, @category_id, @price_list_id,
              @min_qty, @max_qty, @discount_type, @discount_value, @tax_rate,
              @valid_from, @valid_to, 1, @notes, @created_by, GETDATE());
      SELECT id FROM @out;
    `);
  res.status(201).json({ success: true, data: { id: r.recordset[0].id } });
}));

// ── UPDATE ────────────────────────────────────────────────────
router.patch('/:id', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const { priority, discount_value, tax_rate, min_qty, max_qty, valid_from, valid_to, is_active, notes } = req.body;

  await pool.request()
    .input('id',             sql.Int,           id)
    .input('org_id',         sql.Int,           orgId)
    .input('priority',       sql.Int,           priority       != null ? Number(priority)       : null)
    .input('discount_value', sql.Decimal(12,4), discount_value != null ? Number(discount_value) : null)
    .input('tax_rate',       sql.Decimal(5,2),  tax_rate       != null ? Number(tax_rate)       : null)
    .input('min_qty',        sql.Decimal(18,4), min_qty        != null ? Number(min_qty)        : null)
    .input('max_qty',        sql.Decimal(18,4), max_qty        != null ? Number(max_qty)        : null)
    .input('valid_from',     sql.Date,          valid_from ? new Date(valid_from) : null)
    .input('valid_to',       sql.Date,          valid_to   ? new Date(valid_to)   : null)
    .input('is_active',      sql.Bit,           is_active  != null ? (is_active ? 1 : 0) : null)
    .input('notes',          sql.NVarChar(500), notes ?? null)
    .query(`
      UPDATE pricing_conditions
      SET priority       = COALESCE(@priority,       priority),
          discount_value = COALESCE(@discount_value, discount_value),
          tax_rate       = COALESCE(@tax_rate,       tax_rate),
          min_qty        = COALESCE(@min_qty,        min_qty),
          max_qty        = COALESCE(@max_qty,        max_qty),
          valid_from     = COALESCE(@valid_from,     valid_from),
          valid_to       = COALESCE(@valid_to,       valid_to),
          is_active      = COALESCE(@is_active,      is_active),
          notes          = COALESCE(@notes,          notes)
      WHERE id=@id AND org_id=@org_id
    `);
  res.json({ success: true });
}));

// ── DELETE ────────────────────────────────────────────────────
router.delete('/:id', perm('delete'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query('DELETE FROM pricing_conditions WHERE id=@id AND org_id=@org_id');
  res.json({ success: true });
}));

// ── SIMULATE ──────────────────────────────────────────────────
router.post('/simulate', perm('read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const { product_id, customer_id, qty, price_list_id } = req.body;
  if (!product_id || !qty) return res.status(400).json({ success: false, error: 'product_id and qty required.' });

  let gst = true;
  let customerCategoryId = null;
  let resolvedPriceListId = price_list_id ? Number(price_list_id) : null;
  let resolvedPriceListName = null;

  if (customer_id) {
    const custRes = await pool.request().input('id', sql.Int, customer_id)
      .query('SELECT gst_registered, customer_category_id FROM contacts WHERE id=@id');
    gst = !!custRes.recordset[0]?.gst_registered;
    customerCategoryId = custRes.recordset[0]?.customer_category_id || null;

    // Auto-resolve customer's assigned price list if not explicitly provided
    if (!resolvedPriceListId) {
      const cplRes = await pool.request().input('contact_id', sql.Int, customer_id)
        .query(`
          SELECT TOP 1 pl.id, pl.name
          FROM contact_price_lists cpl
          JOIN price_lists pl ON pl.id = cpl.price_list_id AND pl.is_active = 1
          WHERE cpl.contact_id = @contact_id
        `);
      if (cplRes.recordset.length) {
        resolvedPriceListId   = cplRes.recordset[0].id;
        resolvedPriceListName = cplRes.recordset[0].name;
      }
    }
  }

  // Fall back to org base price list (Retail/RRP — cash sale baseline)
  if (!resolvedPriceListId) {
    const baseRes = await pool.request().input('org_id', sql.Int, orgId)
      .query(`SELECT TOP 1 id, name FROM price_lists WHERE org_id=@org_id AND is_base=1 AND is_active=1 ORDER BY id`);
    if (baseRes.recordset.length) {
      resolvedPriceListId   = baseRes.recordset[0].id;
      resolvedPriceListName = baseRes.recordset[0].name + ' (RRP)';
    }
  }

  // Final fallback: org default price list
  if (!resolvedPriceListId) {
    const defRes = await pool.request().input('org_id', sql.Int, orgId)
      .query(`SELECT TOP 1 id, name FROM price_lists WHERE org_id=@org_id AND is_default=1 AND is_active=1`);
    if (defRes.recordset.length) {
      resolvedPriceListId   = defRes.recordset[0].id;
      resolvedPriceListName = defRes.recordset[0].name + ' (default)';
    }
  }

  // Get name for explicitly supplied price_list_id
  if (price_list_id && !resolvedPriceListName) {
    const plNameRes = await pool.request().input('id', sql.Int, Number(price_list_id))
      .query('SELECT name FROM price_lists WHERE id=@id');
    resolvedPriceListName = plNameRes.recordset[0]?.name || null;
  }

  const pricing = await calculatePrice({
    orgId, productId: product_id, customerId: customer_id || null,
    customerCategoryId, priceListId: resolvedPriceListId, qty,
    customerGstRegistered: gst, pool, sql,
  });

  res.json({ success: true, data: { ...pricing, priceListId: resolvedPriceListId, priceListName: resolvedPriceListName } });
}));

module.exports = router;
