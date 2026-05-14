'use strict';
// ============================================================
// routes/o2cSO.js  — Sales Orders
//
// GET    /api/o2c/so                       list
// POST   /api/o2c/so                       create (manual, no quote)
// GET    /api/o2c/so/:id                   detail + items + schedule lines + deliveries
// PATCH  /api/o2c/so/:id                   update header (draft)
// POST   /api/o2c/so/:id/items             add item (pricing + ATP)
// PATCH  /api/o2c/so/:id/items/:iid        update item
// DELETE /api/o2c/so/:id/items/:iid        remove item
// POST   /api/o2c/so/:id/confirm           run credit check + ATP + publish WMS task
// POST   /api/o2c/so/:id/release-hold      release credit hold (admin)
// POST   /api/o2c/so/:id/cancel            → cancelled + release allocations
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth }            = require('../middleware/auth');
const { asyncHandler }           = require('../middleware/errorHandler');
const { requirePermission }      = require('../middleware/permissions');
const { getNextNumber }          = require('../utils/numbering');
const { calculatePrice }         = require('../utils/pricingEngine');
const { runATP }                 = require('../utils/atpEngine');
const { checkCredit }            = require('../utils/creditEngine');
const { releaseAllocations }              = require('../utils/o2cEventPublisher');
const { generatePickingList }             = require('../utils/pickingEngine');

router.use(requireAuth);
const perm    = action => requirePermission('sales_orders', action);
const parseId = v => parseInt(v, 10);

async function getSO(id, orgId) {
  const r = await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query('SELECT * FROM sales_orders WHERE id=@id AND org_id=@org_id');
  return r.recordset[0] || null;
}

async function syncSOTotals(soId, pool) {
  await pool.request().input('id', sql.Int, soId).query(`
    UPDATE sales_orders
    SET subtotal    = (SELECT ISNULL(SUM(unit_price * qty_ordered), 0) FROM sales_order_items WHERE so_id=@id),
        tax_amount  = (SELECT ISNULL(SUM(tax_amount),               0) FROM sales_order_items WHERE so_id=@id),
        total_value = (SELECT ISNULL(SUM(line_total),               0) FROM sales_order_items WHERE so_id=@id),
        updated_at  = GETDATE()
    WHERE id=@id
  `);
}

