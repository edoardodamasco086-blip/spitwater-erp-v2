'use strict';
// ============================================================
// routes/p2pRFQ.js  — Requests for Quotation
//
// GET    /api/p2p/rfq                              list
// POST   /api/p2p/rfq                              create (optionally from PR)
// GET    /api/p2p/rfq/:id                          detail + items + responses
// PATCH  /api/p2p/rfq/:id                          update header (draft)
// POST   /api/p2p/rfq/:id/items                    add item
// PATCH  /api/p2p/rfq/:id/items/:itemId            update item
// DELETE /api/p2p/rfq/:id/items/:itemId            remove item
// POST   /api/p2p/rfq/:id/send                     draft → sent
// POST   /api/p2p/rfq/:id/responses                record vendor response
// POST   /api/p2p/rfq/:id/responses/:rid/items     add line items to response
// POST   /api/p2p/rfq/:id/award/:responseId        award → creates PO
// POST   /api/p2p/rfq/:id/cancel                   → cancelled
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect }  = require('../config/db');
const { requireAuth }             = require('../middleware/auth');
const { asyncHandler }            = require('../middleware/errorHandler');
const { requirePermission }       = require('../middleware/permissions');
const { getNextNumber }           = require('../utils/numbering');

router.use(requireAuth);
const perm = action => requirePermission('rfqs', action);
function parseId(v) { return parseInt(v, 10); }

async function getRfq(id, orgId) {
  await poolConnect;
  const r = await pool.request()
    .input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query(`SELECT rfq.*, w.name AS warehouse_name FROM request_for_quotations rfq LEFT JOIN warehouses w ON w.id = rfq.warehouse_id WHERE rfq.id = @id AND rfq.org_id = @org_id`);
  return r.recordset[0] || null;
}

