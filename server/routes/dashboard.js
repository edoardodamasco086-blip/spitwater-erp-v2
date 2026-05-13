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
  const [revenue, receivables, stock, serviceJobs,
         openQuotes, openSOs, backorders, openDeliveries, openPRs, openPOs] = await Promise.all([

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

    // Open quotes (draft + sent)
    pool.request().input('org_id', sql.Int, orgId).query(`
      SELECT COUNT(*) AS cnt, ISNULL(SUM(total_value),0) AS val
      FROM customer_quotes
      WHERE org_id = @org_id AND status IN ('draft','sent')
    `),

    // Open sales orders
    pool.request().input('org_id', sql.Int, orgId).query(`
      SELECT COUNT(*) AS cnt, ISNULL(SUM(total_value),0) AS val
      FROM sales_orders
      WHERE org_id = @org_id AND status IN ('draft','confirmed','credit_hold','partially_shipped')
    `),

    // Open backorder lines
    pool.request().input('org_id', sql.Int, orgId).query(`
      SELECT COUNT(*) AS value
      FROM sales_order_schedule_lines sl
      JOIN sales_orders so ON so.id = sl.so_id
      WHERE so.org_id = @org_id AND sl.atp_category = 'backorder' AND sl.status = 'open'
    `),

    // Open outbound deliveries (pending pick/ship)
    pool.request().input('org_id', sql.Int, orgId).query(`
      SELECT COUNT(*) AS value
      FROM outbound_deliveries
      WHERE org_id = @org_id AND status IN ('open','picking','picked')
    `),

    // Open purchase requisitions
    pool.request().input('org_id', sql.Int, orgId).query(`
      SELECT COUNT(*) AS value
      FROM purchase_requisitions
      WHERE org_id = @org_id AND status IN ('draft','submitted','approved')
    `),

    // Open purchase orders value
    pool.request().input('org_id', sql.Int, orgId).query(`
      SELECT COUNT(*) AS cnt, ISNULL(SUM(total_value),0) AS val
      FROM purchase_orders
      WHERE org_id = @org_id AND status IN ('draft','pending_approval','approved','sent','partially_received')
    `),
  ]);

  return res.json({
    success: true,
    data: {
      revenueThisMonth:       revenue.recordset[0].value,
      outstandingReceivables: receivables.recordset[0].value,
      unitsInStock:           stock.recordset[0].value,
      openServiceJobs:        serviceJobs.recordset[0].value,
      openQuotesCount:        openQuotes.recordset[0].cnt,
      openQuotesValue:        openQuotes.recordset[0].val,
      openSOsCount:           openSOs.recordset[0].cnt,
      openSOsValue:           openSOs.recordset[0].val,
      backorderLines:         backorders.recordset[0].value,
      openDeliveries:         openDeliveries.recordset[0].value,
      openPRsCount:           openPRs.recordset[0].value,
      openPOsCount:           openPOs.recordset[0].cnt,
      openPOsValue:           openPOs.recordset[0].val,
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
  const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 10, 50));

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
  const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 10, 50));

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

// ────────────────────────────────────────────────────────────────
// GET /api/dashboard/o2c-reports
// Backorders, late deliveries, stale open orders
// ────────────────────────────────────────────────────────────────
router.get('/o2c-reports', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;

  const [backordersRes, lateRes, staleRes] = await Promise.all([

    // Backorder schedule lines
    pool.request().input('org_id', sql.Int, orgId).query(`
      SELECT
        sl.id, sl.qty, sl.confirmed_date, sl.source_type, sl.source_po_id,
        so.so_number, so.id AS so_id,
        c.full_name AS customer_name,
        p.name AS product_name, p.product_code,
        soi.line_number,
        DATEDIFF(day, so.created_at, GETDATE()) AS age_days
      FROM sales_order_schedule_lines sl
      JOIN sales_orders so ON so.id = sl.so_id
      JOIN sales_order_items soi ON soi.id = sl.so_item_id
      JOIN contacts c ON c.id = so.customer_id
      JOIN products p ON p.id = soi.product_id
      WHERE so.org_id = @org_id
        AND sl.atp_category = 'backorder'
        AND sl.status = 'open'
      ORDER BY sl.confirmed_date ASC, so.created_at ASC
    `),

    // Late outbound deliveries (planned past today, not shipped)
    pool.request().input('org_id', sql.Int, orgId).query(`
      SELECT
        od.id, od.delivery_number, od.status, od.planned_ship_date,
        od.created_at,
        so.so_number, so.id AS so_id,
        c.full_name AS customer_name,
        DATEDIFF(day, od.planned_ship_date, GETDATE()) AS days_late,
        (SELECT COUNT(*) FROM outbound_delivery_items WHERE delivery_id = od.id) AS item_count
      FROM outbound_deliveries od
      JOIN sales_orders so ON so.id = od.so_id
      JOIN contacts c ON c.id = so.customer_id
      WHERE od.org_id = @org_id
        AND od.status NOT IN ('shipped','cancelled')
        AND od.planned_ship_date IS NOT NULL
        AND od.planned_ship_date < CAST(GETDATE() AS DATE)
      ORDER BY od.planned_ship_date ASC
    `),

    // Stale open orders (draft/credit_hold older than 7 days)
    pool.request().input('org_id', sql.Int, orgId).query(`
      SELECT
        so.id, so.so_number, so.status, so.credit_status, so.total_value,
        so.created_at,
        c.full_name AS customer_name,
        DATEDIFF(day, so.created_at, GETDATE()) AS age_days,
        (SELECT COUNT(*) FROM sales_order_items WHERE so_id = so.id) AS item_count
      FROM sales_orders so
      JOIN contacts c ON c.id = so.customer_id
      WHERE so.org_id = @org_id
        AND so.status IN ('draft','credit_hold')
        AND so.created_at < DATEADD(day, -7, GETDATE())
      ORDER BY so.created_at ASC
    `),
  ]);

  return res.json({
    success: true,
    data: {
      backorders:      backordersRes.recordset,
      lateDeliveries:  lateRes.recordset,
      staleOrders:     staleRes.recordset,
    }
  });
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
