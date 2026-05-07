# Warehouse Management System — Architecture & Build Plan

*Last updated: 2026-05-07*
*Stack: Express + SQL Server 2014 + React 18 + Vite*

---

## Phase Build Status

| Phase | Status | Files |
|---|---|---|
| **Phase 1** — Zones & Bins | ✅ Complete | `server/routes/warehouse.js`, `client/src/pages/warehouse/WarehousePage.jsx`, `client/src/api/warehouse.js` |
| **Phase 2** — Stock levels & movement history | ✅ Complete | `server/routes/warehouse.js` (+stock endpoints), `client/src/pages/products/StockTab.jsx` |
| **Phase 2.5** — FIFO valuation + reports + UX improvements | ✅ Complete | See section below |
| **Phase 3** — Transfers | 🔲 Not started | |
| **Phase 4** — Receiving | 🔲 Not started | |
| **Phase 5** — Picking & Dispatch | 🔲 Not started | |
| **Phase 6** — Inventory Count | 🔲 Not started | |
| **Phase 7** — Service Orders | 🔲 Not started | |
| **Phase 8** — Production Orders | 🔲 Not started | |
| **Phase 9** — Bundle & BOM editor | 🔲 Not started | |

### DB migrations applied (2026-05-07)
`server/scripts/migrate-wms-phase1.js` — run and complete:
- `warehouse_zones`: added `org_id` (backfilled from parent warehouse), `created_at`, `updated_at`
- `warehouse_bins`: added `created_at`, `updated_at`
- `stock_levels`: added `bin_id` (nullable, for bin-level tracking)
- `stock_movements`: added `from_warehouse_id`, `from_bin_id` (for transfers)
- Indexes: `ix_wz_warehouse`, `ix_wb_zone`, `ix_wb_warehouse`, `ix_sl_bin`

### Phase 2.5 — Complete (2026-05-07)

**FIFO cost layering**
- `fifo_cost_layers` — one row per inbound movement (receive / positive adjustment), tracks `qty_remaining` and `is_fully_consumed`
- `fifo_consumption_log` — one row per FIFO layer consumed on outbound, links back to layer and movement
- `stock_movements` extended: `unit_cost`, `total_cost`, `fifo_layer_id`, `fifo_consumption_log_id`
- Adjust endpoint writes/consumes FIFO layers atomically in POST `/api/warehouse/stock/adjust`

**Warehouse → Chart of Accounts link**
- `warehouses` extended: `inventory_account_id` (FK → `chart_of_accounts`), `use_separate_account` (BIT)
- `GET /api/settings/warehouses` JOINs `chart_of_accounts` for account code/name
- `GET /api/settings/chart-of-accounts?type=asset` — new endpoint for COA dropdown
- `WarehouseSettings.jsx` — inventory account picker + `use_separate_account` checkbox

**Audit log on stock adjustments + product field changes**
- `audit_log` rows written on every stock adjust (`inventory.adjust`)
- Product PATCH writes audit_log + `audit_changes` for all 26 tracked fields (old→new diffs)
- `GET /api/products/:id/history` — paginated event timeline with field-level diffs
- `ProductHistoryTab.jsx` — expandable timeline UI on product detail page

**Movement history UX**
- `StockTab.jsx` — shows last 10 movements by default; "View all N movements →" link navigates to `/movements?product_id=X`
- Click any movement row → `MovementDetailModal` with full detail
- `MovementDetailModal.jsx` — shared reusable component (used by StockTab + MovementsReportPage)
- `MovementsReportPage.jsx` — full movement report at `/movements`: product/type/warehouse/date filters, 50/page, clickable rows, picks up `?product_id=` from StockTab nav
- `InventoryLevelsPage.jsx` — inventory levels at `/inventory`: no cost, rich filters (product search, category, warehouse, zone, supplier, committed/on-order/low-stock toggles), LOW badge on below-min rows
- `StockReportsPage.jsx` — stock value (FIFO) + by-location reports at `/warehouse/reports`

**New API endpoints**
```
GET /api/warehouse/stock/movements?search=&from_date=&to_date=&movement_type=&warehouse_id=&product_id=&page=&limit=
GET /api/warehouse/reports/stock-value?warehouse_id=&search=
GET /api/warehouse/reports/by-location?warehouse_id=
GET /api/warehouse/reports/inventory-levels?search=&category_id=&warehouse_id=&zone_id=&supplier_id=&committed_only=&on_order_only=&low_stock=
GET /api/settings/chart-of-accounts?type=
GET /api/products/:id/history?page=&limit=
```

