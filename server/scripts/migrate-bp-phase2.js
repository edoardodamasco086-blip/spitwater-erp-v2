'use strict';
// ============================================================
// scripts/migrate-bp-phase2.js  — Business Partner Phase 2
//
// Wires business_partners into:
//   sales_orders           → customer_bp_id, ship_to_address_id, bill_to_address_id
//   purchase_info_records  → vendor_bp_id
//   item_source_list       → vendor_bp_id
//   product_suppliers      → bp_id
//
// Then backfills each column via the contacts.bp_id link.
// Adds performance indexes on all new FK columns.
//
// Idempotent — safe to re-run.
//
// Run from project root:
//   node server/scripts/migrate-bp-phase2.js
// ============================================================

require('dotenv').config();
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER,
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE,
  options: {
    encrypt:                process.env.DB_ENCRYPT    === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
    enableArithAbort:       true,
  },
};
if (process.env.DB_WINDOWS_AUTH === 'true') {
  config.options.trustedConnection = true;
} else {
  config.user     = process.env.DB_USER;
  config.password = process.env.DB_PASSWORD;
}

// Helper: add a column if it does not already exist
async function addColumnIfMissing(pool, table, column, definition) {
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('${table}') AND name = '${column}'
    )
      ALTER TABLE ${table} ADD ${column} ${definition}
  `);
}

// Helper: create an index if it does not already exist
async function addIndexIfMissing(pool, indexName, table, cols) {
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.indexes
      WHERE name = '${indexName}' AND object_id = OBJECT_ID('${table}')
    )
      CREATE INDEX ${indexName} ON ${table} (${cols})
  `);
}