// ── LIST ──────────────────────────────────────────────────────
router.get('/', perm('read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId  = req.user.orgId;
  const limit  = Math.min(200, parseInt(req.query.limit)  || 50);
  const offset = Math.max(0,   parseInt(req.query.offset) || 0);
  const status = req.query.status || null;

  const rows = await pool.request()
    .input('org_id',  sql.Int,         orgId)
    .input('limit',   sql.Int,         limit)
    .input('offset',  sql.Int,         offset)
    .input('status',  sql.VarChar(20), status)
    .query(`
      SELECT
        rfq.id, rfq.rfq_number, rfq.title, rfq.status, rfq.pr_id, rfq.deadline_date,
        rfq.delivery_date, rfq.created_at, rfq.updated_at,
        w.name  AS warehouse_name,
        pr.pr_number,
        (SELECT COUNT(*) FROM rfq_items ri         WHERE ri.rfq_id  = rfq.id) AS item_count,
        (SELECT COUNT(*) FROM rfq_vendor_responses rv WHERE rv.rfq_id = rfq.id) AS response_count,
        COUNT(*) OVER() AS total_count
      FROM request_for_quotations rfq
      LEFT JOIN warehouses w  ON w.id  = rfq.warehouse_id
      LEFT JOIN purchase_requisitions pr ON pr.id = rfq.pr_id
      WHERE rfq.org_id = @org_id
        AND (@status IS NULL OR rfq.status = @status)
      ORDER BY rfq.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

  const total = rows.recordset[0]?.total_count ?? 0;
  res.json({ success: true, data: rows.recordset, meta: { total, limit, offset } });
}));

// ── CREATE ────────────────────────────────────────────────────
router.post('/', perm('write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const { title, pr_id, warehouse_id, deadline_date, delivery_date, notes, copy_pr_items } = req.body;

  if (!title?.trim()) return res.status(400).json({ success: false, error: 'title is required.' });

  // Validate PR if provided
  if (pr_id) {
    const prCheck = await pool.request()
      .input('id', sql.Int, pr_id).input('org_id', sql.Int, orgId)
      .query(`SELECT id, status FROM purchase_requisitions WHERE id=@id AND org_id=@org_id`);
    if (!prCheck.recordset.length) return res.status(400).json({ success: false, error: 'PR not found.' });
    if (!['approved', 'submitted'].includes(prCheck.recordset[0].status)) {
      return res.status(409).json({ success: false, error: 'PR must be approved or submitted to create an RFQ from it.' });
    }
  }

  const { number: rfqNumber } = await getNextNumber('request_for_quotation', orgId, pool, sql);

  const r = await pool.request()
    .input('org_id',        sql.Int,           orgId)
    .input('rfq_number',    sql.NVarChar(50),  rfqNumber)
    .input('title',         sql.NVarChar(200), title.trim())
    .input('pr_id',         sql.Int,           pr_id         || null)
    .input('warehouse_id',  sql.Int,           warehouse_id  || null)
    .input('deadline_date', sql.Date,          deadline_date  ? new Date(deadline_date)  : null)
    .input('delivery_date', sql.Date,          delivery_date  ? new Date(delivery_date)  : null)
    .input('notes',         sql.NVarChar(1000), notes         || null)
    .input('created_by',    sql.Int,           req.user.userId)
    .query(`
      DECLARE @out TABLE (id INT);
      INSERT INTO request_for_quotations
        (org_id, rfq_number, title, status, pr_id, warehouse_id, deadline_date, delivery_date, notes, created_by, created_at, updated_at)
      OUTPUT INSERTED.id INTO @out
      VALUES (@org_id, @rfq_number, @title, 'draft', @pr_id, @warehouse_id, @deadline_date, @delivery_date, @notes, @created_by, GETDATE(), GETDATE());
      SELECT id FROM @out;
    `);

  const rfqId = r.recordset[0].id;

  // Optionally copy items from the PR
  if (pr_id && copy_pr_items) {
    const prItems = await pool.request()
      .input('pr_id', sql.Int, pr_id)
      .query('SELECT * FROM purchase_requisition_items WHERE pr_id = @pr_id');
    for (const item of prItems.recordset) {
      await pool.request()
        .input('rfq_id',        sql.Int,           rfqId)
        .input('org_id',        sql.Int,           orgId)
        .input('product_id',    sql.Int,           item.product_id)
        .input('pr_item_id',    sql.Int,           item.id)
        .input('qty_requested', sql.Decimal(18,4), Number(item.qty_requested))
        .input('target_price',  sql.Decimal(18,4), Number(item.unit_cost_est || 0))
        .input('notes',         sql.NVarChar(500), item.notes || null)
        .query(`
          INSERT INTO rfq_items (rfq_id, org_id, product_id, pr_item_id, qty_requested, target_price, notes)
          VALUES (@rfq_id, @org_id, @product_id, @pr_item_id, @qty_requested, @target_price, @notes)
        `);
    }
  }

  res.status(201).json({ success: true, data: { id: rfqId, rfq_number: rfqNumber } });
}));

// ── DETAIL ────────────────────────────────────────────────────
router.get('/:id', perm('read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);

  const [rfqRes, itemsRes, respRes] = await Promise.all([
    pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId).query(`
      SELECT rfq.*, w.name AS warehouse_name, pr.pr_number
      FROM request_for_quotations rfq
      LEFT JOIN warehouses w ON w.id = rfq.warehouse_id
      LEFT JOIN purchase_requisitions pr ON pr.id = rfq.pr_id
      WHERE rfq.id = @id AND rfq.org_id = @org_id
    `),
    pool.request().input('rfq_id', sql.Int, id).query(`
      SELECT ri.*, p.name AS product_name, p.product_code, uom.code AS uom_code
      FROM rfq_items ri
      JOIN products p ON p.id = ri.product_id
      LEFT JOIN units_of_measure uom ON uom.id = p.base_uom_id
      WHERE ri.rfq_id = @rfq_id ORDER BY ri.id
    `),
    pool.request().input('rfq_id', sql.Int, id).query(`
      SELECT rv.*, c.full_name AS supplier_name
      FROM rfq_vendor_responses rv
      JOIN contacts c ON c.id = rv.supplier_id
      WHERE rv.rfq_id = @rfq_id ORDER BY rv.created_at
    `),
  ]);

  if (!rfqRes.recordset.length) return res.status(404).json({ success: false, error: 'RFQ not found.' });

  // Attach response items to each response
  const responses = rfqRes.recordset.length ? respRes.recordset : [];
  const respIds   = responses.map(r => r.id);
  let   respItems = [];
  if (respIds.length) {
    const ri = await pool.request().query(`
      SELECT rri.*, ri2.product_id, ri2.qty_requested,
             p.name AS product_name, p.product_code,
             rri.unit_price * ri2.qty_requested AS total_price
      FROM rfq_response_items rri
      JOIN rfq_items ri2 ON ri2.id = rri.rfq_item_id
      JOIN products p ON p.id = ri2.product_id
      WHERE rri.response_id IN (${respIds.join(',')})
    `);
    respItems = ri.recordset;
  }
  const responsesWithItems = responses.map(r => {
    const items = respItems.filter(i => i.response_id === r.id);
    const total_price = items.reduce((sum, i) => sum + Number(i.total_price || 0), 0);
    return { ...r, items, total_price };
  });

  res.json({
    success: true,
    data: { ...rfqRes.recordset[0], items: itemsRes.recordset, responses: responsesWithItems },
  });
}));

// ── UPDATE HEADER ─────────────────────────────────────────────
router.patch('/:id', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const rfq   = await getRfq(id, orgId);
  if (!rfq) return res.status(404).json({ success: false, error: 'RFQ not found.' });
  if (rfq.status !== 'draft') return res.status(409).json({ success: false, error: 'Only draft RFQs can be edited.' });

  const { warehouse_id, deadline_date, delivery_date, notes } = req.body;
  await pool.request()
    .input('id',            sql.Int,           id)
    .input('org_id',        sql.Int,           orgId)
    .input('warehouse_id',  sql.Int,           warehouse_id  ?? null)
    .input('deadline_date', sql.Date,          deadline_date ? new Date(deadline_date) : null)
    .input('delivery_date', sql.Date,          delivery_date ? new Date(delivery_date) : null)
    .input('notes',         sql.NVarChar(1000), notes        ?? null)
    .query(`
      UPDATE request_for_quotations
      SET warehouse_id  = COALESCE(@warehouse_id,  warehouse_id),
          deadline_date = COALESCE(@deadline_date, deadline_date),
          delivery_date = COALESCE(@delivery_date, delivery_date),
          notes         = COALESCE(@notes,         notes),
          updated_at    = GETDATE()
      WHERE id = @id AND org_id = @org_id
    `);
  res.json({ success: true });
}));

// ── ADD ITEM ──────────────────────────────────────────────────
router.post('/:id/items', perm('write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const rfqId = parseId(req.params.id);
  const rfq   = await getRfq(rfqId, orgId);
  if (!rfq) return res.status(404).json({ success: false, error: 'RFQ not found.' });
  if (!['draft', 'sent'].includes(rfq.status)) return res.status(409).json({ success: false, error: 'Cannot add items.' });

  const { product_id, pr_item_id, qty_requested, description, target_price, notes } = req.body;
  if (!product_id || !qty_requested) return res.status(400).json({ success: false, error: 'product_id and qty_requested are required.' });

  const r = await pool.request()
    .input('rfq_id',        sql.Int,           rfqId)
    .input('org_id',        sql.Int,           orgId)
    .input('product_id',    sql.Int,           product_id)
    .input('pr_item_id',    sql.Int,           pr_item_id   || null)
    .input('qty_requested', sql.Decimal(18,4), Number(qty_requested))
    .input('description',   sql.NVarChar(500), description  || null)
    .input('target_price',  sql.Decimal(18,4), target_price != null ? Number(target_price) : null)
    .input('notes',         sql.NVarChar(500), notes || null)
    .query(`
      DECLARE @out TABLE (id INT);
      INSERT INTO rfq_items (rfq_id, org_id, product_id, pr_item_id, qty_requested, description, target_price, notes)
      OUTPUT INSERTED.id INTO @out
      VALUES (@rfq_id, @org_id, @product_id, @pr_item_id, @qty_requested, @description, @target_price, @notes);
      SELECT id FROM @out;
    `);
  res.status(201).json({ success: true, data: { id: r.recordset[0].id } });
}));

// ── UPDATE ITEM ───────────────────────────────────────────────
router.patch('/:id/items/:itemId', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId  = req.user.orgId;
  const rfqId  = parseId(req.params.id);
  const itemId = parseId(req.params.itemId);
  const rfq    = await getRfq(rfqId, orgId);
  if (!rfq) return res.status(404).json({ success: false, error: 'RFQ not found.' });
  if (!['draft', 'sent'].includes(rfq.status)) return res.status(409).json({ success: false, error: 'Cannot edit items.' });

  const { qty_requested, target_price, notes } = req.body;
  await pool.request()
    .input('id',            sql.Int,           itemId)
    .input('rfq_id',        sql.Int,           rfqId)
    .input('qty_requested', sql.Decimal(18,4), qty_requested != null ? Number(qty_requested) : null)
    .input('target_price',  sql.Decimal(18,4), target_price  != null ? Number(target_price)  : null)
    .input('notes',         sql.NVarChar(500), notes ?? null)
    .query(`
      UPDATE rfq_items
      SET qty_requested = COALESCE(@qty_requested, qty_requested),
          target_price  = COALESCE(@target_price,  target_price),
          notes         = COALESCE(@notes,         notes)
      WHERE id = @id AND rfq_id = @rfq_id
    `);
  res.json({ success: true });
}));

// ── REMOVE ITEM ───────────────────────────────────────────────
router.delete('/:id/items/:itemId', perm('delete'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId  = req.user.orgId;
  const rfqId  = parseId(req.params.id);
  const itemId = parseId(req.params.itemId);
  const rfq    = await getRfq(rfqId, orgId);
  if (!rfq) return res.status(404).json({ success: false, error: 'RFQ not found.' });
  if (rfq.status !== 'draft') return res.status(409).json({ success: false, error: 'Only draft RFQ items can be removed.' });
  await pool.request()
    .input('id',     sql.Int, itemId)
    .input('rfq_id', sql.Int, rfqId)
    .query('DELETE FROM rfq_items WHERE id = @id AND rfq_id = @rfq_id');
  res.json({ success: true });
}));

// ── SEND RFQ ──────────────────────────────────────────────────
router.post('/:id/send', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const rfq   = await getRfq(id, orgId);
  if (!rfq) return res.status(404).json({ success: false, error: 'RFQ not found.' });
  if (rfq.status !== 'draft') return res.status(409).json({ success: false, error: `RFQ is already ${rfq.status}.` });

  const items = await pool.request().input('rfq_id', sql.Int, id)
    .query('SELECT id FROM rfq_items WHERE rfq_id = @rfq_id');
  if (!items.recordset.length) return res.status(400).json({ success: false, error: 'Add at least one item before sending.' });

  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query(`UPDATE request_for_quotations SET status='sent', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);
  res.json({ success: true, data: { status: 'sent' } });
}));

