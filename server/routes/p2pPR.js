'use strict';
// ============================================================
// routes/p2pPR.js  — Purchase Requisitions
//
// GET    /api/p2p/pr                        list
// POST   /api/p2p/pr                        create draft
// GET    /api/p2p/pr/:id                    detail + items
// PATCH  /api/p2p/pr/:id                    update header (draft)
// POST   /api/p2p/pr/:id/items              add item
// PATCH  /api/p2p/pr/:id/items/:itemId      update item
// DELETE /api/p2p/pr/:id/items/:itemId      remove item
// POST   /api/p2p/pr/:id/submit             draft → submitted
// POST   /api/p2p/pr/:id/approve            submitted → approved  (admin)
// POST   /api/p2p/pr/:id/reject             submitted → rejected  (admin)
// POST   /api/p2p/pr/:id/cancel             → cancelled
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect }  = require('../config/db');
const { requireAuth }             = require('../middleware/auth');
const { asyncHandler }            = require('../middleware/errorHandler');
const { requirePermission }       = require('../middleware/permissions');
const { getNextNumber }           = require('../utils/numbering');

router.use(requireAuth);
const perm = action => requirePermission('purchase_requisitions', action);

function parseId(v) { return parseInt(v, 10); }

async function getPr(id, orgId) {
  await poolConnect;
  const r = await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT pr.*, u.full_name AS requester_name
      FROM purchase_requisitions pr
      LEFT JOIN users u ON u.id = pr.requester_id
      WHERE pr.id = @id AND pr.org_id = @org_id
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
    .input('org_id',  sql.Int,         orgId)
    .input('limit',   sql.Int,         limit)
    .input('offset',  sql.Int,         offset)
    .input('status',  sql.VarChar(20), status)
    .input('search',  sql.NVarChar(200), search)
    .query(`
      SELECT
        pr.id, pr.pr_number, pr.status, pr.department, pr.cost_center,
        pr.required_date, pr.created_at, pr.updated_at,
        u.full_name AS requester_name,
        (SELECT COUNT(*)                        FROM purchase_requisition_items i WHERE i.pr_id = pr.id) AS item_count,
        (SELECT ISNULL(SUM(i.qty_requested * i.unit_cost_est), 0) FROM purchase_requisition_items i WHERE i.pr_id = pr.id) AS total_est,
        COUNT(*) OVER() AS total_count
      FROM purchase_requisitions pr
      LEFT JOIN users u ON u.id = pr.requester_id
      WHERE pr.org_id = @org_id
        AND (@status IS NULL OR pr.status = @status)
        AND (@search IS NULL OR pr.pr_number LIKE @search OR pr.department LIKE @search)
      ORDER BY pr.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

  const total = rows.recordset[0]?.total_count ?? 0;
  res.json({ success: true, data: rows.recordset, meta: { total, limit, offset } });
}));

// ── CREATE ────────────────────────────────────────────────────
router.post('/', perm('write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const { department, cost_center, required_date, notes } = req.body;

  const { number: prNumber } = await getNextNumber('purchase_requisition', orgId, pool, sql);

  const r = await pool.request()
    .input('org_id',        sql.Int,           orgId)
    .input('pr_number',     sql.NVarChar(50),  prNumber)
    .input('requester_id',  sql.Int,           req.user.userId)
    .input('department',    sql.NVarChar(100), department   || null)
    .input('cost_center',   sql.NVarChar(50),  cost_center  || null)
    .input('required_date', sql.Date,          required_date ? new Date(required_date) : null)
    .input('notes',         sql.NVarChar(1000), notes       || null)
    .input('created_by',    sql.Int,           req.user.userId)
    .query(`
      DECLARE @out TABLE (id INT);
      INSERT INTO purchase_requisitions
        (org_id, pr_number, status, requester_id, department, cost_center, required_date, notes, created_by, created_at, updated_at)
      OUTPUT INSERTED.id INTO @out
      VALUES
        (@org_id, @pr_number, 'draft', @requester_id, @department, @cost_center, @required_date, @notes, @created_by, GETDATE(), GETDATE());
      SELECT id FROM @out;
    `);

  res.status(201).json({ success: true, data: { id: r.recordset[0].id, pr_number: prNumber } });
}));

// ── DETAIL ────────────────────────────────────────────────────
router.get('/:id', perm('read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);

  const [prRes, itemsRes] = await Promise.all([
    pool.request()
      .input('id', sql.Int, id).input('org_id', sql.Int, orgId)
      .query(`
        SELECT pr.*, u.full_name AS requester_name,
               ab.full_name AS approved_by_name, rb.full_name AS rejected_by_name,
               (SELECT ISNULL(SUM(i.qty_requested * i.unit_cost_est), 0) FROM purchase_requisition_items i WHERE i.pr_id = pr.id) AS total_est
        FROM purchase_requisitions pr
        LEFT JOIN users ab ON ab.id = pr.approved_by
        LEFT JOIN users rb ON rb.id = pr.rejected_by
        LEFT JOIN users u  ON u.id  = pr.requester_id
        WHERE pr.id = @id AND pr.org_id = @org_id
      `),
    pool.request()
      .input('pr_id', sql.Int, id)
      .query(`
        SELECT i.*, p.name AS product_name, p.product_code,
               p.base_uom_id, uom.code AS uom_code, w.name AS warehouse_name
        FROM purchase_requisition_items i
        JOIN products p ON p.id = i.product_id
        LEFT JOIN units_of_measure uom ON uom.id = p.base_uom_id
        LEFT JOIN warehouses w ON w.id = i.warehouse_id
        WHERE i.pr_id = @pr_id
        ORDER BY i.id
      `),
  ]);

  if (!prRes.recordset.length) return res.status(404).json({ success: false, error: 'PR not found.' });

  res.json({ success: true, data: { ...prRes.recordset[0], items: itemsRes.recordset } });
}));

// ── UPDATE HEADER ─────────────────────────────────────────────
router.patch('/:id', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const pr    = await getPr(id, orgId);
  if (!pr) return res.status(404).json({ success: false, error: 'PR not found.' });
  if (pr.status !== 'draft') return res.status(409).json({ success: false, error: 'Only draft PRs can be edited.' });

  const { department, cost_center, required_date, notes } = req.body;
  await pool.request()
    .input('id',            sql.Int,           id)
    .input('org_id',        sql.Int,           orgId)
    .input('department',    sql.NVarChar(100), department   ?? null)
    .input('cost_center',   sql.NVarChar(50),  cost_center  ?? null)
    .input('required_date', sql.Date,          required_date ? new Date(required_date) : null)
    .input('notes',         sql.NVarChar(1000), notes       ?? null)
    .query(`
      UPDATE purchase_requisitions
      SET department    = COALESCE(@department,    department),
          cost_center   = COALESCE(@cost_center,   cost_center),
          required_date = COALESCE(@required_date, required_date),
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
  const prId  = parseId(req.params.id);
  const pr    = await getPr(prId, orgId);
  if (!pr) return res.status(404).json({ success: false, error: 'PR not found.' });
  if (!['draft', 'submitted'].includes(pr.status)) return res.status(409).json({ success: false, error: 'Cannot add items to this PR.' });

  const { product_id, warehouse_id, qty_requested, unit_cost_est, required_date, notes } = req.body;
  if (!product_id || !qty_requested) return res.status(400).json({ success: false, error: 'product_id and qty_requested are required.' });

  const r = await pool.request()
    .input('pr_id',         sql.Int,           prId)
    .input('org_id',        sql.Int,           orgId)
    .input('product_id',    sql.Int,           product_id)
    .input('warehouse_id',  sql.Int,           warehouse_id  || null)
    .input('qty_requested', sql.Decimal(18,4), Number(qty_requested))
    .input('unit_cost_est', sql.Decimal(18,4), Number(unit_cost_est || 0))
    .input('required_date', sql.Date,          required_date ? new Date(required_date) : null)
    .input('notes',         sql.NVarChar(500), notes || null)
    .query(`
      DECLARE @out TABLE (id INT);
      INSERT INTO purchase_requisition_items
        (pr_id, org_id, product_id, warehouse_id, qty_requested, unit_cost_est, required_date, notes, status)
      OUTPUT INSERTED.id INTO @out
      VALUES (@pr_id, @org_id, @product_id, @warehouse_id, @qty_requested, @unit_cost_est, @required_date, @notes, 'open');
      SELECT id FROM @out;
    `);
  res.status(201).json({ success: true, data: { id: r.recordset[0].id } });
}));

