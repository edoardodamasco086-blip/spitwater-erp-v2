'use strict';
// ============================================================
// scripts/migrate-pir-bp.js — SAP PIR / Business Partner module
//
// Adds:
//   products.tax_classification
//   contact_addresses.address_role
//   bp_bank_accounts
//   purchase_info_records  (PIR)
//   pir_conditions
//   pir_scales
//   item_source_list
//
// Run from server/ directory:
//   node scripts/migrate-pir-bp.js
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

async function run() {
  console.log('\n=== SAP PIR / BP Migration ===\n');
  console.log(`Connecting to ${process.env.DB_SERVER} / ${process.env.DB_DATABASE}`);

  let pool;
  try {
    pool = await sql.connect(config);
    const q = (s) => pool.request().query(s);

    // ── 1. products.tax_classification ───────────────────────────
    await q(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('products') AND name = 'tax_classification'
      )
        ALTER TABLE products
          ADD tax_classification VARCHAR(20) NOT NULL DEFAULT 'gst_applicable'
    `);
    console.log("  ✔ products.tax_classification (gst_applicable | gst_free | input_taxed)");

    // ── 2. contact_addresses.address_role ────────────────────────
    await q(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('contact_addresses') AND name = 'address_role'
      )
        ALTER TABLE contact_addresses
          ADD address_role VARCHAR(20) NULL
    `);
    console.log("  ✔ contact_addresses.address_role (sold_to | ship_to | bill_to | payer | remit_to)");

    // ── 3. bp_bank_accounts ───────────────────────────────────────
    await q(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'bp_bank_accounts')
      CREATE TABLE bp_bank_accounts (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        org_id         INT           NOT NULL REFERENCES organisations(id),
        contact_id     INT           NOT NULL REFERENCES contacts(id),
        account_name   NVARCHAR(200) NOT NULL,
        bank_name      NVARCHAR(100) NULL,
        bsb            VARCHAR(10)   NULL,
        account_number VARCHAR(20)   NULL,
        swift_code     VARCHAR(20)   NULL,
        iban           VARCHAR(50)   NULL,
        currency_code  VARCHAR(3)    NOT NULL DEFAULT 'AUD',
        is_default     BIT           NOT NULL DEFAULT 0,
        notes          NVARCHAR(200) NULL,
        created_at     DATETIME      NOT NULL DEFAULT GETDATE(),
        created_by     INT           NULL REFERENCES users(id)
      )
    `);
    console.log("  ✔ bp_bank_accounts");

    // ── 4. purchase_info_records (PIR) ────────────────────────────
    await q(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'purchase_info_records')
      CREATE TABLE purchase_info_records (
        id                     INT IDENTITY(1,1) PRIMARY KEY,
        org_id                 INT            NOT NULL REFERENCES organisations(id),
        product_id             INT            NOT NULL REFERENCES products(id),
        vendor_id              INT            NOT NULL REFERENCES contacts(id),
        vendor_material_number NVARCHAR(50)   NULL,
        vendor_description     NVARCHAR(200)  NULL,
        purchase_uom_id        INT            NULL REFERENCES units_of_measure(id),
        vendor_lead_time_days  INT            NOT NULL DEFAULT 0,
        vendor_moq             DECIMAL(18,4)  NOT NULL DEFAULT 1,
        order_multiple         DECIMAL(18,4)  NOT NULL DEFAULT 1,
        is_active              BIT            NOT NULL DEFAULT 1,
        notes                  NVARCHAR(500)  NULL,
        created_at             DATETIME       NOT NULL DEFAULT GETDATE(),
        updated_at             DATETIME       NOT NULL DEFAULT GETDATE(),
        created_by             INT            NULL REFERENCES users(id),
        CONSTRAINT uq_pir_product_vendor UNIQUE (org_id, product_id, vendor_id)
      )
    `);
    console.log("  ✔ purchase_info_records");

    // ── 5. pir_conditions — date-driven pricing per PIR ──────────
    await q(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'pir_conditions')
      CREATE TABLE pir_conditions (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        pir_id        INT           NOT NULL REFERENCES purchase_info_records(id) ON DELETE CASCADE,
        valid_from    DATE          NOT NULL,
        valid_to      DATE          NULL,
        base_price    DECIMAL(18,4) NOT NULL,
        currency_code VARCHAR(3)    NOT NULL DEFAULT 'AUD',
        incoterm      VARCHAR(10)   NULL,
        notes         NVARCHAR(200) NULL,
        created_at    DATETIME      NOT NULL DEFAULT GETDATE()
      )
    `);
    console.log("  ✔ pir_conditions");

    // ── 6. pir_scales — volume tiered pricing per condition ───────
    await q(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'pir_scales')
      CREATE TABLE pir_scales (
        id               INT IDENTITY(1,1) PRIMARY KEY,
        pir_condition_id INT           NOT NULL REFERENCES pir_conditions(id) ON DELETE CASCADE,
        min_qty          DECIMAL(18,4) NOT NULL,
        max_qty          DECIMAL(18,4) NULL,
        unit_price       DECIMAL(18,4) NOT NULL
      )
    `);
    console.log("  ✔ pir_scales");

    // ── 7. item_source_list — ranked preferred vendors per product ─
    await q(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'item_source_list')
      CREATE TABLE item_source_list (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        org_id       INT           NOT NULL REFERENCES organisations(id),
        product_id   INT           NOT NULL REFERENCES products(id),
        vendor_id    INT           NOT NULL REFERENCES contacts(id),
        pir_id       INT           NULL REFERENCES purchase_info_records(id),
        rank         INT           NOT NULL DEFAULT 1,
        is_preferred BIT           NOT NULL DEFAULT 0,
        is_blocked   BIT           NOT NULL DEFAULT 0,
        valid_from   DATE          NULL,
        valid_to     DATE          NULL,
        notes        NVARCHAR(200) NULL,
        created_at   DATETIME      NOT NULL DEFAULT GETDATE(),
        CONSTRAINT uq_source_list_product_vendor UNIQUE (org_id, product_id, vendor_id)
      )
    `);
    console.log("  ✔ item_source_list");

    // ── Indexes ────────────────────────────────────────────────────
    const indexes = [
      ['ix_pir_org_product',   'purchase_info_records', 'org_id, product_id'],
      ['ix_pir_org_vendor',    'purchase_info_records', 'org_id, vendor_id'],
      ['ix_pir_cond_pir',      'pir_conditions',        'pir_id, valid_from, valid_to'],
      ['ix_pir_scale_cond',    'pir_scales',            'pir_condition_id, min_qty'],
      ['ix_src_list_product',  'item_source_list',      'org_id, product_id, is_blocked, rank'],
      ['ix_bp_bank_contact',   'bp_bank_accounts',      'org_id, contact_id'],
    ];
    for (const [name, table, cols] of indexes) {
      await q(`
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='${name}' AND object_id=OBJECT_ID('${table}'))
          CREATE INDEX ${name} ON ${table} (${cols})
      `);
    }
    console.log("  ✔ indexes");

    // ── Summary ────────────────────────────────────────────────────
    console.log('\n─────────────────────────────────────────────────');
    console.log('Tables / columns created (or already existed):');
    console.log('  1. products.tax_classification          (ALTER)');
    console.log('  2. contact_addresses.address_role       (ALTER)');
    console.log('  3. bp_bank_accounts                     (CREATE)');
    console.log('  4. purchase_info_records                (CREATE)');
    console.log('  5. pir_conditions                       (CREATE)');
    console.log('  6. pir_scales                           (CREATE)');
    console.log('  7. item_source_list                     (CREATE)');
    console.log('─────────────────────────────────────────────────');
    console.log('\n✅  PIR / BP migration complete.\n');

  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

run().catch(e => { console.error(e.message); process.exit(1); });
