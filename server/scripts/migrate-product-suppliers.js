'use strict';
// migrate-product-suppliers.js
// 1. Creates product_suppliers table
// 2. Migrates existing preferred_supplier_id + supplier_part_number + lead_time_days
//    + min_order_qty + order_multiple from products into product_suppliers
require('dotenv').config();
const sql = require('mssql');
const config = {
  server:   process.env.DB_SERVER,
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options:  { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_CERT === 'true' },
};

async function run() {
  const pool = await sql.connect(config);

  // 1. Create table if not exists
  console.log('Creating product_suppliers table if not exists...');
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'product_suppliers')
    CREATE TABLE product_suppliers (
      id                  INT          IDENTITY(1,1) PRIMARY KEY,
      org_id              INT          NOT NULL,
      product_id          INT          NOT NULL,
      contact_id          INT          NOT NULL,
      supplier_part_number NVARCHAR(100) NULL,
      lead_time_days      INT          NOT NULL DEFAULT 0,
      min_order_qty       DECIMAL(18,4) NOT NULL DEFAULT 1,
      order_multiple      DECIMAL(18,4) NOT NULL DEFAULT 1,
      notes               NVARCHAR(MAX) NULL,
      is_preferred        BIT          NOT NULL DEFAULT 0,
      is_active           BIT          NOT NULL DEFAULT 1,
      sort_order          INT          NOT NULL DEFAULT 0,
      created_at          DATETIME     NOT NULL DEFAULT GETDATE(),
      created_by          INT          NULL,
      updated_at          DATETIME     NOT NULL DEFAULT GETDATE(),
      CONSTRAINT UQ_product_suppliers UNIQUE (org_id, product_id, contact_id)
    )
  `);
  console.log('Table ready.');

  // 2. Migrate existing preferred_supplier_id rows
  console.log('Migrating existing preferred supplier data...');
  const existing = await pool.request().query(`
    SELECT id, org_id, preferred_supplier_id, supplier_part_number,
           lead_time_days, min_order_qty, order_multiple
    FROM products
    WHERE preferred_supplier_id IS NOT NULL AND is_void = 0
  `);

  let migrated = 0;
  for (const p of existing.recordset) {
    // Check if row already exists (idempotent)
    const check = await pool.request()
      .input('org_id',     sql.Int, p.org_id)
      .input('product_id', sql.Int, p.id)
      .input('contact_id', sql.Int, p.preferred_supplier_id)
      .query('SELECT id FROM product_suppliers WHERE org_id=@org_id AND product_id=@product_id AND contact_id=@contact_id');

    if (check.recordset.length === 0) {
      await pool.request()
        .input('org_id',              sql.Int,          p.org_id)
        .input('product_id',          sql.Int,          p.id)
        .input('contact_id',          sql.Int,          p.preferred_supplier_id)
        .input('supplier_part_number',sql.NVarChar(100), p.supplier_part_number || null)
        .input('lead_time_days',      sql.Int,          p.lead_time_days || 0)
        .input('min_order_qty',       sql.Decimal(18,4), p.min_order_qty || 1)
        .input('order_multiple',      sql.Decimal(18,4), p.order_multiple || 1)
        .query(`
          INSERT INTO product_suppliers
            (org_id, product_id, contact_id, supplier_part_number, lead_time_days, min_order_qty, order_multiple, is_preferred, is_active, sort_order)
          VALUES
            (@org_id, @product_id, @contact_id, @supplier_part_number, @lead_time_days, @min_order_qty, @order_multiple, 1, 1, 0)
        `);
      migrated++;
      console.log(`  Migrated product ${p.id} → contact ${p.preferred_supplier_id}`);
    } else {
      console.log(`  Skipped product ${p.id} (already migrated)`);
    }
  }

  console.log(`\nDone. Migrated ${migrated} of ${existing.recordset.length} products.`);
  await pool.close();
}

run().catch(err => { console.error(err); process.exit(1); });
