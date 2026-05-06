'use strict';
// ============================================================
// services/currencyService.js
//
// Fetches daily exchange rates from exchangerate.host (free, JSON)
// Base currency: AUD (or org base_currency from org_settings)
//
// Usage:
//   const { fetchAndStoreRates, getRate, convertAmount } = require('./currencyService');
//
//   // Called by scheduler daily at midnight
//   await fetchAndStoreRates(pool, sql, orgId);
//
//   // In pricing logic
//   const rate = await getRate(pool, sql, 'USD', 'AUD');
//   const aud  = convertAmount(580, 'USD', 'AUD', rate);
// ============================================================

const https  = require('https');
const logger = require('../config/logger');

// ── Fetch JSON from URL ───────────────────────────────────────
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON response')); }
      });
    }).on('error', reject);
  });
}

// ── Fetch and store today's rates ────────────────────────────
// base: the org base currency (usually 'AUD')
async function fetchAndStoreRates(pool, sql, baseCurrency = 'AUD') {
  try {
    logger.info(`[Currency] Fetching rates (base: ${baseCurrency})`);

    let quotes = null;

    // Try 1: frankfurter.app — completely free, no key needed
    try {
      const url1 = `https://api.frankfurter.app/latest?from=${baseCurrency}`;
      const data1 = await fetchJSON(url1);
      // { base: 'AUD', rates: { USD: 0.634, EUR: 0.58, ... } }
      if (data1.rates && Object.keys(data1.rates).length > 0) {
        quotes = {};
        for (const [to, rate] of Object.entries(data1.rates)) {
          quotes[`${baseCurrency}${to}`] = rate;
        }
        logger.info(`[Currency] Got ${Object.keys(quotes).length} rates from frankfurter.app`);
      }
    } catch(e) {
      logger.warn('[Currency] frankfurter.app failed:', e.message);
    }

    // Try 2: exchangerate-api.com free tier (no key for open access)
    if (!quotes) {
      try {
        const url2 = `https://open.er-api.com/v6/latest/${baseCurrency}`;
        const data2 = await fetchJSON(url2);
        if (data2.rates && Object.keys(data2.rates).length > 0) {
          quotes = {};
          for (const [to, rate] of Object.entries(data2.rates)) {
            quotes[`${baseCurrency}${to}`] = rate;
          }
          logger.info(`[Currency] Got ${Object.keys(quotes).length} rates from open.er-api.com`);
        }
      } catch(e) {
        logger.warn('[Currency] open.er-api.com failed:', e.message);
      }
    }

    if (!quotes || Object.keys(quotes).length === 0) {
      logger.warn('[Currency] All API sources failed — no rates received');
      return { success: false, error: 'All rate sources failed. Check network connectivity.' };
    }

    const today = new Date().toISOString().split('T')[0];
    let stored  = 0;
    let skipped = 0;
    let errors  = 0;

    // Get our known currency codes for filtering
    const knownRes = await pool.request().query('SELECT code FROM currencies WHERE is_active=1');
    const known    = new Set(knownRes.recordset.map(r => r.code));

    // Build pairs — quotes may be { AUDUSD: 0.634 } or { USD: 0.634 }
    const pairs = [];
    for (const [key, rate] of Object.entries(quotes)) {
      if (key.length === 6) {
        // AUDUSD format
        pairs.push({ from: key.slice(0,3), to: key.slice(3,6), rate: parseFloat(rate) });
      } else if (key.length === 3) {
        // USD format — base currency is baseCurrency
        pairs.push({ from: baseCurrency, to: key, rate: parseFloat(rate) });
      }
    }

    for (const { from, to, rate } of pairs) {
      // Skip if either currency not in our master list
      if (!known.has(from) || !known.has(to)) { skipped++; continue; }
      if (isNaN(rate) || rate <= 0) { skipped++; continue; }

      try {
        // Use DELETE + INSERT pattern (most reliable for SQL Server 2014)
        await pool.request()
          .input('fcc', sql.VarChar(3),    from)
          .input('tcc', sql.VarChar(3),    to)
          .input('rate', sql.Decimal(18,8), rate)
          .input('rd',   sql.Date,          today)
          .query(`
            DELETE FROM exchange_rates WHERE from_currency_code=@fcc AND to_currency_code=@tcc AND rate_date=@rd;
            INSERT INTO exchange_rates (from_currency_code,to_currency_code,rate,rate_date,source,created_at)
            VALUES (@fcc,@tcc,@rate,@rd,'api',GETDATE());
          `);

        // Inverse
        await pool.request()
          .input('fcc', sql.VarChar(3),    to)
          .input('tcc', sql.VarChar(3),    from)
          .input('rate', sql.Decimal(18,8), 1 / rate)
          .input('rd',   sql.Date,          today)
          .query(`
            DELETE FROM exchange_rates WHERE from_currency_code=@fcc AND to_currency_code=@tcc AND rate_date=@rd;
            INSERT INTO exchange_rates (from_currency_code,to_currency_code,rate,rate_date,source,created_at)
            VALUES (@fcc,@tcc,@rate,@rd,'api',GETDATE());
          `);

        stored++;
      } catch(e) {
        errors++;
        logger.debug(`[Currency] Skip ${from}/${to}: ${e.message}`);
      }
    }

    // Update org fx_last_updated
    await pool.request()
      .input('now', sql.DateTime, new Date())
      .query("UPDATE org_settings SET fx_last_updated=@now");

    logger.info(`[Currency] Stored ${stored} rates, skipped ${skipped} unknown currencies`);
    return { success: true, stored, skipped, date: today };

  } catch (err) {
    logger.error('[Currency] Rate fetch failed:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Get the most recent rate between two currencies ──────────
// Returns rate as number, or null if not found
async function getRate(pool, sql, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return 1;

  const res = await pool.request()
    .input('from', sql.VarChar(3), fromCurrency)
    .input('to',   sql.VarChar(3), toCurrency)
    .query(`
      SELECT TOP 1 rate, rate_date
      FROM exchange_rates
      WHERE from_currency_code = @from AND to_currency_code = @to
      ORDER BY rate_date DESC
    `);

  return res.recordset.length ? parseFloat(res.recordset[0].rate) : null;
}

// ── Convert an amount between currencies ─────────────────────
function convertAmount(amount, fromCurrency, toCurrency, rate) {
  if (!rate || fromCurrency === toCurrency) return amount;
  return parseFloat((amount * rate).toFixed(4));
}

// ── Get all latest rates for a base currency ─────────────────
async function getAllRates(pool, sql, baseCurrency = 'AUD') {
  const res = await pool.request()
    .input('from', sql.VarChar(3), baseCurrency)
    .query(`
      SELECT er.to_currency_code, er.rate, er.rate_date,
             c.name AS currency_name, c.symbol
      FROM exchange_rates er
      INNER JOIN currencies c ON c.code = er.to_currency_code
      WHERE er.from_currency_code = @from
        AND er.rate_date = (
          SELECT MAX(rate_date) FROM exchange_rates WHERE from_currency_code = @from
        )
      ORDER BY er.to_currency_code ASC
    `);
  return res.recordset;
}

// ── Start daily scheduler (called from server.js) ────────────
function startDailyFetch(pool, sql, baseCurrency = 'AUD') {
  // Run immediately on startup if no rates today
  async function runIfNeeded() {
    try {
      const today  = new Date().toISOString().split('T')[0];
      const exists = await pool.request()
        .input('today', sql.Date, today)
        .input('from',  sql.VarChar(3), baseCurrency)
        .query('SELECT 1 FROM exchange_rates WHERE rate_date=@today AND from_currency_code=@from');

      if (!exists.recordset.length) {
        logger.info('[Currency] No rates for today — fetching now...');
        await fetchAndStoreRates(pool, sql, baseCurrency);
      } else {
        logger.info('[Currency] Rates already fetched for today');
      }
    } catch (e) {
      logger.error('[Currency] Startup check failed:', e.message);
    }
  }

  // Run after a short delay to let DB pool warm up
  setTimeout(runIfNeeded, 10000);

  // Schedule daily at 00:05 AEST (14:05 UTC previous day)
  function scheduleNext() {
    const now  = new Date();
    const next = new Date();
    next.setUTCHours(14, 5, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const msUntil = next - now;
    logger.info(`[Currency] Next rate fetch scheduled in ${Math.round(msUntil / 60000)} minutes`);
    setTimeout(async () => {
      await fetchAndStoreRates(pool, sql, baseCurrency);
      scheduleNext();
    }, msUntil);
  }
  scheduleNext();
}

module.exports = { fetchAndStoreRates, getRate, convertAmount, getAllRates, startDailyFetch };
