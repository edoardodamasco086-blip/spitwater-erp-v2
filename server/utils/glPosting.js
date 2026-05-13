'use strict';
/**
 * SAP FICO–style GL posting utilities.
 *
 * Immutability rules (enforced by DB triggers):
 *   - Posted entries and their lines cannot be edited or deleted.
 *   - The ONLY allowed mutation on a posted entry is linking a reversal document
 *     (sets reversed_by_id, reversed_at, status='reversed').
 *
 * Correction method: reverseJournalEntry() — creates a mirror entry
 *   with debits/credits swapped, then links both documents bidirectionally.
 */

const { getNextNumber } = require('./numbering');

const DEBIT_CREDIT_TOLERANCE = 0.01;

/**
 * Post a new journal entry atomically.
 *
 * opts = {
 *   orgId        : number,
 *   entryDate    : string | Date,   // 'YYYY-MM-DD'
 *   description  : string,
 *   source       : string,          // 'manual' | 'inbound_delivery' | 'dispatch' | 'adjustment' | …
 *   referenceType: string | null,   // 'inbound_delivery' | 'purchase_order' | …
 *   referenceId  : number | null,
 *   createdBy    : number | null,
 *   lines: Array<{
 *     accountId  : number,
 *     debit      : number,
 *     credit     : number,
 *     description: string | null,
 *     contactId  : number | null,
 *     productId  : number | null,
 *   }>
 * }
 *
 * Returns { entryId, entryNumber }
 */
async function postJournalEntry(opts, pool, sql) {
  const { orgId, entryDate, description, source, referenceType, referenceId, createdBy, lines } = opts;

  if (!lines || lines.length < 2) {
    throw new Error('A journal entry requires at least 2 lines.');
  }

  let totalDebit  = 0;
  let totalCredit = 0;
  for (const l of lines) {
    totalDebit  += Number(l.debit  || 0);
    totalCredit += Number(l.credit || 0);
  }
  totalDebit  = Math.round(totalDebit  * 10000) / 10000;
  totalCredit = Math.round(totalCredit * 10000) / 10000;

  if (Math.abs(totalDebit - totalCredit) > DEBIT_CREDIT_TOLERANCE) {
    throw new Error(
      `Journal entry is unbalanced: debit ${totalDebit.toFixed(4)} ≠ credit ${totalCredit.toFixed(4)}.`
    );
  }

  const { number: entryNumber } = await getNextNumber('journal', orgId, pool, sql);

  const txn = pool.transaction();
  await txn.begin();

  try {
    const headerRes = await new sql.Request(txn)
      .input('org_id',         sql.Int,          orgId)
      .input('journal_number', sql.NVarChar(50),  entryNumber)
      .input('journal_type',   sql.VarChar(20),   source || 'manual')
      .input('status',         sql.VarChar(20),   'posted')
      .input('description',    sql.NVarChar(500), description || null)
      .input('source_type',    sql.VarChar(50),   referenceType || null)
      .input('source_id',      sql.Int,           referenceId   || null)
      .input('entry_date',     sql.Date,          entryDate ? new Date(entryDate) : new Date())
      .input('total_debit',    sql.Decimal(18,4), totalDebit)
      .input('total_credit',   sql.Decimal(18,4), totalCredit)
      .input('currency_code',  sql.VarChar(3),    'AUD')
      .input('exchange_rate',  sql.Decimal(18,6), 1)
      .input('is_reversal',    sql.Bit,           0)
      .input('posted_at',      sql.DateTime,      new Date())
      .input('posted_by',      sql.Int,           createdBy || null)
      .input('created_by',     sql.Int,           createdBy || null)
      .query(`
        DECLARE @out TABLE (id INT);
        INSERT INTO journal_entries
          (org_id, journal_number, journal_type, status, description,
           source_type, source_id, entry_date,
           total_debit, total_credit, currency_code, exchange_rate,
           is_reversal, posted_at, posted_by, created_by, created_at, updated_at)
        OUTPUT INSERTED.id INTO @out
        VALUES
          (@org_id, @journal_number, @journal_type, @status, @description,
           @source_type, @source_id, @entry_date,
           @total_debit, @total_credit, @currency_code, @exchange_rate,
           @is_reversal, @posted_at, @posted_by, @created_by, GETDATE(), GETDATE());
        SELECT id FROM @out;
      `);

    const entryId = headerRes.recordset[0].id;

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await new sql.Request(txn)
        .input('entry_id',    sql.Int,           entryId)
        .input('org_id',      sql.Int,           orgId)
        .input('account_id',  sql.Int,           l.accountId)
        .input('debit',       sql.Decimal(18,4), Number(l.debit  || 0))
        .input('credit',      sql.Decimal(18,4), Number(l.credit || 0))
        .input('description', sql.NVarChar(500), l.description || null)
        .input('line_order',  sql.Int,           i)
        .input('contact_id',  sql.Int,           l.contactId || null)
        .input('product_id',  sql.Int,           l.productId || null)
        .query(`
          INSERT INTO journal_entry_lines
            (entry_id, org_id, account_id, debit, credit, description,
             line_order, contact_id, product_id, created_at)
          VALUES
            (@entry_id, @org_id, @account_id, @debit, @credit, @description,
             @line_order, @contact_id, @product_id, GETDATE())
        `);
    }

    await txn.commit();
    return { entryId, entryNumber };

  } catch (err) {
    try { await txn.rollback(); } catch (_) { /* trigger may have already rolled back */ }
    throw err;
  }
}

/**
 * SAP-style reversal: creates a mirror entry (debits ↔ credits swapped),
 * then links both documents bidirectionally.
 *
 * The original document keeps status='reversed' — it is NEVER deleted or edited.
 *
 * Returns { reversalId, reversalNumber }
 */
