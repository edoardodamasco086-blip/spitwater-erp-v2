'use strict';
// ============================================================
// scripts/migrate-field-validation.js
// Run ONCE: node scripts/migrate-field-validation.js
//
// Creates field_validation_rules table and seeds default rules
// for all entity types (product, contact, invoice, quote, etc.)
// ============================================================

require('dotenv').config();
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER   || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE,
  options:  { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_CERT === 'true', enableArithAbort: true },
};
if (process.env.DB_WINDOWS_AUTH === 'true') { config.options.trustedConnection = true; }
else { config.user = process.env.DB_USER; config.password = process.env.DB_PASSWORD; }

// ── Default rules per entity ─────────────────────────────────
const DEFAULT_RULES = [

  // ── PRODUCT ──────────────────────────────────────────────────
  { entity_key: 'product', field_key: 'name',                   field_label: 'Product Name',         is_required: 1, validation_type: 'min_length',  validation_min: 2,    validation_max: null, transform: 'trim',          sort_order: 1  },
  { entity_key: 'product', field_key: 'product_code',           field_label: 'Product Code',         is_required: 0, validation_type: 'max_length',  validation_min: null, validation_max: 50,   transform: 'uppercase_trim', sort_order: 2  },
  { entity_key: 'product', field_key: 'barcode',                field_label: 'Barcode / EAN',        is_required: 0, validation_type: 'numeric_only',validation_min: null, validation_max: null, transform: 'numeric_only',  sort_order: 3  },
  { entity_key: 'product', field_key: 'category_id',            field_label: 'Category',             is_required: 1, validation_type: 'leaf_category',validation_min: null, validation_max: null, transform: 'none',          sort_order: 4  },
  { entity_key: 'product', field_key: 'base_uom_id',            field_label: 'Unit of Measure',      is_required: 1, validation_type: 'none',        validation_min: null, validation_max: null, transform: 'none',          sort_order: 5  },
  { entity_key: 'product', field_key: 'default_sales_price',    field_label: 'Sales Price',          is_required: 0, validation_type: 'positive',    validation_min: 0,    validation_max: null, transform: 'none',          sort_order: 6  },
  { entity_key: 'product', field_key: 'default_purchase_price', field_label: 'Purchase Price',       is_required: 0, validation_type: 'positive',    validation_min: 0,    validation_max: null, transform: 'none',          sort_order: 7  },
  { entity_key: 'product', field_key: 'weight_kg',              field_label: 'Weight (kg)',           is_required: 0, validation_type: 'positive',    validation_min: 0,    validation_max: null, transform: 'none',          sort_order: 8  },

  // ── CONTACT ──────────────────────────────────────────────────
  { entity_key: 'contact', field_key: 'full_name',              field_label: 'Full Name',            is_required: 1, validation_type: 'min_length',  validation_min: 2,    validation_max: null, transform: 'trim',          sort_order: 1  },
  { entity_key: 'contact', field_key: 'email',                  field_label: 'Email',                is_required: 0, validation_type: 'email',       validation_min: null, validation_max: null, transform: 'lowercase_trim', sort_order: 2  },
  { entity_key: 'contact', field_key: 'phone',                  field_label: 'Phone',                is_required: 0, validation_type: 'phone_au',    validation_min: null, validation_max: null, transform: 'phone_au_format',sort_order: 3  },
  { entity_key: 'contact', field_key: 'mobile',                 field_label: 'Mobile',               is_required: 0, validation_type: 'mobile_au',   validation_min: null, validation_max: null, transform: 'phone_au_format',sort_order: 4  },
  { entity_key: 'contact', field_key: 'abn',                    field_label: 'ABN',                  is_required: 0, validation_type: 'abn',         validation_min: null, validation_max: null, transform: 'abn_format',    sort_order: 5  },
  { entity_key: 'contact', field_key: 'postcode',               field_label: 'Postcode',             is_required: 0, validation_type: 'postcode_au', validation_min: null, validation_max: null, transform: 'numeric_only',  sort_order: 6  },
  { entity_key: 'contact', field_key: 'website',                field_label: 'Website',              is_required: 0, validation_type: 'url',         validation_min: null, validation_max: null, transform: 'lowercase_trim', sort_order: 7  },
  { entity_key: 'contact', field_key: 'credit_limit',           field_label: 'Credit Limit',         is_required: 0, validation_type: 'positive',    validation_min: 0,    validation_max: null, transform: 'none',          sort_order: 8  },

  // ── INVOICE ──────────────────────────────────────────────────
  { entity_key: 'invoice', field_key: 'contact_id',             field_label: 'Customer',             is_required: 1, validation_type: 'none',        validation_min: null, validation_max: null, transform: 'none',          sort_order: 1  },
  { entity_key: 'invoice', field_key: 'document_date',          field_label: 'Invoice Date',         is_required: 1, validation_type: 'date',        validation_min: null, validation_max: null, transform: 'none',          sort_order: 2  },
  { entity_key: 'invoice', field_key: 'due_date',               field_label: 'Due Date',             is_required: 1, validation_type: 'future_date', validation_min: null, validation_max: null, transform: 'none',          sort_order: 3  },
  { entity_key: 'invoice', field_key: 'reference',              field_label: 'Customer Reference',   is_required: 0, validation_type: 'max_length',  validation_min: null, validation_max: 100,  transform: 'trim',          sort_order: 4  },

  // ── QUOTE ────────────────────────────────────────────────────
  { entity_key: 'quote',   field_key: 'contact_id',             field_label: 'Customer',             is_required: 1, validation_type: 'none',        validation_min: null, validation_max: null, transform: 'none',          sort_order: 1  },
  { entity_key: 'quote',   field_key: 'document_date',          field_label: 'Quote Date',           is_required: 1, validation_type: 'date',        validation_min: null, validation_max: null, transform: 'none',          sort_order: 2  },
  { entity_key: 'quote',   field_key: 'expiry_date',            field_label: 'Expiry Date',          is_required: 0, validation_type: 'future_date', validation_min: null, validation_max: null, transform: 'none',          sort_order: 3  },

  // ── PURCHASE ORDER ───────────────────────────────────────────
  { entity_key: 'purchase_order', field_key: 'contact_id',      field_label: 'Supplier',             is_required: 1, validation_type: 'none',        validation_min: null, validation_max: null, transform: 'none',          sort_order: 1  },
  { entity_key: 'purchase_order', field_key: 'document_date',   field_label: 'Order Date',           is_required: 1, validation_type: 'date',        validation_min: null, validation_max: null, transform: 'none',          sort_order: 2  },
  { entity_key: 'purchase_order', field_key: 'expected_delivery',field_label: 'Expected Delivery',   is_required: 0, validation_type: 'future_date', validation_min: null, validation_max: null, transform: 'none',          sort_order: 3  },
  { entity_key: 'purchase_order', field_key: 'reference',       field_label: 'Supplier Reference',   is_required: 0, validation_type: 'max_length',  validation_min: null, validation_max: 100,  transform: 'trim',          sort_order: 4  },

  // ── SERVICE JOB ──────────────────────────────────────────────
  { entity_key: 'service_job', field_key: 'contact_id',         field_label: 'Customer',             is_required: 1, validation_type: 'none',        validation_min: null, validation_max: null, transform: 'none',          sort_order: 1  },
  { entity_key: 'service_job', field_key: 'machine_serial',     field_label: 'Machine Serial No.',   is_required: 0, validation_type: 'min_length',  validation_min: 3,    validation_max: null, transform: 'uppercase_trim', sort_order: 2  },
  { entity_key: 'service_job', field_key: 'fault_description',  field_label: 'Fault Description',    is_required: 1, validation_type: 'min_length',  validation_min: 10,   validation_max: null, transform: 'trim',          sort_order: 3  },
];

