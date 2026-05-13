'use strict';
// ============================================================
// routes/p2pPO.js  — Purchase Orders
//
// GET    /api/p2p/po                        list with 3-way match stats
// POST   /api/p2p/po                        create manually
// GET    /api/p2p/po/:id                    detail + items + approvals + receipts
// PATCH  /api/p2p/po/:id                    update header (draft)
// POST   /api/p2p/po/:id/items              add item
// PATCH  /api/p2p/po/:id/items/:itemId      update item
// DELETE /api/p2p/po/:id/items/:itemId      remove item
// POST   /api/p2p/po/:id/submit             draft → pending_approval (or auto-approve)
// POST   /api/p2p/po/:id/approve            action approval (admin)
// POST   /api/p2p/po/:id/reject             reject at current level (admin)
// POST   /api/p2p/po/:id/send               approved → sent (to vendor)
// POST   /api/p2p/po/:id/cancel             → cancelled
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect }      = require('../config/db');
const { requireAuth }                 = require('../middleware/auth');
const { asyncHandler }                = require('../middleware/errorHandler');
const { requirePermission }           = require('../middleware/permissions');
const { getNextNumber }               = require('../utils/numbering');
const { submitForApproval, processApproval, syncPoTotal } = require('../utils/p2pApprovalEngine');

router.use(requireAuth);
const perm = action => requirePermission('purchase_orders', action);
function parseId(v) { return parseInt(v, 10); }

async function getPo(id, orgId) {
  await poolConnect;
  const r = await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT po.*, s.full_name AS supplier_name, w.name AS warehouse_name
      FROM purchase_orders po
      JOIN contacts        s ON s.id = po.supplier_id
      LEFT JOIN warehouses w ON w.id = po.warehouse_id
      WHERE po.id = @id AND po.org_id = @org_id
    `);
  return r.recordset[0] || null;
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
    .input('status',  sql.VarChar(30),  status)
    .input('search',  sql.NVarChar(200), search)
    .query(`
      SELECT
        po.id, po.po_number, po.status, po.total_value, po.expected_delivery_date,
        po.payment_terms, po.currency_code, po.created_at, po.sent_at,
        po.approval_levels_required, po.current_approval_level,
        s.full_name  AS supplier_name,
        w.name       AS warehouse_name,
        (SELECT COUNT(*)                           FROM purchase_order_items poi WHERE poi.po_id = po.id) AS line_count,
        (SELECT ISNULL(SUM(poi.qty_ordered),0)     FROM purchase_order_items poi WHERE poi.po_id = po.id) AS total_qty_ordered,
        (SELECT ISNULL(SUM(poi.qty_received),0)    FROM purchase_order_items poi WHERE poi.po_id = po.id) AS total_qty_received,
        COUNT(*) OVER() AS total_count
      FROM purchase_orders po
      JOIN contacts        s ON s.id = po.supplier_id
      LEFT JOIN warehouses w ON w.id = po.warehouse_id
      WHERE po.org_id = @org_id
        AND (@status IS NULL OR po.status = @status)
        AND (@search IS NULL OR po.po_number LIKE @search OR s.full_name LIKE @search)
      ORDER BY po.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

  const total = rows.recordset[0]?.total_count ?? 0;
  res.json({ success: true, data: rows.recordset, meta: { total, limit, offset } });
}));

// ── CREATE ────────────────────────────────────────────────────
router.post('/', perm('write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const { supplier_id, warehouse_id, pr_id, rfq_id, payment_terms, currency_code, expected_delivery_date, notes } = req.body;

  if (!supplier_id) return res.status(400).json({ success: false, error: 'supplier_id is required.' });

  const { number: poNumber } = await getNextNumber('purchase_order', orgId, pool, sql);

  const r = await pool.request()
    .input('org_id',                   sql.Int,           orgId)
    .input('po_number',                sql.NVarChar(50),  poNumber)
    .input('supplier_id',              sql.Int,           supplier_id)
    .input('warehouse_id',             sql.Int,           warehouse_id || null)
    .input('pr_id',                    sql.Int,           pr_id         || null)
    .input('rfq_id',                   sql.Int,           rfq_id        || null)
    .input('payment_terms',            sql.NVarChar(100), payment_terms || null)
    .input('currency_code',            sql.VarChar(3),    currency_code || 'AUD')
    .input('expected_delivery_date',   sql.Date,          expected_delivery_date ? new Date(expected_delivery_date) : null)
    .input('notes',                    sql.NVarChar(1000), notes        || null)
    .input('created_by',               sql.Int,           req.user.userId)
    .query(`
      DECLARE @out TABLE (id INT);
      INSERT INTO purchase_orders
        (org_id, po_number, status, supplier_id, warehouse_id, pr_id, rfq_id,
         payment_terms, currency_code, expected_delivery_date, notes, total_value, created_by, created_at, updated_at)
      OUTPUT INSERTED.id INTO @out
      VALUES
        (@org_id, @po_number, 'draft', @supplier_id, @warehouse_id, @pr_id, @rfq_id,
         @payment_terms, @currency_code, @expected_delivery_date, @notes, 0, @created_by, GETDATE(), GETDATE());
      SELECT id FROM @out;
    `);

  res.status(201).json({ success: true, data: { id: r.recordset[0].id, po_number: poNumber } });
}));

