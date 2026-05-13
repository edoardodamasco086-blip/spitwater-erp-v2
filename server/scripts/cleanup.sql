-- ============================================================
-- cleanup.sql  — Run against Development_04052026
-- Drops unused columns and tables identified in the May 2026 audit.
-- Safe to re-run: all statements are guarded with IF EXISTS checks.
-- ============================================================

USE Development_04052026;
GO

-- ── 1. price_list_items.discount_pct ─────────────────────────
-- Must drop the index and default constraint before dropping the column.

-- 1a. Drop any index that covers discount_pct
IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('price_list_items') AND name = 'ix_pli_product')
BEGIN
  DROP INDEX ix_pli_product ON price_list_items;
  PRINT 'Dropped index ix_pli_product on price_list_items';
END
GO

-- 1b. Drop default constraint (SQL Server won't let you drop a column with a bound default)
DECLARE @con sysname;
SELECT @con = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON c.object_id = dc.parent_object_id
                   AND c.column_id = dc.parent_column_id
WHERE dc.parent_object_id = OBJECT_ID('price_list_items')
  AND c.name = 'discount_pct';
IF @con IS NOT NULL
  EXEC('ALTER TABLE price_list_items DROP CONSTRAINT [' + @con + ']');
GO

-- 1c. Drop the column
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('price_list_items') AND name = 'discount_pct'
)
BEGIN
  ALTER TABLE price_list_items DROP COLUMN discount_pct;
  PRINT 'Dropped price_list_items.discount_pct';
END
ELSE
  PRINT 'price_list_items.discount_pct already absent — skip';
GO

-- 1d. Recreate the index without discount_pct
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('price_list_items') AND name = 'ix_pli_product')
BEGIN
  CREATE INDEX ix_pli_product ON price_list_items (product_id, price_list_id);
  PRINT 'Recreated index ix_pli_product (without discount_pct)';
END
GO

-- ── 2. special_prices ────────────────────────────────────────
-- Contact-specific price overrides — never implemented in any route.
IF OBJECT_ID('special_prices', 'U') IS NOT NULL
BEGIN
  DROP TABLE special_prices;
  PRINT 'Dropped table: special_prices';
END
ELSE
  PRINT 'special_prices not found — skip';
GO

-- ── 3. posting_rule_lines / posting_rules ────────────────────
-- Planned automated GL posting rules — never implemented in any route.
IF OBJECT_ID('posting_rule_lines', 'U') IS NOT NULL
BEGIN
  DROP TABLE posting_rule_lines;
  PRINT 'Dropped table: posting_rule_lines';
END
ELSE
  PRINT 'posting_rule_lines not found — skip';
GO

IF OBJECT_ID('posting_rules', 'U') IS NOT NULL
BEGIN
  DROP TABLE posting_rules;
  PRINT 'Dropped table: posting_rules';
END
ELSE
  PRINT 'posting_rules not found — skip';
GO

-- ── 4. journal_lines ─────────────────────────────────────────
-- Legacy table superseded by journal_entry_lines.
-- No route or utility references journal_lines.
IF OBJECT_ID('journal_lines', 'U') IS NOT NULL
BEGIN
  DROP TABLE journal_lines;
  PRINT 'Dropped table: journal_lines';
END
ELSE
  PRINT 'journal_lines not found — skip';
GO

-- ── 5. activities ─────────────────────────────────────────────
-- Generic activity log — never implemented; audit_log covers this.
IF OBJECT_ID('activities', 'U') IS NOT NULL
BEGIN
  DROP TABLE activities;
  PRINT 'Dropped table: activities';
END
ELSE
  PRINT 'activities not found — skip';
GO

-- ── 6. entity_registry ───────────────────────────────────────
-- Entity-type registry — never implemented in any route.
IF OBJECT_ID('entity_registry', 'U') IS NOT NULL
BEGIN
  DROP TABLE entity_registry;
  PRINT 'Dropped table: entity_registry';
END
ELSE
  PRINT 'entity_registry not found — skip';
GO

PRINT '=== Cleanup complete ===';
