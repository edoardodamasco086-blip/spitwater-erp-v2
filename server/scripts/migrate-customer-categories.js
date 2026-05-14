'use strict';
// ============================================================
// migrate-customer-categories.js
//
// Adds:
//   customer_categories   — new table for grouping customers
//   contacts.customer_category_id
//   pricing_conditions.customer_category_id
//   products.retail_price
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
  console.log('\n=== Customer Categories Migration ===\n');
  let pool;
  try {
    pool = await sql.connect(config);

    // ── customer_categories table ─────────────────────────────────
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='customer_categories')
      CREATE TABLE customer_categories (
        id          INT IDENTITY(1,1) NOT NULL,
        org_id      INT           NOT NULL,
        name        NVARCHAR(100) NOT NULL,
        description NVARCHAR(500) NULL,
        color       VARCHAR(7)    NOT NULL DEFAULT '#2F7FE8',
        is_active   BIT           NOT NULL DEFAULT 1,
        created_at  DATETIME      NOT NULL DEFAULT GETDATE(),
        CONSTRAINT pk_customer_categories PRIMARY KEY (id),
        CONSTRAINT fk_customer_categories_org FOREIGN KEY (org_id) REFERENCES organisations(id)
      )
    `);
    console.log('  ✓ customer_categories');

    // ── contacts.customer_category_id ────────────────────────────
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('contacts') AND name='customer_category_id'
      )
        ALTER TABLE contacts ADD customer_category_id INT NULL
    `);
    console.log('  ✓ contacts.customer_category_id');

    // ── pricing_conditions.customer_category_id ──────────────────
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('pricing_conditions') AND name='customer_category_id'
      )
        ALTER TABLE pricing_conditions ADD customer_category_id INT NULL
    `);
    console.log('  ✓ pricing_conditions.customer_category_id');

    // ── products.retail_price ─────────────────────────────────────
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('products') AND name='retail_price'
      )
        ALTER TABLE products ADD retail_price DECIMAL(18,4) NULL
    `);
    console.log('  ✓ products.retail_price');

    console.log('\n✅  Done.\n');
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}
run();
