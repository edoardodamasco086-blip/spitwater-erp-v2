'use strict';
require('dotenv').config();
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER   || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt:                process.env.DB_ENCRYPT    === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
    enableArithAbort:       true,
  },
};

const migrations = [

  // ── journal_entries: add missing columns ─────────────────────

  {
    label: 'journal_entries: add entry_date',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_entries' AND COLUMN_NAME='entry_date')
        ALTER TABLE journal_entries ADD entry_date DATE NOT NULL DEFAULT CAST(GETDATE() AS DATE)
    `,
  },
  {
    label: 'journal_entries: add voided_by',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_entries' AND COLUMN_NAME='voided_by')
        ALTER TABLE journal_entries ADD voided_by INT NULL
    `,
  },
  {
    label: 'journal_entries: add voided_at',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_entries' AND COLUMN_NAME='voided_at')
        ALTER TABLE journal_entries ADD voided_at DATETIME NULL
    `,
  },
  {
    label: 'journal_entries: add void_reason',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_entries' AND COLUMN_NAME='void_reason')
        ALTER TABLE journal_entries ADD void_reason NVARCHAR(500) NULL
    `,
  },
  {
    label: 'journal_entries: add updated_at',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='journal_entries' AND COLUMN_NAME='updated_at')
        ALTER TABLE journal_entries ADD updated_at DATETIME NOT NULL DEFAULT GETDATE()
    `,
  },
  {
    label: 'journal_entries: make period_id nullable',
    sql: `
      IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME='journal_entries' AND COLUMN_NAME='period_id' AND IS_NULLABLE='NO'
      )
      BEGIN
        -- Drop any default constraint first
        DECLARE @cname NVARCHAR(200);
        SELECT @cname = dc.name
          FROM sys.default_constraints dc
          JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
         WHERE c.object_id = OBJECT_ID('journal_entries') AND c.name = 'period_id';
        IF @cname IS NOT NULL
          EXEC('ALTER TABLE journal_entries DROP CONSTRAINT [' + @cname + ']');
        ALTER TABLE journal_entries ALTER COLUMN period_id INT NULL;
      END
    `,
  },
  {
    label: 'journal_entries: make description nullable',
    sql: `
      IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME='journal_entries' AND COLUMN_NAME='description' AND IS_NULLABLE='NO'
      )
      BEGIN
        DECLARE @cname NVARCHAR(200);
        SELECT @cname = dc.name
          FROM sys.default_constraints dc
          JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
         WHERE c.object_id = OBJECT_ID('journal_entries') AND c.name = 'description';
        IF @cname IS NOT NULL
          EXEC('ALTER TABLE journal_entries DROP CONSTRAINT [' + @cname + ']');
        ALTER TABLE journal_entries ALTER COLUMN description NVARCHAR(500) NULL;
      END
    `,
  },

  // ── journal_entry_lines: create ───────────────────────────────

  {
    label: 'journal_entry_lines: create table',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='journal_entry_lines')
      CREATE TABLE journal_entry_lines (
        id          BIGINT IDENTITY(1,1) PRIMARY KEY,
        entry_id    INT           NOT NULL,
        org_id      INT           NOT NULL,
        account_id  INT           NOT NULL,
        debit       DECIMAL(18,4) NOT NULL DEFAULT 0,
        credit      DECIMAL(18,4) NOT NULL DEFAULT 0,
        description NVARCHAR(500) NULL,
        line_order  INT           NOT NULL DEFAULT 0,
        contact_id  INT           NULL,
        product_id  INT           NULL,
        created_at  DATETIME      NOT NULL DEFAULT GETDATE(),

        CONSTRAINT fk_jel_entry   FOREIGN KEY (entry_id)   REFERENCES journal_entries(id),
        CONSTRAINT fk_jel_account FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
      )
    `,
  },

  // ── Indexes ───────────────────────────────────────────────────

  {
    label: 'index: ix_je_org_status on journal_entries(org_id, status)',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_je_org_status' AND object_id=OBJECT_ID('journal_entries'))
        CREATE INDEX ix_je_org_status ON journal_entries (org_id, status) INCLUDE (journal_number, entry_date, total_debit, total_credit)
    `,
  },
  {
    label: 'index: ix_jel_entry on journal_entry_lines(entry_id)',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_jel_entry' AND object_id=OBJECT_ID('journal_entry_lines'))
        CREATE INDEX ix_jel_entry ON journal_entry_lines (entry_id)
    `,
  },
  {
    label: 'index: ix_jel_account on journal_entry_lines(account_id, org_id)',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_jel_account' AND object_id=OBJECT_ID('journal_entry_lines'))
        CREATE INDEX ix_jel_account ON journal_entry_lines (account_id, org_id) INCLUDE (debit, credit)
    `,
  },
];

// ── Seed functions (run after schema migrations) ──────────────

async function seedJournalEntrySeries(pool) {
  // A 'journal' series already exists in the seed data (series_type='journal').
  // Ensure it is marked is_default=1 and is_active=1 so getNextNumber('journal',...) finds it.
  await pool.request().query(`
    UPDATE numbering_series
    SET is_default  = 1,
        is_active   = 1,
        allow_manual = 1,
        updated_at  = GETDATE()
    WHERE series_type = 'journal'
      AND is_default = 0
  `);
  // For orgs that have no journal series at all, insert one
  await pool.request().query(`
    INSERT INTO numbering_series (org_id, name, code, series_type, prefix, suffix, separator, include_year, include_month, padding, next_number, reset_frequency, is_default, is_active, allow_manual, created_at, updated_at)
    SELECT
      o.id, 'Journal Entry', 'JNL', 'journal', 'JNL', '', '-',
      1, 0, 5, 1, 'yearly', 1, 1, 1, GETDATE(), GETDATE()
    FROM organisations o
    WHERE NOT EXISTS (
      SELECT 1 FROM numbering_series ns WHERE ns.org_id = o.id AND ns.series_type = 'journal'
    )
  `);
}

// Australian standard COA for a trading/distribution company
// account_type values: asset | liability | equity | revenue | cogs | expense
// normal_balance: debit | credit
const AU_COA = [
  // ── Assets ──────────────────────────────────────────────────
  { code: '1-0000', name: 'Assets',                        type: 'asset',     sub: 'header',        bal: 'debit',  sort: 100, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: false },
  { code: '1-1000', name: 'Cash at Bank',                  type: 'asset',     sub: 'current_asset', bal: 'debit',  sort: 110, system: true,  ar: false, ap: false, bank: true,  gst: false, re: false, manual: true  },
  { code: '1-1100', name: 'Accounts Receivable',           type: 'asset',     sub: 'current_asset', bal: 'debit',  sort: 120, system: true,  ar: true,  ap: false, bank: false, gst: false, re: false, manual: false },
  { code: '1-1200', name: 'Inventory',                     type: 'asset',     sub: 'current_asset', bal: 'debit',  sort: 130, system: true,  ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  { code: '1-1300', name: 'GST Paid (Input Tax Credits)',  type: 'asset',     sub: 'current_asset', bal: 'debit',  sort: 140, system: true,  ar: false, ap: false, bank: false, gst: true,  re: false, manual: false, bas: '1B' },
  { code: '1-1400', name: 'Prepaid Expenses',              type: 'asset',     sub: 'current_asset', bal: 'debit',  sort: 150, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  { code: '1-2000', name: 'Plant & Equipment (at cost)',   type: 'asset',     sub: 'fixed_asset',   bal: 'debit',  sort: 210, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  { code: '1-2100', name: 'Less: Accumulated Depreciation',type: 'asset',     sub: 'fixed_asset',   bal: 'credit', sort: 220, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  // ── Liabilities ──────────────────────────────────────────────
  { code: '2-0000', name: 'Liabilities',                   type: 'liability', sub: 'header',           bal: 'credit', sort: 300, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: false },
  { code: '2-2000', name: 'Accounts Payable',              type: 'liability', sub: 'current_liability', bal: 'credit', sort: 310, system: true,  ar: false, ap: true,  bank: false, gst: false, re: false, manual: false },
  { code: '2-2100', name: 'GST Collected',                 type: 'liability', sub: 'current_liability', bal: 'credit', sort: 320, system: true,  ar: false, ap: false, bank: false, gst: true,  re: false, manual: false, bas: '1A' },
  { code: '2-2200', name: 'GST Payable / (Refundable)',    type: 'liability', sub: 'current_liability', bal: 'credit', sort: 330, system: true,  ar: false, ap: false, bank: false, gst: true,  re: false, manual: false },
  { code: '2-2300', name: 'PAYG Withholding Payable',      type: 'liability', sub: 'current_liability', bal: 'credit', sort: 340, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: false },
  { code: '2-2400', name: 'Superannuation Payable',        type: 'liability', sub: 'current_liability', bal: 'credit', sort: 350, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: false },
  { code: '2-2500', name: 'Income Tax Payable',            type: 'liability', sub: 'current_liability', bal: 'credit', sort: 360, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: false },
  { code: '2-3000', name: 'Loans Payable',                 type: 'liability', sub: 'non_current_liability', bal: 'credit', sort: 410, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true },
  // ── Equity ───────────────────────────────────────────────────
  { code: '3-0000', name: 'Equity',                        type: 'equity',    sub: 'header',   bal: 'credit', sort: 500, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: false },
  { code: '3-3000', name: 'Share Capital',                 type: 'equity',    sub: 'equity',   bal: 'credit', sort: 510, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  { code: '3-3100', name: 'Retained Earnings',             type: 'equity',    sub: 'equity',   bal: 'credit', sort: 520, system: true,  ar: false, ap: false, bank: false, gst: false, re: true,  manual: false },
  { code: '3-3200', name: 'Current Year Earnings',         type: 'equity',    sub: 'equity',   bal: 'credit', sort: 530, system: true,  ar: false, ap: false, bank: false, gst: false, re: false, manual: false },
  // ── Revenue ──────────────────────────────────────────────────
  { code: '4-0000', name: 'Revenue',                       type: 'revenue',   sub: 'header',  bal: 'credit', sort: 600, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: false },
  { code: '4-4000', name: 'Sales Revenue',                 type: 'revenue',   sub: 'revenue', bal: 'credit', sort: 610, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  { code: '4-4100', name: 'Service Revenue',               type: 'revenue',   sub: 'revenue', bal: 'credit', sort: 620, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  { code: '4-4200', name: 'Other Income',                  type: 'revenue',   sub: 'revenue', bal: 'credit', sort: 630, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  // ── COGS ─────────────────────────────────────────────────────
  { code: '5-0000', name: 'Cost of Goods Sold',            type: 'cogs',      sub: 'header', bal: 'debit',  sort: 700, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: false },
  { code: '5-5000', name: 'Cost of Goods Sold',            type: 'cogs',      sub: 'cogs',   bal: 'debit',  sort: 710, system: true,  ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  { code: '5-5100', name: 'Freight Inward',                type: 'cogs',      sub: 'cogs',   bal: 'debit',  sort: 720, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  // ── Expenses ─────────────────────────────────────────────────
  { code: '6-0000', name: 'Expenses',                      type: 'expense',   sub: 'header',   bal: 'debit',  sort: 800, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: false },
  { code: '6-6000', name: 'Wages & Salaries',              type: 'expense',   sub: 'overhead', bal: 'debit',  sort: 810, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  { code: '6-6100', name: 'Superannuation Expense',        type: 'expense',   sub: 'overhead', bal: 'debit',  sort: 820, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  { code: '6-6200', name: 'Rent',                          type: 'expense',   sub: 'overhead', bal: 'debit',  sort: 830, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  { code: '6-6300', name: 'Utilities',                     type: 'expense',   sub: 'overhead', bal: 'debit',  sort: 840, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  { code: '6-6400', name: 'Telephone & Internet',          type: 'expense',   sub: 'overhead', bal: 'debit',  sort: 850, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  { code: '6-6500', name: 'Insurance',                     type: 'expense',   sub: 'overhead', bal: 'debit',  sort: 860, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  { code: '6-6600', name: 'Depreciation',                  type: 'expense',   sub: 'overhead', bal: 'debit',  sort: 870, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  { code: '6-6700', name: 'Marketing & Advertising',       type: 'expense',   sub: 'overhead', bal: 'debit',  sort: 880, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  { code: '6-6800', name: 'Accounting & Legal Fees',       type: 'expense',   sub: 'overhead', bal: 'debit',  sort: 890, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  { code: '6-6900', name: 'Office Supplies',               type: 'expense',   sub: 'overhead', bal: 'debit',  sort: 900, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  { code: '6-6950', name: 'Bank Charges & Fees',           type: 'expense',   sub: 'overhead', bal: 'debit',  sort: 910, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
  { code: '6-6970', name: 'Miscellaneous Expenses',        type: 'expense',   sub: 'overhead', bal: 'debit',  sort: 920, system: false, ar: false, ap: false, bank: false, gst: false, re: false, manual: true  },
];

async function seedCOA(pool) {
  // Only seed for orgs that have zero COA rows
  const orgs = await pool.request().query(`
    SELECT o.id FROM organisations o
    WHERE NOT EXISTS (
      SELECT 1 FROM chart_of_accounts coa WHERE coa.org_id = o.id
    )
  `);

  for (const org of orgs.recordset) {
    const orgId = org.id;
    console.log(`  Seeding COA for org ${orgId}…`);

    for (const acct of AU_COA) {
      await pool.request()
        .input('org_id',          sql.Int,         orgId)
        .input('account_code',    sql.VarChar(20),  acct.code)
        .input('account_name',    sql.NVarChar(200), acct.name)
        .input('account_type',    sql.VarChar(20),  acct.type)
        .input('account_subtype', sql.VarChar(30),  acct.sub)
        .input('normal_balance',  sql.VarChar(6),   acct.bal)
        .input('currency_code',   sql.VarChar(3),   'AUD')
        .input('bas_field',       sql.VarChar(10),  acct.bas || null)
        .input('is_bank_account', sql.Bit,          acct.bank  ? 1 : 0)
        .input('is_gst_account',  sql.Bit,          acct.gst   ? 1 : 0)
        .input('is_ar_account',   sql.Bit,          acct.ar    ? 1 : 0)
        .input('is_ap_account',   sql.Bit,          acct.ap    ? 1 : 0)
        .input('is_retained_earnings', sql.Bit,     acct.re    ? 1 : 0)
        .input('is_system',       sql.Bit,          acct.system ? 1 : 0)
        .input('allow_manual_journal', sql.Bit,     acct.manual ? 1 : 0)
        .input('is_active',       sql.Bit,          1)
        .input('sort_order',      sql.Int,          acct.sort)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE org_id=@org_id AND account_code=@account_code)
          INSERT INTO chart_of_accounts
            (org_id, account_code, account_name, account_type, account_subtype,
             normal_balance, currency_code, bas_field,
             is_bank_account, is_gst_account, is_ar_account, is_ap_account,
             is_retained_earnings, is_system, allow_manual_journal, is_active,
             sort_order, created_at, updated_at)
          VALUES
            (@org_id, @account_code, @account_name, @account_type, @account_subtype,
             @normal_balance, @currency_code, @bas_field,
             @is_bank_account, @is_gst_account, @is_ar_account, @is_ap_account,
             @is_retained_earnings, @is_system, @allow_manual_journal, @is_active,
             @sort_order, GETDATE(), GETDATE())
        `);
    }
    console.log(`  ✓  Seeded ${AU_COA.length} accounts for org ${orgId}`);
  }
}

async function run() {
  console.log('Connecting to database…');
  const pool = await sql.connect(config);
  console.log('Connected.\n');

  let ok = 0;

  for (const m of migrations) {
    try {
      await pool.request().query(m.sql);
      console.log(`  ✓  ${m.label}`);
      ok++;
    } catch (err) {
      console.error(`  ✗  ${m.label}: ${err.message}`);
      await pool.close();
      process.exit(1);
    }
  }

  console.log(`\n${ok} schema migrations applied.\n`);

  // Seeds
  console.log('Seeding journal_entry numbering series…');
  await seedJournalEntrySeries(pool);
  console.log('  ✓  Journal entry numbering series ready.\n');

  console.log('Seeding chart of accounts (AU standard)…');
  await seedCOA(pool);
  console.log('\nDone.');

  await pool.close();
}

run().catch(err => { console.error(err.message); process.exit(1); });
