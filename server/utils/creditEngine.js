'use strict';
// ============================================================
// utils/creditEngine.js  — Credit Control Integration
//
// Called on SO confirmation. Checks:
//   1. Customer credit_hold flag (manual block)
//   2. Overdue invoices in AR (any balance past credit_terms due date)
//   3. Open SO exposure + new order total vs. credit_limit
//
// Returns: { passed, status, reason }
//   status:  'ok' | 'credit_hold' | 'overdue_hold'
// ============================================================

/**
 * @param {object} p
 * @param {number} p.orgId
 * @param {number} p.customerId
 * @param {number} p.newOrderTotal   — total value of the new SO
 * @param {object} p.pool
 * @param {object} p.sql
 */
async function checkCredit({ orgId, customerId, newOrderTotal, pool, sql }) {
  // ── 1. Customer master ─────────────────────────────────────────
  const custRes = await pool.request()
    .input('id',     sql.Int, customerId)
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT credit_limit, credit_hold, credit_terms, gst_registered
      FROM contacts
      WHERE id = @id AND org_id = @org_id
    `);

  if (!custRes.recordset.length) {
    return { passed: false, status: 'credit_hold', reason: 'Customer not found.' };
  }
  const cust = custRes.recordset[0];

  // ── 2. Manual credit hold ──────────────────────────────────────
  if (cust.credit_hold) {
    return { passed: false, status: 'credit_hold', reason: 'Customer account is on manual credit hold.' };
  }

  // ── 3. Overdue invoices ────────────────────────────────────────
  // Parse credit_terms (e.g. 'NET30', 'NET60', 'COD', 'EOM30') → days
  const termsDays = parseCreditTerms(cust.credit_terms);
  if (termsDays !== null) {
    // Check journal_entry_lines for AR debits that are past due
    // AR invoices are posted to accounts with account_type = 'accounts_receivable'
    const overdueRes = await pool.request()
      .input('org_id',      sql.Int, orgId)
      .input('customer_id', sql.Int, customerId)
      .input('due_days',    sql.Int, termsDays)
      .query(`
        SELECT COUNT(*) AS cnt
        FROM journal_entries je
        JOIN journal_entry_lines jel ON jel.entry_id = je.id
        JOIN chart_of_accounts coa   ON coa.id = jel.account_id
        WHERE je.org_id = @org_id
          AND je.contact_id = @customer_id
          AND je.status = 'posted'
          AND coa.account_type = 'accounts_receivable'
          AND jel.debit_amount > 0
          AND DATEDIFF(DAY, je.entry_date, GETDATE()) > @due_days
          AND je.is_reconciled = 0
      `);
    const overdueCount = overdueRes.recordset[0]?.cnt ?? 0;
    if (overdueCount > 0) {
      return {
        passed: false,
        status: 'overdue_hold',
        reason: `Customer has ${overdueCount} overdue invoice(s) beyond ${termsDays}-day payment terms.`,
      };
    }
  }

  // ── 4. Credit limit check ──────────────────────────────────────
  const creditLimit = Number(cust.credit_limit || 0);
  if (creditLimit > 0) {
    // Open SO exposure (confirmed SOs not yet fully invoiced)
    const exposureRes = await pool.request()
      .input('org_id',      sql.Int, orgId)
      .input('customer_id', sql.Int, customerId)
      .query(`
        SELECT ISNULL(SUM(so.total_value), 0) AS open_exposure
        FROM sales_orders so
        WHERE so.org_id = @org_id
          AND so.customer_id = @customer_id
          AND so.status IN ('confirmed','processing','partially_shipped')
      `);
    const openExposure = Number(exposureRes.recordset[0]?.open_exposure ?? 0);

    // Outstanding AR balance (unreconciled AR debits)
    const arRes = await pool.request()
      .input('org_id',      sql.Int, orgId)
      .input('customer_id', sql.Int, customerId)
      .query(`
        SELECT ISNULL(SUM(jel.debit_amount - jel.credit_amount), 0) AS ar_balance
        FROM journal_entries je
        JOIN journal_entry_lines jel ON jel.entry_id = je.id
        JOIN chart_of_accounts coa   ON coa.id = jel.account_id
        WHERE je.org_id = @org_id
          AND je.contact_id = @customer_id
          AND je.status = 'posted'
          AND coa.account_type = 'accounts_receivable'
          AND je.is_reconciled = 0
      `);
    const arBalance = Number(arRes.recordset[0]?.ar_balance ?? 0);

    const totalExposure = openExposure + arBalance + Number(newOrderTotal);
    if (totalExposure > creditLimit) {
      return {
        passed: false,
        status: 'credit_hold',
        reason: `Order would exceed credit limit. Limit: ${fmt(creditLimit)}, Total exposure: ${fmt(totalExposure)} (Open SOs: ${fmt(openExposure)} + AR: ${fmt(arBalance)} + This order: ${fmt(newOrderTotal)}).`,
      };
    }
  }

  return { passed: true, status: 'ok', reason: null };
}

function parseCreditTerms(terms) {
  if (!terms) return null;
  const t = String(terms).toUpperCase().trim();
  if (t === 'COD' || t === 'CIA') return 0;
  const m = t.match(/NET(\d+)/);
  if (m) return parseInt(m[1]);
  const eom = t.match(/EOM(\d+)/);
  if (eom) return 30 + parseInt(eom[1]); // end of month + days
  return null;
}

function fmt(n) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);
}

module.exports = { checkCredit };
