'use strict';
// ============================================================
// utils/pickingEngine.js  — SAP LE/SD Delivery Fulfillment Engine
//
// Implements Full / Partial delivery rules mirroring SAP SD
// "Delivery Complete" / "Partial Delivery" document control.
//
// Full delivery  (is_full_delivery_required = 1):
//   All active SO items must have 100% coverage from 'available'
//   open schedule lines before any outbound delivery is created.
//
// Partial delivery (is_full_delivery_required = 0):
//   Any item with available stock generates picking tasks.
//   Uncovered qty remains as open backorder.
//
// Stock state machine:
//   SO confirm  → soft_allocated += qty_available    (reservation)
//   Pick item   → soft_allocated -= qty              (move to hard)
//               → hard_allocated += qty              (physical pick)
//   Ship / GI   → hard_allocated -= qty_shipped      (goods issue)
//               → qty_on_hand    -= qty_shipped      (physical deduct)
// ============================================================

const { getNextNumber } = require('./numbering');

/**
 * Evaluate whether an SO is eligible for outbound delivery creation.
 *
 * @returns {{
 *   canCreate:      boolean,
 *   blocked:        boolean,   // true only when full-delivery rule blocks it
 *   reason:         string|null,
 *   pickableLines:  Array,     // [{so_item_id, sched_line_id, product_id, warehouse_id, qty}]
 *   isFullRequired: boolean,
 *   so:             object|null
 * }}
 */
