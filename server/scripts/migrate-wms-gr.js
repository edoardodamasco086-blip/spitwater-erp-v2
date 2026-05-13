'use strict';
// Run from server/ directory: node scripts/migrate-wms-gr.js
require('dotenv').config();
const sql = require('mssql');

const cfg = {
  server:   process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options:  { encrypt: false, trustServerCertificate: true },
};

async function run() {
  console.log(`Connecting to ${process.env.DB_SERVER} / ${process.env.DB_DATABASE}`);
  const pool = await sql.connect(cfg);
  const q    = (s) => pool.request().query(s);

  // ── inbound_deliveries ────────────────────────────────────────
  await q(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='inbound_deliveries')
    CREATE TABLE inbound_deliveries (
      id              INT IDENTITY(1,1) PRIMARY KEY,
      org_id          INT            NOT NULL,
      delivery_number NVARCHAR(50)   NOT NULL,
      supplier_id     INT            NULL,
      warehouse_id    INT            NOT NULL,
      status          VARCHAR(20)    NOT NULL DEFAULT 'draft',
      expected_date   DATE           NULL,
      supplier_ref    NVARCHAR(100)  NULL,
      notes           NVARCHAR(1000) NULL,
      gl_entry_id     INT            NULL,
      posted_at       DATETIME       NULL,
      posted_by       INT            NULL,
      created_by      INT            NULL,
      created_at      DATETIME       NOT NULL DEFAULT GETDATE(),
      updated_at      DATETIME       NOT NULL DEFAULT GETDATE(),
      CONSTRAINT fk_ind_org      FOREIGN KEY (org_id)       REFERENCES organisations(id),
      CONSTRAINT fk_ind_wh       FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      CONSTRAINT fk_ind_supplier FOREIGN KEY (supplier_id)  REFERENCES contacts(id),
      CONSTRAINT uq_ind_number   UNIQUE (org_id, delivery_number)
    )
  `);
  console.log('✓ inbound_deliveries');

  // ── inbound_delivery_items ────────────────────────────────────
  await q(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='inbound_delivery_items')
    CREATE TABLE inbound_delivery_items (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      delivery_id   INT           NOT NULL,
      org_id        INT           NOT NULL,
      product_id    INT           NOT NULL,
      expected_qty  DECIMAL(18,4) NOT NULL DEFAULT 0,
      received_qty  DECIMAL(18,4) NOT NULL DEFAULT 0,
      unit_cost     DECIMAL(18,4) NOT NULL DEFAULT 0,
      lot_number    NVARCHAR(100) NULL,
      notes         NVARCHAR(500) NULL,
      CONSTRAINT fk_idi_delivery FOREIGN KEY (delivery_id) REFERENCES inbound_deliveries(id),
      CONSTRAINT fk_idi_product  FOREIGN KEY (product_id)  REFERENCES products(id)
    )
  `);
  console.log('✓ inbound_delivery_items');

  // ── handling_units ────────────────────────────────────────────
  await q(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='handling_units')
    CREATE TABLE handling_units (
      id           INT IDENTITY(1,1) PRIMARY KEY,
      org_id       INT          NOT NULL,
      hu_number    NVARCHAR(50) NOT NULL,
      hu_type      VARCHAR(20)  NOT NULL DEFAULT 'carton',
      status       VARCHAR(20)  NOT NULL DEFAULT 'open',
      warehouse_id INT          NULL,
      bin_id       INT          NULL,
      parent_hu_id INT          NULL,
      delivery_id  INT          NULL,
      created_by   INT          NULL,
      created_at   DATETIME     NOT NULL DEFAULT GETDATE(),
      updated_at   DATETIME     NOT NULL DEFAULT GETDATE(),
      CONSTRAINT uq_hu_number   UNIQUE (org_id, hu_number),
      CONSTRAINT fk_hu_delivery FOREIGN KEY (delivery_id) REFERENCES inbound_deliveries(id)
    )
  `);
  console.log('✓ handling_units');

  // ── hu_contents ───────────────────────────────────────────────
  await q(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='hu_contents')
    CREATE TABLE hu_contents (
      id               INT IDENTITY(1,1) PRIMARY KEY,
      hu_id            INT           NOT NULL,
      org_id           INT           NOT NULL,
      delivery_item_id INT           NULL,
      product_id       INT           NOT NULL,
      lot_number       NVARCHAR(100) NULL,
      qty              DECIMAL(18,4) NOT NULL,
      CONSTRAINT fk_huc_hu      FOREIGN KEY (hu_id)            REFERENCES handling_units(id),
      CONSTRAINT fk_huc_product FOREIGN KEY (product_id)       REFERENCES products(id),
      CONSTRAINT fk_huc_item    FOREIGN KEY (delivery_item_id) REFERENCES inbound_delivery_items(id)
    )
  `);
  console.log('✓ hu_contents');

  // ── putaway_rules ─────────────────────────────────────────────
  await q(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='putaway_rules')
    CREATE TABLE putaway_rules (
      id           INT IDENTITY(1,1) PRIMARY KEY,
      org_id       INT           NOT NULL,
      rule_name    NVARCHAR(100) NOT NULL,
      warehouse_id INT           NULL,
      rule_type    VARCHAR(30)   NOT NULL,
      priority     INT           NOT NULL DEFAULT 100,
      product_id   INT           NULL,
      category_id  INT           NULL,
      zone_id      INT           NULL,
      bin_id       INT           NULL,
      is_active    BIT           NOT NULL DEFAULT 1,
      created_at   DATETIME      NOT NULL DEFAULT GETDATE(),
      CONSTRAINT fk_par_org FOREIGN KEY (org_id) REFERENCES organisations(id)
    )
  `);
  console.log('✓ putaway_rules');

  // ── wms_scan_events ───────────────────────────────────────────
  await q(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='wms_scan_events')
    CREATE TABLE wms_scan_events (
      id               INT IDENTITY(1,1) PRIMARY KEY,
      org_id           INT           NOT NULL,
      delivery_id      INT           NOT NULL,
      delivery_item_id INT           NULL,
      hu_id            INT           NULL,
      bin_id           INT           NULL,
      product_id       INT           NULL,
      lot_number       NVARCHAR(100) NULL,
      serial_number    NVARCHAR(100) NULL,
      qty_scanned      DECIMAL(18,4) NOT NULL DEFAULT 1,
      raw_barcode      NVARCHAR(500) NULL,
      parsed_gtin      NVARCHAR(20)  NULL,
      scanned_by       INT           NULL,
      scanned_at       DATETIME      NOT NULL DEFAULT GETDATE(),
      CONSTRAINT fk_wse_delivery FOREIGN KEY (delivery_id) REFERENCES inbound_deliveries(id)
    )
  `);
  console.log('✓ wms_scan_events');

  // ── wms_serial_numbers ────────────────────────────────────────
  await q(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='wms_serial_numbers')
    CREATE TABLE wms_serial_numbers (
      id               INT IDENTITY(1,1) PRIMARY KEY,
      org_id           INT           NOT NULL,
      product_id       INT           NOT NULL,
      serial_number    NVARCHAR(100) NOT NULL,
      status           VARCHAR(20)   NOT NULL DEFAULT 'in_stock',
      hu_id            INT           NULL,
      bin_id           INT           NULL,
      warehouse_id     INT           NULL,
      delivery_item_id INT           NULL,
      received_at      DATETIME      NOT NULL DEFAULT GETDATE(),
      CONSTRAINT uq_wms_serial  UNIQUE (org_id, product_id, serial_number),
      CONSTRAINT fk_wsn_product FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);
  console.log('✓ wms_serial_numbers');

  // ── Seed numbering series 'inbound_delivery' for all orgs ─────
  await q(`
    INSERT INTO numbering_series
      (org_id, name, code, series_type, prefix, suffix, separator, padding,
       include_year, include_month, next_number, reset_frequency,
       fy_start_month, is_default, is_active, created_at, updated_at)
    SELECT
      o.id, 'Inbound Delivery', 'GRN', 'inbound_delivery', 'GRN', '', '-', 5,
      1, 0, 1, 'yearly',
      7, 1, 1, GETDATE(), GETDATE()
    FROM organisations o
    WHERE NOT EXISTS (
      SELECT 1 FROM numbering_series ns
      WHERE ns.org_id = o.id AND ns.series_type = 'inbound_delivery'
    )
  `);
  console.log('✓ numbering_series: inbound_delivery seeded');

  await pool.close();
  console.log('\n✅ WMS GR migration complete.');
}

run().catch(e => { console.error(e.message); process.exit(1); });
