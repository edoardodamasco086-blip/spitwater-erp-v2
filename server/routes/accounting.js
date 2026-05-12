'use strict';
// ============================================================
// routes/accounting.js
//
// CHART OF ACCOUNTS
//   GET    /api/accounting/accounts
//   POST   /api/accounting/accounts
//   PATCH  /api/accounting/accounts/:id
//   DELETE /api/accounting/accounts/:id   (deactivate — blocked if has lines)
//
// JOURNAL ENTRIES
//   GET    /api/accounting/journals
//   GET    /api/accounting/journals/:id
//   POST   /api/accounting/journals
//   POST   /api/accounting/journals/:id/reverse   (SAP-style reversal only)
//
// ACCOUNT DETERMINATION (OBYC matrix)
//   GET    /api/accounting/account-determination
//   POST   /api/accounting/account-determination
//   PATCH  /api/accounting/account-determination/:id
//   DELETE /api/accounting/account-determination/:id
//
// REPORTS
//   GET    /api/accounting/trial-balance
//   GET    /api/accounting/gl-register/:accountId
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect }          = require('../config/db');
const { requireAuth }                     = require('../middleware/auth');
const { asyncHandler }                    = require('../middleware/errorHandler');
const { postJournalEntry, reverseJournalEntry } = require('../utils/glPosting');
const { AccountDeterminationError }       = require('../utils/accountDetermination');

router.use(requireAuth);

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'];

// ============================================================
// CHART OF ACCOUNTS
// ============================================================

router.get('/accounts', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId  = req.user.orgId;
  const type   = req.query.type   || null;
  const active = req.query.active !== 'false';

  const rows = await pool.request()
    .input('org_id',       sql.Int,        orgId)
    .input('account_type', sql.VarChar(20), type)
    .input('active_only',  sql.Bit,         active ? 1 : 0)
    .query(`
      SELECT
        id, account_code, account_name, account_type, account_subtype,
        normal_balance, currency_code, description, bas_field,
        financial_statement_section, gst_treatment, ato_report_category,
        is_bank_account, is_gst_account, is_ar_account, is_ap_account,
        is_retained_earnings, is_system, allow_manual_journal, is_active, sort_order,
        parent_account_id, created_at, updated_at
      FROM chart_of_accounts
      WHERE org_id = @org_id
        AND (@account_type IS NULL OR account_type = @account_type)
        AND (@active_only  = 0    OR is_active     = 1)
      ORDER BY sort_order, account_code
    `);

  return res.json({ success: true, data: rows.recordset });
}));

