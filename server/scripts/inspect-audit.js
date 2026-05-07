const sql = require('mssql');
require('dotenv').config({ path: __dirname + '/../.env' });
const cfg = {
  server: process.env.DB_SERVER, database: process.env.DB_DATABASE,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true }
};
sql.connect(cfg).then(async pool => {
  // Check distinct entity_keys and permission_types in role_permissions
  const rp = await pool.request().query(
    'SELECT DISTINCT entity_key, permission_type FROM role_permissions ORDER BY entity_key, permission_type'
  );
  console.log('\nPermission entity_key/types:', JSON.stringify(rp.recordset));

  // check products columns relevant to UOM
  const pr = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='products'
    ORDER BY ORDINAL_POSITION
  `);
  console.log('\nProducts columns:', JSON.stringify(pr.recordset.map(r => r.COLUMN_NAME)));

  // sample audit_log to see format
  const al = await pool.request().query('SELECT TOP 3 * FROM audit_log ORDER BY id DESC');
  console.log('\nSample audit_log:', JSON.stringify(al.recordset));

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