**Permissions**
- Stock adjust: `requirePermission('inventory', 'write')` — manageable in team permissions tab
- All report/read endpoints: `requirePermission('inventory', 'read')`

**KPI / UX fixes**
- Committed KPI sub-label corrected to "Reserved for sales, services & production"
- All 4 StockTab KPI cards show UOM code suffix
- UOM note shown in warehouse breakdown table
- Adjust modal includes `unit_cost` field for inbound movements (FIFO layer creation)

---

## 1. Current State (What Already Exists)

### Database tables (confirmed present)
| Table | Status |
|---|---|
| `warehouses` | Full schema, basic CRUD via `/api/settings/warehouses` |
| `warehouse_zones` | ✅ Full CRUD — `GET/POST/PATCH/DELETE /api/warehouse/zones` |
| `warehouse_bins` | ✅ Full CRUD — `GET/POST/PATCH/DELETE /api/warehouse/bins` |
| `stock_levels` | Exists — read-only aggregates only (product detail + dashboard KPI) |
| `stock_reservations` | Exists — count-only read in product detail |
| `stock_movements` | Exists (confirmed in list-tx-tables.js) — no API, never queried |
| `receiving_session_lines` | Referenced in list-tx-tables.js — no routes |

### Server routes
- `GET/POST/PATCH /api/settings/warehouses` — warehouse master data (name, code, address, type)
- `GET /api/products/:id/stock` — reads `stock_levels` + `stock_reservations` count for one product
- Dashboard KPI: total stock count across all products (aggregate only)

### Frontend
- `WarehouseSettings.jsx` — create/edit warehouses inside the settings page
- Stock card on product detail — shows on-hand + reserved count (no bin/warehouse breakdown)

### Phase 1 complete — now exists
- `GET/POST/PATCH/DELETE /api/warehouse/zones` — full zone CRUD with bin counts
- `GET/POST/PATCH/DELETE /api/warehouse/bins` — full bin CRUD with limits and lock support
- `client/src/pages/warehouse/WarehousePage.jsx` — warehouse → zone → bin tree UI
- `/warehouse` route wired in React Router and sidebar nav

### Still not started
Stock adjustments, inter-warehouse transfers, goods receipt/receiving, picking,
dispatch, inventory counts, bin-level queries, movement history, service orders, production orders.

---

## 2. Core Architecture Principles

### Single source of truth: `stock_movements`
Every action that changes stock — receiving, dispatch, transfer, adjustment, production consumption,
service material consumption, inventory count variance — writes a row to `stock_movements`.
`stock_levels` is the running aggregate maintained by those movements. Nothing ever updates
`stock_levels` directly except through a movement.

### Five document types — all write to `stock_movements`
| Document | Movement type written |
|---|---|
| Sales Order / Invoice | `dispatch` (outbound) |
| Purchase Order / Receiving | `receive` (inbound) |
| Production Order | `production_consume` (inbound components), `production_output` (outbound finished good) |
| Service Order / Job Card | `service_consume` (materials used) |
| Stock Transfer / Adjustment | `transfer_out` + `transfer_in`, or `adjustment` |

---

## 3. Product Types

The `products` table needs a `product_type` column (if not already distinct enough). Valid values:

| Type | Has stock | BOM | Sale bundle lines | Service bundle lines | On sales doc | On service order |
|---|---|---|---|---|---|---|
| `physical` | yes | can be output | as component | as material | yes | as material |
| `labour` | no | no | no | as line | yes | yes |
| `fee` | no | no | no | as line | yes | yes |
| `sale_bundle` | no | no | **is one** | no | yes — explodes | no |
| `service_bundle` | no | no | no | **is one** | no | yes — template |
| `raw_material` | yes | as input | as component | as material | rarely | rarely |

### Three bundle variants — one shared `bundle_lines` table

| Bundle type | Purpose | Editable after apply? | Stock impact |
|---|---|---|---|
| **Sale bundle** | Sell grouped items as one line on invoice | No — locked at point of sale | Components decremented |
| **Service bundle / kit** | Pre-populate a service order (template) | Yes — tech edits actual lines | Materials decremented on completion |
| **BOM** | Template for production run | No — consumed exactly as specified | Inputs consumed, finished good created |

The parent `product_type` determines which context the bundle can be used in.
The `bundle_lines` table schema is identical for all three.

---

## 4. Database Tables to Build

