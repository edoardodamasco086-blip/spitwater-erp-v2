'use strict';
// ============================================================
// utils/numbering.js
//
// getNextNumber(seriesIdOrType, orgId, pool, sql)
//   → Returns formatted number string e.g. "SLS-2026-00001"
//   → Atomic — uses UPDATE...OUTPUT so no race conditions
//   → Handles financial year reset (July 1 each year)
//
// previewNumber(series)
//   → Returns a preview string without incrementing
//
// getCurrentFinancialYear(fyStartMonth)
//   → Returns the financial year string e.g. "2026" for FY2025-26
// ============================================================

// ── Financial year helper ─────────────────────────────────────
// fyStartMonth: 1-12 (default 7 = July for Australia)
// Returns the year label used in document numbers
// e.g. if FY starts July, then Aug 2025 → FY2025-26 → label "2026"
function getCurrentFinancialYear(fyStartMonth = 7) {
  const now   = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year  = now.getFullYear();
  // If we're past the FY start month, we're in the NEXT FY
  // e.g. July 2025 onwards → FY ends June 2026 → label 2026
  if (month >= fyStartMonth) {
    return String(year + 1);
  }
  return String(year);
}

function getCurrentCalendarYear() {
  return String(new Date().getFullYear());
}

function getCurrentMonth() {
  return String(new Date().getMonth() + 1).padStart(2, '0');
}

// ── Format a number given series config ───────────────────────
function formatNumber(series, sequenceNum) {
  const sep      = series.separator || '-';
  const padding  = series.padding   || 5;
  const prefix   = series.prefix    || '';
  const suffix   = series.suffix    || '';

  const seq = String(sequenceNum).padStart(padding, '0');

  const parts = [];
  if (prefix)               parts.push(prefix);
  if (series.include_year)  parts.push(getCurrentFinancialYear(series.fy_start_month || 7));
  if (series.include_month) parts.push(getCurrentMonth());
  parts.push(seq);

  let number = parts.join(sep);
  if (suffix) number += suffix;

  return number;
}

// ── Preview without incrementing ─────────────────────────────
function previewNumber(series) {
  return formatNumber(series, series.next_number || 1);
}

// ── Check if series needs a yearly reset ─────────────────────
// Returns true if the series has reset_frequency='yearly' and
// we've crossed a financial year boundary since last_reset_at
function needsYearlyReset(series) {
  if (series.reset_frequency !== 'yearly') return false;
  if (!series.last_reset_at)               return false; // never reset — seed already set next_number

  const fyStartMonth = series.fy_start_month || 7;
  const lastReset    = new Date(series.last_reset_at);
  const now          = new Date();

  // What FY was the last reset in?
  const lastFY = lastReset.getMonth() + 1 >= fyStartMonth
    ? lastReset.getFullYear() + 1
    : lastReset.getFullYear();

  // What FY are we in now?
  const currentFY = now.getMonth() + 1 >= fyStartMonth
    ? now.getFullYear() + 1
    : now.getFullYear();

  return currentFY > lastFY;
}

function needsMonthlyReset(series) {
  if (series.reset_frequency !== 'monthly') return false;
  if (!series.last_reset_at)                return false;
  const lastReset = new Date(series.last_reset_at);
  const now       = new Date();
  return now.getFullYear() > lastReset.getFullYear() ||
         now.getMonth()    > lastReset.getMonth();
}

// ── Main function: get next number (atomic) ───────────────────
// seriesIdOrType: either a numeric series ID, or a string like 'invoice'
// orgId: required when using type string
// Returns: { number: "SLS-2026-00001", seriesId: 5, sequence: 1 }
async function getNextNumber(seriesIdOrType, orgId, pool, sql) {
  if (!pool || !sql) throw new Error('pool and sql are required');

  let seriesId;

  // ── Resolve series ID from type string ────────────────────
  if (typeof seriesIdOrType === 'string' && isNaN(seriesIdOrType)) {
    const res = await pool.request()
      .input('org_id',      sql.Int,         orgId)
      .input('series_type', sql.VarChar(50), seriesIdOrType)
      .query(`
        SELECT TOP 1 id FROM numbering_series
        WHERE org_id = @org_id
          AND series_type = @series_type
          AND is_default  = 1
          AND is_active   = 1
        ORDER BY id ASC
      `);

    if (!res.recordset.length) {
      throw new Error(
        `No default numbering series found for type "${seriesIdOrType}". ` +
        `Go to Settings → Numbering Series to create one.`
      );
    }
    seriesId = res.recordset[0].id;
  } else {
    seriesId = parseInt(seriesIdOrType);
  }

  // ── Check if reset needed, then atomic increment ──────────
  // First fetch series to check reset
  const seriesRes = await pool.request()
    .input('id',     sql.Int, seriesId)
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT id, prefix, suffix, separator, padding,
             include_year, include_month, next_number,
             reset_frequency, last_reset_at, fy_start_month,
             series_type, is_active
      FROM numbering_series
      WHERE id = @id AND org_id = @org_id AND is_active = 1
    `);

  if (!seriesRes.recordset.length) {
    throw new Error(`Numbering series (id=${seriesId}) not found or inactive.`);
  }

  const series = seriesRes.recordset[0];

  // ── Reset if needed ───────────────────────────────────────
  if (needsYearlyReset(series) || needsMonthlyReset(series)) {
    await pool.request()
      .input('id', sql.Int, seriesId)
      .query(`
        UPDATE numbering_series
        SET next_number  = 1,
            last_reset_at = GETDATE(),
            updated_at    = GETDATE()
        WHERE id = @id
      `);
    series.next_number = 1;
  }

  // ── Atomic increment — use the CURRENT next_number, then increment ──
  // OUTPUT DELETED returns the row BEFORE the update (the number we want)
  const updateRes = await pool.request()
    .input('id', sql.Int, seriesId)
    .query(`
      UPDATE numbering_series
      SET next_number = next_number + 1,
          updated_at  = GETDATE()
      OUTPUT
        DELETED.next_number  AS sequence,
        DELETED.prefix,
        DELETED.suffix,
        DELETED.separator,
        DELETED.padding,
        DELETED.include_year,
        DELETED.include_month,
        DELETED.fy_start_month
      WHERE id = @id
    `);

  if (!updateRes.recordset.length) {
    throw new Error(`Failed to increment numbering series (id=${seriesId}).`);
  }

  const row      = updateRes.recordset[0];
  const sequence = row.sequence;
  const number   = formatNumber(row, sequence);

  return { number, seriesId, sequence };
}

// ── Add fy_start_month column if it doesn't exist ────────────
async function ensureColumns(pool) {
  try {
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('numbering_series') AND name = 'fy_start_month'
      )
        ALTER TABLE numbering_series ADD fy_start_month TINYINT NOT NULL DEFAULT 7;

      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('numbering_series') AND name = 'last_reset_at'
      )
        ALTER TABLE numbering_series ADD last_reset_at DATETIME NULL;
    `);
  } catch {
    // Ignore — columns may already exist
  }
}

module.exports = { getNextNumber, previewNumber, formatNumber, getCurrentFinancialYear, ensureColumns };
