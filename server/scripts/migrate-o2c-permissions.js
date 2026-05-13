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

// Resources with per-team permission profiles
const RESOURCE_PROFILES = [
  {
    resource: 'customer_quotes',
    perms: { Admin: { r:1,w:1,u:1,d:1 }, Sales: { r:1,w:1,u:1,d:0 }, Viewer: { r:1,w:0,u:0,d:0 } },
  },
  {
    resource: 'sales_orders',
    perms: { Admin: { r:1,w:1,u:1,d:1 }, Sales: { r:1,w:1,u:1,d:0 }, Viewer: { r:1,w:0,u:0,d:0 } },
  },
  {
    // Pricing Conditions — admin/manager only
    resource: 'price_lists',
    perms: { Admin: { r:1,w:1,u:1,d:1 }, Sales: { r:1,w:0,u:0,d:0 }, Viewer: { r:1,w:0,u:0,d:0 } },
  },
];

function permsFor(teamName, profile) {
  const p = profile.perms[teamName] || { r:1,w:0,u:0,d:0 };
  return { can_read: p.r, can_write: p.w, can_update: p.u, can_delete: p.d };
}

async function run() {
  console.log('\n=== O2C Permissions Migration ===\n');
  let pool;
  try {
    pool = await sql.connect(config);
    const teamsRes = await pool.request().query('SELECT id, org_id, name FROM teams ORDER BY org_id, id');
    for (const team of teamsRes.recordset) {
      for (const profile of RESOURCE_PROFILES) {
        const perms = permsFor(team.name, profile);
        await pool.request()
          .input('org_id',     sql.Int,         team.org_id)
          .input('team_id',    sql.Int,         team.id)
          .input('resource',   sql.VarChar(50), profile.resource)
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
        console.log(`  ✅  ${team.name.padEnd(12)} / ${profile.resource.padEnd(20)} R:${perms.can_read} W:${perms.can_write} U:${perms.can_update} D:${perms.can_delete}`);
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