> **Before building:** run an inspection script to confirm exact columns on
> `warehouse_zones`, `warehouse_bins`, `stock_levels`, `stock_movements`,
> `receiving_session_lines`. Only add columns that are genuinely missing.

### 4.1 Location master data
```sql
-- warehouse_zones (confirm columns, add if missing)
id, warehouse_id, org_id, code, name,
zone_type VARCHAR(20),   -- pick | bulk | receive | dispatch | quarantine
is_active BIT, created_at, updated_at

-- warehouse_bins (confirm columns, add if missing)
id, zone_id, org_id, code, name,
bin_type VARCHAR(20),    -- standard | oversize | hazmat | cold
max_weight DECIMAL(10,2), max_volume DECIMAL(10,2),
is_active BIT, created_at, updated_at
```

### 4.2 Stock core
```sql
-- stock_levels (confirm columns, add bin_id if missing)
id, org_id, product_id, warehouse_id, bin_id,
qty_on_hand DECIMAL(18,4),
qty_reserved DECIMAL(18,4),
-- qty_available is computed: qty_on_hand - qty_reserved
updated_at

-- stock_movements (confirm columns, add if missing)
id, org_id, product_id,
warehouse_id, bin_id,           -- destination (for inbound)
from_warehouse_id, from_bin_id, -- source (for transfers)
movement_type VARCHAR(30),      -- adjustment | transfer_in | transfer_out | receive |
                                -- dispatch | production_consume | production_output |
                                -- service_consume | count_variance
qty DECIMAL(18,4),
reference_type VARCHAR(30),     -- transfer | receiving | service_order | production_order | count | manual
reference_id INT,
notes NVARCHAR(500),
created_by INT, created_at
```

### 4.3 Stock transfers
```sql
stock_transfers
  id, org_id,
  from_warehouse_id, to_warehouse_id,
  from_bin_id, to_bin_id,
  status VARCHAR(20),   -- draft | in_transit | completed | cancelled
  notes NVARCHAR(500),
  created_by INT, created_at, completed_at

stock_transfer_lines
  id, transfer_id, product_id,
  qty DECIMAL(18,4), uom_id,
  qty_received DECIMAL(18,4),   -- for partial receives
  notes NVARCHAR(500)
```

### 4.4 Goods receipt / receiving
```sql
receiving_sessions
  id, org_id, warehouse_id, bin_id,
  supplier_id (contact_id),
  reference_no NVARCHAR(100),   -- supplier invoice / PO number
  status VARCHAR(20),           -- open | partial | complete | void
  notes NVARCHAR(500),
  created_by INT, created_at, completed_at

receiving_session_lines  (likely already exists — confirm columns)
  id, session_id, product_id,
  qty_expected DECIMAL(18,4),
  qty_received DECIMAL(18,4),
  unit_cost DECIMAL(18,4),
  notes NVARCHAR(500)
```

### 4.5 Picking & dispatch
```sql
picking_orders
  id, org_id, warehouse_id,
  document_id INT,              -- FK to sales document (Phase 5b)
  status VARCHAR(20),           -- draft | in_progress | completed | cancelled
  priority TINYINT,
  assigned_to INT,              -- user_id
  created_by INT, created_at, completed_at

picking_order_lines
  id, picking_order_id, product_id, bin_id,
  qty_requested DECIMAL(18,4),
  qty_picked DECIMAL(18,4)

dispatch_orders
  id, org_id, warehouse_id, picking_order_id,
  contact_id INT,
  carrier NVARCHAR(100),
  tracking_no NVARCHAR(100),
  status VARCHAR(20),           -- pending | dispatched | delivered
  dispatched_at, created_by, created_at
```

### 4.6 Inventory counts (stocktake)
```sql
inventory_counts
  id, org_id, warehouse_id,
  status VARCHAR(20),           -- draft | in_progress | completed | void
  count_type VARCHAR(20),       -- full | cycle | spot
  reference NVARCHAR(100),
  created_by INT, created_at, completed_at

inventory_count_lines
  id, count_id, product_id, bin_id,
  qty_system DECIMAL(18,4),     -- snapshot at count start
  qty_counted DECIMAL(18,4),
  variance DECIMAL(18,4),       -- computed: qty_counted - qty_system
  notes NVARCHAR(500),
  counted_by INT, counted_at
```

