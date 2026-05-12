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

  // ── chart_of_accounts: ATO/BAS reporting columns ─────────────────────────

  {
    label: 'chart_of_accounts: add financial_statement_section',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='chart_of_accounts' AND COLUMN_NAME='financial_statement_section')
        ALTER TABLE chart_of_accounts ADD financial_statement_section VARCHAR(2) NULL
    `,
  },
  {
    label: 'chart_of_accounts: add gst_treatment',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='chart_of_accounts' AND COLUMN_NAME='gst_treatment')
        ALTER TABLE chart_of_accounts ADD gst_treatment VARCHAR(20) NULL
    `,
  },
  {
    label: 'chart_of_accounts: add ato_report_category',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='chart_of_accounts' AND COLUMN_NAME='ato_report_category')
        ALTER TABLE chart_of_accounts ADD ato_report_category VARCHAR(100) NULL
    `,
  },

  // ── account_determination table (OBYC matrix) ─────────────────────────────

  {
    label: 'account_determination: create table',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='account_determination')
      CREATE TABLE account_determination (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        org_id            INT NOT NULL,
        transaction_key   VARCHAR(20) NOT NULL,
        -- NULL means "any" — used for wildcard fallback
        valuation_class   INT NULL,           -- FK to product_categories.id
        warehouse_id      INT NULL,           -- FK to warehouses.id
        account_id        INT NOT NULL,       -- FK to chart_of_accounts.id
        description       NVARCHAR(200) NULL,
        is_active         BIT NOT NULL DEFAULT 1,
        created_at        DATETIME NOT NULL DEFAULT GETDATE(),
        updated_at        DATETIME NOT NULL DEFAULT GETDATE(),
        CONSTRAINT fk_ad_org         FOREIGN KEY (org_id)          REFERENCES organisations(id),
        CONSTRAINT fk_ad_account     FOREIGN KEY (account_id)      REFERENCES chart_of_accounts(id),
        CONSTRAINT fk_ad_warehouse   FOREIGN KEY (warehouse_id)    REFERENCES warehouses(id),
        CONSTRAINT fk_ad_valuation   FOREIGN KEY (valuation_class) REFERENCES product_categories(id),
        -- Unique per specificity level; NULLs are distinct in SQL Server so we use a computed approach
        CONSTRAINT uq_ad_matrix UNIQUE (org_id, transaction_key, valuation_class, warehouse_id)
      )
    `,
  },

  // ── journal_entries: immutability triggers ────────────────────────────────

  {
    label: 'journal_entries: drop guard_update trigger if exists',
    sql: `
      IF OBJECT_ID('trg_journal_entries_guard_update', 'TR') IS NOT NULL
        DROP TRIGGER trg_journal_entries_guard_update
    `,
  },
  {
    // Allows ONLY setting reversed_by_id on a posted entry.
    // Blocks changes to any financial field or status on a posted document.
    label: 'journal_entries: create guard_update trigger',
    sql: `
      CREATE TRIGGER trg_journal_entries_guard_update
      ON journal_entries
      AFTER UPDATE
      AS
      BEGIN
        SET NOCOUNT ON;

        -- If no rows updated, nothing to check
        IF @@ROWCOUNT = 0 RETURN;

        -- Detect if any financial or status field changed on a POSTED entry
        -- Allowed exception: setting reversed_by_id / reversed_at on a posted entry (reversal link)
        IF EXISTS (
          SELECT 1
          FROM inserted i
          JOIN deleted d ON i.id = d.id
          WHERE d.status = 'posted'
            AND (
                  -- financial fields must not change
                  i.total_debit      <> d.total_debit      OR
                  i.total_credit     <> d.total_credit     OR
                  i.currency_code    <> d.currency_code    OR
                  i.exchange_rate    <> d.exchange_rate    OR
                  i.entry_date       <> d.entry_date       OR
                  i.journal_type     <> d.journal_type     OR
                  -- status must not change UNLESS it is moving to 'reversed' (set by reversal process)
                  (i.status <> d.status AND i.status NOT IN ('reversed')) OR
                  -- reversal_of_id must not change once set
                  (d.reversal_of_id IS NOT NULL AND (i.reversal_of_id IS NULL OR i.reversal_of_id <> d.reversal_of_id))
                )
        )
        BEGIN
          RAISERROR('GL Immutability Violation: posted journal entries cannot be modified. Use a reversing entry.', 16, 1);
          ROLLBACK TRANSACTION;
          RETURN;
        END
      END
    `,
  },
  {
    label: 'journal_entries: drop no_delete trigger if exists',
    sql: `
      IF OBJECT_ID('trg_journal_entries_no_delete', 'TR') IS NOT NULL
        DROP TRIGGER trg_journal_entries_no_delete
    `,
  },
  {
    label: 'journal_entries: create no_delete trigger',
    sql: `
      CREATE TRIGGER trg_journal_entries_no_delete
      ON journal_entries
      INSTEAD OF DELETE
      AS
      BEGIN
        SET NOCOUNT ON;
        RAISERROR('GL Immutability Violation: journal entries cannot be deleted. The ledger is permanent.', 16, 1);
        -- INSTEAD OF trigger: simply not executing the DELETE achieves the block
      END
    `,
  },

  // ── journal_entry_lines: immutability triggers ────────────────────────────

  {
    label: 'journal_entry_lines: drop no_update trigger if exists',
    sql: `
      IF OBJECT_ID('trg_journal_entry_lines_no_update', 'TR') IS NOT NULL
        DROP TRIGGER trg_journal_entry_lines_no_update
    `,
  },
  {
    label: 'journal_entry_lines: create no_update trigger',
    sql: `
      CREATE TRIGGER trg_journal_entry_lines_no_update
      ON journal_entry_lines
      AFTER UPDATE
      AS
      BEGIN
        SET NOCOUNT ON;
        IF @@ROWCOUNT = 0 RETURN;
        RAISERROR('GL Immutability Violation: journal entry lines cannot be modified after posting.', 16, 1);
        ROLLBACK TRANSACTION;
      END
    `,
  },
  {
    label: 'journal_entry_lines: drop no_delete trigger if exists',
    sql: `
      IF OBJECT_ID('trg_journal_entry_lines_no_delete', 'TR') IS NOT NULL
        DROP TRIGGER trg_journal_entry_lines_no_delete
    `,
  },
  {
    label: 'journal_entry_lines: create no_delete trigger',
    sql: `
      CREATE TRIGGER trg_journal_entry_lines_no_delete
      ON journal_entry_lines
      INSTEAD OF DELETE
      AS
      BEGIN
        SET NOCOUNT ON;
        RAISERROR('GL Immutability Violation: journal entry lines cannot be deleted. The ledger is permanent.', 16, 1);
      END
    `,
  },

];

async function run() {
  let pool;
  try {
    pool = await sql.connect(config);
    console.log('Connected to SQL Server\n');

    for (const m of migrations) {
      try {
        await pool.request().query(m.sql);
        console.log(`  ✓  ${m.label}`);
      } catch (err) {
        console.error(`  ✗  ${m.label}`);
        console.error(`     ${err.message}`);
        process.exit(1);
      }
    }

    console.log('\nAll migrations completed successfully.');
  } finally {
    if (pool) await pool.close();
  }
}

run();
