'use strict';
// ============================================================
// utils/o2cEventPublisher.js  — O2C → WMS Event Publisher
//
// Called after an SO is confirmed (credit passed, ATP run).
// For each schedule line with atp_category='available':
//   1. Creates an outbound_delivery record (if not already existing)
//   2. Creates outbound_delivery_items (picking tasks)
//   3. Increments stock_levels.soft_allocated for the product
//
// Backorder lines are NOT sent to WMS immediately — they will be
// triggered when the inbound PO is received (future hook).
// ============================================================

const { getNextNumber } = require('./numbering');

/**
 * Publish WMS outbound picking task for a confirmed SO.
 * Only processes schedule lines with atp_category = 'available'.
 *
 * @param {object} p
 * @param {number} p.soId
 * @param {number} p.orgId
 * @param {object} p.pool
 * @param {object} p.sql
 * @returns {Promise<{ deliveryId: number|null, deliveryNumber: string|null }>}
 */
async function publishPickingTask({ soId, orgId, pool, sql }) {
  // ── 1. Load SO + available schedule lines ──────────────────────
  const soRes = await pool.request()
    .input('id',     sql.Int, soId)
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT id, so_number, customer_id, warehouse_id, requested_delivery_date
      FROM sales_orders WHERE id=@id AND org_id=@org_id
    `);
  if (!soRes.recordset.length) return { deliveryId: null, deliveryNumber: null };
  const so = soRes.recordset[0];

  const linesRes = await pool.request()
    .input('so_id',  sql.Int, soId)
    .query(`
      SELECT sl.id AS schedule_line_id, sl.so_item_id, sl.qty, sl.confirmed_date,
             soi.product_id, soi.warehouse_id AS item_wh
      FROM sales_order_schedule_lines sl
      JOIN sales_order_items soi ON soi.id = sl.so_item_id
      WHERE sl.so_id = @so_id
        AND sl.atp_category = 'available'
        AND sl.status = 'open'
    `);

  const availableLines = linesRes.recordset;
  if (!availableLines.length) return { deliveryId: null, deliveryNumber: null };

  // ── 2. Create outbound delivery header ─────────────────────────
  const { number: deliveryNumber } = await getNextNumber('outbound_delivery', orgId, pool, sql);

  // Resolve warehouse: SO header → first item → org default warehouse
  let warehouseId = so.warehouse_id || availableLines[0]?.item_wh || null;
  if (!warehouseId) {
    const whRes = await pool.request()
      .input('org_id', sql.Int, orgId)
      .query(`SELECT TOP 1 id FROM warehouses WHERE org_id=@org_id AND is_active=1 ORDER BY id ASC`);
    warehouseId = whRes.recordset[0]?.id || null;
  }
  if (!warehouseId) return { deliveryId: null, deliveryNumber: null }; // no warehouse configured

  const delRes = await pool.request()
    .input('org_id',           sql.Int,          orgId)
    .input('delivery_number',  sql.NVarChar(50),  deliveryNumber)
    .input('so_id',            sql.Int,           soId)
    .input('warehouse_id',     sql.Int,           warehouseId)
    .input('planned_ship_date',sql.Date,          so.requested_delivery_date || null)
    .input('created_by',       sql.Int,           null)
    .query(`
      DECLARE @out TABLE (id INT);
      INSERT INTO outbound_deliveries
        (org_id, delivery_number, status, so_id, warehouse_id, planned_ship_date, created_by, created_at, updated_at)
      OUTPUT INSERTED.id INTO @out
      VALUES (@org_id, @delivery_number, 'open', @so_id, @warehouse_id, @planned_ship_date, @created_by, GETDATE(), GETDATE());
      SELECT id FROM @out;
    `);
  const deliveryId = delRes.recordset[0].id;

  // ── 3. Create picking items + soft-allocate stock ──────────────
  for (const line of availableLines) {
    const itemWh = line.item_wh || warehouseId;
    if (!itemWh) continue; // still no warehouse — skip this line

    // Insert outbound delivery item
    const odiRes = await pool.request()
      .input('delivery_id',      sql.Int,           deliveryId)
      .input('so_item_id',       sql.Int,           line.so_item_id)
      .input('schedule_line_id', sql.Int,           line.schedule_line_id)
      .input('org_id',           sql.Int,           orgId)
      .input('product_id',       sql.Int,           line.product_id)
      .input('warehouse_id',     sql.Int,           itemWh)
      .input('qty_to_ship',      sql.Decimal(18,4), Number(line.qty))
      .query(`
        DECLARE @out TABLE (id INT);
        INSERT INTO outbound_delivery_items
          (delivery_id, so_item_id, schedule_line_id, org_id, product_id, warehouse_id, qty_to_ship, qty_picked, qty_shipped, status, created_at)
        OUTPUT INSERTED.id INTO @out
        VALUES (@delivery_id, @so_item_id, @schedule_line_id, @org_id, @product_id, @warehouse_id, @qty_to_ship, 0, 0, 'open', GETDATE());
        SELECT id FROM @out;
      `);

    const odiId = odiRes.recordset[0].id;

    // Link schedule line → outbound_delivery_item + move to 'picking'
    await pool.request()
      .input('id',               sql.Int, line.schedule_line_id)
      .input('outbound_item_id', sql.Int, odiId)
      .query(`
        UPDATE sales_order_schedule_lines
        SET status = 'picking', outbound_item_id = @outbound_item_id
        WHERE id = @id
      `);

    // Soft-allocate stock (upsert stock_levels row if needed)
    await pool.request()
      .input('org_id',      sql.Int,           orgId)
      .input('product_id',  sql.Int,           line.product_id)
      .input('warehouse_id',sql.Int,           itemWh)
      .input('qty',         sql.Decimal(18,4), Number(line.qty))
      .query(`
        IF EXISTS (SELECT 1 FROM stock_levels WHERE org_id=@org_id AND product_id=@product_id AND warehouse_id=@warehouse_id)
          UPDATE stock_levels
          SET soft_allocated = soft_allocated + @qty, updated_at = GETDATE()
          WHERE org_id=@org_id AND product_id=@product_id AND warehouse_id=@warehouse_id
        ELSE
          INSERT INTO stock_levels (org_id, product_id, warehouse_id, qty_on_hand, qty_reserved, qty_on_order, soft_allocated, hard_allocated, updated_at)
          VALUES (@org_id, @product_id, @warehouse_id, 0, 0, 0, @qty, 0, GETDATE())
      `);
  }

  return { deliveryId, deliveryNumber };
}

/**
 * Release soft allocations when an SO is cancelled.
 */
async function releaseAllocations({ soId, orgId, pool, sql }) {
  const linesRes = await pool.request()
    .input('so_id',  sql.Int, soId)
    .query(`
      SELECT sl.id, sl.qty, sl.outbound_item_id,
             soi.product_id, soi.warehouse_id
      FROM sales_order_schedule_lines sl
      JOIN sales_order_items soi ON soi.id = sl.so_item_id
      WHERE sl.so_id = @so_id AND sl.atp_category = 'available' AND sl.status IN ('open','picking')
    `);

  for (const line of linesRes.recordset) {
    const wh = line.warehouse_id;
    if (!wh) continue;
    await pool.request()
      .input('org_id',      sql.Int,           orgId)
      .input('product_id',  sql.Int,           line.product_id)
      .input('warehouse_id',sql.Int,           wh)
      .input('qty',         sql.Decimal(18,4), Number(line.qty))
      .query(`
        UPDATE stock_levels
        SET soft_allocated = CASE WHEN soft_allocated >= @qty THEN soft_allocated - @qty ELSE 0 END, updated_at = GETDATE()
        WHERE org_id=@org_id AND product_id=@product_id AND warehouse_id=@warehouse_id
      `);
  }

  // Cancel outbound deliveries for this SO
  await pool.request().input('so_id', sql.Int, soId).input('org_id', sql.Int, orgId)
    .query(`
      UPDATE outbound_deliveries SET status='cancelled', updated_at=GETDATE()
      WHERE so_id=@so_id AND org_id=@org_id AND status IN ('open','picking')
    `);
}

module.exports = { publishPickingTask, releaseAllocations };
