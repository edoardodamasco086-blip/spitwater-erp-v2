'use strict';
// Run from server/ directory: node scripts/migrate-drop-receiving.js
// Drops the legacy Goods Receiving tables — superseded by WMS Inbound Deliveries.
require('dotenv').config();
const sql = require('mssql');

const cfg = {
  server:   process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options:  { encrypt: false, trustServerCertificate: true },
};

async function run() {
  console.log(`Connecting to ${process.env.DB_SERVER} / ${process.env.DB_DATABASE}`);
  const pool = await sql.connect(cfg);
  const q    = (s) => pool.request().query(s);

  // Drop child tables first (FK constraints)
  await q(`
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='receiving_session_lines')
      DROP TABLE receiving_session_lines
  `);
  console.log('✓ dropped receiving_session_lines');

  // putaway_tasks has a FK to receiving_sessions and is unused — drop it too
  await q(`
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='putaway_tasks')
      DROP TABLE putaway_tasks
  `);
  console.log('✓ dropped putaway_tasks');

  await q(`
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='receiving_sessions')
      DROP TABLE receiving_sessions
  `);
  console.log('✓ dropped receiving_sessions');

  // Remove numbering series rows for receiving_session (if any)
  await q(`
    DELETE FROM numbering_series WHERE series_type = 'receiving_session'
  `);
  console.log('✓ removed numbering_series rows for receiving_session');

  await pool.close();
  console.log('\n✅ Goods Receiving cleanup complete.');
}

run().catch(e => { console.error(e.message); process.exit(1); });
