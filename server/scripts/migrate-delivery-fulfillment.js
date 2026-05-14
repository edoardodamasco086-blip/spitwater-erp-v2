'use strict';
// ============================================================
// migrate-delivery-fulfillment.js
//
// Adds SAP LE/SD fulfillment columns:
//   sales_orders.is_full_delivery_required  BIT NOT NULL DEFAULT 0
//     → TRUE  = block delivery until every line has 100% ATP
//     → FALSE = partial delivery allowed (ship what's available)
// ============================================================

require('dotenv').config();
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER,
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE,
  options:  { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_CERT === 'true', enableArithAbort: true },
};
if (process.env.DB_WINDOWS_AUTH === 'true') config.options.trustedConnection = true;
else { config.user = process.env.DB_USER; config.password = process.env.DB_PASSWORD; }

async function run() {
  console.log('\n=== Delivery Fulfillment Migration ===\n');
  let pool;
  try {
    pool = await sql.connect(config);

    // ── sales_orders.is_full_delivery_required ────────────────────
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('sales_orders') AND name = 'is_full_delivery_required'
      )
        ALTER TABLE sales_orders
          ADD is_full_delivery_required BIT NOT NULL DEFAULT 0
    `);
    console.log('  ✓ sales_orders.is_full_delivery_required');

    // Backfill existing rows to partial delivery (0)
    await pool.request().query(`
      UPDATE sales_orders
      SET is_full_delivery_required = 0
      WHERE is_full_delivery_required IS NULL
    `);
    console.log('  ✓ backfilled existing orders → partial delivery mode');

    // ── outbound_delivery_items: ensure picked_at column exists ───
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('outbound_delivery_items') AND name = 'picked_at'
      )
        ALTER TABLE outbound_delivery_items ADD picked_at DATETIME NULL
    `);
    console.log('  ✓ outbound_delivery_items.picked_at');

    // ── outbound_delivery_items: batch/serial columns ─────────────
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('outbound_delivery_items') AND name = 'batch_number'
      )
        ALTER TABLE outbound_delivery_items ADD batch_number NVARCHAR(50) NULL
    `);
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('outbound_delivery_items') AND name = 'serial_number'
      )
        ALTER TABLE outbound_delivery_items ADD serial_number NVARCHAR(100) NULL
    `);
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('outbound_delivery_items') AND name = 'bin_id'
      )
        ALTER TABLE outbound_delivery_items ADD bin_id INT NULL
    `);
    console.log('  ✓ outbound_delivery_items.batch_number / serial_number / bin_id');

    console.log('\n✅  Done.\n');
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}
run();
