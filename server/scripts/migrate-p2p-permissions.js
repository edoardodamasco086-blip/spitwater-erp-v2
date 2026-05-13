'use strict';
// ============================================================
// scripts/migrate-p2p-permissions.js
// Run ONCE: node scripts/migrate-p2p-permissions.js
//
// Adds purchase_requisitions and rfqs to team_permissions for
// all existing teams across all orgs. Idempotent — safe to re-run.
//
//   Admin team        → full access  (1,1,1,1)
//   Viewer/others     → read only    (1,0,0,0)
//   Warehouse team    → read+write   (1,1,1,0)
// ============================================================

require('dotenv').config();
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER   || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE || 'Development_04052026',
  options: {
    encrypt:                process.env.DB_ENCRYPT    === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
    enableArithAbort:       true,
  },
};
if (process.env.DB_WINDOWS_AUTH === 'true') {
  config.options.trustedConnection = true;
} else {
  config.user     = process.env.DB_USER;
  config.password = process.env.DB_PASSWORD;
}

const NEW_RESOURCES = ['purchase_requisitions', 'rfqs'];

function permsFor(teamName) {
  switch (teamName) {
    case 'Admin':     return { can_read: 1, can_write: 1, can_update: 1, can_delete: 1 };
    case 'Warehouse': return { can_read: 1, can_write: 1, can_update: 1, can_delete: 0 };
    default:          return { can_read: 1, can_write: 0, can_update: 0, can_delete: 0 };
  }
}

async function run() {
  console.log('\n=== Spitwater ERP — P2P Permissions Migration ===\n');
  let pool;
  try {
    pool = await sql.connect(config);
    console.log('✅  Connected\n');

    const teamsRes = await pool.request().query(`
      SELECT t.id, t.org_id, t.name
      FROM teams t
      ORDER BY t.org_id, t.id
    `);

    if (!teamsRes.recordset.length) {
      console.warn('⚠️  No teams found. Run migrate-permissions.js first.');
      return;
    }

    console.log(`Found ${teamsRes.recordset.length} team(s). Seeding resources: ${NEW_RESOURCES.join(', ')}\n`);

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
              UPDATE team_permissions
              SET can_read=@can_read, can_write=@can_write,
                  can_update=@can_update, can_delete=@can_delete, updated_at=GETDATE()
              WHERE org_id=@org_id AND team_id=@team_id AND resource=@resource
            ELSE
              INSERT INTO team_permissions (org_id, team_id, resource, can_read, can_write, can_update, can_delete, updated_at)
              VALUES (@org_id, @team_id, @resource, @can_read, @can_write, @can_update, @can_delete, GETDATE())
          `);
        const p = perms;
        console.log(`  ✅  ${team.name.padEnd(12)} / ${resource.padEnd(25)} → R:${p.can_read} W:${p.can_write} U:${p.can_update} D:${p.can_delete}`);
      }
    }

    console.log('\n=================================================');
    console.log('  ✅  P2P permissions migration complete!');
    console.log('=================================================\n');

  } catch (err) {
    console.error('\n❌  Migration failed:', err.message);
    if (err.number) console.error('SQL Error:', err.number);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

run();
