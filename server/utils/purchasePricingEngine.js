'use strict';
// ============================================================
// utils/purchasePricingEngine.js — SAP PIR Purchase Price Engine
//
// Mirrors the SAP MM pricing determination procedure:
//   1. Resolve preferred vendor via item_source_list (ranked)
//   2. Find the active PIR condition for product+vendor+date
//   3. Walk pir_scales for volume-tiered price; fall back to base_price
//
// Exports:
//   determinePurchasePrice      — price for explicit product+vendor+qty+date
//   resolveSourceVendor         — preferred vendor from item_source_list
//   determinePriceFromSourceList — combined: resolve vendor, then price
// ============================================================

/**
 * @typedef {Object} PurchasePriceResult
 * @property {number|null} price               - Unit price (null if no condition found)
 * @property {'pir_scale'|'pir_base'|'no_condition'} source - How price was determined
 * @property {number|null} pirId               - purchase_info_records.id
 * @property {number|null} conditionId         - pir_conditions.id
 * @property {number|null} scaleId             - pir_scales.id (null when pir_base)
 * @property {string|null} validFrom           - Condition valid_from (ISO date string)
 * @property {string|null} validTo             - Condition valid_to (ISO date string or null)
 * @property {string|null} currency_code       - Condition currency code
 * @property {string|null} vendorMaterialNumber - PIR vendor material number
 */

/**
 * @typedef {Object} SourceVendorResult
 * @property {number} vendorId      - contacts.id of the resolved vendor
 * @property {number|null} pirId    - purchase_info_records.id linked in source list
 * @property {number} rank          - Source list rank
 * @property {boolean} is_preferred - Whether this entry is flagged preferred
 */

/**
 * Determine the purchase unit price for a given product, vendor, quantity and date.
 *
 * Lookup order:
 *   1. Find the active PIR for org+product+vendor where is_active = 1
 *   2. Within that PIR, find the condition valid on @date (TOP 1 by valid_from DESC)
 *   3. Walk pir_scales (ordered by min_qty DESC) — first row where qty >= min_qty wins
 *   4. If no scale row applies, use pir_conditions.base_price
 *
 * @param {object} p
 * @param {number}  p.orgId
 * @param {number}  p.productId
 * @param {number}  p.vendorId
 * @param {number}  p.qty         - Order quantity (used for scale lookup)
 * @param {string}  p.date        - ISO date string (YYYY-MM-DD) for validity check
 * @param {object}  p.pool        - mssql ConnectionPool
 * @param {object}  p.sql         - mssql module (for typed inputs)
 * @returns {Promise<PurchasePriceResult>}
 */
async function determinePurchasePrice({ orgId, productId, vendorId, qty, date, pool, sql }) {
  // ── 1. Find active PIR ──────────────────────────────────────────
  const pirRes = await pool.request()
    .input('org_id',     sql.Int, orgId)
    .input('product_id', sql.Int, productId)
    .input('vendor_id',  sql.Int, vendorId)
    .query(`
      SELECT TOP 1
        id,
        vendor_material_number
      FROM purchase_info_records
      WHERE org_id     = @org_id
        AND product_id = @product_id
        AND vendor_id  = @vendor_id
        AND is_active  = 1
    `);

  if (!pirRes.recordset.length) {
    return { price: null, source: 'no_condition', pirId: null, conditionId: null,
             scaleId: null, validFrom: null, validTo: null,
             currency_code: null, vendorMaterialNumber: null };
  }

  const pir = pirRes.recordset[0];
  const pirId = pir.id;
  const vendorMaterialNumber = pir.vendor_material_number || null;

  // ── 2. Find active condition for this PIR on @date ──────────────
  const condRes = await pool.request()
    .input('pir_id', sql.Int,      pirId)
    .input('date',   sql.Date,     new Date(date))
    .query(`
      SELECT TOP 1
        id,
        base_price,
        currency_code,
        valid_from,
        valid_to
      FROM pir_conditions
      WHERE pir_id     = @pir_id
        AND valid_from <= @date
        AND (valid_to IS NULL OR valid_to >= @date)
      ORDER BY valid_from DESC
    `);

  if (!condRes.recordset.length) {
    return { price: null, source: 'no_condition', pirId, conditionId: null,
             scaleId: null, validFrom: null, validTo: null,
             currency_code: null, vendorMaterialNumber };
  }

  const cond = condRes.recordset[0];
  const conditionId   = cond.id;
  const basePrice     = Number(cond.base_price);
  const currency_code = cond.currency_code;
  const validFrom     = cond.valid_from ? cond.valid_from.toISOString().slice(0, 10) : null;
  const validTo       = cond.valid_to   ? cond.valid_to.toISOString().slice(0, 10)   : null;

  // ── 3. Load pir_scales ordered by min_qty DESC (largest band first) ─
  const scaleRes = await pool.request()
    .input('pir_condition_id', sql.Int,          conditionId)
    .input('qty',              sql.Decimal(18,4), Number(qty))
    .query(`
      SELECT TOP 1
        id,
        unit_price
      FROM pir_scales
      WHERE pir_condition_id = @pir_condition_id
        AND @qty >= min_qty
      ORDER BY min_qty DESC
    `);

  if (scaleRes.recordset.length) {
    const scale = scaleRes.recordset[0];
    return {
      price:               +Number(scale.unit_price).toFixed(4),
      source:              'pir_scale',
      pirId,
      conditionId,
      scaleId:             scale.id,
      validFrom,
      validTo,
      currency_code,
      vendorMaterialNumber,
    };
  }

  // ── 4. Fall back to base_price ──────────────────────────────────
  return {
    price:               +basePrice.toFixed(4),
    source:              'pir_base',
    pirId,
    conditionId,
    scaleId:             null,
    validFrom,
    validTo,
    currency_code,
    vendorMaterialNumber,
  };
}

