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

    // Query 6: FK constraints on journal_entries (corrected for SQL Server)
    console.log('=== FOREIGN KEY CONSTRAINTS ON JOURNAL_ENTRIES ===');
    let result = await pool.request().query(`
      SELECT 
        TC.CONSTRAINT_NAME,
        KCU.COLUMN_NAME,
        CCU.TABLE_NAME AS REFERENCED_TABLE_NAME,
        CCU.COLUMN_NAME AS REFERENCED_COLUMN_NAME
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS AS TC
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS KCU
        ON TC.CONSTRAINT_NAME = KCU.CONSTRAINT_NAME
      JOIN INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE AS CCU
        ON CCU.CONSTRAINT_NAME = TC.CONSTRAINT_NAME
      WHERE TC.TABLE_NAME = 'journal_entries'
        AND TC.CONSTRAINT_TYPE = 'FOREIGN KEY'
    `);
    console.log(JSON.stringify(result.recordset, null, 2));

    await pool.close();
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

runQueries();
