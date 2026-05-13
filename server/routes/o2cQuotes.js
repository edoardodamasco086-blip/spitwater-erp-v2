'use strict';
// ============================================================
// routes/o2cQuotes.js  — Customer Quotes
//
// GET    /api/o2c/quotes                  list
// POST   /api/o2c/quotes                  create draft
// GET    /api/o2c/quotes/:id              detail + items
// PATCH  /api/o2c/quotes/:id              update header (draft)
// POST   /api/o2c/quotes/:id/items        add item (runs pricing engine)
// PATCH  /api/o2c/quotes/:id/items/:iid   update item qty/price
// DELETE /api/o2c/quotes/:id/items/:iid   remove item
// POST   /api/o2c/quotes/:id/send         draft → sent
// POST   /api/o2c/quotes/:id/accept       sent → accepted
// POST   /api/o2c/quotes/:id/reject       sent → rejected
// POST   /api/o2c/quotes/:id/convert      accepted → creates Sales Order
// POST   /api/o2c/quotes/:id/cancel       → expired/cancelled
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth }            = require('../middleware/auth');
const { asyncHandler }           = require('../middleware/errorHandler');
const { requirePermission }      = require('../middleware/permissions');
const { getNextNumber }          = require('../utils/numbering');
const { calculatePrice, calcHeaderTotals } = require('../utils/pricingEngine');
const { runATP }                 = require('../utils/atpEngine');

router.use(requireAuth);
const perm = action => requirePermission('customer_quotes', action);
const parseId = v => parseInt(v, 10);

async function getQuote(id, orgId) {
  const r = await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query('SELECT * FROM customer_quotes WHERE id=@id AND org_id=@org_id');
  return r.recordset[0] || null;
}

async function syncQuoteTotals(quoteId, pool) {
  await pool.request().input('id', sql.Int, quoteId).query(`
    UPDATE customer_quotes
    SET subtotal   = (SELECT ISNULL(SUM(unit_price * qty_requested), 0) FROM customer_quote_items WHERE quote_id = @id),
        tax_amount = (SELECT ISNULL(SUM(tax_amount),                 0) FROM customer_quote_items WHERE quote_id = @id),
        total_value= (SELECT ISNULL(SUM(line_total),                 0) FROM customer_quote_items WHERE quote_id = @id),
        updated_at = GETDATE()
    WHERE id = @id
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
    .input('org_id',  sql.Int,          orgId)
    .input('limit',   sql.Int,          limit)
    .input('offset',  sql.Int,          offset)
    .input('status',  sql.VarChar(20),  status)
    .input('search',  sql.NVarChar(200), search)
    .query(`
      SELECT
        q.id, q.quote_number, q.status, q.total_value, q.validity_date,
        q.currency_code, q.created_at, q.updated_at,
        c.full_name AS customer_name,
        (SELECT COUNT(*) FROM customer_quote_items qi WHERE qi.quote_id = q.id) AS item_count,
        COUNT(*) OVER() AS total_count
      FROM customer_quotes q
      JOIN contacts c ON c.id = q.customer_id
      WHERE q.org_id = @org_id
        AND (@status IS NULL OR q.status = @status)
        AND (@search IS NULL OR q.quote_number LIKE @search OR c.full_name LIKE @search)
      ORDER BY q.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

  res.json({ success: true, data: rows.recordset, meta: { total: rows.recordset[0]?.total_count ?? 0, limit, offset } });
}));

// ── CREATE ────────────────────────────────────────────────────
router.post('/', perm('write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const { customer_id, warehouse_id, price_list_id, currency_code, payment_terms, validity_date, notes } = req.body;
  if (!customer_id) return res.status(400).json({ success: false, error: 'customer_id is required.' });

  const { number } = await getNextNumber('quote', orgId, pool, sql);

  const r = await pool.request()
    .input('org_id',        sql.Int,           orgId)
    .input('quote_number',  sql.NVarChar(50),  number)
    .input('customer_id',   sql.Int,           customer_id)
    .input('warehouse_id',  sql.Int,           warehouse_id  || null)
    .input('price_list_id', sql.Int,           price_list_id || null)
    .input('currency_code', sql.VarChar(3),    currency_code || 'AUD')
    .input('payment_terms', sql.NVarChar(100), payment_terms || null)
    .input('validity_date', sql.Date,          validity_date ? new Date(validity_date) : null)
    .input('notes',         sql.NVarChar(1000), notes || null)
    .input('created_by',    sql.Int,           req.user.userId)
    .query(`
      DECLARE @out TABLE (id INT);
      INSERT INTO customer_quotes
        (org_id, quote_number, status, customer_id, warehouse_id, price_list_id, currency_code, payment_terms, validity_date, notes, created_by, created_at, updated_at)
      OUTPUT INSERTED.id INTO @out
      VALUES (@org_id, @quote_number, 'draft', @customer_id, @warehouse_id, @price_list_id, @currency_code, @payment_terms, @validity_date, @notes, @created_by, GETDATE(), GETDATE());
      SELECT id FROM @out;
    `);

  res.status(201).json({ success: true, data: { id: r.recordset[0].id, quote_number: number } });
}));

