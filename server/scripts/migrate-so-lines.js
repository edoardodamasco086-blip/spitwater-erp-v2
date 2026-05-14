'use strict';
// ============================================================
// migrate-so-lines.js
//
// Adds to sales_order_items:
//   requested_delivery_date DATE NULL       — per-line delivery request
//   line_status             VARCHAR(20) DEFAULT 'open'  — 'open'|'closed'|'cancelled'
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
  console.log('\n=== SO Lines Migration ===\n');
  let pool;
  try {
    pool = await sql.connect(config);

    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('sales_order_items') AND name='requested_delivery_date')
        ALTER TABLE sales_order_items ADD requested_delivery_date DATE NULL
    `);
    console.log('  ✓ sales_order_items.requested_delivery_date');

    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('sales_order_items') AND name='line_status')
        ALTER TABLE sales_order_items ADD line_status VARCHAR(20) NOT NULL DEFAULT 'open'
    `);
    console.log('  ✓ sales_order_items.line_status');

    // Backfill existing rows
    await pool.request().query(`
      UPDATE sales_order_items SET line_status='open' WHERE line_status IS NULL OR line_status=''
    `);
    console.log('  ✓ backfilled existing rows');

    console.log('\n✅  Done.\n');
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}
run();
