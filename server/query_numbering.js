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

    // Query: numbering_series sample
    console.log('=== NUMBERING_SERIES SAMPLE ===');
    let result = await pool.request().query(
      'SELECT TOP 10 id, series_type, prefix FROM numbering_series'
    );
    console.log(JSON.stringify(result.recordset, null, 2));

    await pool.close();
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

runQueries();
