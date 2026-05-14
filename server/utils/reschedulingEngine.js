'use strict';
// ============================================================
// utils/reschedulingEngine.js  — SAP V_V2 Rescheduling Engine
//
// Triggered after every Goods Receipt to redistribute newly-available
// physical stock to open backorder schedule lines.
//
// Priority rules (mirror SAP MRP/ATP):
//   1. Requested Delivery Date (earliest first; NULLs last)
//   2. Sales Order created_at (FIFO tie-breaker)
//
// For each reallocated line:
//   - Converts backorder → available (in-place if full; splits if partial)
//   - Updates stock_levels.soft_allocated
//   - Updates SO item atp_status / qty_scheduled
//   - Finds or creates an open outbound delivery and inserts a picking item
// ============================================================

const { getNextNumber } = require('./numbering');

/**
 * Re-allocate free ATP to open backorder lines for a given product+warehouse.
 *
 * @param {object} p
 * @param {number} p.productId
 * @param {number} p.warehouseId
 * @param {number} p.orgId
 * @param {object} p.pool
 * @param {object} p.sql
 * @returns {Promise<{ reallocated: number, lines: Array }>}
 */
async function runRescheduling({ productId, warehouseId, orgId, pool, sql }) {
  // ── 1. Current stock position ──────────────────────────────────
  const stockRes = await pool.request()
    .input('org_id',       sql.Int, orgId)
    .input('product_id',   sql.Int, productId)
    .input('warehouse_id', sql.Int, warehouseId)
    .query(`
      SELECT ISNULL(SUM(qty_on_hand),    0) AS on_hand,
             ISNULL(SUM(soft_allocated), 0) AS soft_alloc,
             ISNULL(SUM(hard_allocated), 0) AS hard_alloc
      FROM stock_levels
      WHERE org_id=@org_id AND product_id=@product_id AND warehouse_id=@warehouse_id
    `);

  const s      = stockRes.recordset[0];
  let freeAtp  = Math.max(0, Number(s.on_hand) - Number(s.soft_alloc) - Number(s.hard_alloc));
  if (freeAtp === 0) return { reallocated: 0, lines: [] };

  // ── 2. Open backorder lines — RDD ASC, FIFO tie-break ─────────
  const boRes = await pool.request()
    .input('org_id',       sql.Int, orgId)
    .input('product_id',   sql.Int, productId)
    .input('warehouse_id', sql.Int, warehouseId)
    .query(`
      SELECT sl.id         AS sched_line_id,
             sl.qty,
             sl.so_item_id,
             sl.so_id,
             soi.requested_delivery_date AS rdd,
             so.created_at               AS so_created_at,
             soi.product_id,
             COALESCE(soi.warehouse_id, so.warehouse_id) AS eff_warehouse_id
      FROM   sales_order_schedule_lines sl
      JOIN   sales_order_items soi ON soi.id  = sl.so_item_id
      JOIN   sales_orders      so  ON so.id   = sl.so_id
      WHERE  so.org_id           = @org_id
        AND  sl.atp_category     = 'backorder'
        AND  sl.status           = 'open'
        AND  soi.product_id      = @product_id
        AND  COALESCE(soi.warehouse_id, so.warehouse_id) = @warehouse_id
        AND  soi.line_status     = 'open'
        AND  so.status IN ('confirmed','processing','partially_shipped')
      ORDER BY
        CASE WHEN soi.requested_delivery_date IS NULL THEN 1 ELSE 0 END,
        soi.requested_delivery_date ASC,
        so.created_at ASC
    `);

  const backorders = boRes.recordset;
  if (!backorders.length) return { reallocated: 0, lines: [] };

  const results = [];

  // Cache SO full-delivery flags to avoid repeated DB round-trips per loop
  const soFlagCache = {};
  async function isFullDeliveryRequired(soId) {
    if (soFlagCache[soId] !== undefined) return soFlagCache[soId];
    const r = await pool.request().input('id', sql.Int, soId)
      .query('SELECT is_full_delivery_required FROM sales_orders WHERE id=@id');
    soFlagCache[soId] = !!r.recordset[0]?.is_full_delivery_required;
    return soFlagCache[soId];
  }

  // ── 3. Allocate in priority order ─────────────────────────────
  for (const bo of backorders) {
    if (freeAtp <= 0) break;

    const boQty        = Number(bo.qty);
    const allocQty     = Math.min(boQty, freeAtp);
    const confirmedDate = bo.rdd ? new Date(bo.rdd) : new Date();
    let   newSchedLineId;

    if (allocQty >= boQty) {
      // ── Full conversion in-place ─────────────────────────────
      await pool.request()
        .input('id',   sql.Int,  bo.sched_line_id)
        .input('date', sql.Date, confirmedDate)
        .query(`
          UPDATE sales_order_schedule_lines
          SET atp_category = 'available', confirmed_date = @date
          WHERE id = @id
        `);
      newSchedLineId = bo.sched_line_id;

    } else {
      // ── Partial: shrink backorder, insert new available line ──
      await pool.request()
        .input('id',  sql.Int,           bo.sched_line_id)
        .input('qty', sql.Decimal(18,4), boQty - allocQty)
        .query(`UPDATE sales_order_schedule_lines SET qty=@qty WHERE id=@id`);

      const noRes = await pool.request()
        .input('so_item_id', sql.Int, bo.so_item_id)
        .query(`
          SELECT ISNULL(MAX(schedule_line_no),0)+1 AS n
          FROM sales_order_schedule_lines WHERE so_item_id=@so_item_id
        `);

      const insRes = await pool.request()
        .input('so_item_id',       sql.Int,           bo.so_item_id)
        .input('so_id',            sql.Int,           bo.so_id)
        .input('org_id',           sql.Int,           orgId)
        .input('schedule_line_no', sql.Int,           noRes.recordset[0].n)
        .input('qty',              sql.Decimal(18,4), allocQty)
        .input('confirmed_date',   sql.Date,          confirmedDate)
        .query(`
          DECLARE @out TABLE (id INT);
          INSERT INTO sales_order_schedule_lines
            (so_item_id, so_id, org_id, schedule_line_no, qty, confirmed_date,
             atp_category, source_type, status, created_at)
          OUTPUT INSERTED.id INTO @out
          VALUES (@so_item_id, @so_id, @org_id, @schedule_line_no, @qty, @confirmed_date,
                  'available', 'stock', 'open', GETDATE());
          SELECT id FROM @out;
        `);
      newSchedLineId = insRes.recordset[0].id;
    }

    // ── Soft-allocate the newly available qty ──────────────────
    await pool.request()
      .input('org_id',       sql.Int,           orgId)
      .input('product_id',   sql.Int,           productId)
      .input('warehouse_id', sql.Int,           warehouseId)
      .input('qty',          sql.Decimal(18,4), allocQty)
      .query(`
        UPDATE stock_levels
        SET soft_allocated = soft_allocated + @qty, updated_at = GETDATE()
        WHERE org_id=@org_id AND product_id=@product_id AND warehouse_id=@warehouse_id
      `);

    // ── Update SO item atp_status / qty_scheduled ──────────────
    const itemRes = await pool.request()
      .input('id', sql.Int, bo.so_item_id)
      .query(`SELECT qty_ordered, ISNULL(qty_scheduled,0) AS qty_scheduled FROM sales_order_items WHERE id=@id`);
    if (itemRes.recordset.length) {
      const it           = itemRes.recordset[0];
      const newScheduled = Number(it.qty_scheduled) + allocQty;
      const newStatus    = newScheduled >= Number(it.qty_ordered) ? 'full' : 'partial';
      await pool.request()
        .input('id',            sql.Int,           bo.so_item_id)
        .input('qty_scheduled', sql.Decimal(18,4), newScheduled)
        .input('atp_status',    sql.VarChar(20),   newStatus)
        .query(`UPDATE sales_order_items SET qty_scheduled=@qty_scheduled, atp_status=@atp_status WHERE id=@id`);
    }

    // ── Create / extend outbound delivery ─────────────────────
    // Skip for full-delivery SOs — the DDL job creates the delivery
    // only when ALL lines reach 100% ATP coverage.
    const fullDelivery = await isFullDeliveryRequired(bo.so_id);
    if (!fullDelivery) {
      await ensureOutboundDeliveryItem({
        soId:        bo.so_id,
        soItemId:    bo.so_item_id,
        schedLineId: newSchedLineId,
        productId,
        warehouseId,
        qty:         allocQty,
        orgId,
        pool,
        sql,
      });
    }

    freeAtp -= allocQty;
    results.push({
      schedLineId: newSchedLineId,
      soId:        bo.so_id,
      qty:         allocQty,
      rdd:         bo.rdd,
    });
  }

  return { reallocated: results.length, lines: results };
}

