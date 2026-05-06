'use strict';
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

// Check if table exists
async function tableExists(pool, name) {
  const r = await pool.request().query(`SELECT 1 FROM sys.tables WHERE name = '${name}'`);
  return r.recordset.length > 0;
}

// Check if column exists
async function columnExists(pool, table, col) {
  const r = await pool.request().query(`SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('${table}') AND name = '${col}'`);
  return r.recordset.length > 0;
}

// Check if constraint/index exists
async function constraintExists(pool, name, type) {
  if (type === 'fk') {
    const r = await pool.request().query(`SELECT 1 FROM sys.foreign_keys WHERE name = '${name}'`);
    return r.recordset.length > 0;
  }
  const r = await pool.request().query(`SELECT 1 FROM sys.indexes WHERE name = '${name}'`);
  return r.recordset.length > 0;
}

async function run() {
  console.log('\n=== Pricing / UOM / Currency Migration ===\n');
  let pool;
  try {
    pool = await sql.connect(config);
    console.log('✅  Connected\n');

    // ── 1. currencies ─────────────────────────────────────────
    if (!await tableExists(pool, 'currencies')) {
      await pool.request().query(`
        CREATE TABLE currencies (
          code       VARCHAR(3)    NOT NULL,
          name       NVARCHAR(50)  NOT NULL,
          symbol     NVARCHAR(5)   NOT NULL DEFAULT '$',
          is_active  BIT           NOT NULL DEFAULT 1,
          is_base    BIT           NOT NULL DEFAULT 0,
          CONSTRAINT pk_currencies PRIMARY KEY (code)
        )
      `);
      console.log('✅  Created: currencies');
    } else { console.log('ℹ️   Exists:  currencies'); }

    // ── 2. exchange_rates — NO inline constraints ──────────────
    if (!await tableExists(pool, 'exchange_rates')) {
      // Create table with ONLY primary key — no FKs or UNIQUE yet
      await pool.request().query(`
        CREATE TABLE exchange_rates (
          id              INT IDENTITY(1,1) NOT NULL,
          from_currency   VARCHAR(3)        NOT NULL,
          to_currency     VARCHAR(3)        NOT NULL,
          rate            DECIMAL(18,8)     NOT NULL,
          rate_date       DATE              NOT NULL,
          source          VARCHAR(20)       NOT NULL DEFAULT 'exchangerate_host',
          fetched_at      DATETIME          NOT NULL DEFAULT GETDATE(),
          CONSTRAINT pk_exchange_rates PRIMARY KEY (id)
        )
      `);
      console.log('✅  Created: exchange_rates');

      // Now add UNIQUE and FKs as separate statements
      await pool.request().query(`ALTER TABLE exchange_rates ADD CONSTRAINT uq_exchange_rates UNIQUE (from_currency, to_currency, rate_date)`);
      console.log('✅  Added: uq_exchange_rates');

      try {
        await pool.request().query(`ALTER TABLE exchange_rates ADD CONSTRAINT fk_er_from FOREIGN KEY (from_currency) REFERENCES currencies(code)`);
        await pool.request().query(`ALTER TABLE exchange_rates ADD CONSTRAINT fk_er_to   FOREIGN KEY (to_currency)   REFERENCES currencies(code)`);
        console.log('✅  Added: exchange_rates FKs');
      } catch (e) { console.log('  Note: exchange_rates FKs skipped -', e.message); }

      await pool.request().query(`CREATE INDEX ix_er_date ON exchange_rates (rate_date DESC, from_currency, to_currency)`);
    } else { console.log('ℹ️   Exists:  exchange_rates'); }

    // ── 3. customer_tiers ─────────────────────────────────────
    if (!await tableExists(pool, 'customer_tiers')) {
      await pool.request().query(`
        CREATE TABLE customer_tiers (
          id           INT IDENTITY(1,1) NOT NULL,
          org_id       INT               NOT NULL,
          name         NVARCHAR(100)     NOT NULL,
          description  NVARCHAR(500)     NULL,
          color        VARCHAR(7)        NOT NULL DEFAULT '#2F7FE8',
          discount_pct DECIMAL(5,2)      NOT NULL DEFAULT 0,
          is_active    BIT               NOT NULL DEFAULT 1,
          sort_order   INT               NOT NULL DEFAULT 0,
          created_at   DATETIME          NOT NULL DEFAULT GETDATE(),
          CONSTRAINT pk_customer_tiers PRIMARY KEY (id)
        )
      `);
      console.log('✅  Created: customer_tiers');
      await pool.request().query(`ALTER TABLE customer_tiers ADD CONSTRAINT uq_tier_name UNIQUE (org_id, name)`);
      try { await pool.request().query(`ALTER TABLE customer_tiers ADD CONSTRAINT fk_tier_org FOREIGN KEY (org_id) REFERENCES organisations(id)`); } catch(e) {}
    } else { console.log('ℹ️   Exists:  customer_tiers'); }

    // ── 4. contact_tiers ──────────────────────────────────────
    if (!await tableExists(pool, 'contact_tiers')) {
      // Create with only PK — add constraints separately for SQL Server 2014
      await pool.request().query(`
        CREATE TABLE contact_tiers (
          id          INT IDENTITY(1,1) NOT NULL,
          org_id      INT               NOT NULL,
          contact_id  INT               NOT NULL,
          tier_id     INT               NOT NULL,
          assigned_at DATETIME          NOT NULL DEFAULT GETDATE(),
          assigned_by INT               NULL,
          CONSTRAINT pk_contact_tiers PRIMARY KEY (id)
        )
      `);
      console.log('✅  Created: contact_tiers');
      // Add constraints separately
      await pool.request().query(`ALTER TABLE contact_tiers ADD CONSTRAINT uq_contact_tier UNIQUE (org_id, contact_id)`);
      try { await pool.request().query(`ALTER TABLE contact_tiers ADD CONSTRAINT fk_ct_org  FOREIGN KEY (org_id)  REFERENCES organisations(id)`); } catch(e) {}
      try { await pool.request().query(`ALTER TABLE contact_tiers ADD CONSTRAINT fk_ct_tier FOREIGN KEY (tier_id) REFERENCES customer_tiers(id)`); } catch(e) {}
    } else { console.log('ℹ️   Exists:  contact_tiers'); }

    // ── 5. product_uom_conversions ────────────────────────────
    if (!await tableExists(pool, 'product_uom_conversions')) {
      await pool.request().query(`
        CREATE TABLE product_uom_conversions (
          id          INT IDENTITY(1,1) NOT NULL,
          org_id      INT               NOT NULL,
          product_id  INT               NOT NULL,
          uom_id      INT               NOT NULL,
          uom_role    VARCHAR(10)       NOT NULL DEFAULT 'other',
          qty_in_base DECIMAL(18,6)     NOT NULL DEFAULT 1,
          barcode     NVARCHAR(100)     NULL,
          weight_kg   DECIMAL(10,4)     NULL,
          length_cm   DECIMAL(10,2)     NULL,
          width_cm    DECIMAL(10,2)     NULL,
          height_cm   DECIMAL(10,2)     NULL,
          is_active   BIT               NOT NULL DEFAULT 1,
          sort_order  INT               NOT NULL DEFAULT 0,
          CONSTRAINT pk_puom    PRIMARY KEY (id)
        )
      `);
      console.log('✅  Created: product_uom_conversions');
      await pool.request().query(`ALTER TABLE product_uom_conversions ADD CONSTRAINT uq_puom UNIQUE (org_id, product_id, uom_id)`);
      try { await pool.request().query(`ALTER TABLE product_uom_conversions ADD CONSTRAINT fk_puom_org FOREIGN KEY (org_id) REFERENCES organisations(id)`); } catch(e) {}
      await pool.request().query(`CREATE INDEX ix_puom_product ON product_uom_conversions (org_id, product_id)`);
      try {
        await pool.request().query(`ALTER TABLE product_uom_conversions ADD CONSTRAINT fk_puom_uom FOREIGN KEY (uom_id) REFERENCES units_of_measure(id)`);
      } catch (e) {}
    } else { console.log('ℹ️   Exists:  product_uom_conversions'); }

    // ── 6. product_supplier_prices ────────────────────────────
    if (!await tableExists(pool, 'product_supplier_prices')) {
      await pool.request().query(`
        CREATE TABLE product_supplier_prices (
          id              INT IDENTITY(1,1) NOT NULL,
          org_id          INT               NOT NULL,
          product_id      INT               NOT NULL,
          contact_id      INT               NOT NULL,
          uom_id          INT               NOT NULL,
          unit_price      DECIMAL(18,4)     NOT NULL,
          currency_code   VARCHAR(3)        NOT NULL DEFAULT 'AUD',
          min_order_qty   DECIMAL(18,4)     NOT NULL DEFAULT 1,
          lead_time_days  INT               NULL,
          valid_from      DATE              NULL,
          valid_to        DATE              NULL,
          is_active       BIT               NOT NULL DEFAULT 1,
          notes           NVARCHAR(500)     NULL,
          created_at      DATETIME          NOT NULL DEFAULT GETDATE(),
          updated_at      DATETIME          NOT NULL DEFAULT GETDATE(),
          CONSTRAINT pk_psp     PRIMARY KEY (id)
        )
      `);
      console.log('✅  Created: product_supplier_prices');
      try { await pool.request().query(`ALTER TABLE product_supplier_prices ADD CONSTRAINT fk_psp_org FOREIGN KEY (org_id) REFERENCES organisations(id)`); } catch(e) {}
      await pool.request().query(`CREATE INDEX ix_psp_product ON product_supplier_prices (org_id, product_id, contact_id)`);
      try {
        await pool.request().query(`ALTER TABLE product_supplier_prices ADD CONSTRAINT fk_psp_uom FOREIGN KEY (uom_id) REFERENCES units_of_measure(id)`);
        await pool.request().query(`ALTER TABLE product_supplier_prices ADD CONSTRAINT fk_psp_cur FOREIGN KEY (currency_code) REFERENCES currencies(code)`);
      } catch (e) {}
    } else { console.log('ℹ️   Exists:  product_supplier_prices'); }

    // ── 7. cpq_discount_rules ─────────────────────────────────
    if (!await tableExists(pool, 'cpq_discount_rules')) {
      await pool.request().query(`
        CREATE TABLE cpq_discount_rules (
          id                  INT IDENTITY(1,1) NOT NULL,
          org_id              INT               NOT NULL,
          name                NVARCHAR(200)     NOT NULL,
          tier_id             INT               NULL,
          price_list_id       INT               NULL,
          product_category_id INT               NULL,
          product_id          INT               NULL,
          uom_id              INT               NULL,
          qty_min             DECIMAL(18,4)     NULL,
          qty_max             DECIMAL(18,4)     NULL,
          discount_pct        DECIMAL(5,2)      NOT NULL DEFAULT 0,
          discount_fixed      DECIMAL(18,4)     NULL,
          priority            INT               NOT NULL DEFAULT 0,
          is_active           BIT               NOT NULL DEFAULT 1,
          valid_from          DATE              NULL,
          valid_to            DATE              NULL,
          notes               NVARCHAR(500)     NULL,
          created_at          DATETIME          NOT NULL DEFAULT GETDATE(),
          CONSTRAINT pk_cpq    PRIMARY KEY (id)
        )
      `);
      console.log('✅  Created: cpq_discount_rules');
      try { await pool.request().query(`ALTER TABLE cpq_discount_rules ADD CONSTRAINT fk_cpq_org  FOREIGN KEY (org_id)  REFERENCES organisations(id)`); } catch(e) {}
      try { await pool.request().query(`ALTER TABLE cpq_discount_rules ADD CONSTRAINT fk_cpq_tier FOREIGN KEY (tier_id) REFERENCES customer_tiers(id)`); } catch(e) {}
    } else { console.log('ℹ️   Exists:  cpq_discount_rules'); }

    // ── 8. Add columns to price_list_items ────────────────────
    console.log('\nUpdating price_list_items...');
    const pliCols = [
      ['uom_id',        'INT NULL'],
      ['currency_code', "VARCHAR(3) NOT NULL DEFAULT 'AUD'"],
      ['qty_min',       'DECIMAL(18,4) NOT NULL DEFAULT 1'],
      ['qty_max',       'DECIMAL(18,4) NULL'],
    ];
    for (const [col, def] of pliCols) {
      if (!await columnExists(pool, 'price_list_items', col)) {
        await pool.request().query(`ALTER TABLE price_list_items ADD ${col} ${def}`);
        console.log(`  ✅  Added: price_list_items.${col}`);
      } else {
        console.log(`  ℹ️   Exists: price_list_items.${col}`);
      }
    }
    try {
      if (!await constraintExists(pool, 'fk_pli_uom', 'fk')) {
        await pool.request().query(`ALTER TABLE price_list_items ADD CONSTRAINT fk_pli_uom FOREIGN KEY (uom_id) REFERENCES units_of_measure(id)`);
      }
    } catch(e) {}

    // ── 9. Add columns to org_settings ────────────────────────
    console.log('\nUpdating org_settings...');
    if (!await columnExists(pool, 'org_settings', 'base_currency')) {
      await pool.request().query(`ALTER TABLE org_settings ADD base_currency VARCHAR(3) NOT NULL DEFAULT 'AUD'`);
      console.log('  ✅  Added: org_settings.base_currency');
    } else { console.log('  ℹ️   Exists: org_settings.base_currency'); }
    if (!await columnExists(pool, 'org_settings', 'fx_last_updated')) {
      await pool.request().query(`ALTER TABLE org_settings ADD fx_last_updated DATETIME NULL`);
      console.log('  ✅  Added: org_settings.fx_last_updated');
    } else { console.log('  ℹ️   Exists: org_settings.fx_last_updated'); }

    // ── 10. Seed currencies ───────────────────────────────────
    console.log('\nSeeding currencies...');
    const DEFAULT_CURRENCIES = [
      { code: 'AUD', name: 'Australian Dollar', symbol: '$',  is_base: 1 },
      { code: 'USD', name: 'US Dollar',          symbol: '$',  is_base: 0 },
      { code: 'EUR', name: 'Euro',               symbol: '€',  is_base: 0 },
      { code: 'GBP', name: 'British Pound',      symbol: '£',  is_base: 0 },
      { code: 'JPY', name: 'Japanese Yen',       symbol: '¥',  is_base: 0 },
      { code: 'CNY', name: 'Chinese Yuan',       symbol: '¥',  is_base: 0 },
      { code: 'NZD', name: 'New Zealand Dollar', symbol: '$',  is_base: 0 },
      { code: 'SGD', name: 'Singapore Dollar',   symbol: '$',  is_base: 0 },
      { code: 'HKD', name: 'Hong Kong Dollar',   symbol: '$',  is_base: 0 },
      { code: 'INR', name: 'Indian Rupee',       symbol: '₹', is_base: 0 },
    ];
    // Ensure is_base column exists on currencies (may have been created without it)
    if (!await columnExists(pool, 'currencies', 'is_base')) {
      await pool.request().query(`ALTER TABLE currencies ADD is_base BIT NOT NULL DEFAULT 0`);
      console.log('  ✅  Added: currencies.is_base');
    }
    if (!await columnExists(pool, 'currencies', 'symbol')) {
      await pool.request().query(`ALTER TABLE currencies ADD symbol NVARCHAR(5) NOT NULL DEFAULT '$'`);
      console.log('  ✅  Added: currencies.symbol');
    }

    let currCreated = 0;
    for (const cur of DEFAULT_CURRENCIES) {
      const ex = await pool.request().input('code', sql.VarChar(3), cur.code).query('SELECT 1 FROM currencies WHERE code=@code');
      if (!ex.recordset.length) {
        await pool.request()
          .input('code',    sql.VarChar(3),  cur.code)
          .input('name',    sql.NVarChar(50), cur.name)
          .input('symbol',  sql.NVarChar(5),  cur.symbol)
          .input('is_base', sql.Bit,          cur.is_base)
          .query(`INSERT INTO currencies (code,name,symbol,is_active,is_base) VALUES (@code,@name,@symbol,1,@is_base)`);
        currCreated++;
      }
    }
    console.log(`  ✅  ${currCreated} currencies created`);

    // ── 11. Seed customer tiers ───────────────────────────────
    console.log('\nSeeding customer tiers...');
    const orgRes = await pool.request().query('SELECT TOP 1 id FROM organisations ORDER BY id');
    if (orgRes.recordset.length) {
      const orgId = orgRes.recordset[0].id;
      const TIERS = [
        { name: 'Standard', color: '#7B93B0', discount_pct: 0,  sort_order: 1 },
        { name: 'Silver',   color: '#9EA0A5', discount_pct: 5,  sort_order: 2 },
        { name: 'Gold',     color: '#E89B2F', discount_pct: 10, sort_order: 3 },
        { name: 'Dealer',   color: '#9366E8', discount_pct: 15, sort_order: 4 },
        { name: 'Platinum', color: '#2F7FE8', discount_pct: 20, sort_order: 5 },
      ];
      let tierCreated = 0;
      for (const t of TIERS) {
        const ex = await pool.request()
          .input('org_id', sql.Int, orgId).input('name', sql.NVarChar(100), t.name)
          .query('SELECT id FROM customer_tiers WHERE org_id=@org_id AND name=@name');
        if (!ex.recordset.length) {
          await pool.request()
            .input('org_id', sql.Int, orgId).input('name', sql.NVarChar(100), t.name)
            .input('color', sql.VarChar(7), t.color).input('dp', sql.Decimal(5,2), t.discount_pct)
            .input('so', sql.Int, t.sort_order)
            .query(`INSERT INTO customer_tiers (org_id,name,color,discount_pct,is_active,sort_order,created_at) VALUES (@org_id,@name,@color,@dp,1,@so,GETDATE())`);
          tierCreated++;
        }
      }
      console.log(`  ✅  ${tierCreated} customer tiers created`);
    }

    console.log('\n=== Migration complete ✅ ===\n');

  } catch (err) {
    console.error('\n❌  Migration failed:', err.message);
    if (err.number) console.error('SQL Error number:', err.number);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}
run();