/**
 * Resolve the preferred/highest-ranked non-blocked vendor for a product on a given date.
 *
 * Filters item_source_list where:
 *   - is_blocked = 0
 *   - valid_from IS NULL OR valid_from <= @date
 *   - valid_to   IS NULL OR valid_to   >= @date
 *
 * Ordered by: is_preferred DESC, rank ASC
 *
 * @param {object} p
 * @param {number} p.orgId
 * @param {number} p.productId
 * @param {string} p.date        - ISO date string (YYYY-MM-DD)
 * @param {object} p.pool        - mssql ConnectionPool
 * @param {object} p.sql         - mssql module
 * @returns {Promise<SourceVendorResult|null>}
 */
async function resolveSourceVendor({ orgId, productId, date, pool, sql }) {
  const res = await pool.request()
    .input('org_id',     sql.Int,  orgId)
    .input('product_id', sql.Int,  productId)
    .input('date',       sql.Date, new Date(date))
    .query(`
      SELECT TOP 1
        vendor_id,
        pir_id,
        rank,
        is_preferred
      FROM item_source_list
      WHERE org_id     = @org_id
        AND product_id = @product_id
        AND is_blocked = 0
        AND (valid_from IS NULL OR valid_from <= @date)
        AND (valid_to   IS NULL OR valid_to   >= @date)
      ORDER BY is_preferred DESC, rank ASC
    `);

  if (!res.recordset.length) return null;

  const row = res.recordset[0];
  return {
    vendorId:     row.vendor_id,
    pirId:        row.pir_id   || null,
    rank:         row.rank,
    is_preferred: !!row.is_preferred,
  };
}

/**
 * Resolve the preferred vendor from item_source_list, then determine the
 * purchase price via the PIR/condition/scale chain.
 *
 * Returns the full PurchasePriceResult enriched with vendorId,
 * or null if no source vendor was found.
 *
 * @param {object} p
 * @param {number} p.orgId
 * @param {number} p.productId
 * @param {number} p.qty         - Order quantity
 * @param {string} p.date        - ISO date string (YYYY-MM-DD)
 * @param {object} p.pool        - mssql ConnectionPool
 * @param {object} p.sql         - mssql module
 * @returns {Promise<(PurchasePriceResult & { vendorId: number, rank: number, is_preferred: boolean })|null>}
 */
async function determinePriceFromSourceList({ orgId, productId, qty, date, pool, sql }) {
  const source = await resolveSourceVendor({ orgId, productId, date, pool, sql });
  if (!source) return null;

  const priceResult = await determinePurchasePrice({
    orgId,
    productId,
    vendorId: source.vendorId,
    qty,
    date,
    pool,
    sql,
  });

  return {
    ...priceResult,
    vendorId:     source.vendorId,
    rank:         source.rank,
    is_preferred: source.is_preferred,
  };
}

module.exports = {
  determinePurchasePrice,
  resolveSourceVendor,
  determinePriceFromSourceList,
};
