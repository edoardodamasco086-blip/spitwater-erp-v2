'use strict';
// ============================================================
// Putaway Strategy Engine
//
// Resolution priority (first match wins):
//   1. fixed_bin      — explicit bin for product or category
//   2. next_empty     — first empty bin in a configured zone
//   3. by_category    — first available bin in a zone for the category
//   4. dedicated      — bin.dedicated_product_id = product_id
//   5. any_available  — first unlocked bin in warehouse (fallback)
//
// Returns: { bin_id, bin_code, zone_id, strategy, reason } | null
// ============================================================

async function suggestBin({ productId, categoryId, warehouseId, orgId, pool, sql }) {
  // Load all active rules for this org/warehouse ordered by priority
  const rulesRes = await pool.request()
    .input('org_id',       sql.Int, orgId)
    .input('warehouse_id', sql.Int, warehouseId)
    .query(`
      SELECT id, rule_type, product_id, category_id, zone_id, bin_id, priority
      FROM putaway_rules
      WHERE org_id = @org_id
        AND (warehouse_id = @warehouse_id OR warehouse_id IS NULL)
        AND is_active = 1
      ORDER BY priority ASC
    `);

  for (const rule of rulesRes.recordset) {
    const matchesProduct  = rule.product_id  === null || rule.product_id  === productId;
    const matchesCategory = rule.category_id === null || rule.category_id === categoryId;
    if (!matchesProduct || !matchesCategory) continue;

    if (rule.rule_type === 'fixed_bin' && rule.bin_id) {
      const b = await getActiveBin(rule.bin_id, orgId, pool, sql);
      if (b) return { ...b, strategy: 'fixed_bin', reason: `Rule #${rule.id}: fixed bin for ${rule.product_id ? 'product' : 'category'}` };
    }

    if (rule.rule_type === 'next_empty' && rule.zone_id) {
      const b = await pool.request()
        .input('org_id',       sql.Int, orgId)
        .input('warehouse_id', sql.Int, warehouseId)
        .input('zone_id',      sql.Int, rule.zone_id)
        .query(`
          SELECT TOP 1 wb.id AS bin_id, wb.bin_code, wb.zone_id
          FROM warehouse_bins wb
          WHERE wb.org_id = @org_id AND wb.warehouse_id = @warehouse_id
            AND wb.zone_id = @zone_id AND wb.is_active = 1 AND wb.is_locked = 0
            AND NOT EXISTS (
              SELECT 1 FROM stock_levels sl
              WHERE sl.bin_id = wb.id AND sl.qty_on_hand > 0
            )
          ORDER BY wb.pick_sequence ASC, wb.bin_code ASC
        `);
      if (b.recordset.length) return { ...b.recordset[0], strategy: 'next_empty', reason: `Rule #${rule.id}: next empty bin in zone` };
    }

    if (rule.rule_type === 'by_category' && rule.zone_id) {
      const b = await pool.request()
        .input('org_id',       sql.Int, orgId)
        .input('warehouse_id', sql.Int, warehouseId)
        .input('zone_id',      sql.Int, rule.zone_id)
        .query(`
          SELECT TOP 1 wb.id AS bin_id, wb.bin_code, wb.zone_id
          FROM warehouse_bins wb
          WHERE wb.org_id = @org_id AND wb.warehouse_id = @warehouse_id
            AND wb.zone_id = @zone_id AND wb.is_active = 1 AND wb.is_locked = 0
          ORDER BY wb.pick_sequence ASC, wb.bin_code ASC
        `);
      if (b.recordset.length) return { ...b.recordset[0], strategy: 'by_category', reason: `Rule #${rule.id}: category zone routing` };
    }
  }

  // Dedicated bin (no explicit rule needed)
  if (productId) {
    const d = await pool.request()
      .input('org_id',       sql.Int, orgId)
      .input('warehouse_id', sql.Int, warehouseId)
      .input('product_id',   sql.Int, productId)
      .query(`
        SELECT TOP 1 id AS bin_id, bin_code, zone_id
        FROM warehouse_bins
        WHERE org_id = @org_id AND warehouse_id = @warehouse_id
          AND dedicated_product_id = @product_id AND is_active = 1 AND is_locked = 0
      `);
    if (d.recordset.length) return { ...d.recordset[0], strategy: 'dedicated', reason: 'Dedicated bin for product' };
  }

  // Last resort: first unlocked bin in warehouse
  const any = await pool.request()
    .input('org_id',       sql.Int, orgId)
    .input('warehouse_id', sql.Int, warehouseId)
    .query(`
      SELECT TOP 1 id AS bin_id, bin_code, zone_id
      FROM warehouse_bins
      WHERE org_id = @org_id AND warehouse_id = @warehouse_id
        AND is_active = 1 AND is_locked = 0
      ORDER BY pick_sequence ASC, bin_code ASC
    `);
  if (any.recordset.length) return { ...any.recordset[0], strategy: 'any_available', reason: 'No rules matched — first available bin' };

  return null;
}

async function getActiveBin(binId, orgId, pool, sql) {
  const res = await pool.request()
    .input('id',     sql.Int, binId)
    .input('org_id', sql.Int, orgId)
    .query('SELECT id AS bin_id, bin_code, zone_id FROM warehouse_bins WHERE id=@id AND org_id=@org_id AND is_active=1 AND is_locked=0');
  return res.recordset[0] || null;
}

module.exports = { suggestBin };