// ── DETAIL ────────────────────────────────────────────────────
router.get('/:id', perm('read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);

  const [qRes, itemsRes] = await Promise.all([
    pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId).query(`
      SELECT q.*, c.full_name AS customer_name, c.credit_limit, c.credit_hold,
             pl.name AS price_list_name
      FROM customer_quotes q
      JOIN contacts c ON c.id = q.customer_id
      LEFT JOIN price_lists pl ON pl.id = q.price_list_id
      WHERE q.id=@id AND q.org_id=@org_id
    `),
    pool.request().input('quote_id', sql.Int, id).query(`
      SELECT qi.*, p.name AS product_name, p.product_code, uom.code AS uom_code
      FROM customer_quote_items qi
      JOIN products p ON p.id = qi.product_id
      LEFT JOIN units_of_measure uom ON uom.id = p.base_uom_id
      WHERE qi.quote_id = @quote_id
      ORDER BY qi.line_number
    `),
  ]);

  if (!qRes.recordset.length) return res.status(404).json({ success: false, error: 'Quote not found.' });
  res.json({ success: true, data: { ...qRes.recordset[0], items: itemsRes.recordset } });
}));

// ── UPDATE HEADER ─────────────────────────────────────────────
router.patch('/:id', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const q     = await getQuote(id, orgId);
  if (!q) return res.status(404).json({ success: false, error: 'Quote not found.' });
  if (!['draft','sent'].includes(q.status)) return res.status(409).json({ success: false, error: 'Quote cannot be edited in its current status.' });

  const { warehouse_id, price_list_id, payment_terms, validity_date, notes } = req.body;
  await pool.request()
    .input('id',            sql.Int,           id)
    .input('org_id',        sql.Int,           orgId)
    .input('warehouse_id',  sql.Int,           warehouse_id  ?? null)
    .input('price_list_id', sql.Int,           price_list_id ?? null)
    .input('payment_terms', sql.NVarChar(100), payment_terms ?? null)
    .input('validity_date', sql.Date,          validity_date ? new Date(validity_date) : null)
    .input('notes',         sql.NVarChar(1000), notes        ?? null)
    .query(`
      UPDATE customer_quotes
      SET warehouse_id  = COALESCE(@warehouse_id,  warehouse_id),
          price_list_id = COALESCE(@price_list_id, price_list_id),
          payment_terms = COALESCE(@payment_terms, payment_terms),
          validity_date = COALESCE(@validity_date, validity_date),
          notes         = COALESCE(@notes,         notes),
          updated_at    = GETDATE()
      WHERE id=@id AND org_id=@org_id
    `);
  res.json({ success: true });
}));