### 4.7 BOM & Bundles
```sql
-- Bill of Materials (production)
bom_headers
  id, org_id, product_id,       -- finished good
  version INT, is_default BIT, is_active BIT,
  notes NVARCHAR(500), created_by INT, created_at

bom_lines
  id, bom_id, component_product_id,
  qty DECIMAL(18,4), uom_id,
  scrap_pct DECIMAL(5,2),       -- wastage allowance
  notes NVARCHAR(500)

-- Bundles (sale bundles + service kits — same table, type from parent product)
bundle_lines
  id, bundle_product_id,        -- parent product with type='sale_bundle' or 'service_bundle'
  component_product_id,
  qty DECIMAL(18,4), uom_id,
  notes NVARCHAR(500),
  sort_order INT
```

### 4.8 Service orders
```sql
-- Asset / Equipment register
assets
  id, org_id, contact_id,       -- owner (customer)
  asset_code NVARCHAR(50),
  name NVARCHAR(200),
  model NVARCHAR(200),
  serial_no NVARCHAR(100),
  purchase_date DATE,
  notes NVARCHAR(500),
  is_active BIT, created_at, updated_at

-- Service orders (job cards)
service_orders
  id, org_id,
  asset_id INT,                 -- the machine being serviced
  contact_id INT,               -- customer
  service_bundle_id INT,        -- FK to bundle product (template applied, nullable)
  reference_no NVARCHAR(50),    -- job number
  status VARCHAR(20),           -- draft | scheduled | in_progress | completed | invoiced | void
  assigned_to INT,              -- technician (user_id)
  scheduled_at DATETIME,
  started_at DATETIME,
  completed_at DATETIME,
  notes NVARCHAR(500),
  created_by INT, created_at, updated_at

service_order_lines
  id, service_order_id, product_id,
  line_type VARCHAR(20),        -- labour | fee | material
  description NVARCHAR(500),
  qty DECIMAL(18,4), unit_price DECIMAL(18,4),
  actual_qty DECIMAL(18,4),     -- what was actually used (may differ from estimated)
  notes NVARCHAR(500),
  sort_order INT
```

**How service bundles work on a service order:**
When a service bundle is applied, its `bundle_lines` are copied into `service_order_lines`.
The tech can freely edit those lines before completing. On completion, only lines with
`line_type = 'material'` write rows to `stock_movements`. Labour and fee lines go to billing.

### 4.9 Production orders
```sql
production_orders
  id, org_id, warehouse_id,
  product_id INT,               -- finished good being produced
  bom_id INT,                   -- which BOM version was used
  qty_planned DECIMAL(18,4),
  qty_produced DECIMAL(18,4),
  status VARCHAR(20),           -- draft | in_progress | completed | void
  scheduled_at DATETIME,
  completed_at DATETIME,
  notes NVARCHAR(500),
  created_by INT, created_at

production_order_lines
  id, production_order_id, component_product_id,
  qty_required DECIMAL(18,4),   -- from BOM × qty_planned
  qty_consumed DECIMAL(18,4),   -- actual (may differ due to wastage)
  uom_id INT, notes NVARCHAR(500)
```

On completion: `production_order_lines` write `production_consume` movements (negative),
the finished good writes a `production_output` movement (positive).

---

## 5. API Endpoints to Build

### Phase 1 — `routes/warehouse.js`
```
GET    /api/warehouse/zones?warehouse_id=
POST   /api/warehouse/zones
PATCH  /api/warehouse/zones/:id
DELETE /api/warehouse/zones/:id   (soft — set is_active=0)

GET    /api/warehouse/bins?zone_id=&warehouse_id=
POST   /api/warehouse/bins
PATCH  /api/warehouse/bins/:id
DELETE /api/warehouse/bins/:id
GET    /api/warehouse/bins/:id/stock
```

### Phase 2 — add to `routes/warehouse.js`
```
GET    /api/warehouse/stock?warehouse_id=&product_id=&bin_id=
GET    /api/warehouse/stock/movements?product_id=&warehouse_id=&movement_type=&search=&from_date=&to_date=&page=&limit=
POST   /api/warehouse/stock/adjust
```

### Phase 2.5 — add to `routes/warehouse.js` + `routes/settings.js`
```
GET    /api/warehouse/reports/stock-value?warehouse_id=&search=
GET    /api/warehouse/reports/by-location?warehouse_id=
GET    /api/warehouse/reports/inventory-levels?search=&category_id=&warehouse_id=&zone_id=&supplier_id=&committed_only=&on_order_only=&low_stock=
GET    /api/settings/chart-of-accounts?type=
GET    /api/products/:id/history?page=&limit=
```