// ── UPDATE ITEM ───────────────────────────────────────────────
router.patch('/:id/items/:itemId', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId   = req.user.orgId;
  const prId    = parseId(req.params.id);
  const itemId  = parseId(req.params.itemId);
  const pr      = await getPr(prId, orgId);
  if (!pr) return res.status(404).json({ success: false, error: 'PR not found.' });
  if (!['draft', 'submitted'].includes(pr.status)) return res.status(409).json({ success: false, error: 'Cannot edit items on this PR.' });

  const { qty_requested, unit_cost_est, warehouse_id, required_date, notes } = req.body;
  await pool.request()
    .input('id',            sql.Int,           itemId)
    .input('pr_id',         sql.Int,           prId)
    .input('qty_requested', sql.Decimal(18,4), qty_requested != null ? Number(qty_requested) : null)
    .input('unit_cost_est', sql.Decimal(18,4), unit_cost_est != null ? Number(unit_cost_est) : null)
    .input('warehouse_id',  sql.Int,           warehouse_id  ?? null)
    .input('required_date', sql.Date,          required_date ? new Date(required_date) : null)
    .input('notes',         sql.NVarChar(500), notes ?? null)
    .query(`
      UPDATE purchase_requisition_items
      SET qty_requested = COALESCE(@qty_requested, qty_requested),
          unit_cost_est = COALESCE(@unit_cost_est, unit_cost_est),
          warehouse_id  = COALESCE(@warehouse_id,  warehouse_id),
          required_date = COALESCE(@required_date, required_date),
          notes         = COALESCE(@notes,         notes)
      WHERE id = @id AND pr_id = @pr_id
    `);
  res.json({ success: true });
}));