// ── ADD ITEM (runs pricing engine + ATP preview) ───────────────
router.post('/:id/items', perm('write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId   = req.user.orgId;
  const quoteId = parseId(req.params.id);
  const q       = await getQuote(quoteId, orgId);
  if (!q) return res.status(404).json({ success: false, error: 'Quote not found.' });
  if (!['draft','sent'].includes(q.status)) return res.status(409).json({ success: false, error: 'Cannot add items to this quote.' });

  const { product_id, qty_requested, warehouse_id, notes } = req.body;
  if (!product_id || !qty_requested) return res.status(400).json({ success: false, error: 'product_id and qty_requested required.' });

  // Fetch customer GST flag
  const custRes = await pool.request()
    .input('id', sql.Int, q.customer_id)
    .query('SELECT is_gst_registered FROM contacts WHERE id=@id');
  const customerGstRegistered = !!custRes.recordset[0]?.is_gst_registered;

  // Pricing engine
  const pricing = await calculatePrice({
    orgId, productId: product_id, customerId: q.customer_id,
    priceListId: q.price_list_id, qty: qty_requested,
    customerGstRegistered, pool, sql,
  });

  // ATP preview (non-blocking for quotes)
  const wh = warehouse_id || q.warehouse_id;
  const atp = wh
    ? await runATP({ productId: product_id, warehouseId: wh, orgId, qtyRequested: qty_requested, pool, sql })
    : { available: null, atpStatus: 'unknown', atpDate: null };

  // Get next line number
  const lnRes = await pool.request().input('quote_id', sql.Int, quoteId)
    .query('SELECT ISNULL(MAX(line_number),0)+1 AS next_line FROM customer_quote_items WHERE quote_id=@quote_id');
  const lineNumber = lnRes.recordset[0].next_line;

  const r = await pool.request()
    .input('quote_id',              sql.Int,           quoteId)
    .input('org_id',                sql.Int,           orgId)
    .input('line_number',           sql.Int,           lineNumber)
    .input('product_id',            sql.Int,           product_id)
    .input('warehouse_id',          sql.Int,           wh || null)
    .input('qty_requested',         sql.Decimal(18,4), Number(qty_requested))
    .input('base_price',            sql.Decimal(18,4), pricing.basePrice)
    .input('customer_discount_pct', sql.Decimal(5,2),  pricing.customerDiscountPct)
    .input('volume_discount_pct',   sql.Decimal(5,2),  pricing.volumeDiscountPct)
    .input('unit_price',            sql.Decimal(18,4), pricing.unitPrice)
    .input('tax_rate',              sql.Decimal(5,2),  pricing.taxRate)
    .input('tax_amount',            sql.Decimal(18,4), pricing.taxAmount)
    .input('line_total',            sql.Decimal(18,4), pricing.lineTotal)
    .input('atp_qty',               sql.Decimal(18,4), atp.available)
    .input('atp_date',              sql.Date,          atp.atpDate ? new Date(atp.atpDate) : null)
    .input('atp_status',            sql.VarChar(20),   atp.atpStatus)
    .input('notes',                 sql.NVarChar(500), notes || null)
    .query(`
      DECLARE @out TABLE (id INT);
      INSERT INTO customer_quote_items
        (quote_id, org_id, line_number, product_id, warehouse_id, qty_requested,
         base_price, customer_discount_pct, volume_discount_pct, unit_price,
         tax_rate, tax_amount, line_total, atp_qty, atp_date, atp_status, notes)
      OUTPUT INSERTED.id INTO @out
      VALUES (@quote_id, @org_id, @line_number, @product_id, @warehouse_id, @qty_requested,
              @base_price, @customer_discount_pct, @volume_discount_pct, @unit_price,
              @tax_rate, @tax_amount, @line_total, @atp_qty, @atp_date, @atp_status, @notes);
      SELECT id FROM @out;
    `);

  await syncQuoteTotals(quoteId, pool);
  res.status(201).json({ success: true, data: { id: r.recordset[0].id, pricing, atp } });
}));

// ── UPDATE ITEM ───────────────────────────────────────────────
router.patch('/:id/items/:iid', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId   = req.user.orgId;
  const quoteId = parseId(req.params.id);
  const itemId  = parseId(req.params.iid);
  const q       = await getQuote(quoteId, orgId);
  if (!q) return res.status(404).json({ success: false, error: 'Quote not found.' });
  if (!['draft','sent'].includes(q.status)) return res.status(409).json({ success: false, error: 'Cannot edit items.' });

  const { qty_requested, notes } = req.body;

  if (qty_requested != null) {
    // Re-run pricing with new qty
    const itemRes = await pool.request().input('id', sql.Int, itemId).input('quote_id', sql.Int, quoteId)
      .query('SELECT * FROM customer_quote_items WHERE id=@id AND quote_id=@quote_id');
    if (!itemRes.recordset.length) return res.status(404).json({ success: false, error: 'Item not found.' });
    const item = itemRes.recordset[0];

    const custRes = await pool.request().input('id', sql.Int, q.customer_id)
      .query('SELECT is_gst_registered FROM contacts WHERE id=@id');
    const gst = !!custRes.recordset[0]?.is_gst_registered;

    const pricing = await calculatePrice({
      orgId, productId: item.product_id, customerId: q.customer_id,
      priceListId: q.price_list_id, qty: qty_requested, customerGstRegistered: gst, pool, sql,
    });

    await pool.request()
      .input('id',                    sql.Int,           itemId)
      .input('quote_id',              sql.Int,           quoteId)
      .input('qty_requested',         sql.Decimal(18,4), Number(qty_requested))
      .input('base_price',            sql.Decimal(18,4), pricing.basePrice)
      .input('customer_discount_pct', sql.Decimal(5,2),  pricing.customerDiscountPct)
      .input('volume_discount_pct',   sql.Decimal(5,2),  pricing.volumeDiscountPct)
      .input('unit_price',            sql.Decimal(18,4), pricing.unitPrice)
      .input('tax_rate',              sql.Decimal(5,2),  pricing.taxRate)
      .input('tax_amount',            sql.Decimal(18,4), pricing.taxAmount)
      .input('line_total',            sql.Decimal(18,4), pricing.lineTotal)
      .input('notes',                 sql.NVarChar(500), notes ?? null)
      .query(`
        UPDATE customer_quote_items
        SET qty_requested=@qty_requested, base_price=@base_price,
            customer_discount_pct=@customer_discount_pct, volume_discount_pct=@volume_discount_pct,
            unit_price=@unit_price, tax_rate=@tax_rate, tax_amount=@tax_amount,
            line_total=@line_total, notes=COALESCE(@notes, notes)
        WHERE id=@id AND quote_id=@quote_id
      `);
  } else if (notes != null) {
    await pool.request().input('id', sql.Int, itemId).input('quote_id', sql.Int, quoteId)
      .input('notes', sql.NVarChar(500), notes)
      .query('UPDATE customer_quote_items SET notes=@notes WHERE id=@id AND quote_id=@quote_id');
  }

  await syncQuoteTotals(quoteId, pool);
  res.json({ success: true });
}));

