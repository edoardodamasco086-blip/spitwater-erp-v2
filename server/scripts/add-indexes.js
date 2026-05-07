'use strict';
// Run: node scripts/add-indexes.js
// Adds missing indexes identified in the May 2026 performance audit.
// All statements are idempotent — safe to run multiple times.

require('dotenv').config();
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER,
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE,
  options:  {
    encrypt:               process.env.DB_ENCRYPT    === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
    enableArithAbort:      true,
  },
};
if (process.env.DB_WINDOWS_AUTH === 'true') config.options.trustedConnection = true;
else { config.user = process.env.DB_USER; config.password = process.env.DB_PASSWORD; }

// Helper: create index if it doesn't already exist
async function createIndex(pool, label, sql_stmt, check_name, check_table) {
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.indexes
      WHERE object_id = OBJECT_ID('${check_table}') AND name = '${check_name}'
    )
    BEGIN
      ${sql_stmt}
      PRINT 'Created: ${label}';
    END
    ELSE PRINT 'Exists:  ${label}';
  `);
}

async function run() {
  console.log('\n=== Add Missing Indexes Migration ===\n');
  let pool;
  try {
    pool = await sql.connect(config);

    // ── products ─────────────────────────────────────────────────
    // List query: WHERE org_id = ? AND is_void = 0 [AND is_active = ?] [AND category_id = ?]
    await createIndex(pool,
      'ix_products_org_void',
      `CREATE INDEX ix_products_org_void
         ON products (org_id, is_void, is_active)
         INCLUDE (id, name, product_code, product_type, category_id, barcode, created_at);`,
      'ix_products_org_void', 'products');

    // Category filter: WHERE category_id = ? (also used in JOIN for category counts)
    await createIndex(pool,
      'ix_products_category',
      `CREATE INDEX ix_products_category ON products (category_id) WHERE is_void = 0;`,
      'ix_products_category', 'products');

    // ── contacts ─────────────────────────────────────────────────
    // List query: WHERE org_id = ? AND is_void = 0 [AND contact_type = ?]
    await createIndex(pool,
      'ix_contacts_org_void_type',
      `CREATE INDEX ix_contacts_org_void_type
         ON contacts (org_id, is_void, contact_type)
         INCLUDE (id, full_name, email, phone, contact_number, is_active, created_at);`,
      'ix_contacts_org_void_type', 'contacts');

    // Email lookup/duplicate check
    await createIndex(pool,
      'ix_contacts_email_org',
      `CREATE INDEX ix_contacts_email_org ON contacts (email, org_id);`,
      'ix_contacts_email_org', 'contacts');

    // ── stock_levels ─────────────────────────────────────────────
    // Every product detail page: WHERE product_id = ? AND org_id = ?
    await createIndex(pool,
      'ix_stock_product_org',
      `CREATE INDEX ix_stock_product_org ON stock_levels (product_id, org_id);`,
      'ix_stock_product_org', 'stock_levels');

    // ── custom_field_values ───────────────────────────────────────
    // GET /products/:id/custom-values: WHERE org_id=? AND entity_key=? AND entity_id=?
    await createIndex(pool,
      'ix_cfv_lookup',
      `CREATE INDEX ix_cfv_lookup
         ON custom_field_values (org_id, entity_key, entity_id)
         INCLUDE (field_definition_id, value_text, value_number, value_date, value_boolean);`,
      'ix_cfv_lookup', 'custom_field_values');

    // ── custom_field_definitions ──────────────────────────────────
    // WHERE org_id=? AND entity_key=? AND is_active=1
    await createIndex(pool,
      'ix_cfd_org_entity',
      `CREATE INDEX ix_cfd_org_entity
         ON custom_field_definitions (org_id, entity_key, is_active)
         INCLUDE (id, field_key, field_label, field_type, scope_key);`,
      'ix_cfd_org_entity', 'custom_field_definitions');

    // ── price_list_items ──────────────────────────────────────────
    // GET /products/:id/pricing: WHERE product_id = ? (joined to price_lists)
    await createIndex(pool,
      'ix_pli_product',
      `CREATE INDEX ix_pli_product
         ON price_list_items (product_id)
         INCLUDE (price_list_id, unit_price, min_qty, discount_pct);`,
      'ix_pli_product', 'price_list_items');

    // ── product_competitor_data ───────────────────────────────────
    // Market data: WHERE org_id = ? AND product_id = ?
    await createIndex(pool,
      'ix_pcd_product',
      `CREATE INDEX ix_pcd_product ON product_competitor_data (org_id, product_id);`,
      'ix_pcd_product', 'product_competitor_data');

    // ── refresh_tokens ────────────────────────────────────────────
    // Revoke on logout/password-change: WHERE user_id = ? AND revoked_at IS NULL
    await createIndex(pool,
      'ix_rt_user',
      `CREATE INDEX ix_rt_user ON refresh_tokens (user_id) INCLUDE (revoked_at, expires_at);`,
      'ix_rt_user', 'refresh_tokens');

    // ── audit_log ─────────────────────────────────────────────────
    // WHERE org_id = ? ORDER BY occurred_at DESC  (settings page audit viewer)
    await createIndex(pool,
      'ix_audit_org_time',
      `CREATE INDEX ix_audit_org_time ON audit_log (org_id, occurred_at DESC);`,
      'ix_audit_org_time', 'audit_log');

    // ── invites ───────────────────────────────────────────────────
    // Accept invite lookup: WHERE token = ?
    await createIndex(pool,
      'ix_invites_token',
      `CREATE INDEX ix_invites_token ON invites (token) WHERE used_at IS NULL;`,
      'ix_invites_token', 'invites');

    console.log('\n✅  All indexes created (or already existed).\n');

  } catch (err) {
    console.error('❌  Migration failed:', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

run();