router.post('/accounts', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const {
    account_code, account_name, account_type, account_subtype,
    normal_balance, description, bas_field,
    financial_statement_section, gst_treatment, ato_report_category,
    is_bank_account, is_gst_account, allow_manual_journal,
    parent_account_id, sort_order,
  } = req.body;

  if (!account_code?.trim()) return res.status(400).json({ success: false, error: 'account_code is required.' });
  if (!account_name?.trim()) return res.status(400).json({ success: false, error: 'account_name is required.' });
  if (!ACCOUNT_TYPES.includes(account_type)) {
    return res.status(400).json({ success: false, error: `account_type must be one of: ${ACCOUNT_TYPES.join(', ')}.` });
  }

  const nb = normal_balance || (
    ['asset', 'cogs', 'expense'].includes(account_type) ? 'debit' : 'credit'
  );

  const dup = await pool.request()
    .input('org_id', sql.Int, orgId)
    .input('code',   sql.VarChar(20), account_code.trim())
    .query('SELECT 1 FROM chart_of_accounts WHERE org_id=@org_id AND account_code=@code');
  if (dup.recordset.length) {
    return res.status(409).json({ success: false, error: 'An account with this code already exists.' });
  }

  const result = await pool.request()
    .input('org_id',                     sql.Int,          orgId)
    .input('account_code',               sql.VarChar(20),  account_code.trim())
    .input('account_name',               sql.NVarChar(200), account_name.trim())
    .input('account_type',               sql.VarChar(20),  account_type)
    .input('account_subtype',            sql.VarChar(30),  account_subtype || null)
    .input('normal_balance',             sql.VarChar(6),   nb)
    .input('currency_code',              sql.VarChar(3),   'AUD')
    .input('description',                sql.NVarChar(500), description || null)
    .input('bas_field',                  sql.VarChar(10),  bas_field || null)
    .input('financial_statement_section',sql.VarChar(2),   financial_statement_section || null)
    .input('gst_treatment',              sql.VarChar(20),  gst_treatment || null)
    .input('ato_report_category',        sql.VarChar(100), ato_report_category || null)
    .input('is_bank_account',            sql.Bit,          is_bank_account  ? 1 : 0)
    .input('is_gst_account',             sql.Bit,          is_gst_account   ? 1 : 0)
    .input('is_system',                  sql.Bit,          0)
    .input('allow_manual_journal',       sql.Bit,          allow_manual_journal !== false ? 1 : 0)
    .input('is_active',                  sql.Bit,          1)
    .input('parent_account_id',          sql.Int,          parent_account_id || null)
    .input('sort_order',                 sql.Int,          sort_order || 0)
    .query(`
      INSERT INTO chart_of_accounts
        (org_id, account_code, account_name, account_type, account_subtype,
         normal_balance, currency_code, description, bas_field,
         financial_statement_section, gst_treatment, ato_report_category,
         is_bank_account, is_gst_account, is_ar_account, is_ap_account,
         is_retained_earnings, is_system, allow_manual_journal, is_active,
         parent_account_id, sort_order, created_at, updated_at)
      OUTPUT INSERTED.id
      VALUES
        (@org_id, @account_code, @account_name, @account_type, @account_subtype,
         @normal_balance, @currency_code, @description, @bas_field,
         @financial_statement_section, @gst_treatment, @ato_report_category,
         @is_bank_account, @is_gst_account, 0, 0,
         0, @is_system, @allow_manual_journal, @is_active,
         @parent_account_id, @sort_order, GETDATE(), GETDATE())
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id } });
}));

router.patch('/accounts/:id', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);

  const existing = await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query('SELECT * FROM chart_of_accounts WHERE id=@id AND org_id=@org_id');

  if (!existing.recordset.length) return res.status(404).json({ success: false, error: 'Account not found.' });
  const acct = existing.recordset[0];
  if (acct.is_system) return res.status(403).json({ success: false, error: 'System accounts cannot be modified.' });

  const {
    account_name, account_subtype, description, bas_field,
    financial_statement_section, gst_treatment, ato_report_category,
    is_bank_account, is_gst_account, allow_manual_journal, is_active, sort_order,
  } = req.body;

  await pool.request()
    .input('id',                         sql.Int,          id)
    .input('org_id',                     sql.Int,          orgId)
    .input('account_name',               sql.NVarChar(200), account_name               ?? acct.account_name)
    .input('account_subtype',            sql.VarChar(30),  account_subtype            ?? acct.account_subtype)
    .input('description',                sql.NVarChar(500), description                ?? acct.description)
    .input('bas_field',                  sql.VarChar(10),  bas_field                  ?? acct.bas_field)
    .input('financial_statement_section',sql.VarChar(2),   financial_statement_section ?? acct.financial_statement_section)
    .input('gst_treatment',              sql.VarChar(20),  gst_treatment              ?? acct.gst_treatment)
    .input('ato_report_category',        sql.VarChar(100), ato_report_category        ?? acct.ato_report_category)
    .input('is_bank_account',            sql.Bit,          is_bank_account     != null ? (is_bank_account     ? 1 : 0) : acct.is_bank_account)
    .input('is_gst_account',             sql.Bit,          is_gst_account      != null ? (is_gst_account      ? 1 : 0) : acct.is_gst_account)
    .input('allow_manual_journal',       sql.Bit,          allow_manual_journal != null ? (allow_manual_journal ? 1 : 0) : acct.allow_manual_journal)
    .input('is_active',                  sql.Bit,          is_active           != null ? (is_active           ? 1 : 0) : acct.is_active)
    .input('sort_order',                 sql.Int,          sort_order          ?? acct.sort_order)
    .query(`
      UPDATE chart_of_accounts
      SET account_name                = @account_name,
          account_subtype             = @account_subtype,
          description                 = @description,
          bas_field                   = @bas_field,
          financial_statement_section = @financial_statement_section,
          gst_treatment               = @gst_treatment,
          ato_report_category         = @ato_report_category,
          is_bank_account             = @is_bank_account,
          is_gst_account              = @is_gst_account,
          allow_manual_journal        = @allow_manual_journal,
          is_active                   = @is_active,
          sort_order                  = @sort_order,
          updated_at                  = GETDATE()
      WHERE id = @id AND org_id = @org_id
    `);

  return res.json({ success: true });
}));

// Deactivate only — never hard-delete
router.delete('/accounts/:id', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);

  const acct = await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query('SELECT is_system FROM chart_of_accounts WHERE id=@id AND org_id=@org_id');

  if (!acct.recordset.length) return res.status(404).json({ success: false, error: 'Account not found.' });
  if (acct.recordset[0].is_system) return res.status(403).json({ success: false, error: 'System accounts cannot be deactivated.' });

  const used = await pool.request()
    .input('account_id', sql.Int, id)
    .query('SELECT TOP 1 id FROM journal_entry_lines WHERE account_id=@account_id');
  if (used.recordset.length) {
    return res.status(409).json({ success: false, error: 'Cannot deactivate an account with posted journal entries.' });
  }

  await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query('UPDATE chart_of_accounts SET is_active=0, updated_at=GETDATE() WHERE id=@id AND org_id=@org_id');

  return res.json({ success: true });
}));

// ============================================================
// JOURNAL ENTRIES
// ============================================================

router.get('/journals', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId  = req.user.orgId;
  const limit  = Math.max(1, Math.min(200, parseInt(req.query.limit)  || 50));
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const status = req.query.status || null;
  const from   = req.query.from   || null;
  const to     = req.query.to     || null;
  const source = req.query.source || null;

  const rows = await pool.request()
    .input('org_id',  sql.Int,         orgId)
    .input('limit',   sql.Int,         limit)
    .input('offset',  sql.Int,         offset)
    .input('status',  sql.VarChar(20), status)
    .input('from',    sql.Date,        from ? new Date(from) : null)
    .input('to',      sql.Date,        to   ? new Date(to)   : null)
    .input('source',  sql.VarChar(50), source)
    .query(`
      SELECT
        je.id, je.journal_number, je.journal_type, je.status, je.description,
        je.entry_date, je.total_debit, je.total_credit, je.currency_code,
        je.is_reversal, je.reversal_of_id, je.reversed_by_id, je.reversed_at,
        je.source_type, je.source_id,
        je.posted_at, je.posted_by,
        u.full_name AS posted_by_name,
        -- reversal_of journal_number for display
        orig.journal_number AS reversal_of_number,
        -- reversed_by journal_number for display
        rev.journal_number  AS reversed_by_number,
        COUNT(*) OVER() AS total_count
      FROM journal_entries je
      LEFT JOIN users u              ON u.id   = je.posted_by
      LEFT JOIN journal_entries orig ON orig.id = je.reversal_of_id
      LEFT JOIN journal_entries rev  ON rev.id  = je.reversed_by_id
      WHERE je.org_id = @org_id
        AND (@status IS NULL OR je.status    = @status)
        AND (@from   IS NULL OR je.entry_date >= @from)
        AND (@to     IS NULL OR je.entry_date <= @to)
        AND (@source IS NULL OR je.source_type = @source)
      ORDER BY je.entry_date DESC, je.id DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

  const total = rows.recordset[0]?.total_count ?? 0;
  return res.json({
    success: true,
    data:    rows.recordset,
    meta:    { total, limit, offset },
  });
}));

