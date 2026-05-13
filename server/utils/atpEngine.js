'use strict';
// ============================================================
// utils/atpEngine.js  — Available-to-Promise Engine
//
// Calculates real-time ATP for a product+warehouse:
//   available = qty_on_hand - qty_reserved - soft_allocated
//
// If available < requested:
//   - Schedule line 1: available qty, today
//   - Schedule line 2: remainder, earliest open PO delivery date
//
// Returns: { available, scheduleLines, atpStatus }
// ============================================================

const TODAY = () => {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d;
};

/**
 * Run ATP check for one product / warehouse.
 * @param {object} params
 * @param {number} params.productId
 * @param {number} params.warehouseId  — null = check all warehouses for org
 * @param {number} params.orgId
 * @param {number} params.qtyRequested
 * @param {object} params.pool         — mssql pool
 * @param {object} params.sql          — mssql sql types
 * @returns {Promise<{available: number, atpStatus: string, scheduleLines: Array}>}
 */
async function runATP({ productId, warehouseId, orgId, qtyRequested, pool, sql }) {
  // ── 1. Current stock position ──────────────────────────────────
  const stockReq = pool.request()
    .input('org_id',      sql.Int, orgId)
    .input('product_id',  sql.Int, productId);

  let stockSql;
  if (warehouseId) {
    stockReq.input('warehouse_id', sql.Int, warehouseId);
    stockSql = `
      SELECT
        ISNULL(SUM(qty_on_hand),    0) AS on_hand,
        ISNULL(SUM(qty_reserved),   0) AS reserved,
        ISNULL(SUM(soft_allocated), 0) AS soft_alloc,
        ISNULL(SUM(hard_allocated), 0) AS hard_alloc
      FROM stock_levels
      WHERE org_id=@org_id AND product_id=@product_id AND warehouse_id=@warehouse_id
    `;
  } else {
    stockSql = `
      SELECT
        ISNULL(SUM(qty_on_hand),    0) AS on_hand,
        ISNULL(SUM(qty_reserved),   0) AS reserved,
        ISNULL(SUM(soft_allocated), 0) AS soft_alloc,
        ISNULL(SUM(hard_allocated), 0) AS hard_alloc
      FROM stock_levels
      WHERE org_id=@org_id AND product_id=@product_id
    `;
  }

  const stockRes = await stockReq.query(stockSql);
  const s = stockRes.recordset[0];
  const onHand    = Number(s.on_hand);
  const reserved  = Number(s.reserved);
  const softAlloc = Number(s.soft_alloc);
  const hardAlloc = Number(s.hard_alloc);

  // Hard allocated (actively picking) is already deducted from on_hand by WMS
  // Soft allocated = confirmed SOs not yet in picking — deduct from available
  const available = Math.max(0, onHand - reserved - softAlloc);

  const qty = Number(qtyRequested);

  // ── 2. Build schedule lines ────────────────────────────────────
  const today = TODAY();
  const scheduleLines = [];

  if (available >= qty) {
    // Full stock available immediately
    scheduleLines.push({
      schedule_line_no: 1,
      qty,
      confirmed_date:   today,
      atp_category:     'available',
      source_type:      'stock',
      source_po_id:     null,
    });
    return { available, atpStatus: 'ok', scheduleLines, atpDate: today };
  }

  // ── 3. Partial — check open POs for backorder date ─────────────
  const remainderQty = qty - available;

  // Find earliest open PO that covers the remainder (same product)
  const poReq = pool.request()
    .input('org_id',     sql.Int, orgId)
    .input('product_id', sql.Int, productId);

  let poWhereExtra = '';
  if (warehouseId) {
    poReq.input('warehouse_id', sql.Int, warehouseId);
    poWhereExtra = ' AND po.warehouse_id = @warehouse_id';
  }

  const poRes = await poReq.query(`
    SELECT TOP 10
      po.id AS po_id,
      po.expected_delivery_date,
      poi.qty_ordered - poi.qty_received AS qty_outstanding
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.po_id
    WHERE po.org_id = @org_id
      AND poi.product_id = @product_id
      AND po.status IN ('approved','sent','partially_received')
      AND poi.qty_ordered > poi.qty_received
      ${poWhereExtra}
    ORDER BY po.expected_delivery_date ASC
  `);

  // If some stock is available now, create immediate schedule line first
  if (available > 0) {
    scheduleLines.push({
      schedule_line_no: 1,
      qty:              available,
      confirmed_date:   today,
      atp_category:     'available',
      source_type:      'stock',
      source_po_id:     null,
    });
  }

  if (poRes.recordset.length === 0) {
    // No open POs — full backorder with no confirmed date (use 30 days from today)
    const backorderDate = new Date(today);
    backorderDate.setDate(backorderDate.getDate() + 30);
    scheduleLines.push({
      schedule_line_no: available > 0 ? 2 : 1,
      qty:              remainderQty,
      confirmed_date:   backorderDate,
      atp_category:     'backorder',
      source_type:      null,
      source_po_id:     null,
    });
    return {
      available,
      atpStatus: available > 0 ? 'partial' : 'backorder',
      scheduleLines,
      atpDate: backorderDate,
    };
  }

  // Allocate remaining qty across open POs chronologically
  let stillNeeded = remainderQty;
  let lineNo      = available > 0 ? 2 : 1;
  let latestDate  = null;

  for (const po of poRes.recordset) {
    if (stillNeeded <= 0) break;
    const fromPo = Math.min(stillNeeded, Number(po.qty_outstanding));
    const delivDate = po.expected_delivery_date
      ? new Date(po.expected_delivery_date)
      : (() => { const d = new Date(today); d.setDate(d.getDate() + 14); return d; })();
    scheduleLines.push({
      schedule_line_no: lineNo++,
      qty:              fromPo,
      confirmed_date:   delivDate,
      atp_category:     'backorder',
      source_type:      'purchase_order',
      source_po_id:     po.po_id,
    });
    stillNeeded -= fromPo;
    if (!latestDate || delivDate > latestDate) latestDate = delivDate;
  }

  // Any remaining qty still not covered
  if (stillNeeded > 0) {
    const fallback = new Date(today);
    fallback.setDate(fallback.getDate() + 30);
    scheduleLines.push({
      schedule_line_no: lineNo,
      qty:              stillNeeded,
      confirmed_date:   fallback,
      atp_category:     'backorder',
      source_type:      null,
      source_po_id:     null,
    });
    if (!latestDate || fallback > latestDate) latestDate = fallback;
  }

  return {
    available,
    atpStatus:  available > 0 ? 'partial' : 'backorder',
    scheduleLines,
    atpDate:    latestDate,
  };
}

module.exports = { runATP };