// ── RECORD VENDOR RESPONSE ────────────────────────────────────
router.post('/:id/responses', perm('write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const rfqId = parseId(req.params.id);
  const rfq   = await getRfq(rfqId, orgId);
  if (!rfq) return res.status(404).json({ success: false, error: 'RFQ not found.' });
  if (!['sent', 'draft'].includes(rfq.status)) return res.status(409).json({ success: false, error: 'RFQ must be sent to record responses.' });

  const { supplier_id, response_date, valid_until, notes } = req.body;
  if (!supplier_id) return res.status(400).json({ success: false, error: 'supplier_id is required.' });

  const r = await pool.request()
    .input('rfq_id',        sql.Int,          rfqId)
    .input('org_id',        sql.Int,          orgId)
    .input('supplier_id',   sql.Int,          supplier_id)
    .input('response_date', sql.Date,         response_date ? new Date(response_date) : null)
    .input('valid_until',   sql.Date,         valid_until   ? new Date(valid_until)   : null)
    .input('notes',         sql.NVarChar(500), notes || null)
    .query(`
      DECLARE @out TABLE (id INT);
      INSERT INTO rfq_vendor_responses (rfq_id, org_id, supplier_id, status, response_date, valid_until, notes, created_at)
      OUTPUT INSERTED.id INTO @out
      VALUES (@rfq_id, @org_id, @supplier_id, 'received', @response_date, @valid_until, @notes, GETDATE());
      SELECT id FROM @out;
    `);
  res.status(201).json({ success: true, data: { id: r.recordset[0].id } });
}));