// ── DETAIL ────────────────────────────────────────────────────
router.get('/:id', perm('read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);

  const [poRes, itemsRes, approvalsRes, receiptsRes] = await Promise.all([
    pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId).query(`
      SELECT po.*,
             s.full_name  AS supplier_name,
             w.name       AS warehouse_name,
             pr.pr_number,
             rfq.rfq_number,
             u.full_name  AS created_by_name
      FROM purchase_orders po
      JOIN contacts        s ON s.id = po.supplier_id
      LEFT JOIN warehouses w ON w.id = po.warehouse_id
      LEFT JOIN purchase_requisitions  pr  ON pr.id  = po.pr_id
      LEFT JOIN request_for_quotations rfq ON rfq.id = po.rfq_id
      LEFT JOIN users u ON u.id = po.created_by
      WHERE po.id = @id AND po.org_id = @org_id
    `),
    pool.request().input('po_id', sql.Int, id).query(`
      SELECT poi.*,
             p.name AS product_name, p.product_code, uom.code AS uom_code,
             w.name AS warehouse_name,
             -- 3-way match status per line
             CASE
               WHEN poi.qty_received  >= poi.qty_ordered AND poi.qty_invoiced >= poi.qty_ordered THEN 'matched'
               WHEN poi.qty_received  >= poi.qty_ordered THEN 'received_not_invoiced'
               WHEN poi.qty_received   > 0               THEN 'partially_received'
               ELSE 'pending'
             END AS match_status
      FROM purchase_order_items poi
      JOIN products p ON p.id = poi.product_id
      LEFT JOIN units_of_measure uom ON uom.id = p.base_uom_id
      LEFT JOIN warehouses w ON w.id = poi.warehouse_id
      WHERE poi.po_id = @po_id
      ORDER BY poi.line_number
    `),
    pool.request().input('po_id', sql.Int, id).query(`
      SELECT par.*, ab.full_name AS actioned_by_name, rb.full_name AS requested_by_name
      FROM po_approval_requests par
      LEFT JOIN users ab ON ab.id = par.actioned_by
      LEFT JOIN users rb ON rb.id = par.requested_by
      WHERE par.po_id = @po_id
      ORDER BY par.approval_level, par.requested_at
    `),
    pool.request().input('po_id', sql.Int, id).query(`
      SELECT id.id, id.delivery_number, id.status, id.posted_at,
             (SELECT ISNULL(SUM(idi.received_qty),0) FROM inbound_delivery_items idi WHERE idi.delivery_id = id.id) AS total_received
      FROM inbound_deliveries id
      WHERE id.po_id = @po_id
      ORDER BY id.created_at
    `),
  ]);

  if (!poRes.recordset.length) return res.status(404).json({ success: false, error: 'PO not found.' });

  res.json({
    success: true,
    data: {
      ...poRes.recordset[0],
      items:     itemsRes.recordset,
      approvals: approvalsRes.recordset,
      receipts:  receiptsRes.recordset,
    },
  });
}));

