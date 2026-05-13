'use strict';
require('dotenv').config();
const sql = require('mssql');
const config = {
  server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT)||1433,
  database: process.env.DB_DATABASE, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: process.env.DB_ENCRYPT==='true', trustServerCertificate: process.env.DB_TRUST_CERT==='true' }
};
async function run() {
  const pool = await sql.connect(config);
  // Inspect document_lines and documents table
  for (const t of ['documents', 'document_lines', 'stock_movements', 'stock_reservations', 'inbound_deliveries', 'inbound_delivery_items', 'handling_units', 'hu_contents']) {
    try {
      const res = await pool.request().input('t', sql.NVarChar, t).query(`
        SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @t ORDER BY ORDINAL_POSITION
      `);
      console.log('\n=== ' + t + ' ===');
      res.recordset.forEach(r => console.log(' ', r.COLUMN_NAME, '(' + r.DATA_TYPE + ')'));
    } catch(e) { console.log(t + ': ERROR', e.message); }
  }
  await pool.close();
}
run().catch(console.error);