// ── ADD RESPONSE LINE ITEMS ───────────────────────────────────
router.post('/:id/responses/:rid/items', perm('write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId      = req.user.orgId;
  const rfqId      = parseId(req.params.id);
  const responseId = parseId(req.params.rid);

  const resp = await pool.request()
    .input('id',     sql.Int, responseId)
    .input('rfq_id', sql.Int, rfqId)
    .query('SELECT id FROM rfq_vendor_responses WHERE id=@id AND rfq_id=@rfq_id');
  if (!resp.recordset.length) return res.status(404).json({ success: false, error: 'Response not found.' });

  const { items } = req.body; // array of { rfq_item_id, unit_price, delivery_days, notes }
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ success: false, error: 'items array is required.' });

  const ids = [];
  for (const item of items) {
    const r = await pool.request()
      .input('response_id',   sql.Int,           responseId)
      .input('rfq_item_id',   sql.Int,           item.rfq_item_id)
      .input('org_id',        sql.Int,           orgId)
      .input('unit_price',    sql.Decimal(18,4), Number(item.unit_price))
      .input('delivery_days', sql.Int,           item.delivery_days || null)
      .input('notes',         sql.NVarChar(500), item.notes || null)
      .query(`
        DECLARE @out TABLE (id INT);
        INSERT INTO rfq_response_items (response_id, rfq_item_id, org_id, unit_price, delivery_days, notes)
        OUTPUT INSERTED.id INTO @out
        VALUES (@response_id, @rfq_item_id, @org_id, @unit_price, @delivery_days, @notes);
        SELECT id FROM @out;
      `);
    ids.push(r.recordset[0].id);
  }
  res.status(201).json({ success: true, data: { ids } });
}));

