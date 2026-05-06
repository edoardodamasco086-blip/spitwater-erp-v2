'use strict';
// ============================================================
// routes/currency.js
//
// GET  /api/currency                  — list currencies + latest rates
// GET  /api/currency/rates            — all rates for base currency
// GET  /api/currency/rate/:from/:to   — specific rate
// POST /api/currency/refresh          — manual trigger rate fetch (admin)
// POST /api/currency                  — add currency
// PATCH /api/currency/:code           — update currency (activate/deactivate)
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect }          = require('../config/db');
const { requireAuth, requireRole }        = require('../middleware/auth');
const { asyncHandler }                    = require('../middleware/errorHandler');
const { fetchAndStoreRates, getAllRates }  = require('../services/currencyService');

router.use(requireAuth);

// ── GET /api/currency ─────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  await poolConnect;

  const [currRes, ratesRes, orgRes] = await Promise.all([
    pool.request().query(`
      SELECT code, name, symbol, is_active, is_base
      FROM currencies ORDER BY is_base DESC, code ASC
    `),
    getAllRates(pool, sql, 'AUD'),
    pool.request().query(`SELECT TOP 1 base_currency, fx_last_updated FROM org_settings`),
  ]);

  const baseCurrency = orgRes.recordset[0]?.base_currency || 'AUD';
  const fxUpdated    = orgRes.recordset[0]?.fx_last_updated;

  // Merge rates into currencies
  const rateMap = {};
  ratesRes.forEach(r => { rateMap[r.to_currency_code] = r; });

  const currencies = currRes.recordset.map(c => ({
    ...c,
    rate_to_base: c.code === baseCurrency ? 1 : (rateMap[c.code]?.rate || null),
    rate_date:    rateMap[c.code]?.rate_date || null,
  }));

  return res.json({
    success: true,
    data: currencies,
    meta: { base_currency: baseCurrency, fx_last_updated: fxUpdated },
  });
}));

// ── GET /api/currency/rate/:from/:to ─────────────────────────
router.get('/rate/:from/:to', asyncHandler(async (req, res) => {
  await poolConnect;
  const { from, to } = req.params;

  if (from === to) return res.json({ success: true, data: { rate: 1, from, to, rate_date: new Date() } });

  const res2 = await pool.request()
    .input('from', sql.VarChar(3), from.toUpperCase())
    .input('to',   sql.VarChar(3), to.toUpperCase())
    .query(`
      SELECT TOP 1 rate, rate_date, source
      FROM exchange_rates
      WHERE from_currency_code=@from AND to_currency_code=@to
      ORDER BY rate_date DESC
    `);

  if (!res2.recordset.length) {
    return res.status(404).json({ success: false, error: `No rate found for ${from}/${to}` });
  }

  return res.json({ success: true, data: { rate: res2.recordset[0].rate, from, to, ...res2.recordset[0] } });
}));

// ── POST /api/currency/refresh — manual trigger (admin only) ──
router.post('/refresh', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgRes = await pool.request().query(`SELECT TOP 1 base_currency FROM org_settings`);
  const base   = orgRes.recordset[0]?.base_currency || 'AUD';

  const result = await fetchAndStoreRates(pool, sql, base);
  return res.json({ success: result.success, data: result, message: result.success ? `Fetched rates for ${result.stored} currency pairs` : result.error });
}));

// ── POST /api/currency ────────────────────────────────────────
router.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { code, name, symbol } = req.body;
  if (!code || !name) return res.status(400).json({ success: false, error: 'code and name required.' });

  await pool.request()
    .input('code',   sql.VarChar(3),   code.toUpperCase().trim())
    .input('name',   sql.NVarChar(50), name.trim())
    .input('symbol', sql.NVarChar(5),  symbol || '$')
    .query(`
      IF NOT EXISTS (SELECT 1 FROM currencies WHERE code=@code)
        INSERT INTO currencies (code,name,symbol,is_active,is_base) VALUES (@code,@name,@symbol,1,0)
    `);

  return res.status(201).json({ success: true, message: `Currency ${code} added.` });
}));

// ── PATCH /api/currency/:code ─────────────────────────────────
router.patch('/:code', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { is_active } = req.body;

  await pool.request()
    .input('code',      sql.VarChar(3), req.params.code.toUpperCase())
    .input('is_active', sql.Bit,        is_active ? 1 : 0)
    .query('UPDATE currencies SET is_active=@is_active WHERE code=@code');

  return res.json({ success: true, message: 'Currency updated.' });
}));

// ── POST /api/currency/rate/manual — set a rate manually ─────
router.post('/rate/manual', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { from_currency, to_currency, rate, rate_date } = req.body;
  if (!from_currency || !to_currency || !rate) {
    return res.status(400).json({ success: false, error: 'from_currency, to_currency and rate required.' });
  }

  const today = rate_date || new Date().toISOString().split('T')[0];
  const r     = parseFloat(rate);
  if (isNaN(r) || r <= 0) return res.status(400).json({ success: false, error: 'rate must be a positive number.' });

  // Upsert for this date
  await pool.request()
    .input('from',  sql.VarChar(3),    from_currency.toUpperCase())
    .input('to',    sql.VarChar(3),    to_currency.toUpperCase())
    .input('rate',  sql.Decimal(18,8), r)
    .input('date',  sql.Date,          today)
    .query(`
      IF EXISTS (SELECT 1 FROM exchange_rates WHERE from_currency_code=@from AND to_currency_code=@to AND rate_date=@date)
        UPDATE exchange_rates SET rate=@rate, source='manual', created_at=GETDATE()
        WHERE from_currency_code=@from AND to_currency_code=@to AND rate_date=@date
      ELSE
        INSERT INTO exchange_rates (from_currency_code,to_currency_code,rate,rate_date,source,created_at)
        VALUES (@from,@to,@rate,@date,'manual',GETDATE())
    `);

  // Also update inverse
  await pool.request()
    .input('from',  sql.VarChar(3),    to_currency.toUpperCase())
    .input('to',    sql.VarChar(3),    from_currency.toUpperCase())
    .input('rate',  sql.Decimal(18,8), 1 / r)
    .input('date',  sql.Date,          today)
    .query(`
      IF EXISTS (SELECT 1 FROM exchange_rates WHERE from_currency_code=@from AND to_currency_code=@to AND rate_date=@date)
        UPDATE exchange_rates SET rate=@rate, source='manual', created_at=GETDATE()
        WHERE from_currency_code=@from AND to_currency_code=@to AND rate_date=@date
      ELSE
        INSERT INTO exchange_rates (from_currency_code,to_currency_code,rate,rate_date,source,created_at)
        VALUES (@from,@to,@rate,@date,'manual',GETDATE())
    `);

  return res.json({ success: true, message: `Rate ${from_currency}/${to_currency} set to ${r} for ${today}` });
}));

// ── GET /api/currency/history/:from/:to — rate history for a pair ─
router.get('/history/:from/:to', asyncHandler(async (req, res) => {
  await poolConnect;
  const rows = await pool.request()
    .input('from', sql.VarChar(3), req.params.from.toUpperCase())
    .input('to',   sql.VarChar(3), req.params.to.toUpperCase())
    .query(`
      SELECT TOP 30 rate, rate_date, source, fetched_at
      FROM exchange_rates
      WHERE from_currency_code=@from AND to_currency_code=@to
      ORDER BY rate_date DESC
    `);
  return res.json({ success: true, data: rows.recordset });
}));

module.exports = router;