// ── UPDATE HEADER ─────────────────────────────────────────────
router.patch('/:id', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const po    = await getPo(id, orgId);
  if (!po) return res.status(404).json({ success: false, error: 'PO not found.' });
  if (po.status !== 'draft') return res.status(409).json({ success: false, error: 'Only draft POs can be edited.' });

  const { supplier_id, warehouse_id, payment_terms, currency_code, expected_delivery_date, notes } = req.body;
  await pool.request()
    .input('id',                     sql.Int,           id)
    .input('org_id',                 sql.Int,           orgId)
    .input('supplier_id',            sql.Int,           supplier_id   ?? null)
    .input('warehouse_id',           sql.Int,           warehouse_id  ?? null)
    .input('payment_terms',          sql.NVarChar(100), payment_terms ?? null)
    .input('currency_code',          sql.VarChar(3),    currency_code ?? null)
    .input('expected_delivery_date', sql.Date,          expected_delivery_date ? new Date(expected_delivery_date) : null)
    .input('notes',                  sql.NVarChar(1000), notes        ?? null)
    .query(`
      UPDATE purchase_orders
      SET supplier_id              = COALESCE(@supplier_id,            supplier_id),
          warehouse_id             = COALESCE(@warehouse_id,           warehouse_id),
          payment_terms            = COALESCE(@payment_terms,          payment_terms),
          currency_code            = COALESCE(@currency_code,          currency_code),
          expected_delivery_date   = COALESCE(@expected_delivery_date, expected_delivery_date),
          notes                    = COALESCE(@notes,                  notes),
          updated_at               = GETDATE()
      WHERE id = @id AND org_id = @org_id
    `);
  res.json({ success: true });
}));

// ── ADD ITEM ──────────────────────────────────────────────────
router.post('/:id/items', perm('write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const poId  = parseId(req.params.id);
  const po    = await getPo(poId, orgId);
  if (!po) return res.status(404).json({ success: false, error: 'PO not found.' });
  if (!['draft'].includes(po.status)) return res.status(409).json({ success: false, error: 'Can only add items to draft POs.' });

  const { product_id, warehouse_id, pr_item_id, rfq_item_id, qty_ordered, unit_price, delivery_date, notes } = req.body;
  if (!product_id || !qty_ordered || !unit_price) {
    return res.status(400).json({ success: false, error: 'product_id, qty_ordered, and unit_price are required.' });
  }

  // Get next line number
  const lnRes = await pool.request().input('po_id', sql.Int, poId)
    .query('SELECT ISNULL(MAX(line_number),0)+1 AS next_line FROM purchase_order_items WHERE po_id=@po_id');
  const lineNumber = lnRes.recordset[0].next_line;

  const r = await pool.request()
    .input('po_id',         sql.Int,           poId)
    .input('org_id',        sql.Int,           orgId)
    .input('product_id',    sql.Int,           product_id)
    .input('warehouse_id',  sql.Int,           warehouse_id || po.warehouse_id)
    .input('pr_item_id',    sql.Int,           pr_item_id   || null)
    .input('rfq_item_id',   sql.Int,           rfq_item_id  || null)
    .input('line_number',   sql.Int,           lineNumber)
    .input('qty_ordered',   sql.Decimal(18,4), Number(qty_ordered))
    .input('unit_price',    sql.Decimal(18,4), Number(unit_price))
    .input('delivery_date', sql.Date,          delivery_date ? new Date(delivery_date) : null)
    .input('notes',         sql.NVarChar(500), notes || null)
    .query(`
      DECLARE @out TABLE (id INT);
      INSERT INTO purchase_order_items
        (po_id, org_id, product_id, warehouse_id, pr_item_id, rfq_item_id, line_number,
         qty_ordered, qty_received, qty_invoiced, unit_price, delivery_date, notes)
      OUTPUT INSERTED.id INTO @out
      VALUES
        (@po_id, @org_id, @product_id, @warehouse_id, @pr_item_id, @rfq_item_id, @line_number,
         @qty_ordered, 0, 0, @unit_price, @delivery_date, @notes);
      SELECT id FROM @out;
    `);

  await syncPoTotal(poId, orgId, pool, sql);
  res.status(201).json({ success: true, data: { id: r.recordset[0].id } });
}));

// ── UPDATE ITEM ───────────────────────────────────────────────
router.patch('/:id/items/:itemId', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId   = req.user.orgId;
  const poId    = parseId(req.params.id);
  const itemId  = parseId(req.params.itemId);
  const po      = await getPo(poId, orgId);
  if (!po) return res.status(404).json({ success: false, error: 'PO not found.' });
  if (po.status !== 'draft') return res.status(409).json({ success: false, error: 'Only draft PO items can be edited.' });

  const { qty_ordered, unit_price, delivery_date, notes } = req.body;
  await pool.request()
    .input('id',            sql.Int,           itemId)
    .input('po_id',         sql.Int,           poId)
    .input('qty_ordered',   sql.Decimal(18,4), qty_ordered != null ? Number(qty_ordered) : null)
    .input('unit_price',    sql.Decimal(18,4), unit_price  != null ? Number(unit_price)  : null)
    .input('delivery_date', sql.Date,          delivery_date ? new Date(delivery_date) : null)
    .input('notes',         sql.NVarChar(500), notes ?? null)
    .query(`
      UPDATE purchase_order_items
      SET qty_ordered   = COALESCE(@qty_ordered,   qty_ordered),
          unit_price    = COALESCE(@unit_price,     unit_price),
          delivery_date = COALESCE(@delivery_date, delivery_date),
          notes         = COALESCE(@notes,         notes)
      WHERE id = @id AND po_id = @po_id
    `);

  await syncPoTotal(poId, orgId, pool, sql);
  res.json({ success: true });
}));

