'use strict';
/**
 * ATO-standard Chart of Accounts seed for Australia.
 * Accounts are structured around ATO BAS reporting labels:
 *   G1  = Total sales (incl. GST)
 *   G2  = Export sales
 *   G3  = GST-free domestic sales
 *   G4  = Input-taxed sales
 *   G10 = Capital purchases (incl. GST)
 *   G11 = Non-capital purchases (incl. GST)
 *   1A  = GST on sales (collected)
 *   1B  = GST on purchases (credits)
 *   W1  = Gross salary & wages
 *   W2  = PAYG withholding
 *
 * financial_statement_section codes:
 *   BS = Balance Sheet | PL = Profit & Loss | OE = Owner's Equity
 *
 * gst_treatment codes:
 *   TAXABLE | GST_FREE | INPUT_TAXED | CAPITAL | NONE
 *
 * Runs idempotently: deletes old generic accounts (1-xxxx format) first,
 * then upserts ATO accounts by code.
 */

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

const ORG_ID = 1;

// normal_balance by type: assets/cogs/expenses = debit; liabilities/equity/revenue = credit
function normalBalance(type) {
  return ['asset', 'cogs', 'expense'].includes(type) ? 'debit' : 'credit';
}

// ─── Account definitions ──────────────────────────────────────────────────────
// [code, name, account_type, financial_statement_section, gst_treatment, ato_report_category, is_system, allow_manual_journal]
const ACCOUNTS = [
  // ── ASSETS (1xxx) ────────────────────────────────────────────────────────
  ['1100', 'Cash at Bank – Operating',        'asset', 'BS', 'NONE',       null,    true,  false],
  ['1101', 'Cash at Bank – Payroll',          'asset', 'BS', 'NONE',       null,    false, false],
  ['1102', 'Petty Cash',                      'asset', 'BS', 'NONE',       null,    false, true],
  ['1200', 'Accounts Receivable (Debtors)',   'asset', 'BS', 'NONE',       null,    true,  false],
  ['1201', 'GST Receivable (1B Credits)',     'asset', 'BS', 'NONE',       '1B',   true,  false],
  ['1210', 'Other Receivables',               'asset', 'BS', 'NONE',       null,    false, true],
  ['1300', 'Inventory – Finished Goods',      'asset', 'BS', 'NONE',       'G11',  true,  false],
  ['1301', 'Inventory – Raw Materials',       'asset', 'BS', 'NONE',       'G11',  false, false],
  ['1310', 'Goods Received / Invoice Pending','asset', 'BS', 'NONE',       null,    true,  false],
  ['1400', 'Prepaid Expenses',                'asset', 'BS', 'NONE',       null,    false, true],
  ['1500', 'Plant & Equipment (at cost)',     'asset', 'BS', 'CAPITAL',    'G10',  false, false],
  ['1510', 'Accumulated Depreciation – P&E', 'asset', 'BS', 'NONE',       null,    false, false],
  ['1520', 'Motor Vehicles (at cost)',        'asset', 'BS', 'CAPITAL',    'G10',  false, false],
  ['1530', 'Accumulated Depreciation – Vehicles','asset','BS','NONE',      null,    false, false],
  ['1600', 'Intangible Assets',               'asset', 'BS', 'NONE',       null,    false, false],
  ['1610', 'Accumulated Amortisation',        'asset', 'BS', 'NONE',       null,    false, false],

  // ── LIABILITIES (2xxx) ───────────────────────────────────────────────────
  ['2100', 'Accounts Payable (Creditors)',    'liability', 'BS', 'NONE',   null,    true,  false],
  ['2101', 'GST Payable (1A Collected)',      'liability', 'BS', 'NONE',   '1A',   true,  false],
  ['2102', 'PAYG Withholding Payable',        'liability', 'BS', 'NONE',   'W2',   true,  false],
  ['2103', 'Superannuation Payable',          'liability', 'BS', 'NONE',   null,    false, false],
  ['2104', 'Wages Payable',                   'liability', 'BS', 'NONE',   null,    false, false],
  ['2200', 'Credit Cards Payable',            'liability', 'BS', 'NONE',   null,    false, true],
  ['2300', 'Bank Loan – Current',             'liability', 'BS', 'NONE',   null,    false, false],
  ['2400', 'Bank Loan – Non-current',         'liability', 'BS', 'NONE',   null,    false, false],
  ['2500', 'Deferred Revenue',                'liability', 'BS', 'NONE',   null,    false, true],
  ['2600', 'Income Tax Payable',              'liability', 'BS', 'NONE',   null,    false, false],
  ['2700', 'Provisions – Annual Leave',       'liability', 'BS', 'NONE',   null,    false, false],
  ['2710', 'Provisions – Long Service Leave', 'liability', 'BS', 'NONE',   null,    false, false],
  ['2900', 'Price Difference Clearing',       'liability', 'BS', 'NONE',   null,    true,  false],

  // ── EQUITY (3xxx) ────────────────────────────────────────────────────────
  ['3100', 'Share Capital',                   'equity', 'OE', 'NONE',     null,    false, false],
  ['3200', 'Retained Earnings',               'equity', 'OE', 'NONE',     null,    true,  false],
  ['3300', "Owner's Draw",                    'equity', 'OE', 'NONE',     null,    false, true],
  ['3900', 'Current Year Earnings',           'equity', 'OE', 'NONE',     null,    true,  false],

  // ── REVENUE (4xxx) ───────────────────────────────────────────────────────
  ['4100', 'Sales Revenue – Taxable (G1)',    'revenue', 'PL', 'TAXABLE',  'G1',   false, false],
  ['4110', 'Sales Revenue – GST-Free (G3)',   'revenue', 'PL', 'GST_FREE', 'G3',   false, false],
  ['4120', 'Sales Revenue – Export (G2)',     'revenue', 'PL', 'GST_FREE', 'G2',   false, false],
  ['4130', 'Sales Revenue – Input Taxed (G4)','revenue', 'PL', 'INPUT_TAXED','G4', false, false],
  ['4200', 'Service Revenue',                 'revenue', 'PL', 'TAXABLE',  'G1',   false, false],
  ['4300', 'Freight & Delivery Income',       'revenue', 'PL', 'TAXABLE',  'G1',   false, false],
  ['4900', 'Other Income',                    'revenue', 'PL', 'TAXABLE',  'G1',   false, true],
  ['4910', 'Interest Income',                 'revenue', 'PL', 'INPUT_TAXED','G4', false, true],

  // ── COGS (5xxx) ──────────────────────────────────────────────────────────
  ['5100', 'Cost of Goods Sold',              'cogs', 'PL', 'TAXABLE',    'G11',  true,  false],
  ['5110', 'Freight Inwards',                 'cogs', 'PL', 'TAXABLE',    'G11',  false, false],
  ['5120', 'Inventory Write-down',            'cogs', 'PL', 'NONE',       null,    false, true],
  ['5200', 'Direct Labour',                   'cogs', 'PL', 'NONE',       'W1',   false, false],
  ['5300', 'Manufacturing Overhead',          'cogs', 'PL', 'TAXABLE',    'G11',  false, false],

  // ── EXPENSES (6xxx) ──────────────────────────────────────────────────────
  ['6100', 'Wages & Salaries',                'expense', 'PL', 'NONE',    'W1',   false, false],
  ['6110', 'Superannuation Expense',          'expense', 'PL', 'NONE',    null,    false, false],
  ['6120', 'Payroll Tax',                     'expense', 'PL', 'NONE',    null,    false, false],
  ['6130', 'Workers Compensation',            'expense', 'PL', 'TAXABLE', 'G11',  false, false],
  ['6200', 'Rent & Occupancy',                'expense', 'PL', 'TAXABLE', 'G11',  false, true],
  ['6210', 'Utilities',                       'expense', 'PL', 'TAXABLE', 'G11',  false, true],
  ['6300', 'Motor Vehicle Expenses',          'expense', 'PL', 'TAXABLE', 'G11',  false, true],
  ['6310', 'Fuel',                            'expense', 'PL', 'TAXABLE', 'G11',  false, true],
  ['6400', 'Depreciation – Plant & Equipment','expense', 'PL', 'NONE',    null,    false, false],
  ['6410', 'Depreciation – Motor Vehicles',   'expense', 'PL', 'NONE',    null,    false, false],
  ['6420', 'Amortisation',                    'expense', 'PL', 'NONE',    null,    false, false],
  ['6500', 'Advertising & Marketing',         'expense', 'PL', 'TAXABLE', 'G11',  false, true],
  ['6600', 'Bank Charges & Interest',         'expense', 'PL', 'INPUT_TAXED','G4',false, true],
  ['6700', 'Insurance',                       'expense', 'PL', 'TAXABLE', 'G11',  false, true],
  ['6800', 'Professional Services',           'expense', 'PL', 'TAXABLE', 'G11',  false, true],
  ['6810', 'IT & Software Subscriptions',     'expense', 'PL', 'TAXABLE', 'G11',  false, true],
  ['6900', 'Repairs & Maintenance',           'expense', 'PL', 'TAXABLE', 'G11',  false, true],
  ['6950', 'Sundry Expenses',                 'expense', 'PL', 'TAXABLE', 'G11',  false, true],
  ['6960', 'Income Tax Expense',              'expense', 'PL', 'NONE',    null,    false, false],
];

