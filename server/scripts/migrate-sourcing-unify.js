'use strict';
// ============================================================
// scripts/migrate-sourcing-unify.js
//
// Idempotent migration: consolidates product_suppliers and
// product_supplier_prices into the unified PIR system.
//
// Steps:
//   1. Add vendor_part_number column to purchase_info_records (if missing)
//   2. Create PIRs from product_suppliers (where no PIR exists)
//   3. Update existing PIRs with supplier_part_number where vendor_material_number is NULL
//   4. Create pir_conditions from product_supplier_prices (where no condition exists)
//      4a. Create pir_scales for prices with min_order_qty > 1
//   5. Update purchase_uom_id on PIR from product_supplier_prices
// ============================================================

const { sql, pool, poolConnect } = require('../config/db');

async function run() {
  await poolConnect;
  console.log('[migrate-sourcing-unify] Starting...\n');

  // ── Step 1: Add vendor_part_number column if not exists ───────
  console.log('[Step 1] Adding vendor_part_number column to purchase_info_records (if missing)...');
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('purchase_info_records') AND name = 'vendor_part_number'
    )
      ALTER TABLE purchase_info_records ADD vendor_part_number NVARCHAR(100) NULL
  `);
  console.log('[Step 1] Done.\n');

  // ── Step 2: Create PIRs from product_suppliers ────────────────
  console.log('[Step 2] Creating PIRs from product_suppliers where no PIR exists...');
  const step2 = await pool.request().query(`
    INSERT INTO purchase_info_records
      (org_id, product_id, vendor_id, vendor_material_number,
       lead_time_days, moq, order_multiple, notes, is_preferred, is_blocked,
       created_at, updated_at)
    SELECT DISTINCT
      ps.org_id,
      ps.product_id,
      ps.contact_id,
      ps.supplier_part_number,
      ps.lead_time_days,
      ps.min_order_qty,
      ps.order_multiple,
      ps.notes,
      ps.is_preferred,
      0,
      GETDATE(),
      GETDATE()
    FROM product_suppliers ps
    WHERE ps.is_active = 1
      AND NOT EXISTS (
        SELECT 1 FROM purchase_info_records pir
        WHERE pir.product_id = ps.product_id
          AND pir.vendor_id  = ps.contact_id
      )
  `);
  const pirsCreated = step2.rowsAffected[0] || 0;
  console.log(`[Step 2] PIRs created: ${pirsCreated}\n`);

  // ── Step 3: Update existing PIRs with supplier_part_number ────
  console.log('[Step 3] Updating existing PIRs with supplier_part_number where vendor_material_number is NULL...');
  const step3 = await pool.request().query(`
    UPDATE pir
    SET pir.vendor_material_number = ps.supplier_part_number,
        pir.updated_at             = GETDATE()
    FROM purchase_info_records pir
    INNER JOIN product_suppliers ps
      ON ps.product_id = pir.product_id
     AND ps.contact_id = pir.vendor_id
    WHERE pir.vendor_material_number IS NULL
      AND ps.supplier_part_number    IS NOT NULL
      AND ps.is_active = 1
  `);
  const pirsUpdated = step3.rowsAffected[0] || 0;
  console.log(`[Step 3] PIRs updated with part number: ${pirsUpdated}\n`);

  // ── Step 4: Create pir_conditions from product_supplier_prices ─
  console.log('[Step 4] Creating pir_conditions from product_supplier_prices (where no condition exists)...');
  const step4 = await pool.request().query(`
    INSERT INTO pir_conditions
      (pir_id, valid_from, valid_to, base_price, currency_code, created_at)
    SELECT
      pir.id,
      psp.valid_from,
      psp.valid_to,
      psp.unit_price,
      psp.currency_code,
      GETDATE()
    FROM product_supplier_prices psp
    INNER JOIN purchase_info_records pir
      ON pir.product_id = psp.product_id
     AND pir.vendor_id  = psp.contact_id
    WHERE psp.is_active = 1
      AND NOT EXISTS (
        SELECT 1 FROM pir_conditions pc
        WHERE pc.pir_id       = pir.id
          AND (
            (pc.valid_from = psp.valid_from)
            OR (pc.valid_from IS NULL AND psp.valid_from IS NULL)
          )
          AND pc.currency_code = psp.currency_code
      )
  `);
  const conditionsCreated = step4.rowsAffected[0] || 0;
  console.log(`[Step 4] pir_conditions created: ${conditionsCreated}`);

  // ── Step 4a: Create pir_scales for min_order_qty > 1 ─────────
  console.log('[Step 4a] Creating pir_scales for supplier prices with min_order_qty > 1...');
  const step4a = await pool.request().query(`
    INSERT INTO pir_scales (pir_condition_id, min_qty, max_qty, unit_price)
    SELECT pc.id, psp.min_order_qty, NULL, psp.unit_price
    FROM pir_conditions pc
    INNER JOIN purchase_info_records pir
      ON pir.id = pc.pir_id
    INNER JOIN product_supplier_prices psp
      ON psp.product_id   = pir.product_id
     AND psp.contact_id   = pir.vendor_id
     AND psp.unit_price   = pc.base_price
    WHERE psp.min_order_qty > 1
      AND NOT EXISTS (
        SELECT 1 FROM pir_scales ps
        WHERE ps.pir_condition_id = pc.id
          AND ps.min_qty = psp.min_order_qty
      )
  `);
  const scalesCreated = step4a.rowsAffected[0] || 0;
  console.log(`[Step 4a] pir_scales created: ${scalesCreated}\n`);

  // ── Step 5: Update purchase_uom_id on PIR from psp ───────────
  console.log('[Step 5] Updating purchase_uom_id on PIRs from product_supplier_prices...');
  const step5 = await pool.request().query(`
    UPDATE pir
    SET pir.purchase_uom_id = psp.uom_id,
        pir.updated_at      = GETDATE()
    FROM purchase_info_records pir
    INNER JOIN product_supplier_prices psp
      ON psp.product_id = pir.product_id
     AND psp.contact_id = pir.vendor_id
    WHERE pir.purchase_uom_id IS NULL
      AND psp.uom_id           IS NOT NULL
      AND psp.is_active = 1
  `);
  const uomUpdated = step5.rowsAffected[0] || 0;
  console.log(`[Step 5] PIRs updated with UOM: ${uomUpdated}\n`);

  // ── Summary ───────────────────────────────────────────────────
  console.log('='.repeat(50));
  console.log('[migrate-sourcing-unify] Summary:');
  console.log(`  PIRs created from product_suppliers:          ${pirsCreated}`);
  console.log(`  PIRs updated with supplier part number:       ${pirsUpdated}`);
  console.log(`  pir_conditions created from supplier prices:  ${conditionsCreated}`);
  console.log(`  pir_scales created (min_order_qty > 1):       ${scalesCreated}`);
  console.log(`  PIRs updated with purchase UOM:               ${uomUpdated}`);
  console.log('='.repeat(50));
  console.log('[migrate-sourcing-unify] Complete.\n');
}

run()
  .catch(err => {
    console.error('[migrate-sourcing-unify] FATAL:', err);
    process.exit(1);
  })
  .finally(() => pool.close());
