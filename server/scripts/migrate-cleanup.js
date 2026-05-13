'use strict';
// ============================================================
// migrate-cleanup.js
//
// Removes columns and tables that are no longer referenced by
// any route or utility:
//
//   DROP COLUMN  price_list_items.discount_pct
//   DROP TABLE   special_prices
//   DROP TABLE   posting_rule_lines
//   DROP TABLE   posting_rules
//   DROP TABLE   journal_lines  (legacy, superseded by journal_entry_lines)
//   DROP TABLE   activities
//   DROP TABLE   entity_registry
//
// Also fixes nothing in code — code was updated before this script.
// ============================================================

const { sql, pool, poolConnect } = require('../config/db');

async function run() {
  await poolConnect;

  const steps = [
    // ── 1. Drop discount_pct from price_list_items ─────────────
    // First drop any default constraint on the column (SQL Server won't drop
    // a column that has a DEFAULT bound to it unless the constraint is removed first).
    {
      label: 'drop default constraint on price_list_items.discount_pct',
      sql: `
        DECLARE @con sysname;
        SELECT @con = dc.name
        FROM sys.default_constraints dc
        JOIN sys.columns c ON c.object_id = dc.parent_object_id
                           AND c.column_id = dc.parent_column_id
        WHERE dc.parent_object_id = OBJECT_ID('price_list_items')
          AND c.name = 'discount_pct';
        IF @con IS NOT NULL
          EXEC('ALTER TABLE price_list_items DROP CONSTRAINT [' + @con + ']');
      `,
    },
    {
      label: 'drop price_list_items.discount_pct column',
      sql: `
        IF EXISTS (
          SELECT 1 FROM sys.columns
          WHERE object_id = OBJECT_ID('price_list_items') AND name = 'discount_pct'
        )
          ALTER TABLE price_list_items DROP COLUMN discount_pct;
      `,
    },

    // ── 2. Drop special_prices ─────────────────────────────────
    {
      label: 'drop table special_prices',
      sql: `
        IF OBJECT_ID('special_prices', 'U') IS NOT NULL
          DROP TABLE special_prices;
      `,
    },

    // ── 3. Drop posting_rule_lines before posting_rules (FK order) ─
    {
      label: 'drop table posting_rule_lines',
      sql: `
        IF OBJECT_ID('posting_rule_lines', 'U') IS NOT NULL
          DROP TABLE posting_rule_lines;
      `,
    },
    {
      label: 'drop table posting_rules',
      sql: `
        IF OBJECT_ID('posting_rules', 'U') IS NOT NULL
          DROP TABLE posting_rules;
      `,
    },

    // ── 4. Drop journal_lines (legacy — replaced by journal_entry_lines) ─
    {
      label: 'drop table journal_lines',
      sql: `
        IF OBJECT_ID('journal_lines', 'U') IS NOT NULL
          DROP TABLE journal_lines;
      `,
    },

    // ── 5. Drop activities ─────────────────────────────────────
    {
      label: 'drop table activities',
      sql: `
        IF OBJECT_ID('activities', 'U') IS NOT NULL
          DROP TABLE activities;
      `,
    },

    // ── 6. Drop entity_registry ────────────────────────────────
    {
      label: 'drop table entity_registry',
      sql: `
        IF OBJECT_ID('entity_registry', 'U') IS NOT NULL
          DROP TABLE entity_registry;
      `,
    },
  ];

  let ok = 0;
  for (const step of steps) {
    try {
      await pool.request().query(step.sql);
      console.log(`  ✓ ${step.label}`);
      ok++;
    } catch (err) {
      console.error(`  ✗ ${step.label}`);
      console.error(`    ${err.message}`);
      process.exit(1);
    }
  }

  console.log(`\nCleanup complete — ${ok}/${steps.length} steps applied.`);
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
