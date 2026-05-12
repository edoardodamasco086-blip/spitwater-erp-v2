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
        name AS constraint_name,
        OBJECT_NAME(parent_object_id) AS table_name,
        (SELECT name FROM sys.columns WHERE object_id = parent_object_id AND column_id = (
          SELECT parent_column_id FROM sys.foreign_key_columns 
          WHERE constraint_object_id = sys.foreign_keys.object_id LIMIT 1
        )) AS column_name,
        OBJECT_NAME(referenced_object_id) AS referenced_table
      FROM sys.foreign_keys
      WHERE OBJECT_NAME(parent_object_id) = 'journal_entries'
    `);
    if (result.recordset.length > 0) {
      console.log(JSON.stringify(result.recordset, null, 2));
    } else {
      console.log('No foreign keys found with that query, trying alternative...');
      result = await pool.request().query(`
        SELECT 
          fks.name,
          OBJECT_NAME(fks.parent_object_id) AS parent_table,
          OBJECT_NAME(fks.referenced_object_id) AS referenced_table
        FROM sys.foreign_keys fks
        WHERE OBJECT_NAME(fks.parent_object_id) = 'journal_entries'
      `);
      console.log(JSON.stringify(result.recordset, null, 2));
    }

    await pool.close();
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

runQueries();
