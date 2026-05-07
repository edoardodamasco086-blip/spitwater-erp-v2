const sql = require('mssql');
require('dotenv').config({ path: __dirname + '/../.env' });
const cfg = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true }
};
sql.connect(cfg).then(async pool => {
  const cols = async (t) => {
    const r = await pool.request().query(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${t}' ORDER BY ORDINAL_POSITION`
    );
    console.log(`${t}:`, JSON.stringify(r.recordset));
  };
  await cols('chart_of_accounts');
  await cols('fifo_cost_layers');
  await cols('fifo_consumption_log');
  await cols('stock_levels');
  await cols('stock_movements');
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