async function run() {
  console.log('\n=== Field Validation Rules Migration ===\n');
  let pool;
  try {
    pool = await sql.connect(config);
    console.log('✅  Connected\n');

    // Create table
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'field_validation_rules')
      BEGIN
        CREATE TABLE field_validation_rules (
          id               INT IDENTITY(1,1) NOT NULL,
          org_id           INT               NOT NULL,
          entity_key       VARCHAR(50)       NOT NULL,
          field_key        VARCHAR(100)      NOT NULL,
          field_label      NVARCHAR(200)     NOT NULL,
          is_required      BIT               NOT NULL DEFAULT 0,
          validation_type  VARCHAR(30)       NOT NULL DEFAULT 'none',
          validation_min   DECIMAL(18,4)     NULL,
          validation_max   DECIMAL(18,4)     NULL,
          validation_regex NVARCHAR(500)     NULL,
          validation_msg   NVARCHAR(200)     NULL,
          transform        VARCHAR(30)       NOT NULL DEFAULT 'none',
          is_active        BIT               NOT NULL DEFAULT 1,
          sort_order       INT               NOT NULL DEFAULT 0,
          updated_at       DATETIME          NOT NULL DEFAULT GETDATE(),
          updated_by       INT               NULL,
          CONSTRAINT pk_fvr    PRIMARY KEY (id),
          CONSTRAINT uq_fvr    UNIQUE (org_id, entity_key, field_key),
          CONSTRAINT fk_fvr_org FOREIGN KEY (org_id) REFERENCES organisations(id)
        )
        CREATE INDEX ix_fvr_entity ON field_validation_rules (org_id, entity_key)
        PRINT 'Created: field_validation_rules'
      END
      ELSE PRINT 'Exists:  field_validation_rules'
    `);

    // Get org_id
    const orgRes = await pool.request().query('SELECT TOP 1 id FROM organisations ORDER BY id');
    if (!orgRes.recordset.length) { console.error('No org found'); process.exit(1); }
    const orgId = orgRes.recordset[0].id;

    // Seed defaults
    let created = 0, skipped = 0;
    for (const rule of DEFAULT_RULES) {
      const exists = await pool.request()
        .input('org_id',     sql.Int,         orgId)
        .input('entity_key', sql.VarChar(50), rule.entity_key)
        .input('field_key',  sql.VarChar(100),rule.field_key)
        .query('SELECT id FROM field_validation_rules WHERE org_id=@org_id AND entity_key=@entity_key AND field_key=@field_key');

      if (exists.recordset.length) { skipped++; continue; }

      await pool.request()
        .input('org_id',          sql.Int,           orgId)
        .input('entity_key',      sql.VarChar(50),   rule.entity_key)
        .input('field_key',       sql.VarChar(100),  rule.field_key)
        .input('field_label',     sql.NVarChar(200), rule.field_label)
        .input('is_required',     sql.Bit,           rule.is_required)
        .input('validation_type', sql.VarChar(30),   rule.validation_type)
        .input('validation_min',  sql.Decimal(18,4), rule.validation_min)
        .input('validation_max',  sql.Decimal(18,4), rule.validation_max)
        .input('transform',       sql.VarChar(30),   rule.transform)
        .input('sort_order',      sql.Int,           rule.sort_order)
        .query(`
          INSERT INTO field_validation_rules
            (org_id,entity_key,field_key,field_label,is_required,validation_type,
             validation_min,validation_max,transform,is_active,sort_order,updated_at)
          VALUES
            (@org_id,@entity_key,@field_key,@field_label,@is_required,@validation_type,
             @validation_min,@validation_max,@transform,1,@sort_order,GETDATE())
        `);
      created++;
    }

    console.log(`✅  Table ready`);
    console.log(`✅  Rules: ${created} created, ${skipped} already existed`);
    console.log('\n=== Migration complete ===\n');

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}
run();