### Phase 3 — add to `routes/warehouse.js`
```
POST   /api/warehouse/transfers
GET    /api/warehouse/transfers?status=
GET    /api/warehouse/transfers/:id
PATCH  /api/warehouse/transfers/:id/dispatch
PATCH  /api/warehouse/transfers/:id/receive
PATCH  /api/warehouse/transfers/:id/cancel
```

### Phase 4 — `routes/receiving.js`
```
POST   /api/receiving
GET    /api/receiving?status=&supplier_id=
GET    /api/receiving/:id
PATCH  /api/receiving/:id/receive-line
PATCH  /api/receiving/:id/complete
PATCH  /api/receiving/:id/void
```

### Phase 5 — `routes/picking.js`
```
POST   /api/picking
GET    /api/picking?status=&warehouse_id=
GET    /api/picking/:id
PATCH  /api/picking/:id/lines/:lineId
PATCH  /api/picking/:id/complete
POST   /api/dispatch
PATCH  /api/dispatch/:id/dispatch
```

### Phase 6 — `routes/inventory-counts.js`
```
POST   /api/inventory-counts
GET    /api/inventory-counts?status=
GET    /api/inventory-counts/:id
PATCH  /api/inventory-counts/:id/start
PATCH  /api/inventory-counts/:id/lines/:lineId
PATCH  /api/inventory-counts/:id/complete
PATCH  /api/inventory-counts/:id/void
```

### Phase 7 (future) — `routes/service-orders.js`
```
POST   /api/service-orders
GET    /api/service-orders?status=&contact_id=&asset_id=
GET    /api/service-orders/:id
PATCH  /api/service-orders/:id
PATCH  /api/service-orders/:id/apply-bundle
PATCH  /api/service-orders/:id/complete
PATCH  /api/service-orders/:id/void

GET    /api/assets
POST   /api/assets
GET    /api/assets/:id
PATCH  /api/assets/:id
GET    /api/assets/:id/service-history
```

### Phase 8 (future) — `routes/production-orders.js`
```
POST   /api/production-orders
GET    /api/production-orders?status=
GET    /api/production-orders/:id
PATCH  /api/production-orders/:id
PATCH  /api/production-orders/:id/start
PATCH  /api/production-orders/:id/complete
PATCH  /api/production-orders/:id/void

GET    /api/bom?product_id=
POST   /api/bom
GET    /api/bom/:id
PATCH  /api/bom/:id
```

### Phase 9 — Bundle & product type management (wired into products module)
```
GET    /api/products/:id/bundle-lines
POST   /api/products/:id/bundle-lines
PATCH  /api/products/:id/bundle-lines/:lineId
DELETE /api/products/:id/bundle-lines/:lineId
```

---

## 6. Frontend Pages to Build

### Phase 1 — Warehouse location tree
`pages/warehouse/WarehousePage.jsx`
- Left panel: warehouse list → expand to zones → expand to bins
- Right panel: detail of selected warehouse / zone / bin
- Inline create/edit for zones and bins
- Summary cards: bin count, zone types, total capacity

### Phase 2 — Stock overview & adjustments ✅
`pages/products/StockTab.jsx` — per-product stock overview with warehouse breakdown, FIFO-aware adjust modal, last 10 movements, View All link
`pages/warehouse/MovementsReportPage.jsx` — full movement report at `/movements`, all filters, paginated, clickable detail modal

### Phase 2.5 — Reports & inventory levels ✅
`pages/warehouse/InventoryLevelsPage.jsx` — inventory levels at `/inventory`, no cost data, rich filters + LOW badge
`pages/warehouse/StockReportsPage.jsx` — FIFO stock value + by-location reports at `/warehouse/reports`
`pages/products/ProductHistoryTab.jsx` — product field-change audit timeline on product detail page

### Phase 3 — Transfers
`pages/warehouse/TransfersPage.jsx`
- Tab strip: Draft / In Transit / Completed / Cancelled
- Create transfer: from/to warehouse + bin pickers, product line items
- Transfer detail page: dispatch action → receive action flow

### Phase 4 — Receiving
`pages/warehouse/ReceivingPage.jsx`
- Queue of open sessions
- Create session: supplier, warehouse, reference
- Session detail: product lines with expected/received qty input
- Complete button — validates all lines, writes movements

