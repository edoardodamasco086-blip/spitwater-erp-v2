'use strict';
// ============================================================
// routes/product-uom.js
//
// Product UOM Conversions:
// GET    /api/product-uom/:productId           — list all UOMs for product
// POST   /api/product-uom/:productId           — add UOM conversion
// PATCH  /api/product-uom/:productId/:id       — update UOM conversion
// DELETE /api/product-uom/:productId/:id       — remove UOM conversion
//
// Supplier Prices:
// GET    /api/product-uom/:productId/supplier-prices        — list
// POST   /api/product-uom/:productId/supplier-prices        — add
// PATCH  /api/product-uom/:productId/supplier-prices/:id    — update
// DELETE /api/product-uom/:productId/supplier-prices/:id    — remove
//
// Customer Tiers:
// GET    /api/product-uom/tiers                — list all tiers (org)
// POST   /api/product-uom/tiers                — create tier
// PATCH  /api/product-uom/tiers/:id            — update tier
// DELETE /api/product-uom/tiers/:id            — delete tier
// GET    /api/product-uom/tiers/:id/contacts   — contacts in tier
// POST   /api/product-uom/tiers/:id/contacts   — assign contact to tier
// DELETE /api/product-uom/tiers/:id/contacts/:contactId — remove
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect }   = require('../config/db');
const { requireAuth, requireRole, requireMinRole } = require('../middleware/auth');
const { asyncHandler }             = require('../middleware/errorHandler');
const { getRate }                  = require('../services/currencyService');

router.use(requireAuth);

// ────────────────────────────────────────────────────────────────
// CUSTOMER TIERS
// ────────────────────────────────────────────────────────────────

router.get('/tiers', asyncHandler(async (req, res) => {
  await poolConnect;
  const rows = await pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .query(`
      SELECT t.id, t.name, t.description, t.color, t.discount_pct,
             t.is_active, t.sort_order,
             (SELECT COUNT(*) FROM contact_tiers ct WHERE ct.tier_id=t.id AND ct.org_id=t.org_id) AS contact_count
      FROM customer_tiers t
      WHERE t.org_id = @org_id
      ORDER BY t.sort_order ASC, t.name ASC
    `);
  return res.json({ success: true, data: rows.recordset });
}));

router.post('/tiers', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { name, description, color, discount_pct, sort_order } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'name required.' });

  const result = await pool.request()
    .input('org_id',       sql.Int,          req.user.orgId)
    .input('name',         sql.NVarChar(100), name.trim())
    .input('description',  sql.NVarChar(500), description || null)
    .input('color',        sql.VarChar(7),    color || '#2F7FE8')
    .input('discount_pct', sql.Decimal(5,2),  discount_pct || 0)
    .input('sort_order',   sql.Int,           sort_order || 0)
    .query(`
      INSERT INTO customer_tiers (org_id,name,description,color,discount_pct,is_active,sort_order,created_at)
      OUTPUT INSERTED.id
      VALUES (@org_id,@name,@description,@color,@discount_pct,1,@sort_order,GETDATE())
    `);
  return res.status(201).json({ success: true, data: { id: result.recordset[0].id } });
}));

router.patch('/tiers/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { name, description, color, discount_pct, is_active, sort_order } = req.body;
  await pool.request()
    .input('id',           sql.Int,          parseInt(req.params.id))
    .input('org_id',       sql.Int,          req.user.orgId)
    .input('name',         sql.NVarChar(100), name        || null)
    .input('description',  sql.NVarChar(500), description || null)
    .input('color',        sql.VarChar(7),    color       || null)
    .input('discount_pct', sql.Decimal(5,2),  discount_pct ?? null)
    .input('is_active',    sql.Bit,           is_active != null ? (is_active ? 1 : 0) : null)
    .input('sort_order',   sql.Int,           sort_order ?? null)
    .query(`
      UPDATE customer_tiers SET
        name         = COALESCE(@name,         name),
        description  = COALESCE(@description,  description),
        color        = COALESCE(@color,         color),
        discount_pct = COALESCE(@discount_pct,  discount_pct),
        is_active    = COALESCE(@is_active,      is_active),
        sort_order   = COALESCE(@sort_order,     sort_order)
      WHERE id=@id AND org_id=@org_id
    `);
  return res.json({ success: true, message: 'Tier updated.' });
}));