/**
 * Find an open outbound delivery for the SO, or create one, then add the item.
 */
async function ensureOutboundDeliveryItem({ soId, soItemId, schedLineId, productId, warehouseId, qty, orgId, pool, sql }) {
  const delRes = await pool.request()
    .input('so_id',  sql.Int, soId)
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT TOP 1 id FROM outbound_deliveries
      WHERE so_id=@so_id AND org_id=@org_id AND status IN ('open','picking')
      ORDER BY created_at DESC
    `);

  let deliveryId = delRes.recordset[0]?.id || null;

  if (!deliveryId) {
    const { number: delNum } = await getNextNumber('outbound_delivery', orgId, pool, sql);
    const createRes = await pool.request()
      .input('org_id',          sql.Int,         orgId)
      .input('delivery_number', sql.NVarChar(50), delNum)
      .input('so_id',           sql.Int,         soId)
      .input('warehouse_id',    sql.Int,         warehouseId)
      .query(`
        DECLARE @out TABLE (id INT);
        INSERT INTO outbound_deliveries
          (org_id, delivery_number, status, so_id, warehouse_id, created_at, updated_at)
        OUTPUT INSERTED.id INTO @out
        VALUES (@org_id, @delivery_number, 'open', @so_id, @warehouse_id, GETDATE(), GETDATE());
        SELECT id FROM @out;
      `);
    deliveryId = createRes.recordset[0].id;
  }

  const odiRes = await pool.request()
    .input('delivery_id',     sql.Int,           deliveryId)
    .input('so_item_id',      sql.Int,           soItemId)
    .input('schedule_line_id',sql.Int,           schedLineId)
    .input('org_id',          sql.Int,           orgId)
    .input('product_id',      sql.Int,           productId)
    .input('warehouse_id',    sql.Int,           warehouseId)
    .input('qty_to_ship',     sql.Decimal(18,4), qty)
    .query(`
      DECLARE @out TABLE (id INT);
      INSERT INTO outbound_delivery_items
        (delivery_id, so_item_id, schedule_line_id, org_id, product_id, warehouse_id,
         qty_to_ship, qty_picked, qty_shipped, status, created_at)
      OUTPUT INSERTED.id INTO @out
      VALUES (@delivery_id, @so_item_id, @schedule_line_id, @org_id, @product_id, @warehouse_id,
              @qty_to_ship, 0, 0, 'open', GETDATE());
      SELECT id FROM @out;
    `);

  const odiId = odiRes.recordset[0].id;

  await pool.request()
    .input('id',               sql.Int, schedLineId)
    .input('outbound_item_id', sql.Int, odiId)
    .query(`
      UPDATE sales_order_schedule_lines
      SET status='picking', outbound_item_id=@outbound_item_id
      WHERE id=@id
    `);
}

module.exports = { runRescheduling };