// ─── SAP transaction keys → account codes ─────────────────────────────────────
// Format: [transaction_key, valuation_class (null=any), warehouse_id (null=any), account_code, description]
const DETERMINATION = [
  // BSX – Inventory receipt (GR posting)
  ['BSX',      null, null, '1300', 'Inventory receipt – finished goods (any)'],
  // WRX – GR/IR Clearing (AP accrual on PO receipt)
  ['WRX',      null, null, '1310', 'GR/IR clearing account (any)'],
  // GBB_VBR – COGS on goods issue / dispatch
  ['GBB_VBR',  null, null, '5100', 'Cost of goods sold (any)'],
  // VKA – Revenue posting on sales dispatch
  ['VKA',      null, null, '4100', 'Sales revenue – taxable (any)'],
  // ARL – Accounts Receivable posting
  ['ARL',      null, null, '1200', 'Accounts receivable (any)'],
  // APL – Accounts Payable posting
  ['APL',      null, null, '2100', 'Accounts payable (any)'],
  // VST_OUT – GST collected on sales
  ['VST_OUT',  null, null, '2101', 'GST payable – collected (any)'],
  // VST_IN – GST input tax credits on purchases
  ['VST_IN',   null, null, '1201', 'GST receivable – credits (any)'],
  // PRD – Price difference (standard vs actual cost)
  ['PRD',      null, null, '2900', 'Price difference clearing (any)'],
  // WGS – Wages expense
  ['WGS',      null, null, '6100', 'Wages & salaries expense (any)'],
  // TAX – PAYG withholding
  ['TAX',      null, null, '2102', 'PAYG withholding payable (any)'],
  // SUP – Superannuation
  ['SUP',      null, null, '6110', 'Superannuation expense (any)'],
  // DEP – Depreciation
  ['DEP',      null, null, '6400', 'Depreciation expense – plant & equipment (any)'],
];