router.delete('/tiers/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const id = parseInt(req.params.id);
  const count = await pool.request().input('id', sql.Int, id)
    .query('SELECT COUNT(*) AS n FROM contact_tiers WHERE tier_id=@id');
  if (count.recordset[0].n > 0)
    return res.status(409).json({ success: false, error: 'Remove all contacts from this tier first.' });
  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, req.user.orgId)
    .query('DELETE FROM customer_tiers WHERE id=@id AND org_id=@org_id');
  return res.json({ success: true, message: 'Tier deleted.' });
}));

// Contacts in a tier
router.get('/tiers/:id/contacts', asyncHandler(async (req, res) => {
  await poolConnect;
  const rows = await pool.request()
    .input('tier_id', sql.Int, parseInt(req.params.id))
    .input('org_id',  sql.Int, req.user.orgId)
    .query(`
      SELECT c.id, c.full_name, c.email, c.contact_type, ct.assigned_at
      FROM contact_tiers ct
      INNER JOIN contacts c ON c.id = ct.contact_id
      WHERE ct.tier_id=@tier_id AND ct.org_id=@org_id
      ORDER BY c.full_name ASC
    `);
  return res.json({ success: true, data: rows.recordset });
}));

router.post('/tiers/:id/contacts', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { contactId } = req.body;
  if (!contactId) return res.status(400).json({ success: false, error: 'contactId required.' });

  // Upsert — a contact can only be in one tier at a time
  await pool.request()
    .input('org_id',     sql.Int, req.user.orgId)
    .input('contact_id', sql.Int, parseInt(contactId))
    .input('tier_id',    sql.Int, parseInt(req.params.id))
    .input('by',         sql.Int, req.user.userId)
    .query(`
      IF EXISTS (SELECT 1 FROM contact_tiers WHERE org_id=@org_id AND contact_id=@contact_id)
        UPDATE contact_tiers SET tier_id=@tier_id, assigned_at=GETDATE(), assigned_by=@by
        WHERE org_id=@org_id AND contact_id=@contact_id
      ELSE
        INSERT INTO contact_tiers (org_id,contact_id,tier_id,assigned_at,assigned_by)
        VALUES (@org_id,@contact_id,@tier_id,GETDATE(),@by)
    `);
  return res.json({ success: true, message: 'Contact assigned to tier.' });
}));

router.delete('/tiers/:id/contacts/:contactId', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  await pool.request()
    .input('org_id',     sql.Int, req.user.orgId)
    .input('contact_id', sql.Int, parseInt(req.params.contactId))
    .input('tier_id',    sql.Int, parseInt(req.params.id))
    .query('DELETE FROM contact_tiers WHERE org_id=@org_id AND contact_id=@contact_id AND tier_id=@tier_id');
  return res.json({ success: true, message: 'Contact removed from tier.' });
}));

// ────────────────────────────────────────────────────────────────
// PRODUCT UOM CONVERSIONS
// ────────────────────────────────────────────────────────────────

router.get('/:productId', asyncHandler(async (req, res) => {
  await poolConnect;
  const rows = await pool.request()
    .input('product_id', sql.Int, parseInt(req.params.productId))
    .input('org_id',     sql.Int, req.user.orgId)
    .query(`
      SELECT pu.id, pu.uom_id, pu.uom_role, pu.qty_in_base,
             pu.barcode, pu.weight_kg, pu.length_cm, pu.width_cm, pu.height_cm,
             pu.is_active, pu.sort_order,
             uom.code AS uom_code, uom.name AS uom_name
      FROM product_uom_conversions pu
      INNER JOIN units_of_measure uom ON uom.id = pu.uom_id
      WHERE pu.product_id = @product_id AND pu.org_id = @org_id
      ORDER BY pu.sort_order ASC, pu.uom_role ASC
    `);
  return res.json({ success: true, data: rows.recordset });
}));

