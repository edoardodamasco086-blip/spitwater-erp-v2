'use strict';
// ============================================================
// routes/product-suppliers.js
//
// GET    /api/products/:id/suppliers           — list suppliers for product
// POST   /api/products/:id/suppliers           — add supplier
// PATCH  /api/products/:id/suppliers/:suppId   — update supplier
// DELETE /api/products/:id/suppliers/:suppId   — remove supplier
// PATCH  /api/products/:id/suppliers/:suppId/set-preferred — set as default
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth }            = require('../middleware/auth');
const { requirePermission }      = require('../middleware/permissions');
const { asyncHandler }           = require('../middleware/errorHandler');

router.use(requireAuth);

// ── LIST ─────────────────────────────────────────────────────
router.get('/:id/suppliers', requirePermission('products','read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const productId = parseInt(req.params.id);
  const orgId     = req.user.orgId;

  const rows = await pool.request()
    .input('product_id', sql.Int, productId)
    .input('org_id',     sql.Int, orgId)
    .query(`
      SELECT
        ps.id, ps.contact_id, ps.supplier_part_number,
        ps.lead_time_days, ps.min_order_qty, ps.order_multiple,
        ps.notes, ps.is_preferred, ps.is_active, ps.sort_order,
        ps.created_at,
        c.full_name   AS supplier_name,
        c.email       AS supplier_email,
        c.phone       AS supplier_phone,
        c.contact_number AS supplier_code
      FROM product_suppliers ps
      INNER JOIN contacts c ON c.id = ps.contact_id
      WHERE ps.product_id = @product_id
        AND ps.org_id     = @org_id
        AND ps.is_active  = 1
      ORDER BY ps.is_preferred DESC, ps.sort_order ASC, c.full_name ASC
    `);

  return res.json({ success: true, data: rows.recordset });
}));

// ── ADD ──────────────────────────────────────────────────────
router.post('/:id/suppliers', requirePermission('products','update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const productId = parseInt(req.params.id);
  const orgId     = req.user.orgId;

  const {
    contact_id, supplier_part_number, lead_time_days,
    min_order_qty, order_multiple, notes, is_preferred = false,
  } = req.body;

  if (!contact_id) return res.status(400).json({ success: false, error: 'contact_id is required.' });

  // If setting as preferred, clear existing preferred first
  if (is_preferred) {
    await pool.request()
      .input('product_id', sql.Int, productId)
      .input('org_id',     sql.Int, orgId)
      .query('UPDATE product_suppliers SET is_preferred=0 WHERE product_id=@product_id AND org_id=@org_id');
  }

  const countRes = await pool.request()
    .input('product_id', sql.Int, productId)
    .input('org_id',     sql.Int, orgId)
    .query('SELECT COUNT(*) AS n FROM product_suppliers WHERE product_id=@product_id AND org_id=@org_id');
  const sortOrder = countRes.recordset[0].n;

  const result = await pool.request()
    .input('org_id',               sql.Int,           orgId)
    .input('product_id',           sql.Int,           productId)
    .input('contact_id',           sql.Int,           parseInt(contact_id))
    .input('supplier_part_number', sql.NVarChar(100), supplier_part_number || null)
    .input('lead_time_days',       sql.Int,           lead_time_days != null ? parseInt(lead_time_days) : 0)
    .input('min_order_qty',        sql.Decimal(18,4), min_order_qty  != null ? parseFloat(min_order_qty) : 1)
    .input('order_multiple',       sql.Decimal(18,4), order_multiple != null ? parseFloat(order_multiple) : 1)
    .input('notes',                sql.NVarChar(sql.MAX), notes || null)
    .input('is_preferred',         sql.Bit,           is_preferred ? 1 : 0)
    .input('sort_order',           sql.Int,           sortOrder)
    .input('created_by',           sql.Int,           req.user.userId)
    .query(`
      INSERT INTO product_suppliers
        (org_id,product_id,contact_id,supplier_part_number,lead_time_days,min_order_qty,order_multiple,notes,is_preferred,is_active,sort_order,created_by)
      OUTPUT INSERTED.id
      VALUES
        (@org_id,@product_id,@contact_id,@supplier_part_number,@lead_time_days,@min_order_qty,@order_multiple,@notes,@is_preferred,1,@sort_order,@created_by)
    `);

  // Keep products.preferred_supplier_id in sync
  if (is_preferred) {
    await _syncPreferred(pool, sql, productId, parseInt(contact_id), supplier_part_number || null);
  }

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id } });
}));

