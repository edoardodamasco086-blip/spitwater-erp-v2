'use strict';
// ============================================================
// config/db.js — SQL Server 2014 connection pool
// All queries across the app import { sql, pool, poolConnect }
// from this file. The pool is created once and reused.
// ============================================================

require('dotenv').config();
const sql = require('mssql');
const logger = require('./logger');

// ── Build config from environment variables ──────────────────
const dbConfig = {
  server:   process.env.DB_SERVER   || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE || 'Development_04052026',
  options: {
    encrypt:                process.env.DB_ENCRYPT    === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
    enableArithAbort:       true,          // required for SQL Server 2014
    rowCollectionOnDone:    false,
    useUTC:                 false,         // keep AU local time
    instanceName:           process.env.DB_INSTANCE || undefined,
  },
  pool: {
    max:                10,   // max 10 simultaneous connections
    min:                0,    // release idle connections
    idleTimeoutMillis:  30000,
    acquireTimeoutMillis: 15000,
  },
  connectionTimeout: 15000,
  requestTimeout:    30000,
};

// ── Windows Authentication vs SQL Auth ───────────────────────
if (process.env.DB_WINDOWS_AUTH === 'true') {
  // Windows Integrated Security — no username/password needed
  dbConfig.options.trustedConnection = true;
  logger.info('DB: Using Windows Authentication');
} else {
  dbConfig.user     = process.env.DB_USER     || 'sa';
  dbConfig.password = process.env.DB_PASSWORD || '';
  logger.info(`DB: Using SQL Authentication as [${dbConfig.user}]`);
}

// ── Create pool ───────────────────────────────────────────────
const pool = new sql.ConnectionPool(dbConfig);

// ── Connect (returns a promise) ───────────────────────────────
const poolConnect = pool.connect()
  .then(() => {
    logger.info(`DB: Connected to [${dbConfig.server}].[${dbConfig.database}]`);
  })
  .catch(err => {
    logger.error('DB: Connection failed —', err.message);
    logger.error('DB: Check your .env file:');
    logger.error(`  DB_SERVER   = ${dbConfig.server}`);
    logger.error(`  DB_PORT     = ${dbConfig.port}`);
    logger.error(`  DB_DATABASE = ${dbConfig.database}`);
    logger.error(`  DB_USER     = ${dbConfig.user || '(windows auth)'}`);
    // Don't crash the process — routes will get errors on first query
  });

// ── Log pool errors ───────────────────────────────────────────
pool.on('error', err => {
  logger.error('DB Pool error:', err.message);
});

// ── Helper: run a query safely ────────────────────────────────
// Usage: const rows = await query('SELECT * FROM users WHERE id = @id', { id: 42 })
async function query(queryStr, inputs = {}) {
  await poolConnect;
  const req = pool.request();
  for (const [key, val] of Object.entries(inputs)) {
    req.input(key, val);
  }
  const result = await req.query(queryStr);
  return result.recordset;
}

// ── Helper: typed inputs (use this for user data to prevent injection) ──
// Usage: const rows = await typedQuery(q, [{ name:'email', type: sql.NVarChar(200), value: email }])
async function typedQuery(queryStr, inputs = []) {
  await poolConnect;
  const req = pool.request();
  for (const { name, type, value } of inputs) {
    req.input(name, type, value);
  }
  const result = await req.query(queryStr);
  return result.recordset;
}

// ── Helper: execute stored procedure ─────────────────────────
async function execProc(procName, inputs = [], outputs = []) {
  await poolConnect;
  const req = pool.request();
  for (const { name, type, value } of inputs) {
    req.input(name, type, value);
  }
  for (const { name, type } of outputs) {
    req.output(name, type);
  }
  return req.execute(procName);
}

module.exports = { sql, pool, poolConnect, query, typedQuery, execProc };
