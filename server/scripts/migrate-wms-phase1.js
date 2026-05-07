'use strict';
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

const migrations = [
  // warehouse_zones: add org_id for multi-tenancy, backfill from parent warehouses
  {
    label: 'warehouse_zones: add org_id',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='warehouse_zones' AND COLUMN_NAME='org_id')
      BEGIN
        ALTER TABLE warehouse_zones ADD org_id INT NOT NULL DEFAULT 0;
        EXEC('UPDATE wz SET wz.org_id = w.org_id FROM warehouse_zones wz INNER JOIN warehouses w ON w.id = wz.warehouse_id');
      END
    `,
  },
  {
    label: 'warehouse_zones: add created_at',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='warehouse_zones' AND COLUMN_NAME='created_at')
        ALTER TABLE warehouse_zones ADD created_at DATETIME NOT NULL DEFAULT GETDATE()
    `,
  },
  {
    label: 'warehouse_zones: add updated_at',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='warehouse_zones' AND COLUMN_NAME='updated_at')
        ALTER TABLE warehouse_zones ADD updated_at DATETIME NOT NULL DEFAULT GETDATE()
    `,
  },
  // warehouse_bins: add created_at / updated_at
  {
    label: 'warehouse_bins: add created_at',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='warehouse_bins' AND COLUMN_NAME='created_at')
        ALTER TABLE warehouse_bins ADD created_at DATETIME NOT NULL DEFAULT GETDATE()
    `,
  },
  {
    label: 'warehouse_bins: add updated_at',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='warehouse_bins' AND COLUMN_NAME='updated_at')
        ALTER TABLE warehouse_bins ADD updated_at DATETIME NOT NULL DEFAULT GETDATE()
    `,
  },
  // stock_levels: add bin_id for bin-level tracking
  {
    label: 'stock_levels: add bin_id',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='stock_levels' AND COLUMN_NAME='bin_id')
        ALTER TABLE stock_levels ADD bin_id INT NULL
    `,
  },
  // stock_movements: add from_warehouse_id / from_bin_id for transfers
  {
    label: 'stock_movements: add from_warehouse_id',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='stock_movements' AND COLUMN_NAME='from_warehouse_id')
        ALTER TABLE stock_movements ADD from_warehouse_id INT NULL
    `,
  },
  {
    label: 'stock_movements: add from_bin_id',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='stock_movements' AND COLUMN_NAME='from_bin_id')
        ALTER TABLE stock_movements ADD from_bin_id INT NULL
    `,
  },
  // Indexes
  {
    label: 'index: ix_wz_warehouse on warehouse_zones(warehouse_id, is_active)',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_wz_warehouse' AND object_id=OBJECT_ID('warehouse_zones'))
        CREATE INDEX ix_wz_warehouse ON warehouse_zones (warehouse_id, is_active)
    `,
  },
  {
    label: 'index: ix_wb_zone on warehouse_bins(zone_id, is_active)',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_wb_zone' AND object_id=OBJECT_ID('warehouse_bins'))
        CREATE INDEX ix_wb_zone ON warehouse_bins (zone_id, is_active)
    `,
  },
  {
    label: 'index: ix_wb_warehouse on warehouse_bins(warehouse_id, is_active)',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_wb_warehouse' AND object_id=OBJECT_ID('warehouse_bins'))
        CREATE INDEX ix_wb_warehouse ON warehouse_bins (warehouse_id, is_active)
    `,
  },
  {
    label: 'index: ix_sl_bin on stock_levels(bin_id) filtered',
    sql: `
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_sl_bin' AND object_id=OBJECT_ID('stock_levels'))
        CREATE INDEX ix_sl_bin ON stock_levels (bin_id) WHERE bin_id IS NOT NULL
    `,
  },
];

async function run() {
  console.log('Connecting to database...');
  const pool = await sql.connect(config);
  console.log('Connected.\n');

  let ok = 0;
  let skipped = 0;

  for (const m of migrations) {
    try {
      await pool.request().query(m.sql);
      console.log(`  ✓  ${m.label}`);
      ok++;
    } catch (err) {
      console.error(`  ✗  ${m.label}: ${err.message}`);
      await pool.close();
      process.exit(1);
    }
  }

  await pool.close();
  console.log(`\nDone. ${ok} migrations applied.`);
}

run().catch(err => { console.error(err.message); process.exit(1); });