// ── REMOVE ITEM ───────────────────────────────────────────────
router.delete('/:id/items/:iid', perm('delete'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId   = req.user.orgId;
  const quoteId = parseId(req.params.id);
  const itemId  = parseId(req.params.iid);
  const q       = await getQuote(quoteId, orgId);
  if (!q) return res.status(404).json({ success: false, error: 'Quote not found.' });
  if (!['draft','sent'].includes(q.status)) return res.status(409).json({ success: false, error: 'Cannot remove items.' });
  await pool.request().input('id', sql.Int, itemId).input('quote_id', sql.Int, quoteId)
    .query('DELETE FROM customer_quote_items WHERE id=@id AND quote_id=@quote_id');
  await syncQuoteTotals(quoteId, pool);
  res.json({ success: true });
}));

// ── SEND ──────────────────────────────────────────────────────
router.post('/:id/send', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const q     = await getQuote(id, orgId);
  if (!q) return res.status(404).json({ success: false, error: 'Quote not found.' });
  if (q.status !== 'draft') return res.status(409).json({ success: false, error: `Quote is already ${q.status}.` });
  const items = await pool.request().input('id', sql.Int, id)
    .query('SELECT id FROM customer_quote_items WHERE quote_id=@id');
  if (!items.recordset.length) return res.status(400).json({ success: false, error: 'Add at least one item before sending.' });
  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query(`UPDATE customer_quotes SET status='sent', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);
  res.json({ success: true, data: { status: 'sent' } });
}));

// ── ACCEPT / REJECT ───────────────────────────────────────────
router.post('/:id/accept', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const q     = await getQuote(id, orgId);
  if (!q) return res.status(404).json({ success: false, error: 'Quote not found.' });
  if (q.status !== 'sent') return res.status(409).json({ success: false, error: 'Only sent quotes can be accepted.' });
  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query(`UPDATE customer_quotes SET status='accepted', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);
  res.json({ success: true, data: { status: 'accepted' } });
}));

