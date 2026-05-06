'use strict';
// ============================================================
// scripts/seed-admin.js
// Run with:  node scripts/seed-admin.js
//
// Creates:
//   - The first organisation (Spitwater Australia)
//   - The first super_admin user
// Safe to run multiple times — checks before inserting.
// ============================================================

require('dotenv').config();
const sql      = require('mssql');
const bcrypt   = require('bcryptjs');
const readline = require('readline');

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

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function run() {
  console.log('\n=== Spitwater ERP — First-Run Admin Setup ===\n');

  // Collect inputs
  const adminEmail    = await ask('Admin email address:    ');
  const adminName     = await ask('Admin full name:        ');
  const adminPassword = await ask('Admin password (min 8): ');
  const orgName       = await ask('Organisation name       [Spitwater Australia]: ') || 'Spitwater Australia';
  const orgAbn        = await ask('ABN                     [leave blank to skip]: ') || null;

  rl.close();

  if (!adminEmail || !adminName || adminPassword.length < 8) {
    console.error('\n❌  Email, name and password (8+ chars) are required.');
    process.exit(1);
  }

  console.log('\nConnecting to database...');
  let pool;
  try {
    pool = await sql.connect(config);
    console.log('✅  Connected\n');

    // ── Check if org already exists ──
    const existingOrg = await pool.request()
      .query("SELECT id FROM organisations WHERE org_key = 'spitwater'");

    let orgId;

    if (existingOrg.recordset.length) {
      orgId = existingOrg.recordset[0].id;
      console.log(`ℹ️  Organisation already exists (id=${orgId}) — skipping org creation.`);
    } else {
      // ── Create organisation ──
      const orgResult = await pool.request()
        .input('org_key',  sql.VarChar(50),  'spitwater')
        .input('name',     sql.NVarChar(200), orgName)
        .input('abn',      sql.VarChar(14),   orgAbn)
        .query(`
          INSERT INTO organisations (org_key, name, abn, country_code, timezone, base_currency_code, created_at, updated_at)
          OUTPUT INSERTED.id
          VALUES (@org_key, @name, @abn, 'AU', 'Australia/Sydney', 'AUD', GETDATE(), GETDATE())
        `);
      orgId = orgResult.recordset[0].id;
      console.log(`✅  Organisation created: "${orgName}" (id=${orgId})`);

      // Create org_settings row
      await pool.request()
        .input('org_id', sql.Int, orgId)
        .query(`
          INSERT INTO org_settings (org_id, created_at, updated_at)
          VALUES (@org_id, GETDATE(), GETDATE())
        `);
      console.log('✅  Org settings initialised');
    }

    // ── Check if admin user already exists ──
    const existingUser = await pool.request()
      .input('email', sql.VarChar(200), adminEmail.trim().toLowerCase())
      .query('SELECT id FROM users WHERE email = @email');

    let userId;

    if (existingUser.recordset.length) {
      userId = existingUser.recordset[0].id;
      console.log(`ℹ️  User [${adminEmail}] already exists (id=${userId}) — updating password.`);
      const hash = await bcrypt.hash(adminPassword, parseInt(process.env.BCRYPT_ROUNDS) || 10);
      await pool.request()
        .input('id',   sql.Int,           userId)
        .input('hash', sql.NVarChar(500), hash)
        .query('UPDATE users SET password_hash = @hash, is_active = 1, updated_at = GETDATE() WHERE id = @id');
    } else {
      // ── Create user ──
      const hash = await bcrypt.hash(adminPassword, parseInt(process.env.BCRYPT_ROUNDS) || 10);
      const userResult = await pool.request()
        .input('email',     sql.VarChar(200),  adminEmail.trim().toLowerCase())
        .input('hash',      sql.NVarChar(500), hash)
        .input('full_name', sql.NVarChar(200), adminName.trim())
        .query(`
          INSERT INTO users (email, password_hash, full_name, is_active, email_verified, created_at, updated_at)
          OUTPUT INSERTED.id
          VALUES (@email, @hash, @full_name, 1, 1, GETDATE(), GETDATE())
        `);
      userId = userResult.recordset[0].id;
      console.log(`✅  User created: "${adminName}" <${adminEmail}> (id=${userId})`);
    }

    // ── Create org_member link (super_admin) ──
    const existingMember = await pool.request()
      .input('org_id',  sql.Int, orgId)
      .input('user_id', sql.Int, userId)
      .query('SELECT id FROM org_members WHERE org_id = @org_id AND user_id = @user_id');

    if (existingMember.recordset.length) {
      await pool.request()
        .input('org_id',  sql.Int,         orgId)
        .input('user_id', sql.Int,         userId)
        .query("UPDATE org_members SET role = 'super_admin', is_active = 1 WHERE org_id = @org_id AND user_id = @user_id");
      console.log(`ℹ️  Org membership updated to super_admin`);
    } else {
      await pool.request()
        .input('org_id',  sql.Int,         orgId)
        .input('user_id', sql.Int,         userId)
        .query(`
          INSERT INTO org_members (org_id, user_id, role, is_active, joined_at)
          VALUES (@org_id, @user_id, 'super_admin', 1, GETDATE())
        `);
      console.log(`✅  User added to org as super_admin`);
    }

    console.log('\n=================================================');
    console.log('  ✅  Setup complete! You can now log in:');
    console.log(`     Email:    ${adminEmail}`);
    console.log(`     Password: (what you just entered)`);
    console.log(`     Role:     super_admin`);
    console.log('\n  Start the server:   npm run dev');
    console.log('  Test login:         POST http://localhost:3000/api/auth/login');
    console.log('=================================================\n');

  } catch (err) {
    console.error('\n❌  Error:', err.message);
    if (err.number) console.error('SQL Error number:', err.number);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

run();