router.post('/:productId', requireMinRole('editor'), asyncHandler(async (req, res) => {
  await poolConnect;
  const productId = parseInt(req.params.productId);
  const {
    uom_id, uom_role = 'other', qty_in_base = 1,
    barcode, weight_kg, length_cm, width_cm, height_cm, sort_order = 0,
  } = req.body;

  if (!uom_id) return res.status(400).json({ success: false, error: 'uom_id required.' });

  // Auto-generate barcode if not provided: {product_barcode}-{uom_code}
  let finalBarcode = barcode;
  if (!finalBarcode) {
    const prodRes = await pool.request()
      .input('id',     sql.Int, productId)
      .input('org_id', sql.Int, req.user.orgId)
      .query('SELECT barcode FROM products WHERE id=@id AND org_id=@org_id');
    const uomRes = await pool.request()
      .input('id', sql.Int, uom_id)
      .query('SELECT code FROM units_of_measure WHERE id=@id');
    if (prodRes.recordset[0]?.barcode && uomRes.recordset[0]?.code) {
      finalBarcode = `${prodRes.recordset[0].barcode}-${uomRes.recordset[0].code}`;
    }
  }

  const result = await pool.request()
    .input('org_id',      sql.Int,          req.user.orgId)
    .input('product_id',  sql.Int,          productId)
    .input('uom_id',      sql.Int,          uom_id)
    .input('uom_role',    sql.VarChar(10),  uom_role)
    .input('qty_in_base', sql.Decimal(18,6),parseFloat(qty_in_base))
    .input('barcode',     sql.NVarChar(100),finalBarcode || null)
    .input('weight_kg',   sql.Decimal(10,4),weight_kg   || null)
    .input('length_cm',   sql.Decimal(10,2),length_cm   || null)
    .input('width_cm',    sql.Decimal(10,2),width_cm    || null)
    .input('height_cm',   sql.Decimal(10,2),height_cm   || null)
    .input('sort_order',  sql.Int,          sort_order)
    .query(`
      INSERT INTO product_uom_conversions
        (org_id,product_id,uom_id,uom_role,qty_in_base,barcode,weight_kg,length_cm,width_cm,height_cm,is_active,sort_order)
      OUTPUT INSERTED.id
      VALUES (@org_id,@product_id,@uom_id,@uom_role,@qty_in_base,@barcode,@weight_kg,@length_cm,@width_cm,@height_cm,1,@sort_order)
    `);
  return res.status(201).json({ success: true, data: { id: result.recordset[0].id, barcode: finalBarcode } });
}));

router.patch('/:productId/:id', requireMinRole('editor'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { uom_role, qty_in_base, barcode, weight_kg, length_cm, width_cm, height_cm, is_active } = req.body;
  await pool.request()
    .input('id',          sql.Int,          parseInt(req.params.id))
    .input('uom_role',    sql.VarChar(10),  uom_role    || null)
    .input('qty_in_base', sql.Decimal(18,6),qty_in_base ?? null)
    .input('barcode',     sql.NVarChar(100),barcode     || null)
    .input('weight_kg',   sql.Decimal(10,4),weight_kg   ?? null)
    .input('length_cm',   sql.Decimal(10,2),length_cm   ?? null)
    .input('width_cm',    sql.Decimal(10,2),width_cm    ?? null)
    .input('height_cm',   sql.Decimal(10,2),height_cm   ?? null)
    .input('is_active',   sql.Bit,          is_active != null ? (is_active ? 1 : 0) : null)
    .query(`
      UPDATE product_uom_conversions SET
        uom_role    = COALESCE(@uom_role,    uom_role),
        qty_in_base = COALESCE(@qty_in_base, qty_in_base),
        barcode     = COALESCE(@barcode,     barcode),
        weight_kg   = COALESCE(@weight_kg,   weight_kg),
        length_cm   = COALESCE(@length_cm,   length_cm),
        width_cm    = COALESCE(@width_cm,    width_cm),
        height_cm   = COALESCE(@height_cm,   height_cm),
        is_active   = COALESCE(@is_active,   is_active)
      WHERE id=@id
    `);
  return res.json({ success: true, message: 'UOM conversion updated.' });
}));

router.delete('/:productId/:id', requireMinRole('editor'), asyncHandler(async (req, res) => {
  await poolConnect;
  await pool.request().input('id', sql.Int, parseInt(req.params.id))
    .query('DELETE FROM product_uom_conversions WHERE id=@id');
  return res.json({ success: true, message: 'UOM conversion removed.' });
}));

// ────────────────────────────────────────────────────────────────
// SUPPLIER PRICES
// ────────────────────────────────────────────────────────────────

router.get('/:productId/supplier-prices', asyncHandler(async (req, res) => {
  await poolConnect;
  const rows = await pool.request()
    .input('product_id', sql.Int, parseInt(req.params.productId))
    .input('org_id',     sql.Int, req.user.orgId)
    .query(`
      SELECT sp.id, sp.contact_id, c.full_name AS supplier_name,
             sp.uom_id, uom.code AS uom_code, uom.name AS uom_name,
             sp.unit_price, sp.currency_code, sp.min_order_qty,
             sp.lead_time_days, sp.valid_from, sp.valid_to, sp.is_active, sp.notes
      FROM product_supplier_prices sp
      INNER JOIN contacts c   ON c.id   = sp.contact_id
      INNER JOIN units_of_measure uom ON uom.id = sp.uom_id
      WHERE sp.product_id = @product_id AND sp.org_id = @org_id
      ORDER BY sp.is_active DESC, c.full_name ASC, uom.code ASC
    `);

  // Add AUD equivalent using latest rate
  const orgRes = await pool.request().query('SELECT TOP 1 base_currency FROM org_settings');
  const base   = orgRes.recordset[0]?.base_currency || 'AUD';

  const data = await Promise.all(rows.recordset.map(async (row) => {
    const rate     = await getRate(pool, sql, row.currency_code, base);
    const aud_equiv = rate ? parseFloat((row.unit_price * rate).toFixed(4)) : null;
    return { ...row, aud_equiv, fx_rate: rate };
  }));

  return res.json({ success: true, data });
}));

