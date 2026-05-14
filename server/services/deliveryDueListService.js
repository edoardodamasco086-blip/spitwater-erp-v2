'use strict';
// ============================================================
// services/deliveryDueListService.js  — SAP VL10 Delivery Due List
//
// Mimics the SAP SD/LE "Delivery Due List" (transaction VL10).
// Runs as a background job (daily CRON) and ad-hoc via API.
//
// Logic:
//   1. Find all SOs with 'available' schedule lines still in 'open'
//      status (i.e., not yet linked to an outbound delivery).
//   2. For each SO, call generatePickingList which enforces the
//      Full / Partial delivery rule on that order.
//   3. Full-delivery SOs that aren't fully covered are skipped
//      (blocked=true) — they'll be re-evaluated on the next run.
//
// This service is the mechanism by which newly-received goods
// (from posted inbound deliveries → V_V2 rescheduling) are
// automatically converted into picking tasks.
// ============================================================

const { generatePickingList } = require('../utils/pickingEngine');

/**
 * Run the Delivery Due List for all organisations.
 *
 * @param {{ pool: object, sql: object }} deps — mssql pool + types
 * @returns {Promise<{
 *   processed: number,
 *   created:   number,
 *   blocked:   number,
 *   errors:    number,
 *   details:   Array
 * }>}
 */
async function runDeliveryDueList({ pool, sql }) {
  // Find all SOs that have available-but-unassigned schedule lines
  const soRes = await pool.request().query(`
    SELECT DISTINCT sl.so_id, so.org_id, so.so_number
    FROM sales_order_schedule_lines sl
    JOIN sales_orders so ON so.id = sl.so_id
    WHERE sl.atp_category     = 'available'
      AND sl.status           = 'open'
      AND sl.outbound_item_id IS NULL
      AND so.status IN ('confirmed', 'processing', 'partially_shipped')
    ORDER BY so.org_id, sl.so_id
  `);

  const summary = {
    processed: 0,
    created:   0,
    blocked:   0,
    errors:    0,
    details:   [],
  };

  for (const row of soRes.recordset) {
    summary.processed++;

    try {
      const result = await generatePickingList({
        soId:  row.so_id,
        orgId: row.org_id,
        pool,
        sql,
      });

      if (result.created) {
        summary.created++;
        summary.details.push({
          so_id:          row.so_id,
          so_number:      row.so_number,
          outcome:        'created',
          delivery_id:    result.deliveryId,
          delivery_number:result.deliveryNumber,
          items_created:  result.itemCount,
        });
      } else {
        summary.blocked++;
        summary.details.push({
          so_id:     row.so_id,
          so_number: row.so_number,
          outcome:   result.blocked ? 'blocked_full_delivery' : 'skipped',
          reason:    result.reason,
        });
      }
    } catch (err) {
      summary.errors++;
      summary.details.push({
        so_id:     row.so_id,
        so_number: row.so_number,
        outcome:   'error',
        reason:    err.message,
      });
    }
  }

  return summary;
}

module.exports = { runDeliveryDueList };