// ── LIST ──────────────────────────────────────────────────────
router.get('/', perm('read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId  = req.user.orgId;
  const limit  = Math.min(200, parseInt(req.query.limit)  || 50);
  const offset = Math.max(0,   parseInt(req.query.offset) || 0);
  const status = req.query.status || null;
  const search = req.query.search ? `%${req.query.search}%` : null;

  const rows = await pool.request()
    .input('org_id',  sql.Int,           orgId)
    .input('limit',   sql.Int,           limit)
    .input('offset',  sql.Int,           offset)
    .input('status',  sql.VarChar(30),   status)
    .input('search',  sql.NVarChar(200), search)
    .query(`
      SELECT
        so.id, so.so_number, so.status, so.credit_status, so.total_value,
        so.requested_delivery_date, so.currency_code, so.created_at, so.updated_at,
        c.full_name AS customer_name,
        (SELECT COUNT(*) FROM sales_order_items soi WHERE soi.so_id = so.id) AS line_count,
        (SELECT COUNT(*) FROM outbound_deliveries od WHERE od.so_id = so.id) AS delivery_count,
        COUNT(*) OVER() AS total_count
      FROM sales_orders so
      JOIN contacts c ON c.id = so.customer_id
      WHERE so.org_id = @org_id
        AND (@status IS NULL OR so.status = @status)
        AND (@search IS NULL OR so.so_number LIKE @search OR c.full_name LIKE @search)
      ORDER BY so.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

  res.json({ success: true, data: rows.recordset, meta: { total: rows.recordset[0]?.total_count ?? 0, limit, offset } });
}));

// ── CREATE (manual) ───────────────────────────────────────────
router.post('/', perm('write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const { customer_id, warehouse_id, price_list_id, currency_code, payment_terms, requested_delivery_date, notes, is_full_delivery_required } = req.body;
  if (!customer_id) return res.status(400).json({ success: false, error: 'customer_id is required.' });

  const { number } = await getNextNumber('sales_order', orgId, pool, sql);

  const r = await pool.request()
    .input('org_id',                  sql.Int,           orgId)
    .input('so_number',               sql.NVarChar(50),  number)
    .input('customer_id',             sql.Int,           customer_id)
    .input('warehouse_id',            sql.Int,           warehouse_id  || null)
    .input('price_list_id',           sql.Int,           price_list_id || null)
    .input('currency_code',               sql.VarChar(3),    currency_code || 'AUD')
    .input('payment_terms',               sql.NVarChar(100), payment_terms || null)
    .input('requested_delivery_date',     sql.Date,          requested_delivery_date ? new Date(requested_delivery_date) : null)
    .input('notes',                       sql.NVarChar(1000), notes || null)
    .input('is_full_delivery_required',   sql.Bit,           is_full_delivery_required ? 1 : 0)
    .input('created_by',                  sql.Int,           req.user.userId)
    .query(`
      DECLARE @out TABLE (id INT);
      INSERT INTO sales_orders
        (org_id, so_number, status, customer_id, warehouse_id, price_list_id, currency_code,
         payment_terms, requested_delivery_date, notes, is_full_delivery_required,
         created_by, created_at, updated_at)
      OUTPUT INSERTED.id INTO @out
      VALUES (@org_id, @so_number, 'draft', @customer_id, @warehouse_id, @price_list_id,
              @currency_code, @payment_terms, @requested_delivery_date, @notes,
              @is_full_delivery_required, @created_by, GETDATE(), GETDATE());
      SELECT id FROM @out;
    `);

  res.status(201).json({ success: true, data: { id: r.recordset[0].id, so_number: number } });
}));

// ── DETAIL ────────────────────────────────────────────────────
router.get('/:id', perm('read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);

  const [soRes, itemsRes, schedRes, delivRes] = await Promise.all([
    pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId).query(`
      SELECT so.*, c.full_name AS customer_name, c.credit_limit, c.credit_hold,
             q.quote_number, pl.name AS price_list_name, u.full_name AS confirmed_by_name
      FROM sales_orders so
      JOIN contacts c ON c.id = so.customer_id
      LEFT JOIN customer_quotes q ON q.id = so.quote_id
      LEFT JOIN price_lists pl ON pl.id = so.price_list_id
      LEFT JOIN users u ON u.id = so.confirmed_by
      WHERE so.id=@id AND so.org_id=@org_id
    `),
    pool.request().input('so_id', sql.Int, id).query(`
      SELECT soi.*, p.name AS product_name, p.product_code, uom.code AS uom_code,
             w.name AS warehouse_name
      FROM sales_order_items soi
      JOIN products p ON p.id = soi.product_id
      LEFT JOIN units_of_measure uom ON uom.id = p.base_uom_id
      LEFT JOIN warehouses w ON w.id = soi.warehouse_id
      WHERE soi.so_id=@so_id ORDER BY soi.line_number
    `),
    pool.request().input('so_id', sql.Int, id).query(`
      SELECT sl.*, soi.line_number, p.name AS product_name
      FROM sales_order_schedule_lines sl
      JOIN sales_order_items soi ON soi.id = sl.so_item_id
      JOIN products p ON p.id = soi.product_id
      WHERE sl.so_id=@so_id ORDER BY soi.line_number, sl.schedule_line_no
    `),
    pool.request().input('so_id', sql.Int, id).query(`
      SELECT od.id, od.delivery_number, od.status, od.planned_ship_date,
             od.actual_ship_date, od.tracking_number,
             (SELECT COUNT(*) FROM outbound_delivery_items odi WHERE odi.delivery_id = od.id) AS item_count
      FROM outbound_deliveries od WHERE od.so_id=@so_id ORDER BY od.created_at
    `),
  ]);

  if (!soRes.recordset.length) return res.status(404).json({ success: false, error: 'Sales Order not found.' });

  // Attach schedule lines to their SO items
  const items = itemsRes.recordset.map(item => ({
    ...item,
    schedule_lines: schedRes.recordset.filter(s => s.so_item_id === item.id),
  }));

  res.json({
    success: true,
    data: { ...soRes.recordset[0], items, deliveries: delivRes.recordset },
  });
}));

// ── UPDATE HEADER ─────────────────────────────────────────────
router.patch('/:id', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const so    = await getSO(id, orgId);
  if (!so) return res.status(404).json({ success: false, error: 'Sales Order not found.' });
  if (['cancelled','shipped','invoiced'].includes(so.status)) return res.status(409).json({ success: false, error: `Cannot edit a ${so.status} SO.` });

  const { warehouse_id, payment_terms, requested_delivery_date, notes, is_full_delivery_required, cascade_to_lines, cascade_warehouse_to_lines } = req.body;
  const isDraft    = ['draft','credit_hold'].includes(so.status);
  const isTerminal = ['shipped','invoiced','cancelled'].includes(so.status);

  await pool.request()
    .input('id',                          sql.Int,           id)
    .input('org_id',                      sql.Int,           orgId)
    .input('warehouse_id',                sql.Int,           !isTerminal && warehouse_id != null ? Number(warehouse_id) : null)
    .input('payment_terms',               sql.NVarChar(100), isDraft ? (payment_terms ?? null) : null)
    .input('requested_delivery_date',     sql.Date,          requested_delivery_date ? new Date(requested_delivery_date) : null)
    .input('notes',                       sql.NVarChar(1000), isDraft ? (notes ?? null) : null)
    .input('is_full_delivery_required',   sql.Bit,           is_full_delivery_required != null ? (is_full_delivery_required ? 1 : 0) : null)
    .query(`
      UPDATE sales_orders
      SET warehouse_id              = CASE WHEN @warehouse_id IS NOT NULL THEN @warehouse_id ELSE warehouse_id END,
          payment_terms             = CASE WHEN @payment_terms IS NOT NULL THEN @payment_terms ELSE payment_terms END,
          requested_delivery_date   = CASE WHEN @requested_delivery_date IS NOT NULL THEN @requested_delivery_date ELSE requested_delivery_date END,
          notes                     = CASE WHEN @notes IS NOT NULL THEN @notes ELSE notes END,
          is_full_delivery_required = CASE WHEN @is_full_delivery_required IS NOT NULL THEN @is_full_delivery_required ELSE is_full_delivery_required END,
          updated_at                = GETDATE()
      WHERE id=@id AND org_id=@org_id
    `);

  if (cascade_to_lines && requested_delivery_date) {
    await pool.request()
      .input('so_id', sql.Int,  id)
      .input('date',  sql.Date, new Date(requested_delivery_date))
      .query(`
        UPDATE sales_order_items
        SET requested_delivery_date = @date
        WHERE so_id = @so_id
          AND line_status = 'open'
          AND (qty_ordered - ISNULL(qty_shipped, 0)) > 0
      `);
  }

  if (cascade_warehouse_to_lines && warehouse_id) {
    await pool.request()
      .input('so_id', sql.Int, id)
      .input('wh',    sql.Int, Number(warehouse_id))
      .query(`
        UPDATE sales_order_items
        SET warehouse_id = @wh
        WHERE so_id = @so_id
          AND line_status = 'open'
          AND (qty_ordered - ISNULL(qty_shipped, 0)) > 0
      `);
  }

  res.json({ success: true });
}));

// ── ADD ITEM ──────────────────────────────────────────────────
router.post('/:id/items', perm('write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const soId  = parseId(req.params.id);
  const so    = await getSO(soId, orgId);
  if (!so) return res.status(404).json({ success: false, error: 'Sales Order not found.' });
  if (!['draft','credit_hold'].includes(so.status)) return res.status(409).json({ success: false, error: 'Cannot add items to this SO.' });

  const { product_id, qty_ordered, warehouse_id, requested_delivery_date, notes } = req.body;
  if (!product_id || !qty_ordered) return res.status(400).json({ success: false, error: 'product_id and qty_ordered required.' });

  const custRes = await pool.request().input('id', sql.Int, so.customer_id)
    .query('SELECT gst_registered FROM contacts WHERE id=@id');
  const gst = !!custRes.recordset[0]?.gst_registered;

  const pricing = await calculatePrice({
    orgId, productId: product_id, customerId: so.customer_id,
    priceListId: so.price_list_id, qty: qty_ordered, customerGstRegistered: gst, pool, sql,
  });

  const lnRes = await pool.request().input('so_id', sql.Int, soId)
    .query('SELECT ISNULL(MAX(line_number),0)+1 AS next_line FROM sales_order_items WHERE so_id=@so_id');
  const lineNumber = lnRes.recordset[0].next_line;

  const r = await pool.request()
    .input('so_id',                   sql.Int,           soId)
    .input('org_id',                  sql.Int,           orgId)
    .input('line_number',             sql.Int,           lineNumber)
    .input('product_id',              sql.Int,           product_id)
    .input('warehouse_id',            sql.Int,           warehouse_id || so.warehouse_id || null)
    .input('qty_ordered',             sql.Decimal(18,4), Number(qty_ordered))
    .input('base_price',              sql.Decimal(18,4), pricing.basePrice)
    .input('customer_discount_pct',   sql.Decimal(5,2),  pricing.customerDiscountPct)
    .input('volume_discount_pct',     sql.Decimal(5,2),  pricing.volumeDiscountPct)
    .input('unit_price',              sql.Decimal(18,4), pricing.unitPrice)
    .input('tax_rate',                sql.Decimal(5,2),  pricing.taxRate)
    .input('tax_amount',              sql.Decimal(18,4), pricing.taxAmount)
    .input('line_total',              sql.Decimal(18,4), pricing.lineTotal)
    .input('requested_delivery_date', sql.Date,          requested_delivery_date ? new Date(requested_delivery_date) : null)
    .input('notes',                   sql.NVarChar(500), notes || null)
    .query(`
      DECLARE @out TABLE (id INT);
      INSERT INTO sales_order_items
        (so_id, org_id, line_number, product_id, warehouse_id, qty_ordered,
         base_price, customer_discount_pct, volume_discount_pct, unit_price,
         tax_rate, tax_amount, line_total, atp_status, requested_delivery_date, notes)
      OUTPUT INSERTED.id INTO @out
      VALUES (@so_id, @org_id, @line_number, @product_id, @warehouse_id, @qty_ordered,
              @base_price, @customer_discount_pct, @volume_discount_pct, @unit_price,
              @tax_rate, @tax_amount, @line_total, 'pending', @requested_delivery_date, @notes);
      SELECT id FROM @out;
    `);

  await syncSOTotals(soId, pool);
  res.status(201).json({ success: true, data: { id: r.recordset[0].id, pricing } });
}));

// ── UPDATE ITEM ───────────────────────────────────────────────
router.patch('/:id/items/:iid', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId  = req.user.orgId;
  const soId   = parseId(req.params.id);
  const itemId = parseId(req.params.iid);
  const so     = await getSO(soId, orgId);
  if (!so) return res.status(404).json({ success: false, error: 'SO not found.' });
  if (['shipped','invoiced','cancelled'].includes(so.status))
    return res.status(409).json({ success: false, error: `Cannot edit items on a ${so.status} SO.` });

  const { qty_ordered, notes, requested_delivery_date, line_status, warehouse_id } = req.body;
  const isDraftOrHold = ['draft','credit_hold'].includes(so.status);
  let totalsChanged = false;

  // ── qty_ordered: draft / credit_hold only ─────────────────────
  if (qty_ordered != null) {
    if (!isDraftOrHold)
      return res.status(409).json({ success: false, error: 'Cannot change qty on a confirmed SO.' });
    const itemRes = await pool.request().input('id', sql.Int, itemId).input('so_id', sql.Int, soId)
      .query('SELECT * FROM sales_order_items WHERE id=@id AND so_id=@so_id');
    if (!itemRes.recordset.length) return res.status(404).json({ success: false, error: 'Item not found.' });
    const item = itemRes.recordset[0];
    const custRes = await pool.request().input('id', sql.Int, so.customer_id)
      .query('SELECT gst_registered FROM contacts WHERE id=@id');
    const gst = !!custRes.recordset[0]?.gst_registered;
    const pricing = await calculatePrice({
      orgId, productId: item.product_id, customerId: so.customer_id,
      priceListId: so.price_list_id, qty: qty_ordered, customerGstRegistered: gst, pool, sql,
    });
    await pool.request()
      .input('id',                    sql.Int,           itemId)
      .input('so_id',                 sql.Int,           soId)
      .input('qty_ordered',           sql.Decimal(18,4), Number(qty_ordered))
      .input('base_price',            sql.Decimal(18,4), pricing.basePrice)
      .input('customer_discount_pct', sql.Decimal(5,2),  pricing.customerDiscountPct)
      .input('volume_discount_pct',   sql.Decimal(5,2),  pricing.volumeDiscountPct)
      .input('unit_price',            sql.Decimal(18,4), pricing.unitPrice)
      .input('tax_rate',              sql.Decimal(5,2),  pricing.taxRate)
      .input('tax_amount',            sql.Decimal(18,4), pricing.taxAmount)
      .input('line_total',            sql.Decimal(18,4), pricing.lineTotal)
      .input('notes',                 sql.NVarChar(500), notes ?? null)
      .query(`
        UPDATE sales_order_items
        SET qty_ordered=@qty_ordered, base_price=@base_price,
            customer_discount_pct=@customer_discount_pct, volume_discount_pct=@volume_discount_pct,
            unit_price=@unit_price, tax_rate=@tax_rate, tax_amount=@tax_amount,
            line_total=@line_total, notes=COALESCE(@notes, notes)
        WHERE id=@id AND so_id=@so_id
      `);
    totalsChanged = true;
  }

  // ── notes only ─────────────────────────────────────────────────
  if (qty_ordered == null && notes != null) {
    await pool.request().input('id', sql.Int, itemId).input('so_id', sql.Int, soId)
      .input('notes', sql.NVarChar(500), notes)
      .query('UPDATE sales_order_items SET notes=@notes WHERE id=@id AND so_id=@so_id');
  }

  // ── requested_delivery_date: any non-terminal SO ──────────────
  if (requested_delivery_date !== undefined) {
    await pool.request()
      .input('id',    sql.Int,  itemId)
      .input('so_id', sql.Int,  soId)
      .input('date',  sql.Date, requested_delivery_date ? new Date(requested_delivery_date) : null)
      .query('UPDATE sales_order_items SET requested_delivery_date=@date WHERE id=@id AND so_id=@so_id');
  }

  // ── line_status: open ↔ closed ────────────────────────────────
  if (line_status != null) {
    if (!['open','closed'].includes(line_status))
      return res.status(400).json({ success: false, error: 'line_status must be open or closed.' });
    await pool.request().input('id', sql.Int, itemId).input('so_id', sql.Int, soId)
      .input('status', sql.VarChar(20), line_status)
      .query('UPDATE sales_order_items SET line_status=@status WHERE id=@id AND so_id=@so_id');

    if (line_status === 'closed') {
      // Release soft allocations for available schedule lines on this item
      const schedRes = await pool.request()
        .input('item_id', sql.Int, itemId)
        .query(`
          SELECT sl.id, sl.qty, soi.product_id,
                 COALESCE(soi.warehouse_id, so.warehouse_id) AS warehouse_id
          FROM sales_order_schedule_lines sl
          JOIN sales_order_items soi ON soi.id = sl.so_item_id
          JOIN sales_orders so ON so.id = soi.so_id
          WHERE sl.so_item_id = @item_id
            AND sl.atp_category = 'available'
            AND sl.status IN ('open','picking')
        `);
      for (const sched of schedRes.recordset) {
        if (!sched.warehouse_id) continue;
        await pool.request()
          .input('org_id',      sql.Int,           orgId)
          .input('product_id',  sql.Int,           sched.product_id)
          .input('warehouse_id',sql.Int,           sched.warehouse_id)
          .input('qty',         sql.Decimal(18,4), Number(sched.qty))
          .query(`
            UPDATE stock_levels
            SET soft_allocated = CASE WHEN soft_allocated >= @qty THEN soft_allocated - @qty ELSE 0 END,
                updated_at = GETDATE()
            WHERE org_id=@org_id AND product_id=@product_id AND warehouse_id=@warehouse_id
          `);
      }
      await pool.request().input('item_id', sql.Int, itemId).query(`
        UPDATE outbound_delivery_items SET status='cancelled'
        WHERE schedule_line_id IN (
          SELECT id FROM sales_order_schedule_lines WHERE so_item_id=@item_id AND status IN ('open','picking')
        )
      `);
      await pool.request().input('item_id', sql.Int, itemId).query(
        `UPDATE sales_order_schedule_lines SET status='cancelled' WHERE so_item_id=@item_id AND status IN ('open','picking')`
      );
    }
  }

  // ── warehouse_id: any non-terminal SO ────────────────────────
  if (warehouse_id !== undefined) {
    await pool.request()
      .input('id',    sql.Int, itemId)
      .input('so_id', sql.Int, soId)
      .input('wh_id', sql.Int, warehouse_id ? Number(warehouse_id) : null)
      .query('UPDATE sales_order_items SET warehouse_id=@wh_id WHERE id=@id AND so_id=@so_id');
  }

  if (totalsChanged) await syncSOTotals(soId, pool);
  res.json({ success: true });
}));

// ── REMOVE ITEM ───────────────────────────────────────────────
router.delete('/:id/items/:iid', perm('delete'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId  = req.user.orgId;
  const soId   = parseId(req.params.id);
  const itemId = parseId(req.params.iid);
  const so     = await getSO(soId, orgId);
  if (!so) return res.status(404).json({ success: false, error: 'SO not found.' });
  if (!['draft','credit_hold'].includes(so.status)) return res.status(409).json({ success: false, error: 'Cannot remove items from a confirmed SO.' });
  await pool.request().input('id', sql.Int, itemId).input('so_id', sql.Int, soId)
    .query('DELETE FROM sales_order_items WHERE id=@id AND so_id=@so_id');
  await syncSOTotals(soId, pool);
  res.json({ success: true });
}));

// ── CONFIRM — credit check + ATP + WMS event ──────────────────
router.post('/:id/confirm', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const so    = await getSO(id, orgId);
  if (!so) return res.status(404).json({ success: false, error: 'SO not found.' });
  if (!['draft','credit_hold'].includes(so.status)) return res.status(409).json({ success: false, error: `SO is already ${so.status}.` });

  const items = await pool.request().input('so_id', sql.Int, id)
    .query('SELECT * FROM sales_order_items WHERE so_id=@so_id');
  if (!items.recordset.length) return res.status(400).json({ success: false, error: 'Add at least one item before confirming.' });

  // ── Credit Check ───────────────────────────────────────────
  const credit = await checkCredit({ orgId, customerId: so.customer_id, newOrderTotal: Number(so.total_value), pool, sql });

  if (!credit.passed) {
    await pool.request()
      .input('id',                sql.Int,          id)
      .input('org_id',            sql.Int,          orgId)
      .input('credit_status',     sql.VarChar(20),  credit.status)
      .input('credit_hold_reason',sql.NVarChar(500), credit.reason)
      .query(`
        UPDATE sales_orders
        SET status='credit_hold', credit_status=@credit_status,
            credit_hold_reason=@credit_hold_reason, updated_at=GETDATE()
        WHERE id=@id AND org_id=@org_id
      `);
    return res.status(402).json({ success: false, credit_hold: true, status: credit.status, reason: credit.reason });
  }

  // Resolve default warehouse once for the whole SO confirmation
  let defaultWhId = so.warehouse_id;
  if (!defaultWhId) {
    const whRes = await pool.request().input('org_id', sql.Int, orgId)
      .query(`SELECT TOP 1 id FROM warehouses WHERE org_id=@org_id AND is_active=1 ORDER BY id ASC`);
    defaultWhId = whRes.recordset[0]?.id || null;
  }

  // ── ATP per line item ──────────────────────────────────────
  const allScheduleLines = [];
  for (const item of items.recordset) {
    if (item.line_status === 'closed' || item.line_status === 'cancelled') continue;
    const wh  = item.warehouse_id || defaultWhId;
    const rdd = item.requested_delivery_date || so.requested_delivery_date || null;
    const atp = await runATP({ productId: item.product_id, warehouseId: wh, orgId, qtyRequested: item.qty_ordered, requestedDeliveryDate: rdd, pool, sql });

    // Delete any old schedule lines (re-confirm case)
    await pool.request().input('so_item_id', sql.Int, item.id)
      .query('DELETE FROM sales_order_schedule_lines WHERE so_item_id=@so_item_id AND status=\'open\'');

    // Insert new schedule lines
    for (const sl of atp.scheduleLines) {
      await pool.request()
        .input('so_item_id',       sql.Int,           item.id)
        .input('so_id',            sql.Int,           id)
        .input('org_id',           sql.Int,           orgId)
        .input('schedule_line_no', sql.Int,           sl.schedule_line_no)
        .input('qty',              sql.Decimal(18,4), Number(sl.qty))
        .input('confirmed_date',   sql.Date,          sl.confirmed_date ? new Date(sl.confirmed_date) : new Date())
        .input('atp_category',     sql.VarChar(20),   sl.atp_category)
        .input('source_type',      sql.VarChar(20),   sl.source_type || null)
        .input('source_po_id',     sql.Int,           sl.source_po_id || null)
        .query(`
          INSERT INTO sales_order_schedule_lines
            (so_item_id, so_id, org_id, schedule_line_no, qty, confirmed_date, atp_category, source_type, source_po_id, status, created_at)
          VALUES (@so_item_id, @so_id, @org_id, @schedule_line_no, @qty, @confirmed_date, @atp_category, @source_type, @source_po_id, 'open', GETDATE())
        `);
    }

    // Update item ATP status + qty_scheduled
    const qtyScheduled = atp.scheduleLines.reduce((s, l) => s + Number(l.qty), 0);
    await pool.request()
      .input('id',            sql.Int,           item.id)
      .input('atp_status',    sql.VarChar(20),   atp.atpStatus)
      .input('qty_scheduled', sql.Decimal(18,4), qtyScheduled)
      .query(`UPDATE sales_order_items SET atp_status=@atp_status, qty_scheduled=@qty_scheduled WHERE id=@id`);

    allScheduleLines.push(...atp.scheduleLines.map(s => ({ ...s, so_item_id: item.id })));
  }

  // ── Confirm SO ────────────────────────────────────────────
  await pool.request()
    .input('id',          sql.Int,      id)
    .input('org_id',      sql.Int,      orgId)
    .input('confirmed_by',sql.Int,      req.user.userId)
    .query(`
      UPDATE sales_orders
      SET status='confirmed', credit_status='ok', credit_hold_reason=NULL,
          confirmed_at=GETDATE(), confirmed_by=@confirmed_by, updated_at=GETDATE()
      WHERE id=@id AND org_id=@org_id
    `);

  // ── Generate picking list (respects full/partial delivery flag) ─
  const pickResult = await generatePickingList({ soId: id, orgId, pool, sql });

  res.json({
    success: true,
    data: {
      status:          'confirmed',
      credit_status:   'ok',
      schedule_lines:  allScheduleLines,
      delivery_id:     pickResult.deliveryId,
      delivery_number: pickResult.deliveryNumber,
      picking_blocked: pickResult.blocked,
      picking_reason:  pickResult.reason,
    },
  });
}));

// ── RELEASE CREDIT HOLD ────────────────────────────────────────
router.post('/:id/release-hold', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const so    = await getSO(id, orgId);
  if (!so) return res.status(404).json({ success: false, error: 'SO not found.' });
  if (so.status !== 'credit_hold') return res.status(409).json({ success: false, error: 'SO is not on credit hold.' });

  // Manually override — re-confirm without credit check
  await pool.request()
    .input('id',          sql.Int, id)
    .input('org_id',      sql.Int, orgId)
    .input('confirmed_by',sql.Int, req.user.userId)
    .query(`
      UPDATE sales_orders
      SET status='confirmed', credit_status='ok', credit_hold_reason='Manually released',
          confirmed_at=GETDATE(), confirmed_by=@confirmed_by, updated_at=GETDATE()
      WHERE id=@id AND org_id=@org_id
    `);

  // Re-run ATP and publish picking task
  const items = await pool.request().input('so_id', sql.Int, id)
    .query('SELECT * FROM sales_order_items WHERE so_id=@so_id');

  for (const item of items.recordset) {
    const wh  = item.warehouse_id || so.warehouse_id;
    const rdd = item.requested_delivery_date || so.requested_delivery_date || null;
    const atp = await runATP({ productId: item.product_id, warehouseId: wh, orgId, qtyRequested: item.qty_ordered, requestedDeliveryDate: rdd, pool, sql });
    await pool.request().input('so_item_id', sql.Int, item.id)
      .query('DELETE FROM sales_order_schedule_lines WHERE so_item_id=@so_item_id AND status=\'open\'');
    for (const sl of atp.scheduleLines) {
      await pool.request()
        .input('so_item_id',       sql.Int,           item.id)
        .input('so_id',            sql.Int,           id)
        .input('org_id',           sql.Int,           orgId)
        .input('schedule_line_no', sql.Int,           sl.schedule_line_no)
        .input('qty',              sql.Decimal(18,4), Number(sl.qty))
        .input('confirmed_date',   sql.Date,          sl.confirmed_date ? new Date(sl.confirmed_date) : new Date())
        .input('atp_category',     sql.VarChar(20),   sl.atp_category)
        .input('source_type',      sql.VarChar(20),   sl.source_type || null)
        .input('source_po_id',     sql.Int,           sl.source_po_id || null)
        .query(`
          INSERT INTO sales_order_schedule_lines
            (so_item_id, so_id, org_id, schedule_line_no, qty, confirmed_date, atp_category, source_type, source_po_id, status, created_at)
          VALUES (@so_item_id, @so_id, @org_id, @schedule_line_no, @qty, @confirmed_date, @atp_category, @source_type, @source_po_id, 'open', GETDATE())
        `);
    }
    await pool.request().input('id', sql.Int, item.id)
      .input('atp_status', sql.VarChar(20), atp.atpStatus)
      .query(`UPDATE sales_order_items SET atp_status=@atp_status WHERE id=@id`);
  }

  const pickResult = await generatePickingList({ soId: id, orgId, pool, sql });
  res.json({ success: true, data: { status: 'confirmed', delivery_id: pickResult.deliveryId, delivery_number: pickResult.deliveryNumber, picking_blocked: pickResult.blocked } });
}));

// ── CANCEL ────────────────────────────────────────────────────
router.post('/:id/cancel', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const so    = await getSO(id, orgId);
  if (!so) return res.status(404).json({ success: false, error: 'SO not found.' });
  if (['shipped','invoiced','cancelled'].includes(so.status)) return res.status(409).json({ success: false, error: `Cannot cancel a ${so.status} SO.` });

  // Release soft allocations + cancel outbound deliveries
  await releaseAllocations({ soId: id, orgId, pool, sql });

  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query(`UPDATE sales_orders SET status='cancelled', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);
  res.json({ success: true });
}));

module.exports = router;