router.get('/journals/:id', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);

  const [headerRes, linesRes] = await Promise.all([
    pool.request()
      .input('id',     sql.Int, id)
      .input('org_id', sql.Int, orgId)
      .query(`
        SELECT
          je.*,
          up.full_name AS posted_by_name,
          orig.journal_number AS reversal_of_number,
          rev.journal_number  AS reversed_by_number
        FROM journal_entries je
        LEFT JOIN users u              ON u.id   = je.posted_by
        LEFT JOIN users up             ON up.id  = je.posted_by
        LEFT JOIN journal_entries orig ON orig.id = je.reversal_of_id
        LEFT JOIN journal_entries rev  ON rev.id  = je.reversed_by_id
        WHERE je.id = @id AND je.org_id = @org_id
      `),
    pool.request()
      .input('entry_id', sql.Int, id)
      .query(`
        SELECT
          jel.id, jel.account_id, jel.debit, jel.credit, jel.description, jel.line_order,
          jel.contact_id, jel.product_id,
          coa.account_code, coa.account_name, coa.account_type, coa.normal_balance
        FROM journal_entry_lines jel
        JOIN chart_of_accounts coa ON coa.id = jel.account_id
        ORDER BY jel.line_order, jel.id
      `),
  ]);

  if (!headerRes.recordset.length) {
    return res.status(404).json({ success: false, error: 'Journal entry not found.' });
  }

  return res.json({
    success: true,
    data:    { ...headerRes.recordset[0], lines: linesRes.recordset },
  });
}));