router.post('/:productId/supplier-prices', requireMinRole('editor'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { contact_id, uom_id, unit_price, currency_code = 'AUD', min_order_qty = 1, lead_time_days, valid_from, valid_to, notes } = req.body;
  if (!contact_id || !uom_id || unit_price == null) return res.status(400).json({ success: false, error: 'contact_id, uom_id and unit_price required.' });

  const result = await pool.request()
    .input('org_id',        sql.Int,          req.user.orgId)
    .input('product_id',    sql.Int,          parseInt(req.params.productId))
    .input('contact_id',    sql.Int,          parseInt(contact_id))
    .input('uom_id',        sql.Int,          parseInt(uom_id))
    .input('unit_price',    sql.Decimal(18,4),parseFloat(unit_price))
    .input('currency_code', sql.VarChar(3),   currency_code.toUpperCase())
    .input('min_order_qty', sql.Decimal(18,4),parseFloat(min_order_qty))
    .input('lead_time_days',sql.Int,          lead_time_days || null)
    .input('valid_from',    sql.Date,         valid_from || null)
    .input('valid_to',      sql.Date,         valid_to   || null)
    .input('notes',         sql.NVarChar(500),notes      || null)
    .query(`
      INSERT INTO product_supplier_prices
        (org_id,product_id,contact_id,uom_id,unit_price,currency_code,min_order_qty,lead_time_days,valid_from,valid_to,is_active,notes,created_at,updated_at)
      OUTPUT INSERTED.id
      VALUES
        (@org_id,@product_id,@contact_id,@uom_id,@unit_price,@currency_code,@min_order_qty,@lead_time_days,@valid_from,@valid_to,1,@notes,GETDATE(),GETDATE())
    `);
  return res.status(201).json({ success: true, data: { id: result.recordset[0].id } });
}));

router.patch('/:productId/supplier-prices/:id', requireMinRole('editor'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { unit_price, currency_code, min_order_qty, lead_time_days, valid_from, valid_to, is_active, notes } = req.body;
  await pool.request()
    .input('id',            sql.Int,          parseInt(req.params.id))
    .input('unit_price',    sql.Decimal(18,4),unit_price    ?? null)
    .input('currency_code', sql.VarChar(3),   currency_code || null)
    .input('min_order_qty', sql.Decimal(18,4),min_order_qty ?? null)
    .input('lead_time_days',sql.Int,          lead_time_days ?? null)
    .input('valid_from',    sql.Date,         valid_from    || null)
    .input('valid_to',      sql.Date,         valid_to      || null)
    .input('is_active',     sql.Bit,          is_active != null ? (is_active ? 1 : 0) : null)
    .input('notes',         sql.NVarChar(500),notes         || null)
    .query(`
      UPDATE product_supplier_prices SET
        unit_price     = COALESCE(@unit_price,     unit_price),
        currency_code  = COALESCE(@currency_code,  currency_code),
        min_order_qty  = COALESCE(@min_order_qty,  min_order_qty),
        lead_time_days = COALESCE(@lead_time_days, lead_time_days),
        valid_from     = COALESCE(@valid_from,     valid_from),
        valid_to       = COALESCE(@valid_to,       valid_to),
        is_active      = COALESCE(@is_active,      is_active),
        notes          = COALESCE(@notes,          notes),
        updated_at     = GETDATE()
      WHERE id=@id
    `);
  return res.json({ success: true, message: 'Supplier price updated.' });
}));

router.delete('/:productId/supplier-prices/:id', requireMinRole('editor'), asyncHandler(async (req, res) => {
  await poolConnect;
  await pool.request().input('id', sql.Int, parseInt(req.params.id))
    .query('UPDATE product_supplier_prices SET is_active=0 WHERE id=@id');
  return res.json({ success: true, message: 'Supplier price deactivated.' });
}));

module.exports = router;
