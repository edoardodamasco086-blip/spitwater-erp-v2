'use strict';
// Adds is_base column to price_lists and marks all retail-type price lists as base (non-deletable)
require('dotenv').config();
const { sql, pool, poolConnect } = require('../config/db');

async function run() {
  await poolConnect;
  console.log('Connected.\n');

  // 1. Add is_base column
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('price_lists') AND name = 'is_base'
    )
    ALTER TABLE price_lists ADD is_base BIT NOT NULL DEFAULT 0;
  `);
  console.log('✔ is_base column ensured.');

  // 2. Mark all retail-type price lists as base
  const upd = await pool.request().query(`
    UPDATE price_lists SET is_base = 1 WHERE price_list_type = 'retail';
    SELECT @@ROWCOUNT AS affected;
  `);
  console.log(`✔ Marked ${upd.recordset[0].affected} retail price list(s) as base.`);

  // 3. Verify
  const check = await pool.request().query(`
    SELECT id, name, price_list_type, is_default, is_base
    FROM price_lists
    WHERE is_base = 1
    ORDER BY name;
  `);
  console.log('\nBase price lists:');
  check.recordset.forEach(r =>
    console.log(`  id=${r.id}  "${r.name}"  type=${r.price_list_type}  is_default=${r.is_default}`)
  );

  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