async function run() {
  console.log('\n=== Business Partner Phase 2 Migration ===\n');
  console.log(`Connecting to ${process.env.DB_SERVER} / ${process.env.DB_DATABASE}`);

  let pool;
  try {
    pool = await sql.connect(config);

    // ─────────────────────────────────────────────────────────────
    // STEP 1 — Add columns (all idempotent)
    // ─────────────────────────────────────────────────────────────
    console.log('\n[1] Adding new FK columns ...');

    // sales_orders
    await addColumnIfMissing(pool, 'sales_orders', 'customer_bp_id',    'INT NULL');
    await addColumnIfMissing(pool, 'sales_orders', 'ship_to_address_id', 'INT NULL');
    await addColumnIfMissing(pool, 'sales_orders', 'bill_to_address_id', 'INT NULL');
    console.log('    + sales_orders: customer_bp_id, ship_to_address_id, bill_to_address_id');

    // purchase_info_records
    await addColumnIfMissing(pool, 'purchase_info_records', 'vendor_bp_id', 'INT NULL');
    console.log('    + purchase_info_records: vendor_bp_id');

    // item_source_list
    await addColumnIfMissing(pool, 'item_source_list', 'vendor_bp_id', 'INT NULL');
    console.log('    + item_source_list: vendor_bp_id');

    // product_suppliers
    await addColumnIfMissing(pool, 'product_suppliers', 'bp_id', 'INT NULL');
    console.log('    + product_suppliers: bp_id');

    // ─────────────────────────────────────────────────────────────
    // STEP 2 — Backfill via contacts.bp_id link
    // ─────────────────────────────────────────────────────────────
    console.log('\n[2] Backfilling BP ids ...');

    // sales_orders.customer_bp_id
    const soCustomer = await pool.request().query(`
      UPDATE so
        SET so.customer_bp_id = c.bp_id
      FROM sales_orders so
      INNER JOIN contacts c ON c.id = so.customer_id
      WHERE so.customer_bp_id IS NULL
        AND c.bp_id IS NOT NULL
    `);
    console.log(`    sales_orders.customer_bp_id        → ${soCustomer.rowsAffected[0]} row(s) updated`);

    // sales_orders.ship_to_address_id (from BP default ship_to address)
    const soShipTo = await pool.request().query(`
      UPDATE so
        SET so.ship_to_address_id = ca.id
      FROM sales_orders so
      INNER JOIN business_partners bp ON bp.id = so.customer_bp_id
      INNER JOIN contact_addresses ca
             ON ca.contact_id = bp.legacy_contact_id
            AND ca.address_role = 'ship_to'
            AND ca.is_default   = 1
      WHERE so.ship_to_address_id IS NULL
        AND so.customer_bp_id IS NOT NULL
    `);
    console.log(`    sales_orders.ship_to_address_id    → ${soShipTo.rowsAffected[0]} row(s) updated`);

    // sales_orders.bill_to_address_id (from BP default bill_to address)
    const soBillTo = await pool.request().query(`
      UPDATE so
        SET so.bill_to_address_id = ca.id
      FROM sales_orders so
      INNER JOIN business_partners bp ON bp.id = so.customer_bp_id
      INNER JOIN contact_addresses ca
             ON ca.contact_id = bp.legacy_contact_id
            AND ca.address_role = 'bill_to'
            AND ca.is_default   = 1
      WHERE so.bill_to_address_id IS NULL
        AND so.customer_bp_id IS NOT NULL
    `);
    console.log(`    sales_orders.bill_to_address_id    → ${soBillTo.rowsAffected[0]} row(s) updated`);

    // purchase_info_records.vendor_bp_id
    const pirVendor = await pool.request().query(`
      UPDATE pir
        SET pir.vendor_bp_id = c.bp_id
      FROM purchase_info_records pir
      INNER JOIN contacts c ON c.id = pir.vendor_id
      WHERE pir.vendor_bp_id IS NULL
        AND c.bp_id IS NOT NULL
    `);
    console.log(`    purchase_info_records.vendor_bp_id → ${pirVendor.rowsAffected[0]} row(s) updated`);

    // item_source_list.vendor_bp_id
    const slVendor = await pool.request().query(`
      UPDATE sl
        SET sl.vendor_bp_id = c.bp_id
      FROM item_source_list sl
      INNER JOIN contacts c ON c.id = sl.vendor_id
      WHERE sl.vendor_bp_id IS NULL
        AND c.bp_id IS NOT NULL
    `);
    console.log(`    item_source_list.vendor_bp_id      → ${slVendor.rowsAffected[0]} row(s) updated`);

    // product_suppliers.bp_id
    const psBpId = await pool.request().query(`
      UPDATE ps
        SET ps.bp_id = c.bp_id
      FROM product_suppliers ps
      INNER JOIN contacts c ON c.id = ps.contact_id
      WHERE ps.bp_id IS NULL
        AND c.bp_id IS NOT NULL
    `);
    console.log(`    product_suppliers.bp_id            → ${psBpId.rowsAffected[0]} row(s) updated`);

    // ─────────────────────────────────────────────────────────────
    // STEP 3 — Indexes on new FK columns
    // ─────────────────────────────────────────────────────────────
    console.log('\n[3] Creating performance indexes ...');

    const indexes = [
      ['ix_so_customer_bp_id',    'sales_orders',            'customer_bp_id'],
      ['ix_so_ship_to_addr',      'sales_orders',            'ship_to_address_id'],
      ['ix_so_bill_to_addr',      'sales_orders',            'bill_to_address_id'],
      ['ix_pir_vendor_bp_id',     'purchase_info_records',   'vendor_bp_id'],
      ['ix_src_list_vendor_bp',   'item_source_list',        'vendor_bp_id'],
      ['ix_prod_supp_bp_id',      'product_suppliers',       'bp_id'],
    ];

    for (const [name, table, cols] of indexes) {
      await addIndexIfMissing(pool, name, table, cols);
    }
    console.log(`    + ${indexes.length} index(es) created (or already existed)`);

    // ─────────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────────
    console.log('\n─────────────────────────────────────────────────');
    console.log('Phase 2 migration complete. Rows updated:');
    console.log(`  sales_orders.customer_bp_id        : ${soCustomer.rowsAffected[0]}`);
    console.log(`  sales_orders.ship_to_address_id    : ${soShipTo.rowsAffected[0]}`);
    console.log(`  sales_orders.bill_to_address_id    : ${soBillTo.rowsAffected[0]}`);
    console.log(`  purchase_info_records.vendor_bp_id : ${pirVendor.rowsAffected[0]}`);
    console.log(`  item_source_list.vendor_bp_id      : ${slVendor.rowsAffected[0]}`);
    console.log(`  product_suppliers.bp_id            : ${psBpId.rowsAffected[0]}`);
    console.log('─────────────────────────────────────────────────');
    console.log('\n  Business Partner Phase 2 migration complete.\n');

  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

run().catch(e => { console.error(e.message); process.exit(1); });