// ── REMOVE ITEM ───────────────────────────────────────────────
router.delete('/:id/items/:itemId', perm('delete'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId  = req.user.orgId;
  const prId   = parseId(req.params.id);
  const itemId = parseId(req.params.itemId);
  const pr     = await getPr(prId, orgId);
  if (!pr) return res.status(404).json({ success: false, error: 'PR not found.' });
  if (!['draft', 'submitted'].includes(pr.status)) return res.status(409).json({ success: false, error: 'Cannot remove items from this PR.' });

  await pool.request()
    .input('id',    sql.Int, itemId)
    .input('pr_id', sql.Int, prId)
    .query('DELETE FROM purchase_requisition_items WHERE id = @id AND pr_id = @pr_id');
  res.json({ success: true });
}));

// ── SUBMIT ────────────────────────────────────────────────────
router.post('/:id/submit', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const pr    = await getPr(id, orgId);
  if (!pr) return res.status(404).json({ success: false, error: 'PR not found.' });
  if (pr.status !== 'draft') return res.status(409).json({ success: false, error: `PR is already ${pr.status}.` });

  const items = await pool.request().input('pr_id', sql.Int, id)
    .query('SELECT id FROM purchase_requisition_items WHERE pr_id = @pr_id');
  if (!items.recordset.length) return res.status(400).json({ success: false, error: 'Add at least one item before submitting.' });

  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query(`UPDATE purchase_requisitions SET status='submitted', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);
  res.json({ success: true, data: { status: 'submitted' } });
}));

// ── APPROVE ───────────────────────────────────────────────────
router.post('/:id/approve', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const pr = await getPr(id, orgId);
  if (!pr) return res.status(404).json({ success: false, error: 'PR not found.' });
  if (pr.status !== 'submitted') return res.status(409).json({ success: false, error: 'Only submitted PRs can be approved.' });

  await pool.request()
    .input('id',          sql.Int,      id)
    .input('org_id',      sql.Int,      orgId)
    .input('approved_by', sql.Int,      req.user.userId)
    .query(`
      UPDATE purchase_requisitions
      SET status      = 'approved',
          approved_by = @approved_by,
          approved_at = GETDATE(),
          updated_at  = GETDATE()
      WHERE id = @id AND org_id = @org_id
    `);
  res.json({ success: true, data: { status: 'approved' } });
}));

// ── REJECT ────────────────────────────────────────────────────
router.post('/:id/reject', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const pr = await getPr(id, orgId);
  if (!pr) return res.status(404).json({ success: false, error: 'PR not found.' });
  if (pr.status !== 'submitted') return res.status(409).json({ success: false, error: 'Only submitted PRs can be rejected.' });

  const { reason } = req.body;
  await pool.request()
    .input('id',              sql.Int,          id)
    .input('org_id',          sql.Int,          orgId)
    .input('rejected_by',     sql.Int,          req.user.userId)
    .input('rejection_reason',sql.NVarChar(500), reason || null)
    .query(`
      UPDATE purchase_requisitions
      SET status           = 'rejected',
          rejected_by      = @rejected_by,
          rejected_at      = GETDATE(),
          rejection_reason = @rejection_reason,
          updated_at       = GETDATE()
      WHERE id = @id AND org_id = @org_id
    `);
  res.json({ success: true, data: { status: 'rejected' } });
}));

// ── CANCEL ────────────────────────────────────────────────────
router.post('/:id/cancel', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const pr    = await getPr(id, orgId);
  if (!pr) return res.status(404).json({ success: false, error: 'PR not found.' });
  if (['approved', 'converted', 'cancelled'].includes(pr.status)) {
    return res.status(409).json({ success: false, error: `Cannot cancel a ${pr.status} PR.` });
  }
  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query(`UPDATE purchase_requisitions SET status='cancelled', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);
  res.json({ success: true });
}));

module.exports = router;
