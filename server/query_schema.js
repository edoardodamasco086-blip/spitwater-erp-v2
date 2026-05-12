require('dotenv').config();
const sql = require('mssql');

async function runQueries() {
  try {
    const pool = new sql.ConnectionPool({
      server: process.env.DB_SERVER,
      database: process.env.DB_DATABASE,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_CERT === 'true'
      }
    });

    await pool.connect();
    console.log('Connected to DB');

    // Query 1: Column list for journal_entries
    console.log('\n=== JOURNAL_ENTRIES COLUMNS ===');
    let result = await pool.request().query(
      "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'journal_entries' ORDER BY ORDINAL_POSITION"
    );
    console.log(JSON.stringify(result.recordset, null, 2));

    // Query 2: Column list for journal_entry_lines
    console.log('\n=== JOURNAL_ENTRY_LINES COLUMNS ===');
    result = await pool.request().query(
      "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'journal_entry_lines' ORDER BY ORDINAL_POSITION"
    );
    console.log(JSON.stringify(result.recordset, null, 2));

    // Query 3: Column list for chart_of_accounts
    console.log('\n=== CHART_OF_ACCOUNTS COLUMNS ===');
    result = await pool.request().query(
      "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'chart_of_accounts' ORDER BY ORDINAL_POSITION"
    );
    console.log(JSON.stringify(result.recordset, null, 2));

    // Query 4: Check product_categories table
    console.log('\n=== PRODUCT_CATEGORIES CHECK ===');
    result = await pool.request().query(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'product_categories'"
    );
    if (result.recordset.length > 0) {
      console.log('product_categories EXISTS');
      result = await pool.request().query(
        "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'product_categories' ORDER BY ORDINAL_POSITION"
      );
      console.log('Columns:', JSON.stringify(result.recordset, null, 2));
      result = await pool.request().query('SELECT TOP 5 * FROM product_categories');
      console.log('Sample rows:', JSON.stringify(result.recordset, null, 2));
    } else {
      console.log('product_categories DOES NOT EXIST');
    }

    // Query 5: Check account_determination table
    console.log('\n=== ACCOUNT_DETERMINATION CHECK ===');
    result = await pool.request().query(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'account_determination'"
    );
    if (result.recordset.length > 0) {
      console.log('account_determination EXISTS');
    } else {
      console.log('account_determination DOES NOT EXIST');
    }

    // Query 6: FK constraints on journal_entries
    console.log('\n=== FOREIGN KEY CONSTRAINTS ON JOURNAL_ENTRIES ===');
    result = await pool.request().query(
      "SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_NAME = 'journal_entries' AND REFERENCED_TABLE_NAME IS NOT NULL"
    );
    console.log(JSON.stringify(result.recordset, null, 2));

    // Query 7: NOT NULL columns on journal_entries
    console.log('\n=== NOT NULL COLUMNS ON JOURNAL_ENTRIES ===');
    result = await pool.request().query(
      "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'journal_entries' AND IS_NULLABLE = 'NO'"
    );
    console.log(JSON.stringify(result.recordset, null, 2));

    // Query 8: numbering_series sample
    console.log('\n=== NUMBERING_SERIES SAMPLE ===');
    result = await pool.request().query(
      'SELECT TOP 10 id, series_type, prefix FROM numbering_series'
    );
    console.log(JSON.stringify(result.recordset, null, 2));

    await pool.close();
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

runQueries();