router.post('/:id/reject', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const q     = await getQuote(id, orgId);
  if (!q) return res.status(404).json({ success: false, error: 'Quote not found.' });
  if (q.status !== 'sent') return res.status(409).json({ success: false, error: 'Only sent quotes can be rejected.' });
  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query(`UPDATE customer_quotes SET status='rejected', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);
  res.json({ success: true, data: { status: 'rejected' } });
}));

// ── CONVERT TO SALES ORDER ────────────────────────────────────
router.post('/:id/convert', perm('write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const q     = await getQuote(id, orgId);
  if (!q) return res.status(404).json({ success: false, error: 'Quote not found.' });
  if (!['accepted','sent'].includes(q.status)) return res.status(409).json({ success: false, error: 'Quote must be accepted or sent to convert.' });

  const items = await pool.request().input('id', sql.Int, id)
    .query('SELECT * FROM customer_quote_items WHERE quote_id=@id ORDER BY line_number');
  if (!items.recordset.length) return res.status(400).json({ success: false, error: 'Quote has no items.' });

  const { requested_delivery_date } = req.body;
  const { number: soNumber } = await getNextNumber('sales_order', orgId, pool, sql);

  const soRes = await pool.request()
    .input('org_id',                  sql.Int,           orgId)
    .input('so_number',               sql.NVarChar(50),  soNumber)
    .input('customer_id',             sql.Int,           q.customer_id)
    .input('quote_id',                sql.Int,           id)
    .input('warehouse_id',            sql.Int,           q.warehouse_id || null)
    .input('price_list_id',           sql.Int,           q.price_list_id || null)
    .input('currency_code',           sql.VarChar(3),    q.currency_code || 'AUD')
    .input('payment_terms',           sql.NVarChar(100), q.payment_terms || null)
    .input('requested_delivery_date', sql.Date,          requested_delivery_date ? new Date(requested_delivery_date) : null)
    .input('subtotal',                sql.Decimal(18,4), Number(q.subtotal))
    .input('tax_amount',              sql.Decimal(18,4), Number(q.tax_amount))
    .input('total_value',             sql.Decimal(18,4), Number(q.total_value))
    .input('notes',                   sql.NVarChar(1000), q.notes || null)
    .input('created_by',              sql.Int,           req.user.userId)
    .query(`
      DECLARE @out TABLE (id INT);
      INSERT INTO sales_orders
        (org_id, so_number, status, customer_id, quote_id, warehouse_id, price_list_id,
         currency_code, payment_terms, requested_delivery_date, subtotal, tax_amount,
         total_value, notes, created_by, created_at, updated_at)
      OUTPUT INSERTED.id INTO @out
      VALUES (@org_id, @so_number, 'draft', @customer_id, @quote_id, @warehouse_id,
              @price_list_id, @currency_code, @payment_terms, @requested_delivery_date,
              @subtotal, @tax_amount, @total_value, @notes, @created_by, GETDATE(), GETDATE());
      SELECT id FROM @out;
    `);
  const soId = soRes.recordset[0].id;

  // Copy quote items to SO items
  for (const item of items.recordset) {
    await pool.request()
      .input('so_id',                 sql.Int,           soId)
      .input('org_id',                sql.Int,           orgId)
      .input('line_number',           sql.Int,           item.line_number)
      .input('product_id',            sql.Int,           item.product_id)
      .input('warehouse_id',          sql.Int,           item.warehouse_id || null)
      .input('quote_item_id',         sql.Int,           item.id)
      .input('qty_ordered',           sql.Decimal(18,4), Number(item.qty_requested))
      .input('base_price',            sql.Decimal(18,4), Number(item.base_price))
      .input('customer_discount_pct', sql.Decimal(5,2),  Number(item.customer_discount_pct))
      .input('volume_discount_pct',   sql.Decimal(5,2),  Number(item.volume_discount_pct))
      .input('unit_price',            sql.Decimal(18,4), Number(item.unit_price))
      .input('tax_rate',              sql.Decimal(5,2),  Number(item.tax_rate))
      .input('tax_amount',            sql.Decimal(18,4), Number(item.tax_amount))
      .input('line_total',            sql.Decimal(18,4), Number(item.line_total))
      .input('notes',                 sql.NVarChar(500), item.notes || null)
      .query(`
        INSERT INTO sales_order_items
          (so_id, org_id, line_number, product_id, warehouse_id, quote_item_id, qty_ordered,
           base_price, customer_discount_pct, volume_discount_pct, unit_price,
           tax_rate, tax_amount, line_total, atp_status, notes)
        VALUES (@so_id, @org_id, @line_number, @product_id, @warehouse_id, @quote_item_id,
                @qty_ordered, @base_price, @customer_discount_pct, @volume_discount_pct,
                @unit_price, @tax_rate, @tax_amount, @line_total, 'pending', @notes)
      `);
  }

  // Mark quote as converted
  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query(`UPDATE customer_quotes SET status='converted', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);

  res.status(201).json({ success: true, data: { so_id: soId, so_number: soNumber } });
}));

// ── CANCEL ────────────────────────────────────────────────────
router.post('/:id/cancel', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const q     = await getQuote(id, orgId);
  if (!q) return res.status(404).json({ success: false, error: 'Quote not found.' });
  if (['converted','expired'].includes(q.status)) return res.status(409).json({ success: false, error: `Cannot cancel a ${q.status} quote.` });
  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query(`UPDATE customer_quotes SET status='expired', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);
  res.json({ success: true });
}));

module.exports = router;
