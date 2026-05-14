'use strict';
// ============================================================
// migrate-sync-backorders-picking.js
//
// One-time data migration to sync existing SO data to the new
// SAP LE/SD ATP + Picking system.
//
// Steps:
//   1. Recalculate qty_scheduled on all open SO items
//      (sum of available non-cancelled schedule lines only)
//   2. Correct atp_status to match new qty_scheduled
//   3. Rebuild soft_allocated / hard_allocated in stock_levels
//      from actual schedule line states
//   4. Generate outbound delivery items for orphaned available
//      schedule lines (available + open + no outbound_item_id)
// ============================================================

require('dotenv').config();
const sql = require('mssql');
const { generatePickingList } = require('../utils/pickingEngine');

const config = {
  server:   process.env.DB_SERVER,
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE,
  options:  { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_CERT === 'true', enableArithAbort: true },
};
if (process.env.DB_WINDOWS_AUTH === 'true') config.options.trustedConnection = true;
else { config.user = process.env.DB_USER; config.password = process.env.DB_PASSWORD; }

async function run() {
  console.log('\n=== Backorder / Picking Data Sync Migration ===\n');
  let pool;
  try {
    pool = await sql.connect(config);

    // ── Step 1 & 2: Recalculate qty_scheduled + atp_status ───────
    console.log('Step 1/4  Recalculating qty_scheduled on open SO items...');

    // Get all open SO items with the correct qty_scheduled
    const itemsRes = await pool.request().query(`
      SELECT
        soi.id,
        soi.qty_ordered,
        soi.qty_scheduled   AS old_scheduled,
        soi.atp_status      AS old_atp_status,
        ISNULL(SUM(CASE
          WHEN sl.atp_category = 'available' AND sl.status NOT IN ('cancelled')
          THEN sl.qty ELSE 0 END), 0) AS correct_scheduled
      FROM sales_order_items soi
      JOIN sales_orders so ON so.id = soi.so_id
      LEFT JOIN sales_order_schedule_lines sl ON sl.so_item_id = soi.id
      WHERE so.status NOT IN ('shipped','invoiced','cancelled')
        AND soi.line_status NOT IN ('cancelled')
      GROUP BY soi.id, soi.qty_ordered, soi.qty_scheduled, soi.atp_status
      HAVING ABS(ISNULL(SUM(CASE
        WHEN sl.atp_category = 'available' AND sl.status NOT IN ('cancelled')
        THEN sl.qty ELSE 0 END), 0) - soi.qty_scheduled) > 0.0001
    `);

    let fixedItems = 0;
    for (const item of itemsRes.recordset) {
      const newScheduled = Number(item.correct_scheduled);
      const newStatus    = newScheduled <= 0 ? 'backorder'
                         : newScheduled >= Number(item.qty_ordered) ? 'full'
                         : 'partial';
      await pool.request()
        .input('id',            sql.Int,           item.id)
        .input('qty_scheduled', sql.Decimal(18,4), newScheduled)
        .input('atp_status',    sql.VarChar(20),   newStatus)
        .query(`
          UPDATE sales_order_items
          SET qty_scheduled=@qty_scheduled, atp_status=@atp_status
          WHERE id=@id
        `);
      console.log(`  ✓ soi.id=${item.id}  qty_scheduled: ${item.old_scheduled} → ${newScheduled}  atp_status: ${item.old_atp_status} → ${newStatus}`);
      fixedItems++;
    }
    console.log(`  Done — ${fixedItems} item(s) corrected.\n`);

    // ── Step 3: Rebuild soft_allocated / hard_allocated ───────────
    console.log('Step 2/4  Rebuilding stock allocation buckets...');

    // Compute correct allocations from schedule lines (per org/product/warehouse)
    // open available → soft_allocated
    // picking available → hard_allocated
    const allocRes = await pool.request().query(`
      SELECT
        so.org_id,
        soi.product_id,
        COALESCE(soi.warehouse_id, so.warehouse_id) AS warehouse_id,
        SUM(CASE WHEN sl.status = 'open'    AND sl.atp_category='available' THEN sl.qty ELSE 0 END) AS correct_soft,
        SUM(CASE WHEN sl.status = 'picking' AND sl.atp_category='available' THEN sl.qty ELSE 0 END) AS correct_hard
      FROM sales_order_schedule_lines sl
      JOIN sales_order_items soi ON soi.id = sl.so_item_id
      JOIN sales_orders so       ON so.id  = sl.so_id
      WHERE sl.atp_category = 'available'
        AND sl.status NOT IN ('shipped','cancelled')
        AND so.status NOT IN ('shipped','invoiced','cancelled')
      GROUP BY so.org_id, soi.product_id, COALESCE(soi.warehouse_id, so.warehouse_id)
    `);

    let fixedStock = 0;
    for (const row of allocRes.recordset) {
      if (row.warehouse_id === null) {
        console.log(`  ⚠  product=${row.product_id} warehouse=NULL — cannot update stock_levels (no warehouse on SO/item). Skipping.`);
        continue;
      }
      // Read current values
      const currRes = await pool.request()
        .input('org_id',       sql.Int, row.org_id)
        .input('product_id',   sql.Int, row.product_id)
        .input('warehouse_id', sql.Int, row.warehouse_id)
        .query(`
          SELECT soft_allocated, hard_allocated
          FROM stock_levels
          WHERE org_id=@org_id AND product_id=@product_id AND warehouse_id=@warehouse_id
        `);
      if (!currRes.recordset.length) {
        console.log(`  ⚠  No stock_levels row for org=${row.org_id} product=${row.product_id} wh=${row.warehouse_id} — skipping.`);
        continue;
      }
      const curr = currRes.recordset[0];
      if (
        Math.abs(Number(curr.soft_allocated) - Number(row.correct_soft)) < 0.0001 &&
        Math.abs(Number(curr.hard_allocated) - Number(row.correct_hard)) < 0.0001
      ) continue; // Already correct

      await pool.request()
        .input('org_id',       sql.Int,           row.org_id)
        .input('product_id',   sql.Int,           row.product_id)
        .input('warehouse_id', sql.Int,           row.warehouse_id)
        .input('soft',         sql.Decimal(18,4), row.correct_soft)
        .input('hard',         sql.Decimal(18,4), row.correct_hard)
        .query(`
          UPDATE stock_levels
          SET soft_allocated=@soft, hard_allocated=@hard, updated_at=GETDATE()
          WHERE org_id=@org_id AND product_id=@product_id AND warehouse_id=@warehouse_id
        `);
      console.log(`  ✓ product=${row.product_id} wh=${row.warehouse_id}  soft: ${curr.soft_allocated}→${row.correct_soft}  hard: ${curr.hard_allocated}→${row.correct_hard}`);
      fixedStock++;
    }

    // Zero out any stock_levels rows where soft/hard_allocated > 0
    // but there are no longer any active schedule lines covering them
    const staleRes = await pool.request().query(`
      SELECT sk.org_id, sk.product_id, sk.warehouse_id, sk.soft_allocated, sk.hard_allocated
      FROM stock_levels sk
      WHERE (sk.soft_allocated > 0 OR sk.hard_allocated > 0)
        AND NOT EXISTS (
          SELECT 1
          FROM sales_order_schedule_lines sl
          JOIN sales_order_items soi ON soi.id = sl.so_item_id
          JOIN sales_orders so       ON so.id  = sl.so_id
          WHERE sl.atp_category = 'available'
            AND sl.status NOT IN ('shipped','cancelled')
            AND so.status NOT IN ('shipped','invoiced','cancelled')
            AND soi.product_id = sk.product_id
            AND COALESCE(soi.warehouse_id, so.warehouse_id) = sk.warehouse_id
            AND so.org_id = sk.org_id
        )
    `);
    for (const row of staleRes.recordset) {
      await pool.request()
        .input('org_id',       sql.Int, row.org_id)
        .input('product_id',   sql.Int, row.product_id)
        .input('warehouse_id', sql.Int, row.warehouse_id)
        .query(`
          UPDATE stock_levels
          SET soft_allocated=0, hard_allocated=0, updated_at=GETDATE()
          WHERE org_id=@org_id AND product_id=@product_id AND warehouse_id=@warehouse_id
        `);
      console.log(`  ✓ Zeroed stale allocations: product=${row.product_id} wh=${row.warehouse_id} (was soft=${row.soft_allocated} hard=${row.hard_allocated})`);
      fixedStock++;
    }
    console.log(`  Done — ${fixedStock} stock_levels row(s) updated.\n`);

    // ── Step 4: Generate picking lists for orphaned available lines ─
    console.log('Step 3/4  Generating outbound delivery items for orphaned available schedule lines...');

    const orphanedSos = await pool.request().query(`
      SELECT DISTINCT sl.so_id, so.org_id, so.so_number
      FROM sales_order_schedule_lines sl
      JOIN sales_orders so ON so.id = sl.so_id
      WHERE sl.atp_category    = 'available'
        AND sl.status          = 'open'
        AND sl.outbound_item_id IS NULL
        AND so.status IN ('confirmed','processing','partially_shipped')
    `);

    let pickingCreated = 0;
    let pickingBlocked = 0;
    for (const row of orphanedSos.recordset) {
      try {
        const result = await generatePickingList({ soId: row.so_id, orgId: row.org_id, pool, sql });
        if (result.created) {
          console.log(`  ✓ SO ${row.so_number} — delivery ${result.deliveryNumber || result.deliveryId}, ${result.itemCount} item(s) added`);
          pickingCreated++;
        } else if (result.blocked) {
          console.log(`  ⚠  SO ${row.so_number} — blocked (${result.reason})`);
          pickingBlocked++;
        } else {
          console.log(`  ⚠  SO ${row.so_number} — no pickable lines found`);
        }
      } catch (err) {
        console.error(`  ❌ SO ${row.so_number}: ${err.message}`);
      }
    }
    console.log(`  Done — ${pickingCreated} picking list(s) created, ${pickingBlocked} blocked.\n`);

    // ── Step 4: Validate outbound delivery header status ──────────
    console.log('Step 4/4  Syncing outbound_delivery header status...');

    // If ALL items are 'picked', delivery status should be 'picked'
    // If at least one item is 'picking', should be 'picking'
    const deliveryStatusRes = await pool.request().query(`
      SELECT
        od.id,
        od.status AS current_status,
        od.delivery_number,
        COUNT(odi.id)                                           AS total_items,
        SUM(CASE WHEN odi.status = 'picked'   THEN 1 ELSE 0 END) AS picked_items,
        SUM(CASE WHEN odi.status = 'shipped'  THEN 1 ELSE 0 END) AS shipped_items,
        SUM(CASE WHEN odi.status = 'open'     THEN 1 ELSE 0 END) AS open_items,
        SUM(CASE WHEN odi.status = 'picking'  THEN 1 ELSE 0 END) AS picking_items
      FROM outbound_deliveries od
      JOIN outbound_delivery_items odi ON odi.delivery_id = od.id AND odi.status != 'cancelled'
      WHERE od.status NOT IN ('shipped','cancelled')
      GROUP BY od.id, od.status, od.delivery_number
    `);

    let fixedDeliveries = 0;
    for (const d of deliveryStatusRes.recordset) {
      let correctStatus = d.current_status;
      if (d.picked_items === d.total_items) correctStatus = 'picked';
      else if (d.picking_items > 0 || d.picked_items > 0) correctStatus = 'picking';
      else correctStatus = 'open';

      if (correctStatus !== d.current_status) {
        await pool.request()
          .input('id',     sql.Int,         d.id)
          .input('status', sql.VarChar(20), correctStatus)
          .query(`UPDATE outbound_deliveries SET status=@status, updated_at=GETDATE() WHERE id=@id`);
        console.log(`  ✓ Delivery ${d.delivery_number}: ${d.current_status} → ${correctStatus}`);
        fixedDeliveries++;
      }
    }
    console.log(`  Done — ${fixedDeliveries} delivery header(s) updated.\n`);

    console.log('✅  Migration complete.\n');
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}
run();
