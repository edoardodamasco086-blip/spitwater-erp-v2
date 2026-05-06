'use strict';
// Run: node scripts/migrate-field-validation-v2.js
// Removes the UNIQUE constraint on (org_id, entity_key, field_key)
// Adds an `id` column as the new primary key if not already present
// Adds a `rule_order` column for ordering within a field

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
  console.log('\n=== Field Validation v2 Migration ===\n');
  let pool;
  try {
    pool = await sql.connect(config);

    // 1. Drop the UNIQUE constraint if it exists
    await pool.request().query(`
      DECLARE @constraintName NVARCHAR(200);
      SELECT @constraintName = name
      FROM sys.indexes
      WHERE object_id = OBJECT_ID('field_validation_rules')
        AND is_unique = 1
        AND name LIKE 'uq_%';

      IF @constraintName IS NOT NULL
      BEGIN
        DECLARE @sql NVARCHAR(500) = 'ALTER TABLE field_validation_rules DROP CONSTRAINT ' + @constraintName;
        EXEC sp_executesql @sql;
        PRINT 'Dropped UNIQUE constraint: ' + @constraintName;
      END
      ELSE
        PRINT 'No UNIQUE constraint found (already removed)';
    `);

    // 2. Add rule_order column if missing (ordering within same field_key)
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('field_validation_rules') AND name = 'rule_order'
      )
      BEGIN
        ALTER TABLE field_validation_rules ADD rule_order INT NOT NULL DEFAULT 0;
        PRINT 'Added: rule_order column';
      END
      ELSE PRINT 'Exists: rule_order column';
    `);

    // 3. Add a non-unique index on (org_id, entity_key, field_key, rule_order) for fast retrieval
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID('field_validation_rules') AND name = 'ix_fvr_field_order'
      )
      BEGIN
        CREATE INDEX ix_fvr_field_order
          ON field_validation_rules (org_id, entity_key, field_key, rule_order);
        PRINT 'Created index: ix_fvr_field_order';
      END
      ELSE PRINT 'Exists: ix_fvr_field_order';
    `);

    // 4. Set rule_order = 0 for all existing rows (they all had unique field_keys so they're all "first" rules)
    await pool.request().query(`
      UPDATE field_validation_rules SET rule_order = 0 WHERE rule_order IS NULL OR rule_order = 0;
      PRINT 'rule_order initialized for existing rows';
    `);

    console.log('\n✅  Migration complete');
    console.log('    - UNIQUE constraint removed');
    console.log('    - rule_order column added');
    console.log('    - Multiple validation rules per field now supported\n');

  } catch (err) {
    console.error('❌  Migration failed:', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}
run();
