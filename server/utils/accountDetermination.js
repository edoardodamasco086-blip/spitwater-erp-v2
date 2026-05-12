'use strict';

/**
 * SAP OBYC-style automated account determination.
 *
 * Specificity hierarchy (highest → lowest):
 *   1. exact match:             transaction_key + valuation_class + warehouse_id
 *   2. category wildcard:       transaction_key + valuation_class + NULL warehouse
 *   3. warehouse wildcard:      transaction_key + NULL valuation   + warehouse_id
 *   4. full wildcard:           transaction_key + NULL             + NULL
 *
 * Throws AccountDeterminationError if no mapping is found — transaction must abort.
 */

class AccountDeterminationError extends Error {
  constructor(transactionKey, valuationClass, warehouseId) {
    super(
      `No account determination found for transaction key "${transactionKey}" ` +
      `(valuation_class=${valuationClass ?? '*'}, warehouse_id=${warehouseId ?? '*'}). ` +
      `Configure OBYC mapping before posting this transaction.`
    );
    this.name = 'AccountDeterminationError';
    this.transactionKey  = transactionKey;
    this.valuationClass  = valuationClass;
    this.warehouseId     = warehouseId;
    this.statusCode      = 422;
  }
}

/**
 * Resolve the GL account_id for a transaction.
 *
 * @param {string}      transactionKey  SAP-style key e.g. 'BSX', 'WRX', 'GBB_VBR'
 * @param {number|null} valuationClass  product_categories.id — null means "any"
 * @param {number|null} warehouseId     warehouses.id          — null means "any"
 * @param {number}      orgId
 * @param {object}      pool            mssql connection pool
 * @param {object}      sql             mssql module
 * @returns {Promise<number>}           chart_of_accounts.id
 * @throws  {AccountDeterminationError}
 */
async function resolveAccount(transactionKey, valuationClass, warehouseId, orgId, pool, sql) {
  // Try all four levels in a single query, ordered by specificity descending.
  // NULL parameters need explicit IS NULL handling.
  const result = await pool.request()
    .input('org_id',          sql.Int,        orgId)
    .input('transaction_key', sql.VarChar(20), transactionKey)
    .input('valuation_class', sql.Int,         valuationClass ?? null)
    .input('warehouse_id',    sql.Int,         warehouseId    ?? null)
    .query(`
      SELECT TOP 1
        ad.account_id,
        -- specificity score: 2 pts for matched valuation, 1 pt for matched warehouse
        (CASE WHEN ad.valuation_class IS NOT NULL THEN 2 ELSE 0 END +
         CASE WHEN ad.warehouse_id   IS NOT NULL THEN 1 ELSE 0 END) AS specificity
      FROM account_determination ad
      WHERE ad.org_id          = @org_id
        AND ad.transaction_key = @transaction_key
        AND ad.is_active       = 1
        -- valuation_class: row must match supplied value OR be wildcard (NULL)
        AND (
          (ad.valuation_class = @valuation_class)
          OR (ad.valuation_class IS NULL)
          OR (@valuation_class IS NULL AND ad.valuation_class IS NULL)
        )
        -- warehouse_id: same wildcard logic
        AND (
          (ad.warehouse_id = @warehouse_id)
          OR (ad.warehouse_id IS NULL)
          OR (@warehouse_id IS NULL AND ad.warehouse_id IS NULL)
        )
      ORDER BY specificity DESC
    `);

  if (!result.recordset.length) {
    throw new AccountDeterminationError(transactionKey, valuationClass, warehouseId);
  }

  return result.recordset[0].account_id;
}

module.exports = { resolveAccount, AccountDeterminationError };