router.post('/journals', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const { entry_date, description, lines } = req.body;

  if (!Array.isArray(lines) || lines.length < 2) {
    return res.status(400).json({ success: false, error: 'A journal entry requires at least 2 lines.' });
  }
  for (const l of lines) {
    if (!l.account_id) return res.status(400).json({ success: false, error: 'Each line requires account_id.' });
    if (Number(l.debit || 0) < 0 || Number(l.credit || 0) < 0) {
      return res.status(400).json({ success: false, error: 'Debit and credit values must be non-negative.' });
    }
  }

  const accountIds = [...new Set(lines.map(l => l.account_id))];
  const acctCheck = await pool.request()
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT id, allow_manual_journal FROM chart_of_accounts
      WHERE org_id = @org_id AND id IN (${accountIds.join(',')}) AND is_active = 1
    `);
  if (acctCheck.recordset.length !== accountIds.length) {
    return res.status(400).json({ success: false, error: 'One or more account IDs are invalid or inactive.' });
  }
  const noManual = acctCheck.recordset.filter(a => !a.allow_manual_journal);
  if (noManual.length) {
    return res.status(400).json({ success: false, error: 'One or more accounts do not allow manual journal entries.' });
  }

  const { entryId, entryNumber } = await postJournalEntry({
    orgId,
    entryDate:     entry_date || new Date(),
    description,
    source:        'manual',
    referenceType: null,
    referenceId:   null,
    createdBy:     req.user.userId,
    lines: lines.map(l => ({
      accountId:   l.account_id,
      debit:       Number(l.debit  || 0),
      credit:      Number(l.credit || 0),
      description: l.description || null,
      contactId:   l.contact_id  || null,
      productId:   l.product_id  || null,
    })),
  }, pool, sql);

  return res.status(201).json({ success: true, data: { id: entryId, journal_number: entryNumber } });
}));

// SAP-style reversal — the ONLY correction mechanism
router.post('/journals/:id/reverse', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId   = req.user.orgId;
  const entryId = parseInt(req.params.id);
  const { reason, reverse_date } = req.body;

  const { reversalId, reversalNumber } = await reverseJournalEntry(
    entryId, orgId, req.user.userId, reverse_date || null, reason || null, pool, sql
  );

  return res.json({ success: true, data: { reversalId, reversalNumber } });
}));

// ============================================================
// ACCOUNT DETERMINATION (OBYC matrix)
// ============================================================

router.get('/account-determination', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;

  const rows = await pool.request()
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT
        ad.id, ad.transaction_key, ad.valuation_class, ad.warehouse_id,
        ad.account_id, ad.description, ad.is_active,
        ad.created_at, ad.updated_at,
        coa.account_code, coa.account_name, coa.account_type,
        pc.name AS valuation_class_name,
        w.name  AS warehouse_name
      FROM account_determination ad
      JOIN chart_of_accounts coa ON coa.id = ad.account_id
      LEFT JOIN product_categories pc ON pc.id = ad.valuation_class
      LEFT JOIN warehouses w          ON w.id  = ad.warehouse_id
      WHERE ad.org_id = @org_id
      ORDER BY ad.transaction_key, ad.valuation_class, ad.warehouse_id
    `);

  return res.json({ success: true, data: rows.recordset });
}));

