'use strict';
// Diagnostic script — read-only, no mutations
// Run: node scripts/diagnose-data-sync.js (from server/)
require('dotenv').config();
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER,
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE,
  options:  { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_CERT === 'true', enableArithAbort: true },
};
if (process.env.DB_WINDOWS_AUTH === 'true') config.options.trustedConnection = true;
else { config.user = process.env.DB_USER; config.password = process.env.DB_PASSWORD; }

async function run() {
  const pool = await sql.connect(config);
  const q = (s) => pool.request().query(s);

  console.log('\n=== Data Sync Diagnostics ===\n');

  // 1. Available schedule lines with NO outbound delivery item (picking candidates)
  const orphanedAvail = await q(`
    SELECT
      sl.id, sl.so_id, sl.so_item_id, sl.qty, sl.status, sl.atp_category,
      sl.outbound_item_id, so.so_number, so.status AS so_status,
      so.is_full_delivery_required,
      soi.product_id, soi.line_status
    FROM sales_order_schedule_lines sl
    JOIN sales_orders so      ON so.id  = sl.so_id
    JOIN sales_order_items soi ON soi.id = sl.so_item_id
    WHERE sl.atp_category = 'available'
      AND sl.status       = 'open'
      AND sl.outbound_item_id IS NULL
      AND so.status IN ('confirmed','processing','partially_shipped')
      AND soi.line_status IN ('open', NULL)
    ORDER BY so.so_number, sl.id
  `);
  console.log(`1. Available sched lines WITHOUT outbound item (picking candidates): ${orphanedAvail.recordset.length}`);
  orphanedAvail.recordset.forEach(r =>
    console.log(`   SO ${r.so_number} [${r.so_status}] full_del=${r.is_full_delivery_required} | sl.id=${r.id} qty=${r.qty} line_status=${r.line_status}`)
  );

  // 2. Schedule lines with status='picking' but outbound_item_id IS NULL (broken link)
  const brokenPicking = await q(`
    SELECT sl.id, sl.so_id, sl.status, sl.outbound_item_id, so.so_number
    FROM sales_order_schedule_lines sl
    JOIN sales_orders so ON so.id = sl.so_id
    WHERE sl.status = 'picking' AND sl.outbound_item_id IS NULL
  `);
  console.log(`\n2. Sched lines status='picking' but outbound_item_id IS NULL (broken): ${brokenPicking.recordset.length}`);
  brokenPicking.recordset.forEach(r =>
    console.log(`   SO ${r.so_number} | sl.id=${r.id}`)
  );

  // 3. Outbound delivery items with schedule_line_id pointing to non-existent or mismatched row
  const orphanedOdi = await q(`
    SELECT odi.id, odi.delivery_id, odi.so_item_id, odi.schedule_line_id, odi.status,
           od.delivery_number
    FROM outbound_delivery_items odi
    JOIN outbound_deliveries od ON od.id = odi.delivery_id
    WHERE odi.schedule_line_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM sales_order_schedule_lines sl
        WHERE sl.id = odi.schedule_line_id
      )
  `);
  console.log(`\n3. ODI with broken schedule_line_id FK: ${orphanedOdi.recordset.length}`);
  orphanedOdi.recordset.forEach(r =>
    console.log(`   Delivery ${r.delivery_number} | odi.id=${r.id} sl_id=${r.schedule_line_id}`)
  );

  // 4. Outbound delivery items linked to schedule lines that don't point back
  const missingBackLink = await q(`
    SELECT odi.id AS odi_id, odi.schedule_line_id, sl.outbound_item_id, od.delivery_number
    FROM outbound_delivery_items odi
    JOIN outbound_deliveries od ON od.id = odi.delivery_id
    JOIN sales_order_schedule_lines sl ON sl.id = odi.schedule_line_id
    WHERE sl.outbound_item_id IS NULL OR sl.outbound_item_id != odi.id
  `);
  console.log(`\n4. ODI↔schedule_line back-link mismatch: ${missingBackLink.recordset.length}`);
  missingBackLink.recordset.forEach(r =>
    console.log(`   Delivery ${r.delivery_number} | odi.id=${r.odi_id} → sl.outbound_item_id=${r.outbound_item_id}`)
  );

  // 5. soft_allocated vs. sum of confirmed available schedule lines
  const softMismatch = await q(`
    SELECT
      sl_agg.org_id, sl_agg.product_id, sl_agg.eff_wh,
      sl_agg.total_avail_open,
      ISNULL(sk.soft_allocated, 0) AS soft_allocated,
      ISNULL(sk.hard_allocated, 0) AS hard_allocated,
      sl_agg.total_avail_open - ISNULL(sk.soft_allocated, 0) - ISNULL(sk.hard_allocated, 0) AS discrepancy
    FROM (
      SELECT
        so.org_id,
        soi.product_id,
        COALESCE(soi.warehouse_id, so.warehouse_id) AS eff_wh,
        SUM(sl.qty) AS total_avail_open
      FROM sales_order_schedule_lines sl
      JOIN sales_order_items soi ON soi.id = sl.so_item_id
      JOIN sales_orders so       ON so.id  = sl.so_id
      WHERE sl.atp_category = 'available'
        AND sl.status IN ('open', 'picking')
        AND so.status NOT IN ('shipped','invoiced','cancelled')
      GROUP BY so.org_id, soi.product_id, COALESCE(soi.warehouse_id, so.warehouse_id)
    ) sl_agg
    LEFT JOIN stock_levels sk
      ON sk.org_id = sl_agg.org_id
     AND sk.product_id = sl_agg.product_id
     AND sk.warehouse_id = sl_agg.eff_wh
    WHERE ABS(sl_agg.total_avail_open - ISNULL(sk.soft_allocated,0) - ISNULL(sk.hard_allocated,0)) > 0.0001
    ORDER BY ABS(sl_agg.total_avail_open - ISNULL(sk.soft_allocated,0) - ISNULL(sk.hard_allocated,0)) DESC
  `);
  console.log(`\n5. Stock soft/hard allocation mismatches vs schedule lines: ${softMismatch.recordset.length}`);
  softMismatch.recordset.forEach(r =>
    console.log(`   org=${r.org_id} product=${r.product_id} wh=${r.eff_wh} | sched_qty=${r.total_avail_open} soft=${r.soft_allocated} hard=${r.hard_allocated} gap=${r.discrepancy}`)
  );

  // 6. qty_scheduled on SO items vs actual schedule lines
  const qtyScheduledMismatch = await q(`
    SELECT
      soi.id AS soi_id, soi.so_id, soi.qty_ordered, soi.qty_scheduled,
      ISNULL(SUM(sl.qty), 0) AS actual_scheduled,
      soi.qty_scheduled - ISNULL(SUM(sl.qty), 0) AS delta,
      so.so_number
    FROM sales_order_items soi
    JOIN sales_orders so ON so.id = soi.so_id
    LEFT JOIN sales_order_schedule_lines sl
      ON sl.so_item_id = soi.id
     AND sl.atp_category = 'available'
     AND sl.status NOT IN ('cancelled')
    WHERE so.status NOT IN ('shipped','invoiced','cancelled')
    GROUP BY soi.id, soi.so_id, soi.qty_ordered, soi.qty_scheduled, so.so_number
    HAVING ABS(soi.qty_scheduled - ISNULL(SUM(sl.qty), 0)) > 0.0001
    ORDER BY ABS(soi.qty_scheduled - ISNULL(SUM(sl.qty), 0)) DESC
  `);
  console.log(`\n6. qty_scheduled on SO items mismatches vs schedule lines: ${qtyScheduledMismatch.recordset.length}`);
  qtyScheduledMismatch.recordset.forEach(r =>
    console.log(`   SO ${r.so_number} | soi.id=${r.soi_id} qty_ordered=${r.qty_ordered} qty_scheduled=${r.qty_scheduled} actual=${r.actual_scheduled} delta=${r.delta}`)
  );

  // 7. Summary counts
  const summary = await q(`
    SELECT
      (SELECT COUNT(*) FROM sales_orders WHERE status NOT IN ('shipped','invoiced','cancelled')) AS open_sos,
      (SELECT COUNT(*) FROM sales_order_schedule_lines WHERE atp_category='available' AND status='open') AS avail_open_lines,
      (SELECT COUNT(*) FROM sales_order_schedule_lines WHERE atp_category='available' AND status='picking') AS avail_picking_lines,
      (SELECT COUNT(*) FROM sales_order_schedule_lines WHERE atp_category='backorder'  AND status='open') AS backorder_lines,
      (SELECT COUNT(*) FROM outbound_deliveries WHERE status IN ('open','picking')) AS open_deliveries,
      (SELECT COUNT(*) FROM outbound_delivery_items WHERE status NOT IN ('shipped','cancelled')) AS open_odi
  `);
  const s = summary.recordset[0];
  console.log('\n7. Summary counts:');
  console.log(`   Open SOs: ${s.open_sos}`);
  console.log(`   Available schedule lines (open): ${s.avail_open_lines}`);
  console.log(`   Available schedule lines (picking): ${s.avail_picking_lines}`);
  console.log(`   Backorder lines: ${s.backorder_lines}`);
  console.log(`   Open outbound deliveries: ${s.open_deliveries}`);
  console.log(`   Open outbound delivery items: ${s.open_odi}`);

  await pool.close();
  console.log('\n=== Diagnostics complete ===\n');
}
run().catch(e => { console.error('❌', e.message); process.exit(1); });
