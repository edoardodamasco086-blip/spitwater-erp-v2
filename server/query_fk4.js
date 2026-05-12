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

    // FK constraints using sys.foreign_keys
    console.log('=== FOREIGN KEYS ON journal_entries ===');
    let result = await pool.request().query(`
      SELECT 
        fks.name,
        OBJECT_NAME(fks.parent_object_id) AS parent_table,
        OBJECT_NAME(fks.referenced_object_id) AS referenced_table
      FROM sys.foreign_keys fks
      WHERE OBJECT_NAME(fks.parent_object_id) = 'journal_entries'
    `);
    console.log(JSON.stringify(result.recordset, null, 2));

    await pool.close();
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

runQueries();