// ── REMOVE ITEM ───────────────────────────────────────────────
router.delete('/:id/items/:itemId', perm('delete'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId  = req.user.orgId;
  const poId   = parseId(req.params.id);
  const itemId = parseId(req.params.itemId);
  const po     = await getPo(poId, orgId);
  if (!po) return res.status(404).json({ success: false, error: 'PO not found.' });
  if (po.status !== 'draft') return res.status(409).json({ success: false, error: 'Only draft PO items can be removed.' });
  await pool.request()
    .input('id',    sql.Int, itemId)
    .input('po_id', sql.Int, poId)
    .query('DELETE FROM purchase_order_items WHERE id=@id AND po_id=@po_id');
  await syncPoTotal(poId, orgId, pool, sql);
  res.json({ success: true });
}));

// ── SUBMIT FOR APPROVAL ───────────────────────────────────────
router.post('/:id/submit', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const po    = await getPo(id, orgId);
  if (!po) return res.status(404).json({ success: false, error: 'PO not found.' });
  if (po.status !== 'draft') return res.status(409).json({ success: false, error: `PO is already ${po.status}.` });

  const items = await pool.request().input('po_id', sql.Int, id)
    .query('SELECT id FROM purchase_order_items WHERE po_id=@po_id');
  if (!items.recordset.length) return res.status(400).json({ success: false, error: 'Add at least one item before submitting.' });

  const result = await submitForApproval(po, req.user.userId, pool, sql);

  res.json({
    success: true,
    data: {
      status:         result.autoApproved ? 'approved' : 'pending_approval',
      auto_approved:  result.autoApproved,
      levels_required: result.levelsRequired,
    },
  });
}));

// ── APPROVE ───────────────────────────────────────────────────
router.post('/:id/approve', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);

  const po = await getPo(id, orgId);
  if (!po) return res.status(404).json({ success: false, error: 'PO not found.' });
  if (po.status !== 'pending_approval') return res.status(409).json({ success: false, error: 'PO is not awaiting approval.' });

  const { comments } = req.body;
  const result = await processApproval(po, req.user.userId, 'approve', comments, pool, sql);

  res.json({ success: true, data: result });
}));

// ── REJECT ────────────────────────────────────────────────────
router.post('/:id/reject', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);

  const po = await getPo(id, orgId);
  if (!po) return res.status(404).json({ success: false, error: 'PO not found.' });
  if (po.status !== 'pending_approval') return res.status(409).json({ success: false, error: 'PO is not awaiting approval.' });

  const { comments } = req.body;
  const result = await processApproval(po, req.user.userId, 'reject', comments, pool, sql);

  res.json({ success: true, data: result });
}));

// ── SEND TO VENDOR ────────────────────────────────────────────
router.post('/:id/send', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const po    = await getPo(id, orgId);
  if (!po) return res.status(404).json({ success: false, error: 'PO not found.' });
  if (po.status !== 'approved') return res.status(409).json({ success: false, error: 'Only approved POs can be sent.' });

  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query(`UPDATE purchase_orders SET status='sent', sent_at=GETDATE(), updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);

  res.json({ success: true, data: { status: 'sent' } });
}));

// ── CANCEL ────────────────────────────────────────────────────
router.post('/:id/cancel', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const po    = await getPo(id, orgId);
  if (!po) return res.status(404).json({ success: false, error: 'PO not found.' });

  const terminal = ['fully_received', 'closed', 'cancelled'];
  if (terminal.includes(po.status)) return res.status(409).json({ success: false, error: `Cannot cancel a ${po.status} PO.` });

  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query(`UPDATE purchase_orders SET status='cancelled', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);
  res.json({ success: true });
}));

module.exports = router;
