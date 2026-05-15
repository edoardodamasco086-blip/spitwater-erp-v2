'use strict';
// ============================================================
// scripts/migrate-business-partners.js
//
// Creates the BP module tables and migrates existing contacts.
//
// Idempotent — safe to re-run.
//
// Run from project root:
//   node server/scripts/migrate-business-partners.js
// ============================================================

require('dotenv').config();
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER,
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE,
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

async function run() {
  console.log('\n=== Business Partner Module Migration ===\n');
  console.log(`Connecting to ${process.env.DB_SERVER} / ${process.env.DB_DATABASE}`);

  let pool;
  try {
    pool = await sql.connect(config);
    const q = (s) => pool.request().query(s);

    // ── 1. business_partners ──────────────────────────────────────
    await q(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'business_partners')
      CREATE TABLE business_partners (
        id                    INT IDENTITY(1,1) PRIMARY KEY,
        org_id                INT           NOT NULL REFERENCES organisations(id),
        bp_type               VARCHAR(20)   NOT NULL CHECK (bp_type IN ('organization','person')),

        -- Organization fields
        legal_entity_name     NVARCHAR(200) NULL,
        trading_name          NVARCHAR(200) NULL,
        abn                   VARCHAR(14)   NULL,
        acn                   VARCHAR(11)   NULL,
        gst_registered        BIT           NOT NULL DEFAULT 0,
        gst_registration_date DATE          NULL,
        website               NVARCHAR(300) NULL,
        industry              NVARCHAR(100) NULL,
        linkedin_url          NVARCHAR(500) NULL,

        -- Person fields
        first_name            NVARCHAR(100) NULL,
        last_name             NVARCHAR(100) NULL,
        job_title             NVARCHAR(100) NULL,

        -- Shared
        email                 NVARCHAR(200) NULL,
        email_secondary       NVARCHAR(200) NULL,
        phone                 NVARCHAR(50)  NULL,
        mobile                NVARCHAR(50)  NULL,
        bp_role               VARCHAR(20)   NOT NULL DEFAULT 'customer'
                                CHECK (bp_role IN ('customer','supplier','both','lead','other')),

        -- Financial
        credit_limit          DECIMAL(18,2) NOT NULL DEFAULT 0,
        payment_terms         VARCHAR(20)   NOT NULL DEFAULT 'NET30',
        is_overseas           BIT           NOT NULL DEFAULT 0,

        -- Customer classification
        customer_tier_id      INT           NULL,
        customer_category_id  INT           NULL,

        -- AI enrichment
        ai_summary            NVARCHAR(MAX) NULL,
        ai_enriched_at        DATETIME      NULL,

        -- Meta
        is_active             BIT           NOT NULL DEFAULT 1,
        notes                 NVARCHAR(MAX) NULL,
        legacy_contact_id     INT           NULL REFERENCES contacts(id),

        created_at            DATETIME      NOT NULL DEFAULT GETDATE(),
        updated_at            DATETIME      NOT NULL DEFAULT GETDATE(),
        created_by            INT           NULL REFERENCES users(id)
      )
    `);
    console.log('  + business_partners');

    // ── 2. bp_relationships (person <-> org) ──────────────────────
    await q(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'bp_relationships')
      CREATE TABLE bp_relationships (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        org_id              INT           NOT NULL REFERENCES organisations(id),
        person_bp_id        INT           NOT NULL REFERENCES business_partners(id),
        org_bp_id           INT           NOT NULL REFERENCES business_partners(id),
        role_label          NVARCHAR(100) NULL,
        is_primary_contact  BIT           NOT NULL DEFAULT 0,
        created_at          DATETIME      NOT NULL DEFAULT GETDATE(),
        created_by          INT           NULL REFERENCES users(id),
        CONSTRAINT uq_bp_rel UNIQUE (org_id, person_bp_id, org_bp_id)
      )
    `);
    console.log('  + bp_relationships');

    // ── 3. bp_enrichment_proposals ────────────────────────────────
    await q(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'bp_enrichment_proposals')
      CREATE TABLE bp_enrichment_proposals (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        org_id          INT             NOT NULL REFERENCES organisations(id),
        bp_id           INT             NOT NULL REFERENCES business_partners(id),
        field_name      VARCHAR(100)    NOT NULL,
        proposed_value  NVARCHAR(MAX)   NULL,
        current_value   NVARCHAR(MAX)   NULL,
        source_url      NVARCHAR(1000)  NULL,
        source_snippet  NVARCHAR(2000)  NULL,
        confidence      DECIMAL(5,2)    NULL,
        status          VARCHAR(20)     NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','accepted','rejected','edited')),
        reviewed_by     INT             NULL REFERENCES users(id),
        reviewed_at     DATETIME        NULL,
        edited_value    NVARCHAR(MAX)   NULL,
        triggered_by    INT             NULL REFERENCES users(id),
        created_at      DATETIME        NOT NULL DEFAULT GETDATE()
      )
    `);
    console.log('  + bp_enrichment_proposals');

    // ── 4. Add bp_id column to contacts (backward compat pointer) ─
    await q(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('contacts') AND name = 'bp_id'
      )
        ALTER TABLE contacts ADD bp_id INT NULL REFERENCES business_partners(id)
    `);
    console.log('  + contacts.bp_id (column)');

    // ── 5. Indexes ─────────────────────────────────────────────────
    const indexes = [
      ['ix_bp_org_role',      'business_partners',       'org_id, bp_role, is_active'],
      ['ix_bp_org_type',      'business_partners',       'org_id, bp_type'],
      ['ix_bp_legacy',        'business_partners',       'legacy_contact_id'],
      ['ix_bpr_person',       'bp_relationships',        'org_id, person_bp_id'],
      ['ix_bpr_org',          'bp_relationships',        'org_id, org_bp_id'],
      ['ix_bpep_bp_status',   'bp_enrichment_proposals', 'bp_id, status'],
      ['ix_bpep_org_status',  'bp_enrichment_proposals', 'org_id, status'],
    ];
    for (const [name, table, cols] of indexes) {
      await q(`
        IF NOT EXISTS (
          SELECT 1 FROM sys.indexes
          WHERE name = '${name}' AND object_id = OBJECT_ID('${table}')
        )
          CREATE INDEX ${name} ON ${table} (${cols})
      `);
    }
    console.log('  + indexes');

    // ── 6. Migrate existing contacts → business_partners ──────────
    console.log('\n  Migrating contacts → business_partners ...');

    const contacts = await pool.request().query(`
      SELECT
        c.id, c.org_id, c.first_name, c.last_name, c.full_name,
        c.company_id, c.position, c.email, c.phone, c.mobile,
        c.abn, c.acn, c.gst_registered, c.is_overseas,
        c.credit_limit, c.credit_terms, c.notes, c.is_active,
        c.created_at, c.created_by, c.contact_type
      FROM contacts c
      WHERE c.is_void = 0
        AND c.id NOT IN (
          SELECT legacy_contact_id
          FROM business_partners
          WHERE legacy_contact_id IS NOT NULL
        )
    `);

    let migrated = 0;
    for (const c of contacts.recordset) {
      // Determine bp_type
      const isPerson = (c.first_name !== null && c.first_name !== '') || c.company_id !== null;
      const bpType   = isPerson ? 'person' : 'organization';

      // Map contact_type → bp_role
      const roleMap = { customer: 'customer', supplier: 'supplier', both: 'both', lead: 'lead' };
      const bpRole  = roleMap[c.contact_type] || 'customer';

      const displayName = isPerson
        ? (`${c.first_name || ''} ${c.last_name || ''}`).trim()
        : (c.full_name || '');

      const result = await pool.request()
        .input('org_id',           sql.Int,           c.org_id)
        .input('bp_type',          sql.VarChar(20),   bpType)
        .input('legal_entity_name',sql.NVarChar(200),  isPerson ? null : (c.full_name || null))
        .input('first_name',       sql.NVarChar(100),  isPerson ? (c.first_name || null) : null)
        .input('last_name',        sql.NVarChar(100),  isPerson ? (c.last_name  || null) : null)
        .input('job_title',        sql.NVarChar(100),  isPerson ? (c.position   || null) : null)
        .input('abn',              sql.VarChar(14),    c.abn      || null)
        .input('acn',              sql.VarChar(11),    c.acn      || null)
        .input('gst_registered',   sql.Bit,            c.gst_registered ? 1 : 0)
        .input('email',            sql.NVarChar(200),  c.email    || null)
        .input('phone',            sql.NVarChar(50),   c.phone    || null)
        .input('mobile',           sql.NVarChar(50),   c.mobile   || null)
        .input('bp_role',          sql.VarChar(20),    bpRole)
        .input('credit_limit',     sql.Decimal(18,2),  c.credit_limit  || 0)
        .input('payment_terms',    sql.VarChar(20),    c.credit_terms  || 'NET30')
        .input('is_overseas',      sql.Bit,            c.is_overseas   ? 1 : 0)
        .input('is_active',        sql.Bit,            c.is_active     ? 1 : 0)
        .input('notes',            sql.NVarChar(sql.MAX), c.notes   || null)
        .input('legacy_contact_id',sql.Int,            c.id)
        .input('created_at',       sql.DateTime,       c.created_at || new Date())
        .input('created_by',       sql.Int,            c.created_by || null)
        .query(`
          INSERT INTO business_partners
            (org_id, bp_type, legal_entity_name, first_name, last_name, job_title,
             abn, acn, gst_registered, email, phone, mobile, bp_role,
             credit_limit, payment_terms, is_overseas, is_active, notes,
             legacy_contact_id, created_at, updated_at, created_by)
          OUTPUT INSERTED.id
          VALUES
            (@org_id, @bp_type, @legal_entity_name, @first_name, @last_name, @job_title,
             @abn, @acn, @gst_registered, @email, @phone, @mobile, @bp_role,
             @credit_limit, @payment_terms, @is_overseas, @is_active, @notes,
             @legacy_contact_id, @created_at, GETDATE(), @created_by)
        `);

      const bpId = result.recordset[0].id;

      // Update the contacts row with the new bp_id
      await pool.request()
        .input('bp_id',      sql.Int, bpId)
        .input('contact_id', sql.Int, c.id)
        .query('UPDATE contacts SET bp_id = @bp_id WHERE id = @contact_id');

      migrated++;
    }

    console.log(`  + Migrated ${migrated} contact(s) to business_partners`);

    // ── Summary ────────────────────────────────────────────────────
    console.log('\n─────────────────────────────────────────────────');
    console.log('Completed:');
    console.log('  1. business_partners          (CREATE or already existed)');
    console.log('  2. bp_relationships           (CREATE or already existed)');
    console.log('  3. bp_enrichment_proposals    (CREATE or already existed)');
    console.log('  4. contacts.bp_id             (ALTER  or already existed)');
    console.log('  5. indexes');
    console.log(`  6. ${migrated} contacts migrated`);
    console.log('─────────────────────────────────────────────────');
    console.log('\n  Business Partner migration complete.\n');

  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

run().catch(e => { console.error(e.message); process.exit(1); });