// ── UPDATE ───────────────────────────────────────────────────
router.patch('/:id/suppliers/:suppId', requirePermission('products','update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const productId = parseInt(req.params.id);
  const suppId    = parseInt(req.params.suppId);
  const orgId     = req.user.orgId;

  const {
    supplier_part_number, lead_time_days, min_order_qty,
    order_multiple, notes,
  } = req.body;

  await pool.request()
    .input('id',                   sql.Int,           suppId)
    .input('product_id',           sql.Int,           productId)
    .input('org_id',               sql.Int,           orgId)
    .input('supplier_part_number', sql.NVarChar(100), supplier_part_number ?? null)
    .input('lead_time_days',       sql.Int,           lead_time_days  != null ? parseInt(lead_time_days)  : null)
    .input('min_order_qty',        sql.Decimal(18,4), min_order_qty   != null ? parseFloat(min_order_qty) : null)
    .input('order_multiple',       sql.Decimal(18,4), order_multiple  != null ? parseFloat(order_multiple): null)
    .input('notes',                sql.NVarChar(sql.MAX), notes ?? null)
    .query(`
      UPDATE product_suppliers SET
        supplier_part_number = COALESCE(@supplier_part_number, supplier_part_number),
        lead_time_days       = COALESCE(@lead_time_days,       lead_time_days),
        min_order_qty        = COALESCE(@min_order_qty,        min_order_qty),
        order_multiple       = COALESCE(@order_multiple,       order_multiple),
        notes                = COALESCE(@notes,                notes),
        updated_at           = GETDATE()
      WHERE id=@id AND product_id=@product_id AND org_id=@org_id
    `);

  // If this row is the preferred one, keep products table in sync
  const isPreferred = await pool.request()
    .input('id', sql.Int, suppId)
    .query('SELECT is_preferred, contact_id, supplier_part_number FROM product_suppliers WHERE id=@id');
  const row = isPreferred.recordset[0];
  if (row?.is_preferred) {
    await _syncPreferred(pool, sql, productId, row.contact_id, row.supplier_part_number);
  }

  return res.json({ success: true, message: 'Supplier updated.' });
}));

// ── SET PREFERRED ─────────────────────────────────────────────
router.patch('/:id/suppliers/:suppId/set-preferred', requirePermission('products','update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const productId = parseInt(req.params.id);
  const suppId    = parseInt(req.params.suppId);
  const orgId     = req.user.orgId;

  // Clear all is_preferred for this product
  await pool.request()
    .input('product_id', sql.Int, productId)
    .input('org_id',     sql.Int, orgId)
    .query('UPDATE product_suppliers SET is_preferred=0 WHERE product_id=@product_id AND org_id=@org_id');

  // Set the chosen one
  await pool.request()
    .input('id',         sql.Int, suppId)
    .input('product_id', sql.Int, productId)
    .query('UPDATE product_suppliers SET is_preferred=1, updated_at=GETDATE() WHERE id=@id AND product_id=@product_id');

  // Sync denormalized fields on products table
  const row = await pool.request()
    .input('id', sql.Int, suppId)
    .query('SELECT contact_id, supplier_part_number FROM product_suppliers WHERE id=@id');
  if (row.recordset[0]) {
    await _syncPreferred(pool, sql, productId, row.recordset[0].contact_id, row.recordset[0].supplier_part_number);
  }

  return res.json({ success: true, message: 'Default supplier updated.' });
}));

// ── DELETE ───────────────────────────────────────────────────
router.delete('/:id/suppliers/:suppId', requirePermission('products','update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const productId = parseInt(req.params.id);
  const suppId    = parseInt(req.params.suppId);
  const orgId     = req.user.orgId;

  // Soft-delete
  await pool.request()
    .input('id',         sql.Int, suppId)
    .input('product_id', sql.Int, productId)
    .input('org_id',     sql.Int, orgId)
    .query('UPDATE product_suppliers SET is_active=0, updated_at=GETDATE() WHERE id=@id AND product_id=@product_id AND org_id=@org_id');

  // If this was the preferred, clear denormalized field on products
  const wasPreferred = await pool.request()
    .input('id', sql.Int, suppId)
    .query('SELECT is_preferred FROM product_suppliers WHERE id=@id');
  if (wasPreferred.recordset[0]?.is_preferred) {
    await pool.request()
      .input('product_id', sql.Int, productId)
      .query('UPDATE products SET preferred_supplier_id=NULL, supplier_part_number=NULL WHERE id=@product_id');
  }

  return res.json({ success: true, message: 'Supplier removed.' });
}));

// ── Helper: keep products.preferred_supplier_id in sync ──────
async function _syncPreferred(pool, sql, productId, contactId, supplierPartNumber) {
  await pool.request()
    .input('id',                   sql.Int,          productId)
    .input('preferred_supplier_id',sql.Int,          contactId)
    .input('supplier_part_number', sql.NVarChar(100),supplierPartNumber || null)
    .query(`
      UPDATE products SET
        preferred_supplier_id = @preferred_supplier_id,
        supplier_part_number  = @supplier_part_number,
        updated_at            = GETDATE()
      WHERE id = @id
    `);
}

module.exports = router;