router.post('/account-determination', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const { transaction_key, valuation_class, warehouse_id, account_id, description } = req.body;

  if (!transaction_key?.trim()) return res.status(400).json({ success: false, error: 'transaction_key is required.' });
  if (!account_id) return res.status(400).json({ success: false, error: 'account_id is required.' });

  // Verify account belongs to org
  const acct = await pool.request()
    .input('id',     sql.Int, account_id)
    .input('org_id', sql.Int, orgId)
    .query('SELECT 1 FROM chart_of_accounts WHERE id=@id AND org_id=@org_id AND is_active=1');
  if (!acct.recordset.length) {
    return res.status(400).json({ success: false, error: 'Account not found or inactive.' });
  }

  const result = await pool.request()
    .input('org_id',          sql.Int,          orgId)
    .input('transaction_key', sql.VarChar(20),  transaction_key.trim())
    .input('valuation_class', sql.Int,          valuation_class || null)
    .input('warehouse_id',    sql.Int,          warehouse_id    || null)
    .input('account_id',      sql.Int,          account_id)
    .input('description',     sql.NVarChar(200),description || null)
    .query(`
      INSERT INTO account_determination
        (org_id, transaction_key, valuation_class, warehouse_id, account_id, description)
      OUTPUT INSERTED.id
      VALUES
        (@org_id, @transaction_key, @valuation_class, @warehouse_id, @account_id, @description)
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id } });
}));

router.patch('/account-determination/:id', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);
  const { account_id, description, is_active } = req.body;

  const row = await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query('SELECT * FROM account_determination WHERE id=@id AND org_id=@org_id');
  if (!row.recordset.length) return res.status(404).json({ success: false, error: 'Determination row not found.' });
  const existing = row.recordset[0];

  await pool.request()
    .input('id',          sql.Int,          id)
    .input('org_id',      sql.Int,          orgId)
    .input('account_id',  sql.Int,          account_id  ?? existing.account_id)
    .input('description', sql.NVarChar(200),description ?? existing.description)
    .input('is_active',   sql.Bit,          is_active   != null ? (is_active ? 1 : 0) : existing.is_active)
    .query(`
      UPDATE account_determination
      SET account_id  = @account_id,
          description = @description,
          is_active   = @is_active,
          updated_at  = GETDATE()
      WHERE id = @id AND org_id = @org_id
    `);

  return res.json({ success: true });
}));

router.delete('/account-determination/:id', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);

  const row = await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query('SELECT 1 FROM account_determination WHERE id=@id AND org_id=@org_id');
  if (!row.recordset.length) return res.status(404).json({ success: false, error: 'Determination row not found.' });

  await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query('DELETE FROM account_determination WHERE id=@id AND org_id=@org_id');

  return res.json({ success: true });
}));

// ============================================================
// REPORTS
// ============================================================

// Trial balance includes both 'posted' and 'reversed' entries —
// the reversal document's lines physically zero out the original in the ledger.
router.get('/trial-balance', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const asOf  = req.query.as_of ? new Date(req.query.as_of) : new Date();

  const rows = await pool.request()
    .input('org_id', sql.Int,  orgId)
    .input('as_of',  sql.Date, asOf)
    .query(`
      SELECT
        coa.id          AS account_id,
        coa.account_code,
        coa.account_name,
        coa.account_type,
        coa.account_subtype,
        coa.normal_balance,
        coa.financial_statement_section,
        coa.gst_treatment,
        coa.ato_report_category,
        coa.sort_order,
        ISNULL(SUM(jel.debit),  0) AS total_debit,
        ISNULL(SUM(jel.credit), 0) AS total_credit,
        ISNULL(SUM(jel.debit),  0) - ISNULL(SUM(jel.credit), 0) AS net_debit,
        ISNULL(SUM(jel.credit), 0) - ISNULL(SUM(jel.debit),  0) AS net_credit
      FROM chart_of_accounts coa
      LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id AND jel.org_id = @org_id
      LEFT JOIN journal_entries je ON je.id = jel.entry_id
            AND je.status IN ('posted', 'reversed')
            AND je.entry_date <= @as_of
      WHERE coa.org_id  = @org_id
        AND coa.is_active = 1
      GROUP BY
        coa.id, coa.account_code, coa.account_name, coa.account_type,
        coa.account_subtype, coa.normal_balance,
        coa.financial_statement_section, coa.gst_treatment, coa.ato_report_category,
        coa.sort_order
      ORDER BY coa.sort_order, coa.account_code
    `);

  const data = rows.recordset.map(r => ({
    ...r,
    balance: r.normal_balance === 'debit'
      ? Number(r.net_debit)
      : Number(r.net_credit),
  }));

  const grandDebit  = data.reduce((s, r) => s + Number(r.total_debit),  0);
  const grandCredit = data.reduce((s, r) => s + Number(r.total_credit), 0);

  return res.json({
    success: true,
    data,
    meta: {
      as_of:        asOf.toISOString().slice(0, 10),
      grand_debit:  grandDebit,
      grand_credit: grandCredit,
      balanced:     Math.abs(grandDebit - grandCredit) < 0.01,
    },
  });
}));

router.get('/gl-register/:accountId', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId     = req.user.orgId;
  const accountId = parseInt(req.params.accountId);
  const limit     = Math.max(1, Math.min(500, parseInt(req.query.limit)  || 100));
  const offset    = Math.max(0, parseInt(req.query.offset) || 0);
  const from      = req.query.from || null;
  const to        = req.query.to   || null;

  const acct = await pool.request()
    .input('id',     sql.Int, accountId)
    .input('org_id', sql.Int, orgId)
    .query('SELECT account_code, account_name, account_type, normal_balance FROM chart_of_accounts WHERE id=@id AND org_id=@org_id');

  if (!acct.recordset.length) {
    return res.status(404).json({ success: false, error: 'Account not found.' });
  }

  const rows = await pool.request()
    .input('account_id', sql.Int,  accountId)
    .input('org_id',     sql.Int,  orgId)
    .input('limit',      sql.Int,  limit)
    .input('offset',     sql.Int,  offset)
    .input('from',       sql.Date, from ? new Date(from) : null)
    .input('to',         sql.Date, to   ? new Date(to)   : null)
    .query(`
      SELECT
        jel.id          AS line_id,
        je.id           AS entry_id,
        je.journal_number,
        je.entry_date,
        je.status,
        je.is_reversal,
        je.description  AS entry_description,
        jel.description AS line_description,
        jel.debit,
        jel.credit,
        je.source_type,
        je.source_id,
        COUNT(*) OVER() AS total_count
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE jel.account_id = @account_id
        AND jel.org_id     = @org_id
        AND je.status      IN ('posted', 'reversed')
        AND (@from IS NULL OR je.entry_date >= @from)
        AND (@to   IS NULL OR je.entry_date <= @to)
      ORDER BY je.entry_date ASC, je.id ASC, jel.line_order ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

  const total   = rows.recordset[0]?.total_count ?? 0;
  const account = acct.recordset[0];

  let running = 0;
  const ledger = rows.recordset.map(r => {
    const debit  = Number(r.debit);
    const credit = Number(r.credit);
    running += (account.normal_balance === 'debit') ? (debit - credit) : (credit - debit);
    return { ...r, running_balance: Math.round(running * 10000) / 10000 };
  });

  return res.json({
    success: true,
    account,
    data:    ledger,
    meta:    { total, limit, offset },
  });
}));

module.exports = router;
