require('dotenv').config();
const sql = require('mssql');

async function runQueries() {
  try {
    const pool = new sql.ConnectionPool({
      server: process.env.DB_SERVER,
      database: process.env.DB_DATABASE,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_CERT === 'true'
      }
    });

    await pool.connect();

    // FK constraints using sp_fkeys
    console.log('=== FOREIGN KEYS REFERENCING journal_entries ===');
    let result = await pool.request().query(`
      SELECT 
        name AS constraint_name,
        OBJECT_NAME(parent_object_id) AS table_name,
        COL_NAME(parent_object_id, parent_column_id) AS column_name,
        OBJECT_NAME(referenced_object_id) AS referenced_table,
        COL_NAME(referenced_object_id, referenced_column_id) AS referenced_column
      FROM sys.foreign_keys
      WHERE OBJECT_NAME(parent_object_id) = 'journal_entries'
    `);
    console.log(JSON.stringify(result.recordset, null, 2));

    await pool.close();
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

runQueries();