### Phase 5 — Picking & dispatch
`pages/warehouse/PickingPage.jsx`
- Queue with priority sort, filter by warehouse
- Pick screen: line list → enter picked qty per line → complete
`pages/warehouse/DispatchPage.jsx`
- Create dispatch from completed pick
- Carrier, tracking number, confirm dispatch

### Phase 6 — Inventory count
`pages/warehouse/InventoryCountsPage.jsx`
- Count list with status filter
- Create count: choose warehouse, filter by zone/bin for cycle counts
- Count entry screen: line by line with live variance highlighting
- Variance summary before finalising
- Audit trail written on completion

### Phase 7 — Service orders
`pages/service/ServiceOrdersPage.jsx`
- Job card list with status tabs
- Create job: customer, asset, assign tech, apply service bundle
- Job detail: editable lines (add/remove labour/materials/fees)
- Complete flow: confirm actual materials, write movements
`pages/service/AssetsPage.jsx`
- Asset register (customer's machines)
- Asset detail with full service history

### Phase 8 — Production orders
`pages/production/ProductionOrdersPage.jsx`
- Order list with status
- Create order: product, BOM version, qty, warehouse
- BOM pre-populates component lines (editable)
- Complete: record actual qty consumed, write movements

### Phase 9 — BOM & Bundle editor (in product detail)
- New tab on product detail page: "Bill of Materials" (for physical/raw_material type)
- New tab: "Bundle Lines" (for sale_bundle and service_bundle types)
- Inline add/remove/reorder component lines

---

## 7. Phase Dependencies

```
Phase 1: Zones & Bins               ← no dependencies
Phase 2: Stock Levels & History     ← needs Phase 1 (bin_id)
Phase 3: Transfers                  ← needs Phase 2
Phase 4: Receiving                  ← needs Phase 2
Phase 5: Picking & Dispatch         ← needs Phase 2, benefits from Phase 4
Phase 6: Inventory Count            ← needs Phase 2
Phase 7: Service Orders             ← needs Phase 2 (for material movements)
Phase 8: Production Orders          ← needs Phase 2 (for BOM consumption)
Phase 9: Bundle & BOM editor        ← needs product_type on products table
```

Phases 3, 4, 6, 7, 8, 9 are all independent of each other once Phase 2 is done.

---

## 8. Permissions

Existing `inventory` and `warehouses` permission resources already in migrations:
- `warehouses`: admin = full CRUD, warehouse_team = read/write
- `inventory`: admin = full CRUD, editor = read/write, viewer = read

Service orders and production orders will need their own permission resources added to the
`migrate-permissions.js` script:
- `service_orders`: admin/editor = full, viewer = read
- `production_orders`: admin/editor = full, viewer = read
- `assets`: admin/editor = full, viewer = read
- `bom`: admin/editor = full, viewer = read

---

## 9. Important Business Rules

1. **No double-counting on sale bundles** — `document_lines` stores the bundle as a single line.
   An `exploded_lines` child table stores component lines. Sales revenue reports JOIN on
   `document_lines` only. Stock movements are written from `exploded_lines`.

2. **Service bundles are templates, not contracts** — when applied to a service order, lines are
   copied and become editable. The service order records what was *actually* done, not what the
   kit said.

3. **Stock availability check for bundles** — "Can I sell Bundle A1 × 5?" checks each component
   independently (`qty_available >= qty_requested` for every line). The bundle itself has no
   stock level row.

4. **Service materials vs labour** — only `line_type = 'material'` lines on a service order
   write stock movements. Labour and fee lines go straight to billing.

5. **BOMs are versioned** — a production order records which BOM version was used at the time.
   Changing the BOM later does not retroactively alter completed orders.

6. **Dealer portal buffer** — warehouses with `dealer_visible = true` expose stock as
   `qty_available - dealer_buffer_qty` to dealer-facing endpoints. Column already exists on
   `warehouses` table.

7. **Soft deletes everywhere** — no hard deletes on any document or stock table. Status = void
   with a reversing movement written to `stock_movements` if needed.

---

## 10. First Steps When Resuming

1. Run `server/scripts/inspect-schema.js` (or write a quick one-off) against the live DB to
   confirm exact columns on: `warehouse_zones`, `warehouse_bins`, `stock_levels`,
   `stock_movements`, `receiving_session_lines`.
2. Write a migration script to add any missing columns (especially `bin_id` on `stock_levels`,
   `movement_type` / `reference_type` / `reference_id` on `stock_movements`).
3. Build Phase 1: zones/bins API (`routes/warehouse.js`) + frontend location tree.
4. Then proceed through phases in order.
