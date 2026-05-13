'use strict';
// routes/p2pReports.js
// GET /api/p2p/reports/backorders
// GET /api/p2p/reports/spend-by-supplier
// GET /api/p2p/reports/pending-approvals

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth }            = require('../middleware/auth');
const { asyncHandler }           = require('../middleware/errorHandler');
const { requirePermission }      = require('../middleware/permissions');

router.use(requireAuth);

// ── BACKORDERS ────────────────────────────────────────────────
router.get('/backorders', requirePermission('purchase_orders', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;

  const rows = await pool.request()
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT
        po.po_number, po.status AS po_status, po.expected_delivery_date,
        c.full_name AS supplier_name,
        p.name AS product_name, p.product_code,
        poi.qty_ordered, poi.qty_received,
        poi.qty_ordered - poi.qty_received AS qty_outstanding,
        poi.unit_price,
        (poi.qty_ordered - poi.qty_received) * poi.unit_price AS outstanding_value,
        w.name AS warehouse_name
      FROM purchase_order_items poi
      JOIN purchase_orders po   ON po.id = poi.po_id
      JOIN contacts c           ON c.id  = po.supplier_id
      JOIN products p           ON p.id  = poi.product_id
      LEFT JOIN warehouses w    ON w.id  = po.warehouse_id
      WHERE po.org_id = @org_id
        AND po.status IN ('sent', 'approved', 'partially_received')
        AND poi.qty_received < poi.qty_ordered
      ORDER BY po.expected_delivery_date ASC, po.po_number
    `);

  res.json({ success: true, data: rows.recordset });
}));

// ── SPEND BY SUPPLIER ─────────────────────────────────────────
router.get('/spend-by-supplier', requirePermission('purchase_orders', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId    = req.user.orgId;
  const fromDate = req.query.from_date || null;
  const toDate   = req.query.to_date   || null;

  const rows = await pool.request()
    .input('org_id',    sql.Int,  orgId)
    .input('from_date', sql.Date, fromDate ? new Date(fromDate) : null)
    .input('to_date',   sql.Date, toDate   ? new Date(toDate)   : null)
    .query(`
      SELECT
        c.id AS supplier_id, c.full_name AS supplier_name,
        COUNT(po.id)        AS po_count,
        SUM(po.total_value) AS total_spend,
        MIN(po.created_at)  AS first_po_date,
        MAX(po.created_at)  AS last_po_date
      FROM purchase_orders po
      JOIN contacts c ON c.id = po.supplier_id
      WHERE po.org_id = @org_id
        AND po.status NOT IN ('cancelled', 'draft')
        AND (@from_date IS NULL OR CAST(po.created_at AS DATE) >= @from_date)
        AND (@to_date   IS NULL OR CAST(po.created_at AS DATE) <= @to_date)
      GROUP BY c.id, c.full_name
      ORDER BY total_spend DESC
    `);

  res.json({ success: true, data: rows.recordset });
}));

// ── PENDING APPROVALS ─────────────────────────────────────────
router.get('/pending-approvals', requirePermission('purchase_orders', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;

  const rows = await pool.request()
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT
        par.id, par.approval_level, par.level_name, par.status,
        par.requested_at,
        po.id AS po_id, po.po_number, po.total_value, po.status AS po_status,
        c.full_name AS supplier_name
      FROM po_approval_requests par
      JOIN purchase_orders po ON po.id = par.po_id
      JOIN contacts c         ON c.id  = po.supplier_id
      WHERE par.org_id = @org_id AND par.status = 'pending'
      ORDER BY par.requested_at ASC
    `);

  res.json({ success: true, data: rows.recordset });
}));

module.exports = router;
