'use strict';
// ============================================================
// scripts/reset-password.js
// Run with:  node scripts/reset-password.js
//
// Directly resets a user's password in the DB.
// Use this if seed-admin.js stored a corrupted password
// due to PowerShell special character issues (! etc.)
// ============================================================

require('dotenv').config();
const sql    = require('mssql');
const bcrypt = require('bcryptjs');

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

// ── SET THESE TWO VALUES THEN RUN THE SCRIPT ─────────────────
const TARGET_EMAIL    = 'edoardo@spitwater.com';
const NEW_PASSWORD    = 'Poi1poiolo!';        // ← change this to whatever you want
// ─────────────────────────────────────────────────────────────

async function run() {
  console.log('\n=== Password Reset ===\n');
  console.log(`Email:    ${TARGET_EMAIL}`);
  console.log(`Password: ${NEW_PASSWORD}`);
  console.log('');

  let pool;
  try {
    pool = await sql.connect(config);
    console.log('Connected to database...\n');

    // Check user exists
    const check = await pool.request()
      .input('email', sql.VarChar(200), TARGET_EMAIL.toLowerCase().trim())
      .query('SELECT id, email, full_name FROM users WHERE email = @email');

    if (!check.recordset.length) {
      console.error(`❌  No user found with email: ${TARGET_EMAIL}`);
      console.error('    Check the email is correct (case-insensitive).');
      process.exit(1);
    }

    const user = check.recordset[0];
    console.log(`Found user: "${user.full_name}" (id=${user.id})`);

    // Hash the new password
    const hash = await bcrypt.hash(NEW_PASSWORD, 10);

    // Update password and unlock account (in case it got locked from failed attempts)
    await pool.request()
      .input('id',           sql.Int,           user.id)
      .input('hash',         sql.NVarChar(500),  hash)
      .query(`
        UPDATE users
        SET password_hash       = @hash,
            failed_login_count  = 0,
            locked_until        = NULL,
            updated_at          = GETDATE()
        WHERE id = @id
      `);

    // Also revoke old refresh tokens so no stale sessions exist
    await pool.request()
      .input('user_id', sql.Int, user.id)
      .query(`
        UPDATE refresh_tokens
        SET revoked_at = GETDATE(), revoked_reason = 'password_reset'
        WHERE user_id = @user_id AND revoked_at IS NULL
      `);

    console.log(`\n✅  Password updated successfully!`);
    console.log(`✅  Failed login counter reset (account unlocked)`);
    console.log(`\nNow test login in Postman:`);
    console.log(`  POST http://localhost:3000/api/auth/login`);
    console.log(`  { "email": "${TARGET_EMAIL}", "password": "${NEW_PASSWORD}" }\n`);

  } catch (err) {
    console.error('❌  Error:', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

run();