// ── AWARD — creates a PO from the winning response ────────────
router.post('/:id/award/:responseId', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId      = req.user.orgId;
  const rfqId      = parseId(req.params.id);
  const responseId = parseId(req.params.responseId);

  const rfq = await getRfq(rfqId, orgId);
  if (!rfq) return res.status(404).json({ success: false, error: 'RFQ not found.' });
  if (!['sent', 'draft'].includes(rfq.status)) return res.status(409).json({ success: false, error: 'RFQ cannot be awarded.' });

  const respRes = await pool.request()
    .input('id',     sql.Int, responseId)
    .input('rfq_id', sql.Int, rfqId)
    .query(`
      SELECT rv.*, c.full_name AS supplier_name
      FROM rfq_vendor_responses rv
      JOIN contacts c ON c.id = rv.supplier_id
      WHERE rv.id = @id AND rv.rfq_id = @rfq_id
    `);
  if (!respRes.recordset.length) return res.status(404).json({ success: false, error: 'Response not found.' });
  const response = respRes.recordset[0];

  // Response must have line items
  const respItems = await pool.request()
    .input('response_id', sql.Int, responseId)
    .query(`
      SELECT rri.*, ri.product_id, ri.qty_requested, ri.pr_item_id
      FROM rfq_response_items rri
      JOIN rfq_items ri ON ri.id = rri.rfq_item_id
      WHERE rri.response_id = @response_id
    `);
  if (!respItems.recordset.length) return res.status(400).json({ success: false, error: 'Response has no line items.' });

  const { payment_terms, expected_delivery_date, notes, warehouse_id } = req.body;
  const warehouseId = warehouse_id || rfq.warehouse_id || null;

  const { number: poNumber } = await getNextNumber('purchase_order', orgId, pool, sql);

  // Create PO header
  const poRes = await pool.request()
    .input('org_id',                   sql.Int,           orgId)
    .input('po_number',                sql.NVarChar(50),  poNumber)
    .input('supplier_id',              sql.Int,           response.supplier_id)
    .input('warehouse_id',             sql.Int,           warehouseId)
    .input('pr_id',                    sql.Int,           rfq.pr_id || null)
    .input('rfq_id',                   sql.Int,           rfqId)
    .input('payment_terms',            sql.NVarChar(100), payment_terms || null)
    .input('expected_delivery_date',   sql.Date,          expected_delivery_date ? new Date(expected_delivery_date) : null)
    .input('notes',                    sql.NVarChar(1000), notes || null)
    .input('created_by',               sql.Int,           req.user.userId)
    .query(`
      DECLARE @out TABLE (id INT);
      INSERT INTO purchase_orders
        (org_id, po_number, status, supplier_id, warehouse_id, pr_id, rfq_id,
         payment_terms, expected_delivery_date, notes, total_value, created_by, created_at, updated_at)
      OUTPUT INSERTED.id INTO @out
      VALUES
        (@org_id, @po_number, 'draft', @supplier_id, @warehouse_id, @pr_id, @rfq_id,
         @payment_terms, @expected_delivery_date, @notes, 0, @created_by, GETDATE(), GETDATE());
      SELECT id FROM @out;
    `);

  const poId = poRes.recordset[0].id;

  // Create PO line items from response items
  let lineNumber = 1;
  let totalValue = 0;
  for (const ri of respItems.recordset) {
    const lineTotal = Number(ri.qty_requested) * Number(ri.unit_price);
    totalValue += lineTotal;
    await pool.request()
      .input('po_id',                sql.Int,           poId)
      .input('org_id',               sql.Int,           orgId)
      .input('product_id',           sql.Int,           ri.product_id)
      .input('warehouse_id',         sql.Int,           warehouseId)
      .input('pr_item_id',           sql.Int,           ri.pr_item_id || null)
      .input('rfq_item_id',          sql.Int,           ri.rfq_item_id)
      .input('rfq_response_item_id', sql.Int,           ri.id)
      .input('line_number',          sql.Int,           lineNumber++)
      .input('qty_ordered',          sql.Decimal(18,4), Number(ri.qty_requested))
      .input('unit_price',           sql.Decimal(18,4), Number(ri.unit_price))
      .input('delivery_date',        sql.Date,          null)
      .query(`
        INSERT INTO purchase_order_items
          (po_id, org_id, product_id, warehouse_id, pr_item_id, rfq_item_id, rfq_response_item_id,
           line_number, qty_ordered, qty_received, qty_invoiced, unit_price, delivery_date)
        VALUES
          (@po_id, @org_id, @product_id, @warehouse_id, @pr_item_id, @rfq_item_id, @rfq_response_item_id,
           @line_number, @qty_ordered, 0, 0, @unit_price, @delivery_date)
      `);
  }

  // Update PO total
  await pool.request().input('id', sql.Int, poId).input('total', sql.Decimal(18,4), totalValue)
    .query('UPDATE purchase_orders SET total_value = @total WHERE id = @id');

  // Mark response as awarded, others as not_awarded
  await pool.request()
    .input('rfq_id',      sql.Int, rfqId)
    .input('response_id', sql.Int, responseId)
    .query(`
      UPDATE rfq_vendor_responses
      SET status = CASE WHEN id = @response_id THEN 'awarded' ELSE 'not_awarded' END
      WHERE rfq_id = @rfq_id
    `);

  // Mark RFQ as awarded
  await pool.request().input('id', sql.Int, rfqId).input('org_id', sql.Int, orgId)
    .query(`UPDATE request_for_quotations SET status='awarded', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);

  res.status(201).json({ success: true, data: { po_id: poId, po_number: poNumber } });
}));

// ── CANCEL ────────────────────────────────────────────────────
router.post('/:id/cancel', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const rfq   = await getRfq(id, orgId);
  if (!rfq) return res.status(404).json({ success: false, error: 'RFQ not found.' });
  if (['awarded', 'cancelled'].includes(rfq.status)) return res.status(409).json({ success: false, error: `Cannot cancel a ${rfq.status} RFQ.` });
  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query(`UPDATE request_for_quotations SET status='cancelled', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);
  res.json({ success: true });
}));

module.exports = router;
