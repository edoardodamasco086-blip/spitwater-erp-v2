'use strict';
// Run from server/ directory: node scripts/migrate-p2p.js
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

  // ── purchase_requisitions ──────────────────────────────────────
  await q(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='purchase_requisitions')
    CREATE TABLE purchase_requisitions (
      id               INT IDENTITY(1,1) PRIMARY KEY,
      org_id           INT            NOT NULL,
      pr_number        NVARCHAR(50)   NOT NULL,
      status           VARCHAR(20)    NOT NULL DEFAULT 'draft',
      requester_id     INT            NULL,
      department       NVARCHAR(100)  NULL,
      cost_center      NVARCHAR(50)   NULL,
      required_date    DATE           NULL,
      notes            NVARCHAR(1000) NULL,
      approved_by      INT            NULL,
      approved_at      DATETIME       NULL,
      rejected_by      INT            NULL,
      rejected_at      DATETIME       NULL,
      rejection_reason NVARCHAR(500)  NULL,
      created_by       INT            NULL,
      created_at       DATETIME       NOT NULL DEFAULT GETDATE(),
      updated_at       DATETIME       NOT NULL DEFAULT GETDATE(),
      CONSTRAINT uq_p2p_pr_number UNIQUE (org_id, pr_number),
      CONSTRAINT fk_p2p_pr_org    FOREIGN KEY (org_id) REFERENCES organisations(id)
    )
  `);
  console.log('✓ purchase_requisitions');

  // ── purchase_requisition_items ─────────────────────────────────
  await q(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='purchase_requisition_items')
    CREATE TABLE purchase_requisition_items (
      id             INT IDENTITY(1,1) PRIMARY KEY,
      pr_id          INT           NOT NULL,
      org_id         INT           NOT NULL,
      product_id     INT           NOT NULL,
      warehouse_id   INT           NULL,
      qty_requested  DECIMAL(18,4) NOT NULL,
      unit_cost_est  DECIMAL(18,4) NOT NULL DEFAULT 0,
      total_est      AS (qty_requested * unit_cost_est) PERSISTED,
      required_date  DATE          NULL,
      notes          NVARCHAR(500) NULL,
      status         VARCHAR(20)   NOT NULL DEFAULT 'open',
      CONSTRAINT fk_p2p_pri_pr        FOREIGN KEY (pr_id)        REFERENCES purchase_requisitions(id),
      CONSTRAINT fk_p2p_pri_product   FOREIGN KEY (product_id)   REFERENCES products(id),
      CONSTRAINT fk_p2p_pri_wh        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    )
  `);
  console.log('✓ purchase_requisition_items');

  // ── request_for_quotations ─────────────────────────────────────
  await q(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='request_for_quotations')
    CREATE TABLE request_for_quotations (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      org_id        INT            NOT NULL,
      rfq_number    NVARCHAR(50)   NOT NULL,
      title         NVARCHAR(200)  NULL,
      status        VARCHAR(20)    NOT NULL DEFAULT 'draft',
      pr_id         INT            NULL,
      warehouse_id  INT            NULL,
      deadline_date DATE           NULL,
      delivery_date DATE           NULL,
      notes         NVARCHAR(1000) NULL,
      created_by    INT            NULL,
      created_at    DATETIME       NOT NULL DEFAULT GETDATE(),
      updated_at    DATETIME       NOT NULL DEFAULT GETDATE(),
      CONSTRAINT uq_p2p_rfq_number UNIQUE (org_id, rfq_number),
      CONSTRAINT fk_p2p_rfq_org    FOREIGN KEY (org_id) REFERENCES organisations(id),
      CONSTRAINT fk_p2p_rfq_pr     FOREIGN KEY (pr_id)  REFERENCES purchase_requisitions(id)
    )
  `);
  console.log('✓ request_for_quotations');

  // ── rfq_items ──────────────────────────────────────────────────
  await q(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='rfq_items')
    CREATE TABLE rfq_items (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      rfq_id        INT           NOT NULL,
      org_id        INT           NOT NULL,
      product_id    INT           NOT NULL,
      pr_item_id    INT           NULL,
      qty_requested DECIMAL(18,4) NOT NULL,
      description   NVARCHAR(500) NULL,
      target_price  DECIMAL(18,4) NULL,
      notes         NVARCHAR(500) NULL,
      CONSTRAINT fk_p2p_rfqi_rfq     FOREIGN KEY (rfq_id)     REFERENCES request_for_quotations(id),
      CONSTRAINT fk_p2p_rfqi_product FOREIGN KEY (product_id) REFERENCES products(id),
      CONSTRAINT fk_p2p_rfqi_pri     FOREIGN KEY (pr_item_id) REFERENCES purchase_requisition_items(id)
    )
  `);
  console.log('✓ rfq_items');

  // ── rfq_vendor_responses ───────────────────────────────────────
  await q(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='rfq_vendor_responses')
    CREATE TABLE rfq_vendor_responses (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      rfq_id        INT            NOT NULL,
      org_id        INT            NOT NULL,
      supplier_id   INT            NOT NULL,
      status        VARCHAR(20)    NOT NULL DEFAULT 'pending',
      response_date DATE           NULL,
      valid_until   DATE           NULL,
      notes         NVARCHAR(500)  NULL,
      created_at    DATETIME       NOT NULL DEFAULT GETDATE(),
      CONSTRAINT fk_p2p_rfqvr_rfq  FOREIGN KEY (rfq_id)      REFERENCES request_for_quotations(id),
      CONSTRAINT fk_p2p_rfqvr_supp FOREIGN KEY (supplier_id) REFERENCES contacts(id)
    )
  `);
  console.log('✓ rfq_vendor_responses');

  // ── rfq_response_items ─────────────────────────────────────────
  await q(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='rfq_response_items')
    CREATE TABLE rfq_response_items (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      response_id   INT           NOT NULL,
      rfq_item_id   INT           NOT NULL,
      org_id        INT           NOT NULL,
      unit_price    DECIMAL(18,4) NOT NULL,
      delivery_days INT           NULL,
      notes         NVARCHAR(500) NULL,
      CONSTRAINT fk_p2p_rfqri_resp FOREIGN KEY (response_id) REFERENCES rfq_vendor_responses(id),
      CONSTRAINT fk_p2p_rfqri_item FOREIGN KEY (rfq_item_id) REFERENCES rfq_items(id)
    )
  `);
  console.log('✓ rfq_response_items');

  // ── po_approval_levels ─────────────────────────────────────────
  await q(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='po_approval_levels')
    CREATE TABLE po_approval_levels (
      id             INT IDENTITY(1,1) PRIMARY KEY,
      org_id         INT            NOT NULL,
      level          INT            NOT NULL,
      level_name     NVARCHAR(100)  NOT NULL,
      min_amount     DECIMAL(18,4)  NOT NULL DEFAULT 0,
      max_amount     DECIMAL(18,4)  NULL,
      approver_role  VARCHAR(20)    NOT NULL DEFAULT 'admin',
      is_active      BIT            NOT NULL DEFAULT 1,
      created_at     DATETIME       NOT NULL DEFAULT GETDATE(),
      CONSTRAINT fk_p2p_pal_org FOREIGN KEY (org_id) REFERENCES organisations(id)
    )
  `);
  console.log('✓ po_approval_levels');

  // ── purchase_orders ────────────────────────────────────────────
  await q(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='purchase_orders')
    CREATE TABLE purchase_orders (
      id                       INT IDENTITY(1,1) PRIMARY KEY,
      org_id                   INT            NOT NULL,
      po_number                NVARCHAR(50)   NOT NULL,
      status                   VARCHAR(30)    NOT NULL DEFAULT 'draft',
      supplier_id              INT            NOT NULL,
      warehouse_id             INT            NULL,
      pr_id                    INT            NULL,
      rfq_id                   INT            NULL,
      payment_terms            NVARCHAR(100)  NULL,
      expected_delivery_date   DATE           NULL,
      currency_code            VARCHAR(3)     NOT NULL DEFAULT 'AUD',
      exchange_rate            DECIMAL(18,6)  NOT NULL DEFAULT 1,
      notes                    NVARCHAR(1000) NULL,
      total_value              DECIMAL(18,4)  NOT NULL DEFAULT 0,
      approval_levels_required INT            NOT NULL DEFAULT 0,
      current_approval_level   INT            NOT NULL DEFAULT 0,
      gl_entry_id              INT            NULL,
      sent_at                  DATETIME       NULL,
      created_by               INT            NULL,
      created_at               DATETIME       NOT NULL DEFAULT GETDATE(),
      updated_at               DATETIME       NOT NULL DEFAULT GETDATE(),
      CONSTRAINT uq_p2p_po_number UNIQUE (org_id, po_number),
      CONSTRAINT fk_p2p_po_org    FOREIGN KEY (org_id)      REFERENCES organisations(id),
      CONSTRAINT fk_p2p_po_supp   FOREIGN KEY (supplier_id) REFERENCES contacts(id),
      CONSTRAINT fk_p2p_po_wh     FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      CONSTRAINT fk_p2p_po_pr     FOREIGN KEY (pr_id)        REFERENCES purchase_requisitions(id),
      CONSTRAINT fk_p2p_po_rfq    FOREIGN KEY (rfq_id)       REFERENCES request_for_quotations(id)
    )
  `);
  console.log('✓ purchase_orders');

  // ── purchase_order_items ───────────────────────────────────────
  await q(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='purchase_order_items')
    CREATE TABLE purchase_order_items (
      id                   INT IDENTITY(1,1) PRIMARY KEY,
      po_id                INT           NOT NULL,
      org_id               INT           NOT NULL,
      product_id           INT           NOT NULL,
      warehouse_id         INT           NULL,
      pr_item_id           INT           NULL,
      rfq_item_id          INT           NULL,
      rfq_response_item_id INT           NULL,
      line_number          INT           NOT NULL DEFAULT 1,
      qty_ordered          DECIMAL(18,4) NOT NULL,
      qty_received         DECIMAL(18,4) NOT NULL DEFAULT 0,
      qty_invoiced         DECIMAL(18,4) NOT NULL DEFAULT 0,
      unit_price           DECIMAL(18,4) NOT NULL,
      total_price          AS (qty_ordered * unit_price) PERSISTED,
      delivery_date        DATE          NULL,
      notes                NVARCHAR(500) NULL,
      CONSTRAINT fk_p2p_poi_po      FOREIGN KEY (po_id)                REFERENCES purchase_orders(id),
      CONSTRAINT fk_p2p_poi_product FOREIGN KEY (product_id)           REFERENCES products(id),
      CONSTRAINT fk_p2p_poi_wh      FOREIGN KEY (warehouse_id)         REFERENCES warehouses(id),
      CONSTRAINT fk_p2p_poi_pri     FOREIGN KEY (pr_item_id)           REFERENCES purchase_requisition_items(id),
      CONSTRAINT fk_p2p_poi_rfqi    FOREIGN KEY (rfq_item_id)          REFERENCES rfq_items(id),
      CONSTRAINT fk_p2p_poi_rfqri   FOREIGN KEY (rfq_response_item_id) REFERENCES rfq_response_items(id)
    )
  `);
  console.log('✓ purchase_order_items');

  // ── po_approval_requests ───────────────────────────────────────
  await q(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='po_approval_requests')
    CREATE TABLE po_approval_requests (
      id             INT IDENTITY(1,1) PRIMARY KEY,
      po_id          INT           NOT NULL,
      org_id         INT           NOT NULL,
      approval_level INT           NOT NULL,
      level_name     NVARCHAR(100) NULL,
      status         VARCHAR(20)   NOT NULL DEFAULT 'pending',
      requested_by   INT           NULL,
      requested_at   DATETIME      NOT NULL DEFAULT GETDATE(),
      actioned_by    INT           NULL,
      actioned_at    DATETIME      NULL,
      comments       NVARCHAR(500) NULL,
      CONSTRAINT fk_p2p_par_po  FOREIGN KEY (po_id)  REFERENCES purchase_orders(id),
      CONSTRAINT fk_p2p_par_org FOREIGN KEY (org_id) REFERENCES organisations(id)
    )
  `);
  console.log('✓ po_approval_requests');

  // ── Add po_id to inbound_deliveries (WMS 3-way match link) ─────
  await q(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='inbound_deliveries' AND COLUMN_NAME='po_id')
      ALTER TABLE inbound_deliveries ADD po_id INT NULL
  `);
  await q(`
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='fk_p2p_ind_po')
      ALTER TABLE inbound_deliveries ADD CONSTRAINT fk_p2p_ind_po FOREIGN KEY (po_id) REFERENCES purchase_orders(id)
  `);
  console.log('✓ inbound_deliveries.po_id added');

  // ── Indexes ────────────────────────────────────────────────────
  const indexes = [
    ['ix_p2p_pr_org_status',  'purchase_requisitions',  'org_id, status'],
    ['ix_p2p_rfq_org_status', 'request_for_quotations', 'org_id, status'],
    ['ix_p2p_po_org_status',  'purchase_orders',        'org_id, status'],
    ['ix_p2p_po_supplier',    'purchase_orders',        'supplier_id'],
    ['ix_p2p_poi_po',         'purchase_order_items',   'po_id'],
    ['ix_p2p_par_po',         'po_approval_requests',   'po_id, status'],
  ];
  for (const [name, table, cols] of indexes) {
    await q(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='${name}' AND object_id=OBJECT_ID('${table}'))
        CREATE INDEX ${name} ON ${table} (${cols})
    `);
  }
  console.log('✓ indexes');

  // ── Seed numbering series ──────────────────────────────────────
  const series = [
    { name: 'Purchase Requisition', code: 'PR',  type: 'purchase_requisition',  prefix: 'PR'  },
    { name: 'Request for Quotation',code: 'RFQ', type: 'request_for_quotation', prefix: 'RFQ' },
    { name: 'Purchase Order',       code: 'PO',  type: 'purchase_order',        prefix: 'PO'  },
  ];
  for (const s of series) {
    await q(`
      INSERT INTO numbering_series
        (org_id, name, code, series_type, prefix, suffix, separator, padding,
         include_year, include_month, next_number, reset_frequency,
         fy_start_month, is_default, is_active, created_at, updated_at)
      SELECT
        o.id, '${s.name}', '${s.code}', '${s.type}', '${s.prefix}', '', '-', 5,
        1, 0, 1, 'yearly', 7, 1, 1, GETDATE(), GETDATE()
      FROM organisations o
      WHERE NOT EXISTS (
        SELECT 1 FROM numbering_series ns
        WHERE ns.org_id = o.id AND ns.series_type = '${s.type}'
      )
    `);
    console.log(`✓ numbering_series: ${s.type}`);
  }

  await pool.close();
  console.log('\n✅ P2P migration complete.');
}

run().catch(e => { console.error(e.message); process.exit(1); });
