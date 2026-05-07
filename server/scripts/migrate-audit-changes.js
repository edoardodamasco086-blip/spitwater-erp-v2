'use strict';
// Creates the audit_changes table for field-level product change tracking.
// Safe to re-run — checks for existence before creating.

require('dotenv').config();
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER   || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt:                process.env.DB_ENCRYPT    === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
    enableArithAbort: true,
  },
};

async function run() {
  const pool = await sql.connect(config);

  // Check if table already exists
  const exists = await pool.request().query(`
    SELECT 1 FROM sys.tables WHERE name = 'audit_changes'
  `);

  if (exists.recordset.length > 0) {
    console.log('audit_changes table already exists — nothing to do.');
    await pool.close();
    return;
  }

  console.log('Creating audit_changes table...');
  await pool.request().query(`
    CREATE TABLE audit_changes (
      id            BIGINT IDENTITY(1,1) PRIMARY KEY,
      audit_log_id  BIGINT        NOT NULL,
      field_name    NVARCHAR(200) NOT NULL,
      old_value     NVARCHAR(MAX) NULL,
      new_value     NVARCHAR(MAX) NULL,
      data_type     VARCHAR(30)   NULL,
      created_at    DATETIME      NOT NULL DEFAULT GETDATE(),
      CONSTRAINT fk_audit_changes_log
        FOREIGN KEY (audit_log_id) REFERENCES audit_log(id) ON DELETE CASCADE
    )
  `);

  await pool.request().query(`
    CREATE INDEX ix_audit_changes_log ON audit_changes (audit_log_id)
  `);

  console.log('audit_changes table created successfully.');
  await pool.close();
}

run().catch(err => { console.error(err); process.exit(1); });
