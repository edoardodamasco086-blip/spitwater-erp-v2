'use strict';
// ============================================================
// GS1-128 barcode parser
//
// Handles three formats:
//   1. Parenthetical  — "(01)12345678901234(10)LOT(21)SER(30)5"
//   2. GS-delimited   — raw scanner output with ASCII 0x1D separators
//   3. Plain string   — 13-digit EAN-13 treated as GTIN, or product_code fallback
//
// Application Identifiers supported:
//   00 — SSCC (18 digits, fixed)
//   01 — GTIN (14 digits, fixed)
//   10 — Batch/Lot (variable, ≤20)
//   17 — Expiry YYMMDD (6 digits, fixed)
//   21 — Serial number (variable, ≤20)
//   30 — Count (variable, ≤8)
// ============================================================

const GS = '\x1D';

const AI_DEFS = {
  '00': { name: 'sscc',     fixedLen: 18 },
  '01': { name: 'gtin',     fixedLen: 14 },
  '10': { name: 'lot',      fixedLen: null },
  '17': { name: 'expiry',   fixedLen: 6  },
  '21': { name: 'serial',   fixedLen: null },
  '30': { name: 'quantity', fixedLen: null },
};

function parseGs1(barcode) {
  if (!barcode) return {};

  const s = String(barcode).trim();

  // ── 1. Parenthetical format ───────────────────────────────────
  if (s.includes('(')) {
    const result = {};
    const re = /\((\d{2,4})\)([^(]*)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const def = AI_DEFS[m[1]];
      if (def) result[def.name] = m[2].trim();
    }
    if (result.quantity) result.quantity = Number(result.quantity) || 1;
    return result;
  }

  // ── 2. GS-delimited / concatenated ───────────────────────────
  if (s.includes(GS) || /^\d{2}/.test(s)) {
    const result = {};
    let pos = 0;

    while (pos < s.length) {
      // Try 2-digit AI (we only support 2-digit AIs in this parser)
      const ai  = s.substr(pos, 2);
      const def = AI_DEFS[ai];
      if (!def) break;
      pos += 2;

      let val;
      if (def.fixedLen) {
        val = s.substr(pos, def.fixedLen);
        pos += def.fixedLen;
      } else {
        // Variable length: read until GS or end
        const gsIdx = s.indexOf(GS, pos);
        val  = gsIdx === -1 ? s.substr(pos) : s.substring(pos, gsIdx);
        pos  = gsIdx === -1 ? s.length : gsIdx + 1;
      }
      result[def.name] = val;
    }

    if (result.quantity) result.quantity = Number(result.quantity) || 1;
    if (Object.keys(result).length) return result;
  }

  // ── 3. Plain EAN-13 / UPC-A → treat as GTIN ─────────────────
  if (/^\d{12,14}$/.test(s)) {
    return { gtin: s.padStart(14, '0') };
  }

  // ── 4. JSON payload from smart scanner ───────────────────────
  if (s.startsWith('{')) {
    try {
      const obj = JSON.parse(s);
      return {
        gtin:     obj.gtin     || obj.productCode || null,
        lot:      obj.lot      || obj.batch       || null,
        serial:   obj.serial   || obj.serialNumber || null,
        quantity: Number(obj.quantity || obj.qty || 1),
        expiry:   obj.expiry   || obj.expiryDate  || null,
      };
    } catch { /* fall through */ }
  }

  // ── 5. Raw fallback: return as a product_code lookup ─────────
  return { raw: s };
}

/**
 * Resolve the barcode to a product row.
 * Tries GTIN → products.barcode, then raw → product_code / barcode.
 * Returns the product row or null.
 */
async function lookupProduct(parsed, orgId, pool, sql) {
  const request = pool.request().input('org_id', sql.Int, orgId);

  if (parsed.gtin) {
    request.input('gtin', sql.NVarChar(20), parsed.gtin);
    const res = await request.query(`
      SELECT id, name, product_code, barcode, tracking_type, category_id, base_uom_id
      FROM products
      WHERE org_id = @org_id AND is_active = 1
        AND (barcode = @gtin OR barcode = RIGHT(@gtin, 13) OR barcode = RIGHT(@gtin, 12))
    `);
    if (res.recordset.length) return res.recordset[0];
  }

  if (parsed.raw) {
    request.input('raw', sql.NVarChar(100), parsed.raw);
    const res = await request.query(`
      SELECT id, name, product_code, barcode, tracking_type, category_id, base_uom_id
      FROM products
      WHERE org_id = @org_id AND is_active = 1
        AND (product_code = @raw OR barcode = @raw)
    `);
    if (res.recordset.length) return res.recordset[0];
  }

  return null;
}

module.exports = { parseGs1, lookupProduct };
