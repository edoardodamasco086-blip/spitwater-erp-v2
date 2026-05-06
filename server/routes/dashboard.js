'use strict';
// ============================================================
// routes/dashboard.js
//
// GET /api/dashboard/kpis       — live KPI figures
// GET /api/dashboard/activity   — recent audit log entries
// GET /api/dashboard/documents  — recent documents
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth }            = require('../middleware/auth');
const { asyncHandler }           = require('../middleware/errorHandler');

router.use(requireAuth);

// ────────────────────────────────────────────────────────────────
// GET /api/dashboard/kpis
// ────────────────────────────────────────────────────────────────
router.get('/kpis', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;

  // Run all KPI queries in parallel
  const [revenue, receivables, stock, serviceJobs] = await Promise.all([

    // Revenue this month (posted invoices)
    pool.request()
      .input('org_id', sql.Int, orgId)
      .query(`
        SELECT ISNULL(SUM(total_inc_gst), 0) AS value
        FROM documents
        WHERE org_id       = @org_id
          AND document_type = 'invoice'
          AND status        = 'posted'
          AND MONTH(document_date) = MONTH(GETDATE())
          AND YEAR(document_date)  = YEAR(GETDATE())
          AND is_void = 0
      `),

    // Outstanding receivables (posted invoices with balance owing)
    pool.request()
      .input('org_id', sql.Int, orgId)
      .query(`
        SELECT ISNULL(SUM(amount_outstanding), 0) AS value
        FROM documents
        WHERE org_id       = @org_id
          AND document_type = 'invoice'
          AND status        = 'posted'
          AND amount_outstanding > 0
          AND is_void = 0
      `),

    // Total units in stock (across all warehouses)
    pool.request()
      .input('org_id', sql.Int, orgId)
      .query(`
        SELECT ISNULL(SUM(qty_on_hand), 0) AS value
        FROM stock_levels
        WHERE org_id = @org_id
      `),

    // Open service jobs
    pool.request()
      .input('org_id', sql.Int, orgId)
      .query(`
        SELECT COUNT(*) AS value
        FROM service_jobs
        WHERE org_id  = @org_id
          AND status NOT IN ('complete', 'invoiced', 'paid')
          AND is_void = 0
      `),
  ]);

  return res.json({
    success: true,
    data: {
      revenueThisMonth:       revenue.recordset[0].value,
      outstandingReceivables: receivables.recordset[0].value,
      unitsInStock:           stock.recordset[0].value,
      openServiceJobs:        serviceJobs.recordset[0].value,
    }
  });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/dashboard/activity?limit=10
// Recent audit log entries for this org, formatted for display
// ────────────────────────────────────────────────────────────────
router.get('/activity', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);

  const rows = await pool.request()
    .input('org_id', sql.Int, orgId)
    .input('limit',  sql.Int, limit)
    .query(`
      SELECT TOP (@limit)
        id,
        action_type,
        entity_type,
        entity_ref,
        description,
        user_name,
        occurred_at
      FROM audit_log
      WHERE org_id = @org_id
      ORDER BY occurred_at DESC
    `);

  // Format for display
  const activity = rows.recordset.map(row => ({
    id:          row.id,
    actionType:  row.action_type,
    entityType:  row.entity_type,
    entityRef:   row.entity_ref,
    description: row.description,
    userName:    row.user_name,
    occurredAt:  row.occurred_at,
    timeAgo:     timeAgo(row.occurred_at),
    color:       actionColor(row.action_type),
  }));

  return res.json({ success: true, data: activity });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/dashboard/documents?limit=10
// Recent documents for this org
// ────────────────────────────────────────────────────────────────
router.get('/documents', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);

  const rows = await pool.request()
    .input('org_id', sql.Int, orgId)
    .input('limit',  sql.Int, limit)
    .query(`
      SELECT TOP (@limit)
        d.id,
        d.document_number,
        d.document_type,
        d.document_date,
        d.due_date,
        d.total_inc_gst,
        d.amount_outstanding,
        d.status,
        c.full_name AS contact_name
      FROM documents d
      LEFT JOIN contacts c ON c.id = d.contact_id
      WHERE d.org_id  = @org_id
        AND d.is_void = 0
      ORDER BY d.created_at DESC
    `);

  return res.json({ success: true, data: rows.recordset });
}));

// ── Helpers ───────────────────────────────────────────────────
function timeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60)   return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function actionColor(actionType) {
  if (!actionType) return '#7B93B0';
  if (actionType.startsWith('auth'))     return '#2F7FE8';
  if (actionType.startsWith('invoice'))  return '#2F7FE8';
  if (actionType.startsWith('payment'))  return '#2ECC8A';
  if (actionType.startsWith('service'))  return '#E89B2F';
  if (actionType.startsWith('purchase')) return '#9366E8';
  if (actionType.startsWith('stock'))    return '#E05252';
  return '#7B93B0';
}

module.exports = router;