async function reverseJournalEntry(entryId, orgId, userId, reverseDate, reason, pool, sql) {
  // Fetch original entry + lines
  const entryRes = await pool.request()
    .input('id',     sql.Int, entryId)
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT je.id, je.journal_number, je.status, je.journal_type,
             je.total_debit, je.total_credit, je.source_type, je.source_id,
             je.reversed_by_id, je.reversal_of_id,
             jel.account_id, jel.debit, jel.credit,
             jel.description as line_desc, jel.line_order,
             jel.contact_id, jel.product_id
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id = je.id
      WHERE je.id = @id AND je.org_id = @org_id
      ORDER BY jel.line_order
    `);

  if (!entryRes.recordset.length) {
    throw new Error(`Journal entry ${entryId} not found.`);
  }

  const header = entryRes.recordset[0];

  if (header.status === 'reversed') {
    throw new Error(`Journal entry ${header.journal_number} has already been reversed.`);
  }
  if (header.status !== 'posted') {
    throw new Error(`Only posted entries can be reversed. Entry ${header.journal_number} has status '${header.status}'.`);
  }
  if (header.reversed_by_id) {
    throw new Error(`Journal entry ${header.journal_number} was already reversed by entry ${header.reversed_by_id}.`);
  }
  if (header.reversal_of_id) {
    throw new Error(`Entry ${header.journal_number} is itself a reversal and cannot be reversed again.`);
  }

  const reversalLines = entryRes.recordset.map(l => ({
    accountId:   l.account_id,
    debit:       Number(l.credit),  // swap
    credit:      Number(l.debit),   // swap
    description: l.line_desc,
    contactId:   l.contact_id,
    productId:   l.product_id,
  }));

  // Get next number BEFORE the transaction (uses its own pooled request)
  const { number: reversalNumber } = await getNextNumber('journal', orgId, pool, sql);

  const txn = pool.transaction();
  await txn.begin();

  try {
    // 1. Insert reversal entry header
    const reversalRes = await new sql.Request(txn)
      .input('org_id',          sql.Int,          orgId)
      .input('journal_number',  sql.NVarChar(50),  reversalNumber)
      .input('journal_type',    sql.VarChar(20),   'reversal')
      .input('status',          sql.VarChar(20),   'posted')
      .input('description',     sql.NVarChar(500), `Reversal of ${header.journal_number}${reason ? ': ' + reason : ''}`)
      .input('source_type',     sql.VarChar(50),   header.source_type || null)
      .input('source_id',       sql.Int,           header.source_id   || null)
      .input('entry_date',      sql.Date,          reverseDate ? new Date(reverseDate) : new Date())
      .input('total_debit',     sql.Decimal(18,4), Number(header.total_credit))
      .input('total_credit',    sql.Decimal(18,4), Number(header.total_debit))
      .input('currency_code',   sql.VarChar(3),    'AUD')
      .input('exchange_rate',   sql.Decimal(18,6), 1)
      .input('is_reversal',     sql.Bit,           1)
      .input('reversal_of_id',  sql.Int,           entryId)
      .input('posted_at',       sql.DateTime,      new Date())
      .input('posted_by',       sql.Int,           userId || null)
      .input('created_by',      sql.Int,           userId || null)
      .query(`
        DECLARE @out TABLE (id INT);
        INSERT INTO journal_entries
          (org_id, journal_number, journal_type, status, description,
           source_type, source_id, entry_date,
           total_debit, total_credit, currency_code, exchange_rate,
           is_reversal, reversal_of_id, posted_at, posted_by, created_by, created_at, updated_at)
        OUTPUT INSERTED.id INTO @out
        VALUES
          (@org_id, @journal_number, @journal_type, @status, @description,
           @source_type, @source_id, @entry_date,
           @total_debit, @total_credit, @currency_code, @exchange_rate,
           @is_reversal, @reversal_of_id, @posted_at, @posted_by, @created_by, GETDATE(), GETDATE());
        SELECT id FROM @out;
      `);

    const reversalId = reversalRes.recordset[0].id;

    // 2. Insert reversal lines
    for (let i = 0; i < reversalLines.length; i++) {
      const l = reversalLines[i];
      await new sql.Request(txn)
        .input('entry_id',    sql.Int,           reversalId)
        .input('org_id',      sql.Int,           orgId)
        .input('account_id',  sql.Int,           l.accountId)
        .input('debit',       sql.Decimal(18,4), l.debit)
        .input('credit',      sql.Decimal(18,4), l.credit)
        .input('description', sql.NVarChar(500), l.description || null)
        .input('line_order',  sql.Int,           i)
        .input('contact_id',  sql.Int,           l.contactId || null)
        .input('product_id',  sql.Int,           l.productId || null)
        .query(`
          INSERT INTO journal_entry_lines
            (entry_id, org_id, account_id, debit, credit, description,
             line_order, contact_id, product_id, created_at)
          VALUES
            (@entry_id, @org_id, @account_id, @debit, @credit, @description,
             @line_order, @contact_id, @product_id, GETDATE())
        `);
    }

    // 3. Link original → reversal (only allowed UPDATE per the immutability trigger)
    await new sql.Request(txn)
      .input('id',              sql.Int,      entryId)
      .input('reversed_by_id',  sql.Int,      reversalId)
      .query(`
        UPDATE journal_entries
        SET reversed_by_id = @reversed_by_id,
            reversed_at    = GETDATE(),
            status         = 'reversed',
            updated_at     = GETDATE()
        WHERE id = @id
      `);

    await txn.commit();
    return { reversalId, reversalNumber };

  } catch (err) {
    try { await txn.rollback(); } catch (_) { /* trigger may have already rolled back */ }
    throw err;
  }
}

module.exports = { postJournalEntry, reverseJournalEntry };
