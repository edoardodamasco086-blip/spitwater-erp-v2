'use strict';
// ================================================================
// Migration: Add scope_key to custom_field_definitions
// Run once: node scripts/migrate-custom-fields-scope.js
// ================================================================
const { poolConnect, pool, sql } = require('../config/db');

async function run() {
  await poolConnect;
  console.log('Adding scope_key column to custom_field_definitions...');
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'custom_field_definitions'
        AND COLUMN_NAME = 'scope_key'
    )
    ALTER TABLE custom_field_definitions ADD scope_key NVARCHAR(100) NULL;
  `);
  console.log('Done.');
  process.exit(0);
}
run().catch(err => { console.error(err); process.exit(1); });
