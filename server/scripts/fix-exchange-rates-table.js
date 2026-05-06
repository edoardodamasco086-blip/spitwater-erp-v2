'use strict';
// Run: node scripts/fix-exchange-rates-table.js
// Fixes exchange_rates table — adds missing columns if needed
require('dotenv').config();
const sql = require('mssql');

const config = {
  server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT)||1433,
  database: process.env.DB_DATABASE,
  options: { encrypt: process.env.DB_ENCRYPT==='true', trustServerCertificate: process.env.DB_TRUST_CERT==='true', enableArithAbort: true },
};
if (process.env.DB_WINDOWS_AUTH==='true') config.options.trustedConnection=true;
else { config.user=process.env.DB_USER; config.password=process.env.DB_PASSWORD; }

async function colExists(pool, table, col) {
  const r = await pool.request().query(`SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('${table}') AND name='${col}'`);
  return r.recordset.length > 0;
}

async function run() {
  console.log('\n=== Fix exchange_rates table ===\n');
  let pool;
  try {
    pool = await sql.connect(config);
    console.log('✅ Connected');

    // Show current columns
    const cols = await pool.request().query(`SELECT name, system_type_id FROM sys.columns WHERE object_id=OBJECT_ID('exchange_rates') ORDER BY column_id`);
    console.log('Current columns:', cols.recordset.map(c=>c.name).join(', '));

    // Add missing columns
    const needed = [
      ['from_currency', 'VARCHAR(3) NOT NULL DEFAULT \'AUD\''],
      ['to_currency',   'VARCHAR(3) NOT NULL DEFAULT \'USD\''],
      ['rate',          'DECIMAL(18,8) NOT NULL DEFAULT 1'],
      ['rate_date',     'DATE NOT NULL DEFAULT GETDATE()'],
      ['source',        "VARCHAR(20) NOT NULL DEFAULT 'api'"],
      ['fetched_at',    'DATETIME NOT NULL DEFAULT GETDATE()'],
    ];

    for (const [col, def] of needed) {
      if (!await colExists(pool, 'exchange_rates', col)) {
        await pool.request().query(`ALTER TABLE exchange_rates ADD ${col} ${def}`);
        console.log(`✅ Added: ${col}`);
      } else {
        console.log(`ℹ️  Exists: ${col}`);
      }
    }

    // Add UNIQUE constraint if missing
    try {
      const uq = await pool.request().query(`SELECT 1 FROM sys.indexes WHERE name='uq_exchange_rates' AND object_id=OBJECT_ID('exchange_rates')`);
      if (!uq.recordset.length) {
        await pool.request().query(`ALTER TABLE exchange_rates ADD CONSTRAINT uq_exchange_rates UNIQUE (from_currency, to_currency, rate_date)`);
        console.log('✅ Added: uq_exchange_rates UNIQUE constraint');
      }
    } catch(e) { console.log('Note: UNIQUE constraint -', e.message); }

    // Add index
    try {
      const ix = await pool.request().query(`SELECT 1 FROM sys.indexes WHERE name='ix_er_date' AND object_id=OBJECT_ID('exchange_rates')`);
      if (!ix.recordset.length) {
        await pool.request().query(`CREATE INDEX ix_er_date ON exchange_rates (rate_date DESC, from_currency, to_currency)`);
        console.log('✅ Added: ix_er_date index');
      }
    } catch(e) { console.log('Note: index -', e.message); }

    console.log('\n=== Done ✅ ===\n');
  } catch(err) {
    console.error('❌ Failed:', err.message);
    process.exit(1);
  } finally { if(pool) await pool.close(); }
}
run();