async function run() {
  let pool;
  try {
    pool = await sql.connect(config);
    console.log('Connected to SQL Server\n');

    // 1. Delete old generic accounts (hyphenated codes like '1-1000') that have no journal lines
    console.log('Step 1: Removing old generic COA accounts...');
    const delRes = await pool.request()
      .input('org_id', sql.Int, ORG_ID)
      .query(`
        DELETE FROM chart_of_accounts
        WHERE org_id = @org_id
          AND account_code LIKE '%-%'
          AND id NOT IN (SELECT DISTINCT account_id FROM journal_entry_lines WHERE org_id = @org_id)
      `);
    console.log(`  Removed ${delRes.rowsAffected[0]} old accounts.\n`);

    // 2. Upsert ATO accounts
    console.log('Step 2: Seeding ATO Chart of Accounts...');
    for (const [code, name, type, fs, gst, ato, isSys, allowManual] of ACCOUNTS) {
      const nb = normalBalance(type);
      await pool.request()
        .input('org_id',                     sql.Int,          ORG_ID)
        .input('account_code',               sql.NVarChar(20), code)
        .input('account_name',               sql.NVarChar(200),name)
        .input('account_type',               sql.NVarChar(50), type)
        .input('normal_balance',             sql.NVarChar(10), nb)
        .input('financial_statement_section',sql.VarChar(2),   fs)
        .input('gst_treatment',              sql.VarChar(20),  gst)
        .input('ato_report_category',        sql.VarChar(100), ato)
        .input('is_system',                  sql.Bit,          isSys ? 1 : 0)
        .input('allow_manual_journal',       sql.Bit,          allowManual ? 1 : 0)
        .query(`
          MERGE chart_of_accounts AS tgt
          USING (SELECT @org_id AS org_id, @account_code AS account_code) AS src
            ON tgt.org_id = src.org_id AND tgt.account_code = src.account_code
          WHEN MATCHED THEN UPDATE SET
            account_name                = @account_name,
            account_type                = @account_type,
            normal_balance              = @normal_balance,
            financial_statement_section = @financial_statement_section,
            gst_treatment               = @gst_treatment,
            ato_report_category         = @ato_report_category,
            is_system                   = @is_system,
            allow_manual_journal        = @allow_manual_journal,
            is_active                   = 1
          WHEN NOT MATCHED THEN INSERT (
            org_id, account_code, account_name, account_type, normal_balance,
            financial_statement_section, gst_treatment, ato_report_category,
            is_system, allow_manual_journal, is_active
          ) VALUES (
            @org_id, @account_code, @account_name, @account_type, @normal_balance,
            @financial_statement_section, @gst_treatment, @ato_report_category,
            @is_system, @allow_manual_journal, 1
          );
        `);
      console.log(`  ✓  ${code}  ${name}`);
    }

    // 3. Seed account_determination matrix
    console.log('\nStep 3: Seeding account determination matrix...');
    for (const [txKey, valClass, whId, accCode, desc] of DETERMINATION) {
      // Resolve account_id from code
      const accRow = await pool.request()
        .input('org_id', sql.Int, ORG_ID)
        .input('code',   sql.NVarChar(20), accCode)
        .query(`SELECT id FROM chart_of_accounts WHERE org_id=@org_id AND account_code=@code`);

      if (!accRow.recordset.length) {
        console.warn(`  ⚠  Account ${accCode} not found — skipping determination row for ${txKey}`);
        continue;
      }
      const accountId = accRow.recordset[0].id;

      // SQL Server UNIQUE constraint treats two NULLs as distinct, so we need a
      // deterministic upsert. We use a DELETE + INSERT inside a serialised block.
      await pool.request()
        .input('org_id',          sql.Int,          ORG_ID)
        .input('transaction_key', sql.VarChar(20),  txKey)
        .input('valuation_class', sql.Int,          valClass)
        .input('warehouse_id',    sql.Int,          whId)
        .input('account_id',      sql.Int,          accountId)
        .input('description',     sql.NVarChar(200),desc)
        .query(`
          DELETE FROM account_determination
          WHERE org_id          = @org_id
            AND transaction_key = @transaction_key
            AND (valuation_class = @valuation_class OR (valuation_class IS NULL AND @valuation_class IS NULL))
            AND (warehouse_id   = @warehouse_id   OR (warehouse_id   IS NULL AND @warehouse_id   IS NULL));

          INSERT INTO account_determination (org_id, transaction_key, valuation_class, warehouse_id, account_id, description)
          VALUES (@org_id, @transaction_key, @valuation_class, @warehouse_id, @account_id, @description);
        `);
      console.log(`  ✓  ${txKey.padEnd(10)} valuation=${valClass ?? '*'} wh=${whId ?? '*'} → ${accCode}`);
    }

    console.log('\nATO COA seed completed successfully.');
  } finally {
    if (pool) await pool.close();
  }
}

run();
