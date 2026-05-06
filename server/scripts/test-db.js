'use strict';
// ============================================================
// scripts/test-db.js
// Run with:  node scripts/test-db.js
// Tests the database connection and shows table count.
// ============================================================

require('dotenv').config();
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER   || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE || 'Development_04052026',
  options: {
    encrypt:                process.env.DB_ENCRYPT    === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
    enableArithAbort:       true,
  },
};

if (process.env.DB_WINDOWS_AUTH === 'true') {
  config.options.trustedConnection = true;
} else {
  config.user     = process.env.DB_USER     || 'sa';
  config.password = process.env.DB_PASSWORD || '';
}

console.log('\n=== Spitwater ERP — Database Connection Test ===\n');
console.log(`Server:   ${config.server}:${config.port}`);
console.log(`Database: ${config.database}`);
console.log(`Auth:     ${process.env.DB_WINDOWS_AUTH === 'true' ? 'Windows' : `SQL (${config.user})`}`);
console.log('\nConnecting...\n');

async function run() {
  let pool;
  try {
    pool = await sql.connect(config);
    console.log('✅  Connection successful!\n');

    // Check DB version
    const ver = await pool.request().query('SELECT @@VERSION AS version');
    const versionLine = ver.recordset[0].version.split('\n')[0];
    console.log(`SQL Server: ${versionLine}\n`);

    // Count tables
    const tables = await pool.request().query(`
      SELECT COUNT(*) AS table_count FROM sys.tables WHERE type = 'U'
    `);
    const count = tables.recordset[0].table_count;
    console.log(`Tables in [${config.database}]: ${count}`);

    if (count === 0) {
      console.log('\n⚠️  No tables found — have you run ERP_SCHEMA_COMPLETE.sql yet?');
    } else if (count < 140) {
      console.log(`\n⚠️  Expected ~148 tables but found ${count} — schema may be incomplete.`);
    } else {
      console.log('✅  Schema looks complete!\n');
    }

    // Check key tables exist
    const keyTables = ['users', 'organisations', 'org_members', 'refresh_tokens', 'audit_log'];
    const check = await pool.request().query(`
      SELECT name FROM sys.tables WHERE name IN (${keyTables.map(t => `'${t}'`).join(',')}) ORDER BY name
    `);
    const found = check.recordset.map(r => r.name);
    console.log('Key tables:');
    for (const t of keyTables) {
      console.log(`  ${found.includes(t) ? '✅' : '❌'}  ${t}`);
    }

    // Check if any users exist
    const userCount = await pool.request().query('SELECT COUNT(*) AS cnt FROM users');
    console.log(`\nUsers in DB: ${userCount.recordset[0].cnt}`);
    if (userCount.recordset[0].cnt === 0) {
      console.log('ℹ️  No users yet — run: node scripts/seed-admin.js to create the first admin.');
    }

    console.log('\n=== All checks passed — ready to start the server ===\n');
  } catch (err) {
    console.error('\n❌  Connection FAILED\n');
    console.error(`Error: ${err.message}\n`);
    console.error('Common fixes:');
    console.error('  1. Check DB_SERVER in your .env file');
    console.error('  2. Check SQL Server is running (SQL Server Configuration Manager)');
    console.error('  3. Check TCP/IP is enabled on port 1433');
    console.error('  4. Check Windows Firewall allows port 1433');
    console.error('  5. Check DB_USER / DB_PASSWORD are correct');
    console.error('  6. For named instances add:  DB_INSTANCE=SQLEXPRESS  to .env\n');
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

run();
