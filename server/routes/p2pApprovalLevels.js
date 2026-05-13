'use strict';
// ============================================================
// routes/p2pApprovalLevels.js  — PO Approval Level Configuration
//
// GET    /api/p2p/approval-levels           list levels for org
// POST   /api/p2p/approval-levels           create level
// PATCH  /api/p2p/approval-levels/:id       update level
// DELETE /api/p2p/approval-levels/:id       delete level
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth }            = require('../middleware/auth');
const { asyncHandler }           = require('../middleware/errorHandler');
const { requirePermission }      = require('../middleware/permissions');

router.use(requireAuth);
const perm = action => requirePermission('purchase_orders', action);

// ── LIST ──────────────────────────────────────────────────────
router.get('/', perm('read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const rows  = await pool.request()
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT id, level, level_name, min_amount, max_amount, approver_role, is_active, created_at
      FROM po_approval_levels
      WHERE org_id = @org_id
      ORDER BY level ASC
    `);
  res.json({ success: true, data: rows.recordset });
}));

// ── CREATE ────────────────────────────────────────────────────
router.post('/', perm('write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;

  const { level, level_name, min_amount, max_amount, approver_role } = req.body;
  if (!level || !level_name || min_amount == null) {
    return res.status(400).json({ success: false, error: 'level, level_name, and min_amount are required.' });
  }

  // Ensure level number is unique for this org
  const dup = await pool.request()
    .input('org_id', sql.Int, orgId).input('level', sql.Int, level)
    .query('SELECT id FROM po_approval_levels WHERE org_id=@org_id AND level=@level');
  if (dup.recordset.length) return res.status(409).json({ success: false, error: `Level ${level} already exists.` });

  const r = await pool.request()
    .input('org_id',        sql.Int,          orgId)
    .input('level',         sql.Int,          level)
    .input('level_name',    sql.NVarChar(100), level_name)
    .input('min_amount',    sql.Decimal(18,4), Number(min_amount))
    .input('max_amount',    sql.Decimal(18,4), max_amount != null ? Number(max_amount) : null)
    .input('approver_role', sql.VarChar(20),  approver_role || 'admin')
    .query(`
      DECLARE @out TABLE (id INT);
      INSERT INTO po_approval_levels (org_id, level, level_name, min_amount, max_amount, approver_role, is_active, created_at)
      OUTPUT INSERTED.id INTO @out
      VALUES (@org_id, @level, @level_name, @min_amount, @max_amount, @approver_role, 1, GETDATE());
      SELECT id FROM @out;
    `);

  res.status(201).json({ success: true, data: { id: r.recordset[0].id } });
}));

// ── UPDATE ────────────────────────────────────────────────────
router.patch('/:id', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id, 10);

  const { level_name, min_amount, max_amount, approver_role, is_active } = req.body;
  await pool.request()
    .input('id',            sql.Int,          id)
    .input('org_id',        sql.Int,          orgId)
    .input('level_name',    sql.NVarChar(100), level_name    ?? null)
    .input('min_amount',    sql.Decimal(18,4), min_amount != null ? Number(min_amount) : null)
    .input('max_amount',    sql.Decimal(18,4), max_amount != null ? Number(max_amount) : null)
    .input('approver_role', sql.VarChar(20),  approver_role ?? null)
    .input('is_active',     sql.Bit,          is_active != null ? (is_active ? 1 : 0) : null)
    .query(`
      UPDATE po_approval_levels
      SET level_name    = COALESCE(@level_name,    level_name),
          min_amount    = COALESCE(@min_amount,    min_amount),
          max_amount    = COALESCE(@max_amount,    max_amount),
          approver_role = COALESCE(@approver_role, approver_role),
          is_active     = COALESCE(@is_active,     is_active)
      WHERE id = @id AND org_id = @org_id
    `);
  res.json({ success: true });
}));

// ── DELETE ────────────────────────────────────────────────────
router.delete('/:id', perm('delete'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id, 10);
  await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query('DELETE FROM po_approval_levels WHERE id=@id AND org_id=@org_id');
  res.json({ success: true });
}));

module.exports = router;
