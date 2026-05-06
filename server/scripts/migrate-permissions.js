'use strict';
// ============================================================
// scripts/migrate-permissions.js
// Run ONCE: node scripts/migrate-permissions.js
//
// Adds to SQL Server (idempotent):
//   - user_teams table     (replaces JSON members in teams)
//   - team_permissions table
//   - teams table          (proper table replacing JSON blob)
//   - Seeds "Admin" team with full permissions
//   - Seeds "Viewer" team with read-only permissions
//   - Migrates existing team JSON data if present
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

const RESOURCES = [
  'contacts','products','quotes','invoices','credit_notes',
  'purchase_orders','goods_receipts','service_jobs','warranties',
  'inventory','warehouses','reports','bas','journals',
  'settings','users','teams','audit_log',
];

// Resources that don't have write/update/delete (read-only by nature)
const READ_ONLY_RESOURCES = new Set(['reports','audit_log']);

async function run() {
  console.log('\n=== Spitwater ERP — Permissions Migration ===\n');
  let pool;
  try {
    pool = await sql.connect(config);
    console.log('✅  Connected\n');

    // ── 1. Create teams table ──────────────────────────────────
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'teams')
      BEGIN
        CREATE TABLE teams (
          id          INT IDENTITY(1,1) NOT NULL,
          org_id      INT               NOT NULL,
          name        NVARCHAR(100)     NOT NULL,
          description NVARCHAR(500)     NULL,
          color       VARCHAR(7)        NOT NULL DEFAULT '#2F7FE8',
          is_system   BIT               NOT NULL DEFAULT 0,
          is_active   BIT               NOT NULL DEFAULT 1,
          created_at  DATETIME          NOT NULL DEFAULT GETDATE(),
          created_by  INT               NULL,
          CONSTRAINT pk_teams    PRIMARY KEY (id),
          CONSTRAINT uq_team_name UNIQUE (org_id, name),
          CONSTRAINT fk_teams_org FOREIGN KEY (org_id) REFERENCES organisations(id)
        )
        PRINT 'Created: teams'
      END
      ELSE PRINT 'Exists:  teams'
    `);

    // ── 2. Create user_teams table ─────────────────────────────
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'user_teams')
      BEGIN
        CREATE TABLE user_teams (
          id         INT IDENTITY(1,1) NOT NULL,
          org_id     INT               NOT NULL,
          user_id    INT               NOT NULL,
          team_id    INT               NOT NULL,
          joined_at  DATETIME          NOT NULL DEFAULT GETDATE(),
          added_by   INT               NULL,
          CONSTRAINT pk_user_teams    PRIMARY KEY (id),
          CONSTRAINT uq_user_team     UNIQUE (org_id, user_id, team_id),
          CONSTRAINT fk_ut_org        FOREIGN KEY (org_id)   REFERENCES organisations(id),
          CONSTRAINT fk_ut_user       FOREIGN KEY (user_id)  REFERENCES users(id),
          CONSTRAINT fk_ut_team       FOREIGN KEY (team_id)  REFERENCES teams(id)
        )
        PRINT 'Created: user_teams'
      END
      ELSE PRINT 'Exists:  user_teams'
    `);

    // ── 3. Create team_permissions table ───────────────────────
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'team_permissions')
      BEGIN
        CREATE TABLE team_permissions (
          id         INT IDENTITY(1,1) NOT NULL,
          org_id     INT               NOT NULL,
          team_id    INT               NOT NULL,
          resource   VARCHAR(50)       NOT NULL,
          can_read   BIT               NOT NULL DEFAULT 0,
          can_write  BIT               NOT NULL DEFAULT 0,
          can_update BIT               NOT NULL DEFAULT 0,
          can_delete BIT               NOT NULL DEFAULT 0,
          updated_at DATETIME          NOT NULL DEFAULT GETDATE(),
          updated_by INT               NULL,
          CONSTRAINT pk_team_permissions  PRIMARY KEY (id),
          CONSTRAINT uq_team_resource     UNIQUE (org_id, team_id, resource),
          CONSTRAINT fk_tp_org            FOREIGN KEY (org_id)  REFERENCES organisations(id),
          CONSTRAINT fk_tp_team           FOREIGN KEY (team_id) REFERENCES teams(id)
        )
        PRINT 'Created: team_permissions'
      END
      ELSE PRINT 'Exists:  team_permissions'
    `);

    // ── 4. Add indexes ──────────────────────────────────────────
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_user_teams_user' AND object_id = OBJECT_ID('user_teams'))
        CREATE INDEX ix_user_teams_user ON user_teams (org_id, user_id);
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_team_perms_team' AND object_id = OBJECT_ID('team_permissions'))
        CREATE INDEX ix_team_perms_team ON team_permissions (org_id, team_id);
    `);

    console.log('✅  Tables ready\n');

    // ── 5. Get org_id = 1 ──────────────────────────────────────
    const orgRes = await pool.request().query('SELECT TOP 1 id FROM organisations ORDER BY id');
    if (!orgRes.recordset.length) {
      console.error('❌  No organisation found. Run seed-admin.js first.');
      process.exit(1);
    }
    const orgId = orgRes.recordset[0].id;

    // ── 6. Seed system teams ────────────────────────────────────
    const systemTeams = [
      { name: 'Admin',    description: 'Full access to all modules',   color: '#2F7FE8', is_system: true  },
      { name: 'Viewer',   description: 'Read-only access to all data', color: '#7B93B0', is_system: true  },
      { name: 'Sales',    description: 'Quotes, orders, invoices',     color: '#2ECC8A', is_system: false },
      { name: 'Service',  description: 'Service jobs and warranties',  color: '#E89B2F', is_system: false },
      { name: 'Warehouse',description: 'Inventory and WMS operations', color: '#9366E8', is_system: false },
    ];

    const teamIds = {};
    for (const t of systemTeams) {
      const existing = await pool.request()
        .input('org_id', sql.Int,          orgId)
        .input('name',   sql.NVarChar(100), t.name)
        .query('SELECT id FROM teams WHERE org_id = @org_id AND name = @name');

      let teamId;
      if (existing.recordset.length) {
        teamId = existing.recordset[0].id;
        console.log(`ℹ️   Team exists: "${t.name}" (id=${teamId})`);
      } else {
        const res = await pool.request()
          .input('org_id',      sql.Int,          orgId)
          .input('name',        sql.NVarChar(100), t.name)
          .input('description', sql.NVarChar(500), t.description)
          .input('color',       sql.VarChar(7),    t.color)
          .input('is_system',   sql.Bit,           t.is_system ? 1 : 0)
          .query(`
            INSERT INTO teams (org_id, name, description, color, is_system, is_active, created_at)
            OUTPUT INSERTED.id
            VALUES (@org_id, @name, @description, @color, @is_system, 1, GETDATE())
          `);
        teamId = res.recordset[0].id;
        console.log(`✅  Created team: "${t.name}" (id=${teamId})`);
      }
      teamIds[t.name] = teamId;
    }

    // ── 7. Seed permissions ─────────────────────────────────────
    const permissionSets = {
      'Admin': (resource) => ({
        can_read:   1, can_write:  1,
        can_update: 1, can_delete: 1,
      }),
      'Viewer': (resource) => ({
        can_read:   1, can_write:  0,
        can_update: 0, can_delete: 0,
      }),
      'Sales': (resource) => ({
        can_read:   ['contacts','products','quotes','invoices','credit_notes','reports'].includes(resource) ? 1 : 0,
        can_write:  ['contacts','quotes','invoices','credit_notes'].includes(resource) ? 1 : 0,
        can_update: ['contacts','quotes','invoices'].includes(resource) ? 1 : 0,
        can_delete: ['quotes'].includes(resource) ? 1 : 0,
      }),
      'Service': (resource) => ({
        can_read:   ['contacts','products','service_jobs','warranties','inventory','reports'].includes(resource) ? 1 : 0,
        can_write:  ['service_jobs','warranties'].includes(resource) ? 1 : 0,
        can_update: ['service_jobs','warranties','contacts'].includes(resource) ? 1 : 0,
        can_delete: ['service_jobs'].includes(resource) ? 1 : 0,
      }),
      'Warehouse': (resource) => ({
        can_read:   ['products','inventory','warehouses','purchase_orders','goods_receipts','reports'].includes(resource) ? 1 : 0,
        can_write:  ['goods_receipts','inventory'].includes(resource) ? 1 : 0,
        can_update: ['inventory','goods_receipts'].includes(resource) ? 1 : 0,
        can_delete: 0,
      }),
    };

    console.log('\nSeeding permissions...');
    for (const [teamName, permFn] of Object.entries(permissionSets)) {
      const teamId = teamIds[teamName];
      if (!teamId) continue;

      for (const resource of RESOURCES) {
        const perms = permFn(resource);
        // Read-only resources force write/update/delete off
        if (READ_ONLY_RESOURCES.has(resource)) {
          perms.can_write = 0; perms.can_update = 0; perms.can_delete = 0;
        }

        await pool.request()
          .input('org_id',     sql.Int,         orgId)
          .input('team_id',    sql.Int,         teamId)
          .input('resource',   sql.VarChar(50), resource)
          .input('can_read',   sql.Bit,         perms.can_read   ? 1 : 0)
          .input('can_write',  sql.Bit,         perms.can_write  ? 1 : 0)
          .input('can_update', sql.Bit,         perms.can_update ? 1 : 0)
          .input('can_delete', sql.Bit,         perms.can_delete ? 1 : 0)
          .query(`
            IF EXISTS (SELECT 1 FROM team_permissions WHERE org_id=@org_id AND team_id=@team_id AND resource=@resource)
              UPDATE team_permissions SET
                can_read=@can_read, can_write=@can_write,
                can_update=@can_update, can_delete=@can_delete,
                updated_at=GETDATE()
              WHERE org_id=@org_id AND team_id=@team_id AND resource=@resource
            ELSE
              INSERT INTO team_permissions (org_id,team_id,resource,can_read,can_write,can_update,can_delete,updated_at)
              VALUES (@org_id,@team_id,@resource,@can_read,@can_write,@can_update,@can_delete,GETDATE())
          `);
      }
      console.log(`  ✅  ${teamName} (${RESOURCES.length} resources)`);
    }

    // ── 8. Add super_admin to Admin team ───────────────────────
    const adminTeamId = teamIds['Admin'];
    const superAdmins = await pool.request()
      .input('org_id', sql.Int, orgId)
      .query(`SELECT user_id FROM org_members WHERE org_id=@org_id AND role='super_admin'`);

    for (const { user_id } of superAdmins.recordset) {
      await pool.request()
        .input('org_id',   sql.Int, orgId)
        .input('user_id',  sql.Int, user_id)
        .input('team_id',  sql.Int, adminTeamId)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM user_teams WHERE org_id=@org_id AND user_id=@user_id AND team_id=@team_id)
            INSERT INTO user_teams (org_id,user_id,team_id,joined_at)
            VALUES (@org_id,@user_id,@team_id,GETDATE())
        `);
      console.log(`\n✅  Super admin added to Admin team`);
    }

    // ── 9. Migrate JSON teams data if it exists ────────────────
    try {
      const jsonData = await pool.request()
        .input('org_id', sql.Int, orgId)
        .query(`SELECT teams_json FROM org_settings WHERE org_id=@org_id AND teams_json IS NOT NULL`);

      if (jsonData.recordset.length && jsonData.recordset[0].teams_json) {
        const oldTeams = JSON.parse(jsonData.recordset[0].teams_json);
        if (oldTeams.length > 0) {
          console.log(`\nMigrating ${oldTeams.length} teams from JSON...`);
          for (const oldTeam of oldTeams) {
            // Create in teams table if not exists
            const ex = await pool.request()
              .input('org_id', sql.Int, orgId)
              .input('name',   sql.NVarChar(100), oldTeam.name)
              .query('SELECT id FROM teams WHERE org_id=@org_id AND name=@name');

            let tid;
            if (ex.recordset.length) {
              tid = ex.recordset[0].id;
            } else {
              const r = await pool.request()
                .input('org_id',      sql.Int,          orgId)
                .input('name',        sql.NVarChar(100), oldTeam.name)
                .input('description', sql.NVarChar(500), oldTeam.description || '')
                .input('color',       sql.VarChar(7),    oldTeam.color || '#2F7FE8')
                .query(`INSERT INTO teams (org_id,name,description,color,is_system,is_active,created_at) OUTPUT INSERTED.id VALUES (@org_id,@name,@description,@color,0,1,GETDATE())`);
              tid = r.recordset[0].id;
              // Seed viewer-level permissions for migrated teams
              for (const resource of RESOURCES) {
                await pool.request()
                  .input('org_id',  sql.Int,         orgId)
                  .input('team_id', sql.Int,         tid)
                  .input('resource',sql.VarChar(50), resource)
                  .query(`IF NOT EXISTS (SELECT 1 FROM team_permissions WHERE org_id=@org_id AND team_id=@team_id AND resource=@resource) INSERT INTO team_permissions (org_id,team_id,resource,can_read,can_write,can_update,can_delete,updated_at) VALUES (@org_id,@team_id,@resource,1,0,0,0,GETDATE())`);
              }
            }
            // Migrate members
            for (const uid of (oldTeam.members || [])) {
              await pool.request()
                .input('org_id',  sql.Int, orgId)
                .input('user_id', sql.Int, uid)
                .input('team_id', sql.Int, tid)
                .query(`IF NOT EXISTS (SELECT 1 FROM user_teams WHERE org_id=@org_id AND user_id=@user_id AND team_id=@team_id) INSERT INTO user_teams (org_id,user_id,team_id,joined_at) VALUES (@org_id,@user_id,@team_id,GETDATE())`);
            }
            console.log(`  ✅  Migrated: "${oldTeam.name}"`);
          }
          // Clear JSON after migration
          await pool.request().input('org_id', sql.Int, orgId)
            .query(`UPDATE org_settings SET teams_json=NULL WHERE org_id=@org_id`);
          console.log('  ✅  JSON data cleared');
        }
      }
    } catch { /* teams_json column may not exist — that's fine */ }

    console.log('\n=================================================');
    console.log('  ✅  Migration complete!');
    console.log('      Tables: teams, user_teams, team_permissions');
    console.log(`      System teams seeded: Admin, Viewer, Sales, Service, Warehouse`);
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
