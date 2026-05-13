'use strict';
// ============================================================
// utils/pricingEngine.js  — Dynamic Pricing Procedure
//
// Hierarchy (SAP SD-style):
//   1. Base Price       — from price_list_items (customer's assigned list)
//                         or products.default_sales_price as fallback
//   2. Customer Discount— pricing_conditions WHERE condition_type='customer_discount'
//                         scoped to: specific product | product's category | all
//   3. Volume Break     — pricing_conditions WHERE condition_type='volume_break'
//                         AND min_qty <= @qty < max_qty
//   4. GST / Tax        — pricing_conditions WHERE condition_type='gst'
//
// Scope resolution for product/category conditions:
//   specific product > category match > all products (product_id IS NULL AND category_id IS NULL)
//
// Returns: { basePrice, customerDiscountPct, volumeDiscountPct, unitPrice, taxRate, taxAmount, lineTotal }
// ============================================================

/**
 * Calculate price for one line item.
 * @param {object} p
 * @param {number}      p.orgId
 * @param {number}      p.productId
 * @param {number|null} p.customerId
 * @param {number|null} p.priceListId   — customer's assigned price list
 * @param {number}      p.qty
 * @param {boolean}     p.customerGstRegistered
 * @param {object}      p.pool
 * @param {object}      p.sql
 * @returns {Promise<PricingResult>}
 */
async function calculatePrice({ orgId, productId, customerId, priceListId, qty, customerGstRegistered, pool, sql }) {
  // ── 1. Base Price ──────────────────────────────────────────────
  let basePrice = 0;

  if (priceListId) {
    const plRes = await pool.request()
      .input('pl_id',      sql.Int, priceListId)
      .input('product_id', sql.Int, productId)
      .query(`
        SELECT TOP 1 unit_price
        FROM price_list_items
        WHERE price_list_id = @pl_id AND product_id = @product_id
      `);
    if (plRes.recordset.length) basePrice = Number(plRes.recordset[0].unit_price);
  }

  // Fall back to product's default sales price
  if (!basePrice) {
    const prodRes = await pool.request()
      .input('id',     sql.Int, productId)
      .input('org_id', sql.Int, orgId)
      .query(`SELECT default_sales_price, category_id FROM products WHERE id=@id AND org_id=@org_id`);
    if (prodRes.recordset.length) {
      basePrice = Number(prodRes.recordset[0].default_sales_price || 0);
    }
  }

  // ── 1b. Resolve product's category for category-scoped conditions ─
  const catRes = await pool.request()
    .input('id',     sql.Int, productId)
    .input('org_id', sql.Int, orgId)
    .query(`SELECT category_id FROM products WHERE id=@id AND org_id=@org_id`);
  const productCategoryId = catRes.recordset[0]?.category_id || null;

  // ── 2. Load applicable pricing conditions ──────────────────────
  const condRes = await pool.request()
    .input('org_id',       sql.Int,           orgId)
    .input('customer_id',  sql.Int,           customerId)
    .input('product_id',   sql.Int,           productId)
    .input('category_id',  sql.Int,           productCategoryId)
    .input('qty',          sql.Decimal(18,4), Number(qty))
    .query(`
      SELECT condition_type, priority, discount_type, discount_value, tax_rate,
             min_qty, max_qty, product_id, category_id, customer_id
      FROM pricing_conditions
      WHERE org_id = @org_id
        AND is_active = 1
        AND (valid_from IS NULL OR valid_from <= CAST(GETDATE() AS DATE))
        AND (valid_to   IS NULL OR valid_to   >= CAST(GETDATE() AS DATE))
        AND condition_type IN ('customer_discount','volume_break','gst')
        AND (
              -- Customer discount: customer scope + product/category scope
              (condition_type = 'customer_discount'
               AND (customer_id IS NULL OR customer_id = @customer_id)
               AND (
                     product_id  = @product_id                              -- exact product match
                  OR (product_id IS NULL AND category_id = @category_id)   -- category match
                  OR (product_id IS NULL AND category_id IS NULL)           -- all products
               ))
           -- Volume break: product/category scope + qty range
           OR (condition_type = 'volume_break'
               AND (
                     product_id  = @product_id
                  OR (product_id IS NULL AND category_id = @category_id)
                  OR (product_id IS NULL AND category_id IS NULL)
               )
               AND (min_qty IS NULL OR @qty >= min_qty)
               AND (max_qty IS NULL OR @qty <  max_qty))
           -- GST: org-wide
           OR (condition_type = 'gst')
        )
      ORDER BY condition_type,
               -- More specific scope wins (product > category > all)
               CASE WHEN product_id  = @product_id  THEN 0
                    WHEN category_id = @category_id THEN 1
                    ELSE 2 END,
               priority ASC
    `);

  const conditions = condRes.recordset;

  // ── 3. Customer Discount ───────────────────────────────────────
  // Take the highest single customer discount (most specific wins)
  const custDiscConds = conditions.filter(c => c.condition_type === 'customer_discount');
  // Prefer conditions with explicit customer_id over wildcard (null)
  let customerDiscountPct = 0;
  if (custDiscConds.length) {
    const best = custDiscConds[0]; // ordered by priority ASC
    customerDiscountPct = Number(best.discount_value);
  }

  // ── 4. Volume Break ────────────────────────────────────────────
  const volConds = conditions.filter(c => c.condition_type === 'volume_break');
  let volumeDiscountPct = 0;
  if (volConds.length) {
    volumeDiscountPct = Number(volConds[0].discount_value);
  }

  // ── 5. Compute unit price after discounts ──────────────────────
  // Discounts are additive in priority order (not compounding)
  const totalDiscountPct = Math.min(customerDiscountPct + volumeDiscountPct, 100);
  const unitPrice = basePrice * (1 - totalDiscountPct / 100);

  // ── 6. GST ────────────────────────────────────────────────────
  const gstCond = conditions.find(c => c.condition_type === 'gst');
  let taxRate = 0;
  if (gstCond && customerGstRegistered !== false) {
    // Apply GST when the org's GST condition exists
    // For B2B AU: GST always applies unless customer is specifically exempt
    taxRate = Number(gstCond.tax_rate);
  }

  const lineSubtotal = unitPrice * Number(qty);
  const taxAmount    = lineSubtotal * (taxRate / 100);
  const lineTotal    = lineSubtotal + taxAmount;

  return {
    basePrice:           +basePrice.toFixed(4),
    customerDiscountPct: +customerDiscountPct.toFixed(2),
    volumeDiscountPct:   +volumeDiscountPct.toFixed(2),
    unitPrice:           +unitPrice.toFixed(4),
    taxRate:             +taxRate.toFixed(2),
    taxAmount:           +taxAmount.toFixed(4),
    lineTotal:           +lineTotal.toFixed(4),
  };
}

/**
 * Recalculate header totals from line items array.
 */
function calcHeaderTotals(items) {
  const subtotal   = items.reduce((s, i) => s + (Number(i.unit_price) * Number(i.qty_ordered || i.qty_requested)), 0);
  const taxAmount  = items.reduce((s, i) => s + Number(i.tax_amount), 0);
  const totalValue = subtotal + taxAmount;
  return {
    subtotal:    +subtotal.toFixed(4),
    tax_amount:  +taxAmount.toFixed(4),
    total_value: +totalValue.toFixed(4),
  };
}

module.exports = { calculatePrice, calcHeaderTotals };
