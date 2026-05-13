'use strict';
// ============================================================
// scripts/migrate-o2c.js  — Order-to-Cash (O2C) Schema
// Run ONCE: node scripts/migrate-o2c.js
//
// Creates:
//   pricing_conditions          rules-based pricing engine
//   customer_quotes             quote header
//   customer_quote_items        quote line items
//   sales_orders                SO header (with credit control)
//   sales_order_items           SO line items (with pricing breakdown)
//   sales_order_schedule_lines  ATP-driven delivery schedule
//   outbound_deliveries         WMS outbound / picking header
//   outbound_delivery_items     picking line items
//
// Alters:
//   stock_levels  +soft_allocated, +hard_allocated columns
// ============================================================

require('dotenv').config();
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER   || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE,
  options: {
    encrypt:                process.env.DB_ENCRYPT    === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
    enableArithAbort:       true,
  },
};
if (process.env.DB_WINDOWS_AUTH === 'true') config.options.trustedConnection = true;
else { config.user = process.env.DB_USER; config.password = process.env.DB_PASSWORD; }

const q = async (pool, s, label) => {
  try { return await pool.request().query(s); }
  catch (err) { throw Object.assign(err, { _label: label }); }
};

async function run() {
  console.log('\n=== Spitwater ERP — O2C Migration ===\n');
  let pool;
  try {
    pool = await sql.connect(config);
    console.log('✅  Connected\n');

    // ── 1. pricing_conditions ──────────────────────────────────────
    await q(pool, `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='pricing_conditions')
      CREATE TABLE pricing_conditions (
        id               INT IDENTITY(1,1) NOT NULL,
        org_id           INT           NOT NULL,
        condition_type   VARCHAR(30)   NOT NULL,  -- base_price | customer_discount | volume_break | gst
        priority         INT           NOT NULL DEFAULT 10,
        customer_id      INT           NULL,       -- NULL = all customers
        product_id       INT           NULL,       -- NULL = all products
        category_id      INT           NULL,       -- product category
        price_list_id    INT           NULL,       -- linked price list
        min_qty          DECIMAL(18,4) NULL,       -- volume break lower bound
        max_qty          DECIMAL(18,4) NULL,       -- volume break upper bound
        discount_type    VARCHAR(10)   NOT NULL DEFAULT 'percent', -- percent | fixed
        discount_value   DECIMAL(12,4) NOT NULL DEFAULT 0,
        tax_rate         DECIMAL(5,2)  NOT NULL DEFAULT 0,  -- for GST conditions
        valid_from       DATE          NULL,
        valid_to         DATE          NULL,
        is_active        BIT           NOT NULL DEFAULT 1,
        notes            NVARCHAR(500) NULL,
        created_by       INT           NULL,
        created_at       DATETIME      NOT NULL DEFAULT GETDATE(),
        CONSTRAINT pk_pricing_conditions PRIMARY KEY (id),
        CONSTRAINT fk_pricing_cond_org FOREIGN KEY (org_id) REFERENCES organisations(id)
      )
    `);
    console.log('✅  pricing_conditions');

    // ── 2. customer_quotes ─────────────────────────────────────────
    await q(pool, `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='customer_quotes')
      CREATE TABLE customer_quotes (
        id               INT IDENTITY(1,1) NOT NULL,
        org_id           INT            NOT NULL,
        quote_number     NVARCHAR(50)   NOT NULL,
        status           VARCHAR(20)    NOT NULL DEFAULT 'draft',  -- draft|sent|accepted|rejected|expired|converted
        customer_id      INT            NOT NULL,
        warehouse_id     INT            NULL,
        price_list_id    INT            NULL,
        currency_code    VARCHAR(3)     NOT NULL DEFAULT 'AUD',
        payment_terms    NVARCHAR(100)  NULL,
        validity_date    DATE           NULL,
        subtotal         DECIMAL(18,4)  NOT NULL DEFAULT 0,
        tax_amount       DECIMAL(18,4)  NOT NULL DEFAULT 0,
        total_value      DECIMAL(18,4)  NOT NULL DEFAULT 0,
        notes            NVARCHAR(1000) NULL,
        created_by       INT            NULL,
        created_at       DATETIME       NOT NULL DEFAULT GETDATE(),
        updated_at       DATETIME       NOT NULL DEFAULT GETDATE(),
        CONSTRAINT pk_quotes        PRIMARY KEY (id),
        CONSTRAINT uq_quote_number  UNIQUE (org_id, quote_number),
        CONSTRAINT fk_q_org         FOREIGN KEY (org_id)      REFERENCES organisations(id),
        CONSTRAINT fk_q_customer    FOREIGN KEY (customer_id) REFERENCES contacts(id)
      )
    `);
    console.log('✅  customer_quotes');

    // ── 3. customer_quote_items ────────────────────────────────────
    await q(pool, `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='customer_quote_items')
      CREATE TABLE customer_quote_items (
        id                   INT IDENTITY(1,1) NOT NULL,
        quote_id             INT           NOT NULL,
        org_id               INT           NOT NULL,
        line_number          INT           NOT NULL DEFAULT 1,
        product_id           INT           NOT NULL,
        warehouse_id         INT           NULL,
        qty_requested        DECIMAL(18,4) NOT NULL,
        base_price           DECIMAL(18,4) NOT NULL DEFAULT 0,
        customer_discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
        volume_discount_pct  DECIMAL(5,2)  NOT NULL DEFAULT 0,
        unit_price           DECIMAL(18,4) NOT NULL DEFAULT 0,
        tax_rate             DECIMAL(5,2)  NOT NULL DEFAULT 0,
        tax_amount           DECIMAL(18,4) NOT NULL DEFAULT 0,
        line_total           DECIMAL(18,4) NOT NULL DEFAULT 0,
        atp_qty              DECIMAL(18,4) NULL,
        atp_date             DATE          NULL,
        atp_status           VARCHAR(20)   NULL,    -- ok | partial | backorder
        notes                NVARCHAR(500) NULL,
        CONSTRAINT pk_quote_items    PRIMARY KEY (id),
        CONSTRAINT fk_qi_quote       FOREIGN KEY (quote_id)    REFERENCES customer_quotes(id),
        CONSTRAINT fk_qi_product     FOREIGN KEY (product_id)  REFERENCES products(id)
      )
    `);
    console.log('✅  customer_quote_items');

    // ── 4. sales_orders ───────────────────────────────────────────
    await q(pool, `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='sales_orders')
      CREATE TABLE sales_orders (
        id                      INT IDENTITY(1,1) NOT NULL,
        org_id                  INT            NOT NULL,
        so_number               NVARCHAR(50)   NOT NULL,
        status                  VARCHAR(30)    NOT NULL DEFAULT 'draft',
          -- draft|credit_hold|confirmed|processing|partially_shipped|shipped|invoiced|cancelled
        customer_id             INT            NOT NULL,
        quote_id                INT            NULL,
        warehouse_id            INT            NULL,
        price_list_id           INT            NULL,
        currency_code           VARCHAR(3)     NOT NULL DEFAULT 'AUD',
        payment_terms           NVARCHAR(100)  NULL,
        requested_delivery_date DATE           NULL,
        credit_status           VARCHAR(20)    NOT NULL DEFAULT 'ok',  -- ok|credit_hold|overdue_hold
        credit_hold_reason      NVARCHAR(500)  NULL,
        subtotal                DECIMAL(18,4)  NOT NULL DEFAULT 0,
        tax_amount              DECIMAL(18,4)  NOT NULL DEFAULT 0,
        total_value             DECIMAL(18,4)  NOT NULL DEFAULT 0,
        notes                   NVARCHAR(1000) NULL,
        confirmed_at            DATETIME       NULL,
        confirmed_by            INT            NULL,
        created_by              INT            NULL,
        created_at              DATETIME       NOT NULL DEFAULT GETDATE(),
        updated_at              DATETIME       NOT NULL DEFAULT GETDATE(),
        CONSTRAINT pk_sales_orders   PRIMARY KEY (id),
        CONSTRAINT uq_so_number      UNIQUE (org_id, so_number),
        CONSTRAINT fk_so_org         FOREIGN KEY (org_id)      REFERENCES organisations(id),
        CONSTRAINT fk_so_customer    FOREIGN KEY (customer_id) REFERENCES contacts(id),
        CONSTRAINT fk_so_quote       FOREIGN KEY (quote_id)    REFERENCES customer_quotes(id)
      )
    `);
    console.log('✅  sales_orders');

    // ── 5. sales_order_items ───────────────────────────────────────
    await q(pool, `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='sales_order_items')
      CREATE TABLE sales_order_items (
        id                   INT IDENTITY(1,1) NOT NULL,
        so_id                INT           NOT NULL,
        org_id               INT           NOT NULL,
        line_number          INT           NOT NULL DEFAULT 1,
        product_id           INT           NOT NULL,
        warehouse_id         INT           NULL,
        quote_item_id        INT           NULL,
        qty_ordered          DECIMAL(18,4) NOT NULL,
        qty_scheduled        DECIMAL(18,4) NOT NULL DEFAULT 0,
        qty_shipped          DECIMAL(18,4) NOT NULL DEFAULT 0,
        qty_invoiced         DECIMAL(18,4) NOT NULL DEFAULT 0,
        base_price           DECIMAL(18,4) NOT NULL DEFAULT 0,
        customer_discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
        volume_discount_pct  DECIMAL(5,2)  NOT NULL DEFAULT 0,
        unit_price           DECIMAL(18,4) NOT NULL DEFAULT 0,
        tax_rate             DECIMAL(5,2)  NOT NULL DEFAULT 0,
        tax_amount           DECIMAL(18,4) NOT NULL DEFAULT 0,
        line_total           DECIMAL(18,4) NOT NULL DEFAULT 0,
        atp_status           VARCHAR(20)   NOT NULL DEFAULT 'pending',  -- pending|ok|partial|backorder
        notes                NVARCHAR(500) NULL,
        CONSTRAINT pk_so_items       PRIMARY KEY (id),
        CONSTRAINT fk_soi_so         FOREIGN KEY (so_id)        REFERENCES sales_orders(id),
        CONSTRAINT fk_soi_product    FOREIGN KEY (product_id)   REFERENCES products(id),
        CONSTRAINT fk_soi_quote_item FOREIGN KEY (quote_item_id) REFERENCES customer_quote_items(id)
      )
    `);
    console.log('✅  sales_order_items');

    // ── 6. sales_order_schedule_lines ─────────────────────────────
    await q(pool, `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='sales_order_schedule_lines')
      CREATE TABLE sales_order_schedule_lines (
        id                INT IDENTITY(1,1) NOT NULL,
        so_item_id        INT           NOT NULL,
        so_id             INT           NOT NULL,
        org_id            INT           NOT NULL,
        schedule_line_no  INT           NOT NULL DEFAULT 1,
        qty               DECIMAL(18,4) NOT NULL,
        confirmed_date    DATE          NOT NULL,
        atp_category      VARCHAR(20)   NOT NULL DEFAULT 'available',  -- available|backorder
        source_type       VARCHAR(20)   NULL,  -- stock|purchase_order
        source_po_id      INT           NULL,  -- FK purchase_orders when backorder
        status            VARCHAR(20)   NOT NULL DEFAULT 'open',  -- open|picking|shipped|cancelled
        outbound_item_id  INT           NULL,
        created_at        DATETIME      NOT NULL DEFAULT GETDATE(),
        CONSTRAINT pk_schedule_lines  PRIMARY KEY (id),
        CONSTRAINT fk_sl_so_item      FOREIGN KEY (so_item_id) REFERENCES sales_order_items(id),
        CONSTRAINT fk_sl_so           FOREIGN KEY (so_id)      REFERENCES sales_orders(id)
      )
    `);
    console.log('✅  sales_order_schedule_lines');

    // ── 7. outbound_deliveries ────────────────────────────────────
    await q(pool, `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='outbound_deliveries')
      CREATE TABLE outbound_deliveries (
        id                INT IDENTITY(1,1) NOT NULL,
        org_id            INT            NOT NULL,
        delivery_number   NVARCHAR(50)   NOT NULL,
        status            VARCHAR(20)    NOT NULL DEFAULT 'open',  -- open|picking|picked|shipped|cancelled
        so_id             INT            NOT NULL,
        warehouse_id      INT            NULL,
        planned_ship_date DATE           NULL,
        actual_ship_date  DATE           NULL,
        tracking_number   NVARCHAR(100)  NULL,
        carrier           NVARCHAR(100)  NULL,
        ship_to_name      NVARCHAR(200)  NULL,
        ship_to_address   NVARCHAR(500)  NULL,
        notes             NVARCHAR(500)  NULL,
        created_by        INT            NULL,
        created_at        DATETIME       NOT NULL DEFAULT GETDATE(),
        updated_at        DATETIME       NOT NULL DEFAULT GETDATE(),
        CONSTRAINT pk_outbound         PRIMARY KEY (id),
        CONSTRAINT uq_delivery_number  UNIQUE (org_id, delivery_number),
        CONSTRAINT fk_od_org           FOREIGN KEY (org_id) REFERENCES organisations(id),
        CONSTRAINT fk_od_so            FOREIGN KEY (so_id)  REFERENCES sales_orders(id)
      )
    `);
    console.log('✅  outbound_deliveries');

    // ── 8. outbound_delivery_items ────────────────────────────────
    await q(pool, `
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='outbound_delivery_items')
      CREATE TABLE outbound_delivery_items (
        id                 INT IDENTITY(1,1) NOT NULL,
        delivery_id        INT           NOT NULL,
        so_item_id         INT           NOT NULL,
        schedule_line_id   INT           NULL,
        org_id             INT           NOT NULL,
        product_id         INT           NOT NULL,
        warehouse_id       INT           NULL,
        qty_to_ship        DECIMAL(18,4) NOT NULL,
        qty_picked         DECIMAL(18,4) NOT NULL DEFAULT 0,
        qty_shipped        DECIMAL(18,4) NOT NULL DEFAULT 0,
        status             VARCHAR(20)   NOT NULL DEFAULT 'open',  -- open|picking|picked|shipped
        batch_number       NVARCHAR(50)  NULL,
        serial_number      NVARCHAR(100) NULL,
        bin_id             INT           NULL,
        picked_at          DATETIME      NULL,
        created_at         DATETIME      NOT NULL DEFAULT GETDATE(),
        CONSTRAINT pk_odi             PRIMARY KEY (id),
        CONSTRAINT fk_odi_delivery    FOREIGN KEY (delivery_id)   REFERENCES outbound_deliveries(id),
        CONSTRAINT fk_odi_so_item     FOREIGN KEY (so_item_id)    REFERENCES sales_order_items(id),
        CONSTRAINT fk_odi_product     FOREIGN KEY (product_id)    REFERENCES products(id)
      )
    `);
    console.log('✅  outbound_delivery_items');

    // ── 9. Alter stock_levels — add allocation columns ─────────────
    await q(pool, `
      IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('stock_levels') AND name='soft_allocated')
        ALTER TABLE stock_levels ADD soft_allocated DECIMAL(18,4) NOT NULL DEFAULT 0
    `);
    await q(pool, `
      IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('stock_levels') AND name='hard_allocated')
        ALTER TABLE stock_levels ADD hard_allocated DECIMAL(18,4) NOT NULL DEFAULT 0
    `);
    console.log('✅  stock_levels + soft_allocated, hard_allocated');

    // ── 10. Numbering series for Quotes, SOs, Deliveries ──────────
    // Uses the existing numbering_series table — just seed defaults if missing
    const seriesCheck = await pool.request().query(`SELECT id FROM numbering_series WHERE series_type IN ('customer_quote','sales_order','outbound_delivery') AND org_id = (SELECT TOP 1 id FROM organisations ORDER BY id)`);
    if (seriesCheck.recordset.length < 3) {
      const orgRes = await pool.request().query('SELECT TOP 1 id FROM organisations ORDER BY id');
      const orgId = orgRes.recordset[0]?.id;
      if (orgId) {
        const nameMap = { customer_quote: 'Customer Quotes', sales_order: 'Sales Orders', outbound_delivery: 'Outbound Deliveries' };
        for (const [series_type, prefix] of [['customer_quote','QT'],['sales_order','SO'],['outbound_delivery','OD']]) {
          await pool.request()
            .input('org_id',      sql.Int,          orgId)
            .input('series_type', sql.VarChar(50),  series_type)
            .input('prefix',      sql.NVarChar(10), prefix)
            .input('sname',       sql.NVarChar(100), nameMap[series_type])
            .input('code',        sql.NVarChar(20),  prefix)
            .query(`
              IF NOT EXISTS (SELECT 1 FROM numbering_series WHERE org_id=@org_id AND (series_type=@series_type OR code=@code))
                INSERT INTO numbering_series (org_id, name, code, series_type, prefix, separator, padding, next_number, reset_frequency, fy_start_month, is_default, is_active, created_at, updated_at)
                VALUES (@org_id, @sname, @code, @series_type, @prefix, '-', 5, 1, 'none', 7, 1, 1, GETDATE(), GETDATE())
            `);
        }
        console.log('✅  numbering_series seeded: QT, SO, OD');
      }
    } else {
      console.log('ℹ️   numbering_series already seeded');
    }

    // ── 11. Indexes ───────────────────────────────────────────────
    const indexes = [
      ['ix_quotes_org_status',    'customer_quotes',             'org_id, status'],
      ['ix_quotes_customer',      'customer_quotes',             'customer_id'],
      ['ix_so_org_status',        'sales_orders',                'org_id, status'],
      ['ix_so_customer',          'sales_orders',                'customer_id'],
      ['ix_soi_so',               'sales_order_items',           'so_id'],
      ['ix_sl_so_item',           'sales_order_schedule_lines',  'so_item_id'],
      ['ix_od_so',                'outbound_deliveries',         'so_id, status'],
      ['ix_odi_delivery',         'outbound_delivery_items',     'delivery_id'],
      ['ix_pc_org_type',          'pricing_conditions',          'org_id, condition_type, is_active'],
    ];
    for (const [name, table, cols] of indexes) {
      await q(pool, `
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='${name}' AND object_id=OBJECT_ID('${table}'))
          CREATE INDEX ${name} ON ${table} (${cols})
      `);
    }
    console.log('✅  Indexes created');

    // ── 12. Seed default GST pricing condition ─────────────────────
    const orgRes2 = await pool.request().query('SELECT TOP 1 id FROM organisations ORDER BY id');
    const orgId2  = orgRes2.recordset[0]?.id;
    if (orgId2) {
      await pool.request().input('org_id', sql.Int, orgId2).query(`
        IF NOT EXISTS (SELECT 1 FROM pricing_conditions WHERE org_id=@org_id AND condition_type='gst')
          INSERT INTO pricing_conditions (org_id, condition_type, priority, discount_type, discount_value, tax_rate, is_active, notes, created_at)
          VALUES (@org_id, 'gst', 99, 'percent', 0, 10.00, 1, 'ATO-compliant GST 10%', GETDATE())
      `);
      console.log('✅  Default GST condition seeded (10%)');
    }

    console.log('\n=================================================');
    console.log('  ✅  O2C Migration complete!');
    console.log('=================================================\n');

  } catch (err) {
    console.error('\n❌  Migration failed at step:', err._label || '(unknown)');
    console.error('Message:', err.message);
    if (err.number) console.error('SQL Error #', err.number);
    if (err.originalError) console.error('Detail:', err.originalError.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

run();
