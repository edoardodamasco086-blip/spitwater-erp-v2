'use strict';
require('dotenv').config();
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER   || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE || 'Development_04052026',
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt:                process.env.DB_ENCRYPT    === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
    enableArithAbort:       true,
  },
};

if (process.env.DB_WINDOWS_AUTH === 'true') {
  config.options.trustedConnection = true;
}

async function inspect() {
  let pool;
  try {
    pool = await sql.connect(config);
    const args = process.argv.slice(2);
    const targetTable = args[0];

    if (targetTable) {
      // Describe specific table
      console.log(`\n=== Table: ${targetTable} ===\n`);
      const res = await pool.request()
        .input('table', sql.NVarChar, targetTable)
        .query(`
          SELECT 
            COLUMN_NAME, 
            DATA_TYPE, 
            CHARACTER_MAXIMUM_LENGTH as MAX_LEN,
            IS_NULLABLE,
            COLUMN_DEFAULT
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = @table
          ORDER BY ORDINAL_POSITION
        `);
      
      if (res.recordset.length === 0) {
        console.log(`Table "${targetTable}" not found.`);
      } else {
        console.table(res.recordset);
      }
    } else {
      // List all tables
      console.log('\n=== Database Tables ===\n');
      const res = await pool.request().query(`
        SELECT TABLE_NAME 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_TYPE = 'BASE TABLE' 
        ORDER BY TABLE_NAME
      `);
      
      const tables = res.recordset.map(r => r.TABLE_NAME);
      console.log(tables.join(', '));
      console.log(`\nTotal Tables: ${tables.length}`);
      console.log('\nUsage: node scripts/inspect-schema.js <table_name>');
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    if (pool) await pool.close();
  }
}

inspect();