async function evaluateDeliveryReadiness({ soId, orgId, pool, sql }) {
  // ── 1. SO header ──────────────────────────────────────────────
  const soRes = await pool.request()
    .input('id',     sql.Int, soId)
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT id, warehouse_id, is_full_delivery_required, requested_delivery_date
      FROM sales_orders
      WHERE id = @id AND org_id = @org_id
    `);
  if (!soRes.recordset.length)
    return { canCreate: false, blocked: false, reason: 'SO not found.', pickableLines: [], isFullRequired: false, so: null };

  const so             = soRes.recordset[0];
  const isFullRequired = !!so.is_full_delivery_required;

  // ── 2. Active open items (not closed / fully shipped) ─────────
  const itemsRes = await pool.request()
    .input('so_id', sql.Int, soId)
    .query(`
      SELECT id, qty_ordered, product_id, warehouse_id,
             ISNULL(qty_shipped, 0) AS qty_shipped
      FROM sales_order_items
      WHERE so_id     = @so_id
        AND line_status = 'open'
        AND qty_ordered > ISNULL(qty_shipped, 0)
    `);

  const items = itemsRes.recordset;
  if (!items.length)
    return { canCreate: false, blocked: false, reason: 'No open items to fulfill.', pickableLines: [], isFullRequired, so };

  // ── 3. Per-item availability check ───────────────────────────
  const pickableLines  = [];
  let   allFullyCovered = true;

  for (const item of items) {
    const openQty = Number(item.qty_ordered) - Number(item.qty_shipped);

    // Available schedule lines not yet linked to a delivery
    const linesRes = await pool.request()
      .input('so_item_id', sql.Int, item.id)
      .query(`
        SELECT id AS sched_line_id, qty, confirmed_date
        FROM sales_order_schedule_lines
        WHERE so_item_id       = @so_item_id
          AND atp_category     = 'available'
          AND status           = 'open'
          AND outbound_item_id IS NULL
        ORDER BY confirmed_date ASC
      `);

    const lines    = linesRes.recordset;
    const availQty = lines.reduce((s, l) => s + Number(l.qty), 0);

    if (availQty < openQty) allFullyCovered = false;

    for (const sl of lines) {
      pickableLines.push({
        so_item_id:    item.id,
        sched_line_id: sl.sched_line_id,
        product_id:    item.product_id,
        warehouse_id:  item.warehouse_id || so.warehouse_id,
        qty:           Number(sl.qty),
      });
    }
  }

  // ── 4. Full-delivery gate ─────────────────────────────────────
  if (isFullRequired && !allFullyCovered) {
    return {
      canCreate:      false,
      blocked:        true,
      reason:         'Full delivery required — one or more lines have insufficient ATP. Picking list blocked until all lines are fully available.',
      pickableLines:  [],
      isFullRequired,
      so,
    };
  }

  if (!pickableLines.length) {
    return {
      canCreate:      false,
      blocked:        false,
      reason:         'No available stock to generate a picking list.',
      pickableLines:  [],
      isFullRequired,
      so,
    };
  }

  return { canCreate: true, blocked: false, reason: null, pickableLines, isFullRequired, so };
}

/**
 * Generate (or extend) an outbound delivery / picking list for a Sales Order.
 *
 * Respects is_full_delivery_required:
 *   - Full : only creates delivery when ALL items are 100% covered.
 *   - Partial: creates delivery for whatever is currently available.
 *
 * Finds an existing open/picking delivery for the SO before creating a new one
 * so partial deliveries are extended in-place rather than duplicated.
 *
 * @returns {{
 *   created:        boolean,
 *   blocked:        boolean,
 *   reason:         string|null,
 *   deliveryId:     number|null,
 *   deliveryNumber: string|null,
 *   itemCount:      number
 * }}
 */
async function generatePickingList({ soId, orgId, pool, sql }) {
  const readiness = await evaluateDeliveryReadiness({ soId, orgId, pool, sql });

  if (!readiness.canCreate) {
    return {
      created:        false,
      blocked:        readiness.blocked,
      reason:         readiness.reason,
      deliveryId:     null,
      deliveryNumber: null,
      itemCount:      0,
    };
  }

  const so = readiness.so;

  // ── Find or create outbound delivery header ───────────────────
  const existRes = await pool.request()
    .input('so_id',  sql.Int, soId)
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT TOP 1 id, delivery_number
      FROM outbound_deliveries
      WHERE so_id = @so_id AND org_id = @org_id AND status IN ('open','picking')
      ORDER BY created_at DESC
    `);

  let deliveryId     = existRes.recordset[0]?.id             || null;
  let deliveryNumber = existRes.recordset[0]?.delivery_number || null;

  if (!deliveryId) {
    const { number } = await getNextNumber('outbound_delivery', orgId, pool, sql);
    deliveryNumber   = number;

    const warehouseId = so.warehouse_id
      || readiness.pickableLines.find(l => l.warehouse_id)?.warehouse_id
      || null;

    const createRes = await pool.request()
      .input('org_id',           sql.Int,          orgId)
      .input('delivery_number',  sql.NVarChar(50),  number)
      .input('so_id',            sql.Int,          soId)
      .input('warehouse_id',     sql.Int,          warehouseId)
      .input('planned_ship_date',sql.Date,          so.requested_delivery_date || null)
      .query(`
        DECLARE @out TABLE (id INT);
        INSERT INTO outbound_deliveries
          (org_id, delivery_number, status, so_id, warehouse_id,
           planned_ship_date, created_at, updated_at)
        OUTPUT INSERTED.id INTO @out
        VALUES (@org_id, @delivery_number, 'open', @so_id, @warehouse_id,
                @planned_ship_date, GETDATE(), GETDATE());
        SELECT id FROM @out;
      `);
    deliveryId = createRes.recordset[0].id;
  }

  // ── Insert picking items for each available schedule line ─────
  let itemCount = 0;

  for (const line of readiness.pickableLines) {
    // Insert outbound delivery item
    const odiRes = await pool.request()
      .input('delivery_id',      sql.Int,           deliveryId)
      .input('so_item_id',       sql.Int,           line.so_item_id)
      .input('schedule_line_id', sql.Int,           line.sched_line_id)
      .input('org_id',           sql.Int,           orgId)
      .input('product_id',       sql.Int,           line.product_id)
      .input('warehouse_id',     sql.Int,           line.warehouse_id || null)
      .input('qty_to_ship',      sql.Decimal(18,4), line.qty)
      .query(`
        DECLARE @out TABLE (id INT);
        INSERT INTO outbound_delivery_items
          (delivery_id, so_item_id, schedule_line_id, org_id,
           product_id, warehouse_id, qty_to_ship,
           qty_picked, qty_shipped, status, created_at)
        OUTPUT INSERTED.id INTO @out
        VALUES (@delivery_id, @so_item_id, @schedule_line_id, @org_id,
                @product_id, @warehouse_id, @qty_to_ship,
                0, 0, 'open', GETDATE());
        SELECT id FROM @out;
      `);

    const odiId = odiRes.recordset[0].id;

    // Link schedule line → delivery item; advance status to 'picking'
    await pool.request()
      .input('id',               sql.Int, line.sched_line_id)
      .input('outbound_item_id', sql.Int, odiId)
      .query(`
        UPDATE sales_order_schedule_lines
        SET status           = 'picking',
            outbound_item_id = @outbound_item_id
        WHERE id = @id
      `);

    itemCount++;
  }

  return {
    created:        true,
    blocked:        false,
    reason:         null,
    deliveryId,
    deliveryNumber,
    itemCount,
  };
}

module.exports = { evaluateDeliveryReadiness, generatePickingList };
