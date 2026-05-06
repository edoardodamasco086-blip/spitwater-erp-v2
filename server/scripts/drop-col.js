'use strict';
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
  },
};

async function drop() {
  let pool;
  try {
    pool = await sql.connect(config);
    console.log('Connected to DB');
    await pool.request().query(`
      DECLARE @ConstraintName nvarchar(200)
      SELECT @ConstraintName = Name FROM sys.default_constraints
      WHERE parent_object_id = OBJECT_ID('exchange_rates') 
        AND parent_column_id = (SELECT column_id FROM sys.columns WHERE object_id = OBJECT_ID('exchange_rates') AND name = 'to_currency')

      IF @ConstraintName IS NOT NULL
        EXEC('ALTER TABLE exchange_rates DROP CONSTRAINT ' + @ConstraintName)

      ALTER TABLE exchange_rates DROP COLUMN to_currency
    `);
    console.log('✅ Column to_currency dropped successfully.');
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    if (pool) await pool.close();
  }
}
drop();
