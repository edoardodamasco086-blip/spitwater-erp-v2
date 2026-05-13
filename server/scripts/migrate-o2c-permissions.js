'use strict';
// node scripts/migrate-o2c-permissions.js
require('dotenv').config();
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER   || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
    enableArithAbort: true,
  },
};
if (process.env.DB_WINDOWS_AUTH === 'true') config.options.trustedConnection = true;
else { config.user = process.env.DB_USER; config.password = process.env.DB_PASSWORD; }

const NEW_RESOURCES = ['customer_quotes', 'sales_orders'];

function permsFor(teamName) {
  switch (teamName) {
    case 'Admin':    return { can_read: 1, can_write: 1, can_update: 1, can_delete: 1 };
    case 'Sales':    return { can_read: 1, can_write: 1, can_update: 1, can_delete: 0 };
    case 'Viewer':   return { can_read: 1, can_write: 0, can_update: 0, can_delete: 0 };
    default:         return { can_read: 1, can_write: 0, can_update: 0, can_delete: 0 };
  }
}

async function run() {
  console.log('\n=== O2C Permissions Migration ===\n');
  let pool;
  try {
    pool = await sql.connect(config);
    const teamsRes = await pool.request().query('SELECT id, org_id, name FROM teams ORDER BY org_id, id');
    for (const team of teamsRes.recordset) {
      const perms = permsFor(team.name);
      for (const resource of NEW_RESOURCES) {
        await pool.request()
          .input('org_id',     sql.Int,         team.org_id)
          .input('team_id',    sql.Int,         team.id)
          .input('resource',   sql.VarChar(50), resource)
          .input('can_read',   sql.Bit,         perms.can_read)
          .input('can_write',  sql.Bit,         perms.can_write)
          .input('can_update', sql.Bit,         perms.can_update)
          .input('can_delete', sql.Bit,         perms.can_delete)
          .query(`
            IF EXISTS (SELECT 1 FROM team_permissions WHERE org_id=@org_id AND team_id=@team_id AND resource=@resource)
              UPDATE team_permissions SET can_read=@can_read, can_write=@can_write, can_update=@can_update, can_delete=@can_delete, updated_at=GETDATE()
              WHERE org_id=@org_id AND team_id=@team_id AND resource=@resource
            ELSE
              INSERT INTO team_permissions (org_id,team_id,resource,can_read,can_write,can_update,can_delete,updated_at)
              VALUES (@org_id,@team_id,@resource,@can_read,@can_write,@can_update,@can_delete,GETDATE())
          `);
        const p = perms;
        console.log(`  ✅  ${team.name.padEnd(12)} / ${resource.padEnd(20)} R:${p.can_read} W:${p.can_write} U:${p.can_update} D:${p.can_delete}`);
      }
    }
    console.log('\n✅  O2C permissions seeded.\n');
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}
run();
