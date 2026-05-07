'use strict';
// ============================================================
// routes/warehouse.js
//
// Phase 1 — Location master data
// GET    /api/warehouse/zones?warehouse_id=
// POST   /api/warehouse/zones
// PATCH  /api/warehouse/zones/:id
// DELETE /api/warehouse/zones/:id
//
// GET    /api/warehouse/bins?zone_id=|warehouse_id=
// POST   /api/warehouse/bins
// PATCH  /api/warehouse/bins/:id
// DELETE /api/warehouse/bins/:id
//
// Phase 2 — Stock levels & movements
// GET    /api/warehouse/stock?product_id=&warehouse_id=
// GET    /api/warehouse/stock/movements?product_id=&warehouse_id=&movement_type=&page=&limit=
// POST   /api/warehouse/stock/adjust
//
// Phase 3 — FIFO valuation + reports
// GET    /api/warehouse/reports/stock-value
// GET    /api/warehouse/reports/by-location
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth }            = require('../middleware/auth');
const { requirePermission }      = require('../middleware/permissions');
const { asyncHandler }           = require('../middleware/errorHandler');

router.use(requireAuth);

const ZONE_TYPES = ['standard', 'pick', 'bulk', 'receive', 'dispatch', 'quarantine'];
const BIN_TYPES  = ['standard', 'oversize', 'hazmat', 'cold', 'quarantine'];

// ── Helpers ───────────────────────────────────────────────────

async function assertWarehouseOwned(pool, warehouseId, orgId) {
  const r = await pool.request()
    .input('id',     sql.Int, warehouseId)
    .input('org_id', sql.Int, orgId)
    .query('SELECT id FROM warehouses WHERE id = @id AND org_id = @org_id AND is_void = 0');
  return r.recordset.length > 0;
}

// ── Zones ─────────────────────────────────────────────────────

router.get('/zones', requirePermission('warehouses', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const warehouseId = parseInt(req.query.warehouse_id);
  if (isNaN(warehouseId)) return res.status(400).json({ success: false, error: 'warehouse_id required.' });

  const rows = await pool.request()
    .input('org_id',       sql.Int, req.user.orgId)
    .input('warehouse_id', sql.Int, warehouseId)
    .query(`
      SELECT
        wz.id, wz.warehouse_id, wz.code, wz.name,
        wz.zone_type, wz.pick_sequence, wz.is_active,
        COUNT(wb.id) AS bin_count
      FROM warehouse_zones wz
      LEFT JOIN warehouse_bins wb ON wb.zone_id = wz.id AND wb.is_active = 1
      WHERE wz.org_id = @org_id AND wz.warehouse_id = @warehouse_id
      GROUP BY wz.id, wz.warehouse_id, wz.code, wz.name, wz.zone_type, wz.pick_sequence, wz.is_active
      ORDER BY wz.pick_sequence ASC, wz.code ASC
    `);

  return res.json({ success: true, data: rows.recordset });
}));

router.post('/zones', requirePermission('warehouses', 'write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { warehouse_id, code, name, zone_type = 'standard', pick_sequence = 0 } = req.body;

  if (!warehouse_id || !code || !name) {
    return res.status(400).json({ success: false, error: 'warehouse_id, code and name are required.' });
  }
  if (!ZONE_TYPES.includes(zone_type)) {
    return res.status(400).json({ success: false, error: `zone_type must be one of: ${ZONE_TYPES.join(', ')}` });
  }

  if (!(await assertWarehouseOwned(pool, warehouse_id, req.user.orgId))) {
    return res.status(404).json({ success: false, error: 'Warehouse not found.' });
  }

  const result = await pool.request()
    .input('org_id',        sql.Int,          req.user.orgId)
    .input('warehouse_id',  sql.Int,          warehouse_id)
    .input('code',          sql.VarChar(20),  code.toUpperCase().trim())
    .input('name',          sql.NVarChar(100), name.trim())
    .input('zone_type',     sql.VarChar(20),  zone_type)
    .input('pick_sequence', sql.Int,          parseInt(pick_sequence) || 0)
    .query(`
      INSERT INTO warehouse_zones
        (org_id, warehouse_id, code, name, zone_type, pick_sequence, is_active, created_at, updated_at)
      OUTPUT INSERTED.id
      VALUES
        (@org_id, @warehouse_id, @code, @name, @zone_type, @pick_sequence, 1, GETDATE(), GETDATE())
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id } });
}));

router.patch('/zones/:id', requirePermission('warehouses', 'write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id.' });

  const { name, zone_type, pick_sequence, is_active } = req.body;

  if (zone_type && !ZONE_TYPES.includes(zone_type)) {
    return res.status(400).json({ success: false, error: `zone_type must be one of: ${ZONE_TYPES.join(', ')}` });
  }

  await pool.request()
    .input('id',            sql.Int,           id)
    .input('org_id',        sql.Int,           req.user.orgId)
    .input('name',          sql.NVarChar(100), name          || null)
    .input('zone_type',     sql.VarChar(20),   zone_type     || null)
    .input('pick_sequence', sql.Int,           pick_sequence != null ? parseInt(pick_sequence) : null)
    .input('is_active',     sql.Bit,           is_active     != null ? (is_active ? 1 : 0)    : null)
    .query(`
      UPDATE warehouse_zones SET
        name          = COALESCE(@name,          name),
        zone_type     = COALESCE(@zone_type,     zone_type),
        pick_sequence = COALESCE(@pick_sequence, pick_sequence),
        is_active     = COALESCE(@is_active,     is_active),
        updated_at    = GETDATE()
      WHERE id = @id AND org_id = @org_id
    `);

  return res.json({ success: true, message: 'Zone updated.' });
}));

router.delete('/zones/:id', requirePermission('warehouses', 'write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id.' });

  const activeBins = await pool.request()
    .input('zone_id', sql.Int, id)
    .query('SELECT COUNT(*) AS n FROM warehouse_bins WHERE zone_id = @zone_id AND is_active = 1');
  if (activeBins.recordset[0].n > 0) {
    return res.status(409).json({
      success: false,
      error: 'Cannot deactivate a zone that has active bins. Deactivate its bins first.',
    });
  }

  await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, req.user.orgId)
    .query('UPDATE warehouse_zones SET is_active = 0, updated_at = GETDATE() WHERE id = @id AND org_id = @org_id');

  return res.json({ success: true, message: 'Zone deactivated.' });
}));

// ── Bins ──────────────────────────────────────────────────────

router.get('/bins', requirePermission('warehouses', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const zoneId      = req.query.zone_id      ? parseInt(req.query.zone_id)      : null;
  const warehouseId = req.query.warehouse_id ? parseInt(req.query.warehouse_id) : null;

  if (!zoneId && !warehouseId) {
    return res.status(400).json({ success: false, error: 'zone_id or warehouse_id required.' });
  }

  const request = pool.request().input('org_id', sql.Int, req.user.orgId);
  let filter = 'wb.org_id = @org_id';
  if (zoneId)      { request.input('zone_id',      sql.Int, zoneId);      filter += ' AND wb.zone_id      = @zone_id'; }
  if (warehouseId) { request.input('warehouse_id', sql.Int, warehouseId); filter += ' AND wb.warehouse_id = @warehouse_id'; }

  const rows = await request.query(`
    SELECT
      wb.id, wb.warehouse_id, wb.zone_id, wb.bin_code, wb.barcode,
      wb.bin_type, wb.max_weight_kg, wb.max_volume_m3, wb.max_units,
      wb.pick_sequence, wb.dedicated_product_id,
      wb.is_active, wb.is_locked, wb.lock_reason, wb.notes,
      wz.name AS zone_name,
      p.name  AS dedicated_product_name
    FROM warehouse_bins wb
    LEFT JOIN warehouse_zones wz ON wz.id = wb.zone_id
    LEFT JOIN products p          ON p.id  = wb.dedicated_product_id
    WHERE ${filter}
    ORDER BY wb.pick_sequence ASC, wb.bin_code ASC
  `);

  return res.json({ success: true, data: rows.recordset });
}));

router.post('/bins', requirePermission('warehouses', 'write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const {
    warehouse_id, zone_id, bin_code, barcode,
    bin_type = 'standard', max_weight_kg, max_volume_m3,
    max_units, pick_sequence = 0, notes,
  } = req.body;

  if (!warehouse_id || !bin_code) {
    return res.status(400).json({ success: false, error: 'warehouse_id and bin_code are required.' });
  }
  if (!BIN_TYPES.includes(bin_type)) {
    return res.status(400).json({ success: false, error: `bin_type must be one of: ${BIN_TYPES.join(', ')}` });
  }

  if (!(await assertWarehouseOwned(pool, warehouse_id, req.user.orgId))) {
    return res.status(404).json({ success: false, error: 'Warehouse not found.' });
  }

  const result = await pool.request()
    .input('org_id',        sql.Int,           req.user.orgId)
    .input('warehouse_id',  sql.Int,           warehouse_id)
    .input('zone_id',       sql.Int,           zone_id       || null)
    .input('bin_code',      sql.VarChar(50),   bin_code.toUpperCase().trim())
    .input('barcode',       sql.VarChar(100),  barcode       || null)
    .input('bin_type',      sql.VarChar(20),   bin_type)
    .input('max_weight_kg', sql.Decimal(10,2), max_weight_kg ? parseFloat(max_weight_kg) : null)
    .input('max_volume_m3', sql.Decimal(10,2), max_volume_m3 ? parseFloat(max_volume_m3) : null)
    .input('max_units',     sql.Int,           max_units     ? parseInt(max_units)        : null)
    .input('pick_sequence', sql.Int,           parseInt(pick_sequence) || 0)
    .input('notes',         sql.NVarChar(500), notes || null)
    .query(`
      INSERT INTO warehouse_bins
        (org_id, warehouse_id, zone_id, bin_code, barcode, bin_type,
         max_weight_kg, max_volume_m3, max_units, pick_sequence,
         is_active, is_locked, notes, created_at, updated_at)
      OUTPUT INSERTED.id
      VALUES
        (@org_id, @warehouse_id, @zone_id, @bin_code, @barcode, @bin_type,
         @max_weight_kg, @max_volume_m3, @max_units, @pick_sequence,
         1, 0, @notes, GETDATE(), GETDATE())
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id } });
}));

router.patch('/bins/:id', requirePermission('warehouses', 'write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id.' });

  const {
    zone_id, bin_type, barcode,
    max_weight_kg, max_volume_m3, max_units,
    pick_sequence, notes, is_active, is_locked, lock_reason,
  } = req.body;

  if (bin_type && !BIN_TYPES.includes(bin_type)) {
    return res.status(400).json({ success: false, error: `bin_type must be one of: ${BIN_TYPES.join(', ')}` });
  }

  await pool.request()
    .input('id',            sql.Int,           id)
    .input('org_id',        sql.Int,           req.user.orgId)
    .input('bin_type',      sql.VarChar(20),   bin_type      || null)
    .input('barcode',       sql.VarChar(100),  barcode       || null)
    .input('max_weight_kg', sql.Decimal(10,2), max_weight_kg != null ? parseFloat(max_weight_kg) : null)
    .input('max_volume_m3', sql.Decimal(10,2), max_volume_m3 != null ? parseFloat(max_volume_m3) : null)
    .input('max_units',     sql.Int,           max_units     != null ? parseInt(max_units)        : null)
    .input('pick_sequence', sql.Int,           pick_sequence != null ? parseInt(pick_sequence)    : null)
    .input('notes',         sql.NVarChar(500), notes         || null)
    .input('is_active',     sql.Bit,           is_active     != null ? (is_active  ? 1 : 0) : null)
    .input('is_locked',     sql.Bit,           is_locked     != null ? (is_locked  ? 1 : 0) : null)
    .input('lock_reason',   sql.NVarChar(200), lock_reason   || null)
    .query(`
      UPDATE warehouse_bins SET
        bin_type      = COALESCE(@bin_type,      bin_type),
        barcode       = COALESCE(@barcode,       barcode),
        max_weight_kg = COALESCE(@max_weight_kg, max_weight_kg),
        max_volume_m3 = COALESCE(@max_volume_m3, max_volume_m3),
        max_units     = COALESCE(@max_units,     max_units),
        pick_sequence = COALESCE(@pick_sequence, pick_sequence),
        notes         = COALESCE(@notes,         notes),
        is_active     = COALESCE(@is_active,     is_active),
        is_locked     = COALESCE(@is_locked,     is_locked),
        lock_reason   = COALESCE(@lock_reason,   lock_reason),
        updated_at    = GETDATE()
      WHERE id = @id AND org_id = @org_id
    `);

  return res.json({ success: true, message: 'Bin updated.' });
}));

router.delete('/bins/:id', requirePermission('warehouses', 'write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id.' });

  const stock = await pool.request()
    .input('bin_id', sql.Int, id)
    .query('SELECT COUNT(*) AS n FROM stock_levels WHERE bin_id = @bin_id AND qty_on_hand > 0');
  if (stock.recordset[0].n > 0) {
    return res.status(409).json({
      success: false,
      error: 'Cannot deactivate a bin that holds stock. Transfer stock out first.',
    });
  }

  await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, req.user.orgId)
    .query('UPDATE warehouse_bins SET is_active = 0, updated_at = GETDATE() WHERE id = @id AND org_id = @org_id');

  return res.json({ success: true, message: 'Bin deactivated.' });
}));

// ── Phase 2: Stock levels ─────────────────────────────────────

// GET /api/warehouse/stock?product_id=&warehouse_id=
router.get('/stock', requirePermission('inventory', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const productId   = req.query.product_id   ? parseInt(req.query.product_id)   : null;
  const warehouseId = req.query.warehouse_id ? parseInt(req.query.warehouse_id) : null;

  if (!productId && !warehouseId) {
    return res.status(400).json({ success: false, error: 'product_id or warehouse_id required.' });
  }

  const request = pool.request().input('org_id', sql.Int, req.user.orgId);
  let filter = 'sl.org_id = @org_id';
  if (productId)   { request.input('product_id',   sql.Int, productId);   filter += ' AND sl.product_id   = @product_id'; }
  if (warehouseId) { request.input('warehouse_id', sql.Int, warehouseId); filter += ' AND sl.warehouse_id = @warehouse_id'; }

  const rows = await request.query(`
    SELECT
      sl.id, sl.product_id, sl.warehouse_id, sl.bin_id,
      sl.qty_on_hand, sl.qty_reserved, sl.qty_on_order,
      sl.qty_on_hand - sl.qty_reserved AS qty_available,
      sl.updated_at,
      w.name AS warehouse_name, w.code AS warehouse_code,
      wb.bin_code,
      p.name AS product_name, p.product_code
    FROM stock_levels sl
    INNER JOIN warehouses w ON w.id = sl.warehouse_id
    LEFT JOIN warehouse_bins wb ON wb.id = sl.bin_id
    LEFT JOIN products p        ON p.id  = sl.product_id
    WHERE ${filter}
    ORDER BY w.name ASC, wb.bin_code ASC
  `);

  return res.json({ success: true, data: rows.recordset });
}));

// GET /api/warehouse/stock/movements?product_id=&warehouse_id=&movement_type=&search=&from_date=&to_date=&page=&limit=
router.get('/stock/movements', requirePermission('inventory', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const productId    = req.query.product_id    ? parseInt(req.query.product_id)    : null;
  const warehouseId  = req.query.warehouse_id  ? parseInt(req.query.warehouse_id)  : null;
  const movementType = req.query.movement_type || null;
  const search       = req.query.search        || null;
  const fromDate     = req.query.from_date     || null;
  const toDate       = req.query.to_date       || null;
  const page         = Math.max(1, parseInt(req.query.page)  || 1);
  const limit        = Math.min(200, parseInt(req.query.limit) || 25);
  const offset       = (page - 1) * limit;

  const request = pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .input('limit',  sql.Int, limit)
    .input('offset', sql.Int, offset);

  let filter = 'sm.org_id = @org_id';
  if (productId)    { request.input('product_id',    sql.Int,          productId);              filter += ' AND sm.product_id    = @product_id'; }
  if (warehouseId)  { request.input('warehouse_id',  sql.Int,          warehouseId);            filter += ' AND sm.warehouse_id  = @warehouse_id'; }
  if (movementType) { request.input('movement_type', sql.VarChar(30),  movementType);           filter += ' AND sm.movement_type = @movement_type'; }
  if (search)       { request.input('search',        sql.NVarChar(200), `%${search}%`);         filter += ' AND (p.name LIKE @search OR p.product_code LIKE @search)'; }
  if (fromDate)     { request.input('from_date',     sql.DateTime,      new Date(fromDate));     filter += ' AND sm.moved_at >= @from_date'; }
  if (toDate)       { request.input('to_date',       sql.DateTime,      new Date(toDate + 'T23:59:59')); filter += ' AND sm.moved_at <= @to_date'; }

  const countReq = pool.request().input('org_id', sql.Int, req.user.orgId);
  if (productId)    countReq.input('product_id',    sql.Int,          productId);
  if (warehouseId)  countReq.input('warehouse_id',  sql.Int,          warehouseId);
  if (movementType) countReq.input('movement_type', sql.VarChar(30),  movementType);
  if (search)       countReq.input('search',        sql.NVarChar(200), `%${search}%`);
  if (fromDate)     countReq.input('from_date',     sql.DateTime,      new Date(fromDate));
  if (toDate)       countReq.input('to_date',       sql.DateTime,      new Date(toDate + 'T23:59:59'));

  const [rows, countRow] = await Promise.all([
    request.query(`
      SELECT
        sm.id, sm.movement_type, sm.qty, sm.unit_cost,
        sm.warehouse_id,      w.name  AS warehouse_name,  w.code  AS warehouse_code,
        sm.from_warehouse_id, wf.name AS from_warehouse_name,
        sm.bin_id,            wb.bin_code,
        sm.reference_type, sm.reference_id,
        sm.notes, sm.moved_at,
        u.full_name AS moved_by_name,
        p.name AS product_name, p.product_code
      FROM stock_movements sm
      LEFT JOIN warehouses w      ON w.id  = sm.warehouse_id
      LEFT JOIN warehouses wf     ON wf.id = sm.from_warehouse_id
      LEFT JOIN warehouse_bins wb ON wb.id = sm.bin_id
      LEFT JOIN users u           ON u.id  = sm.moved_by
      LEFT JOIN products p        ON p.id  = sm.product_id
      WHERE ${filter}
      ORDER BY sm.moved_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `),
    countReq.query(`SELECT COUNT(*) AS n FROM stock_movements sm WHERE ${filter}`),
  ]);

  const total = countRow.recordset[0].n;
  return res.json({
    success: true,
    data: rows.recordset,
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}));

// POST /api/warehouse/stock/adjust
router.post('/stock/adjust', requirePermission('inventory', 'write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { product_id, warehouse_id, bin_id, adjust_type, qty, unit_cost, reason, notes } = req.body;

  if (!product_id || !warehouse_id || !adjust_type || qty == null) {
    return res.status(400).json({ success: false, error: 'product_id, warehouse_id, adjust_type and qty are required.' });
  }
  if (!['add', 'remove', 'set'].includes(adjust_type)) {
    return res.status(400).json({ success: false, error: 'adjust_type must be add, remove or set.' });
  }
  const qtyNum = parseFloat(qty);
  if (isNaN(qtyNum) || qtyNum < 0) {
    return res.status(400).json({ success: false, error: 'qty must be a non-negative number.' });
  }
  if (!reason?.trim()) {
    return res.status(400).json({ success: false, error: 'reason is required for stock adjustments.' });
  }

  const wh = await pool.request()
    .input('id',     sql.Int, warehouse_id)
    .input('org_id', sql.Int, req.user.orgId)
    .query('SELECT id FROM warehouses WHERE id = @id AND org_id = @org_id AND is_void = 0');
  if (!wh.recordset.length) return res.status(404).json({ success: false, error: 'Warehouse not found.' });

  const current = await pool.request()
    .input('product_id',   sql.Int, product_id)
    .input('warehouse_id', sql.Int, warehouse_id)
    .input('org_id',       sql.Int, req.user.orgId)
    .query('SELECT qty_on_hand FROM stock_levels WHERE product_id=@product_id AND warehouse_id=@warehouse_id AND org_id=@org_id');

  const currentQty = parseFloat(current.recordset[0]?.qty_on_hand ?? 0);

  let delta;
  if (adjust_type === 'add')    delta = qtyNum;
  if (adjust_type === 'remove') delta = -qtyNum;
  if (adjust_type === 'set')    delta = qtyNum - currentQty;

  const newQty = currentQty + delta;
  if (newQty < 0) {
    return res.status(400).json({ success: false, error: `Cannot remove ${qtyNum} — only ${currentQty} on hand.` });
  }

  const fullNotes = `[${adjust_type.toUpperCase()}] Reason: ${reason.trim()}${notes ? ` — ${notes.trim()}` : ''}`;
  const orgId     = req.user.orgId;
  const userId    = req.user.userId;

  let movUnitCost  = 0;
  let movTotalCost = 0;
  let fifoLayerId  = null;

  // ── FIFO: positive delta → create a cost layer ───────────────
  if (delta > 0) {
    const costPerUnit = parseFloat(unit_cost) || 0;
    const total       = costPerUnit * delta;

    const layerRes = await pool.request()
      .input('org_id',              sql.Int,          orgId)
      .input('product_id',          sql.Int,          product_id)
      .input('warehouse_id',        sql.Int,          warehouse_id)
      .input('qty_received',        sql.Decimal(18,4), delta)
      .input('unit_cost',           sql.Decimal(18,4), costPerUnit)
      .input('total_cost_received', sql.Decimal(18,4), total)
      .query(`
        INSERT INTO fifo_cost_layers
          (org_id, product_id, warehouse_id, receipt_date, reference_type,
           qty_received, qty_remaining, qty_consumed,
           unit_cost, unit_cost_landed,
           total_cost_received, total_cost_remaining,
           currency_code, exchange_rate,
           is_fully_consumed, is_active, created_at)
        OUTPUT INSERTED.id
        VALUES
          (@org_id, @product_id, @warehouse_id, GETDATE(), 'adjustment',
           @qty_received, @qty_received, 0,
           @unit_cost, @unit_cost,
           @total_cost_received, @total_cost_received,
           'AUD', 1,
           0, 1, GETDATE())
      `);

    fifoLayerId  = layerRes.recordset[0].id;
    movUnitCost  = costPerUnit;
    movTotalCost = total;
  }

  // ── FIFO: negative delta → consume oldest layers ─────────────
  let consumptionLogId = null;
  if (delta < 0) {
    const absDelta = Math.abs(delta);
    const layers = await pool.request()
      .input('org_id',       sql.Int, orgId)
      .input('product_id',   sql.Int, product_id)
      .input('warehouse_id', sql.Int, warehouse_id)
      .query(`
        SELECT id, qty_remaining, unit_cost
        FROM fifo_cost_layers
        WHERE org_id=@org_id AND product_id=@product_id AND warehouse_id=@warehouse_id
          AND is_fully_consumed=0 AND is_active=1
        ORDER BY receipt_date ASC, id ASC
      `);

    let remaining  = absDelta;
    let totalCost  = 0;
    let lastLogId  = null;

    for (const layer of layers.recordset) {
      if (remaining <= 0) break;
      const consume      = Math.min(remaining, parseFloat(layer.qty_remaining));
      const consumeCost  = consume * parseFloat(layer.unit_cost);
      totalCost         += consumeCost;
      remaining         -= consume;
      const newRemaining = parseFloat(layer.qty_remaining) - consume;

      const logRes = await pool.request()
        .input('fifo_layer_id',    sql.Int,          layer.id)
        .input('product_id',       sql.Int,          product_id)
        .input('warehouse_id',     sql.Int,          warehouse_id)
        .input('consumed_by_id',   sql.Int,          0)
        .input('qty_consumed',     sql.Decimal(18,4), consume)
        .input('unit_cost',        sql.Decimal(18,4), parseFloat(layer.unit_cost))
        .input('total_cost',       sql.Decimal(18,4), consumeCost)
        .input('consumed_by_user', sql.Int,           userId)
        .query(`
          INSERT INTO fifo_consumption_log
            (fifo_layer_id, product_id, warehouse_id,
             consumed_by_type, consumed_by_id,
             qty_consumed, unit_cost, total_cost,
             consumed_at, consumed_by_user)
          OUTPUT INSERTED.id
          VALUES
            (@fifo_layer_id, @product_id, @warehouse_id,
             'adjustment', @consumed_by_id,
             @qty_consumed, @unit_cost, @total_cost,
             GETDATE(), @consumed_by_user)
        `);

      lastLogId = logRes.recordset[0].id;

      await pool.request()
        .input('id',                  sql.Int,           layer.id)
        .input('qty_consume',         sql.Decimal(18,4), consume)
        .input('new_remaining',       sql.Decimal(18,4), newRemaining)
        .input('new_total_remaining', sql.Decimal(18,4), newRemaining * parseFloat(layer.unit_cost))
        .query(`
          UPDATE fifo_cost_layers SET
            qty_remaining        = @new_remaining,
            qty_consumed         = qty_consumed + @qty_consume,
            total_cost_remaining = @new_total_remaining,
            is_fully_consumed    = CASE WHEN @new_remaining <= 0 THEN 1 ELSE 0 END
          WHERE id = @id
        `);
    }

    movTotalCost      = totalCost;
    movUnitCost       = absDelta > 0 ? totalCost / absDelta : 0;
    consumptionLogId  = lastLogId;
  }

  // ── Write stock movement ──────────────────────────────────────
  await pool.request()
    .input('org_id',               sql.Int,           orgId)
    .input('product_id',           sql.Int,           product_id)
    .input('warehouse_id',         sql.Int,           warehouse_id)
    .input('bin_id',               sql.Int,           bin_id || null)
    .input('qty',                  sql.Decimal(18,4), delta)
    .input('unit_cost',            sql.Decimal(18,4), movUnitCost)
    .input('total_cost',           sql.Decimal(18,4), movTotalCost)
    .input('fifo_layer_id',        sql.Int,           fifoLayerId      || null)
    .input('fifo_consumption_log', sql.BigInt,        consumptionLogId || null)
    .input('moved_by',             sql.Int,           userId)
    .input('notes',                sql.NVarChar(500), fullNotes)
    .query(`
      INSERT INTO stock_movements
        (org_id, product_id, warehouse_id, bin_id,
         movement_type, qty, unit_cost, total_cost,
         fifo_layer_id, fifo_consumption_log_id,
         reference_type, moved_by, moved_at, notes)
      VALUES
        (@org_id, @product_id, @warehouse_id, @bin_id,
         'adjustment', @qty, @unit_cost, @total_cost,
         @fifo_layer_id, @fifo_consumption_log,
         'manual', @moved_by, GETDATE(), @notes)
    `);

  // ── Upsert stock_levels ───────────────────────────────────────
  await pool.request()
    .input('org_id',       sql.Int,           orgId)
    .input('product_id',   sql.Int,           product_id)
    .input('warehouse_id', sql.Int,           warehouse_id)
    .input('delta',        sql.Decimal(18,4), delta)
    .query(`
      IF EXISTS (SELECT 1 FROM stock_levels WHERE product_id=@product_id AND warehouse_id=@warehouse_id AND org_id=@org_id)
        UPDATE stock_levels
        SET qty_on_hand = qty_on_hand + @delta, updated_at = GETDATE()
        WHERE product_id=@product_id AND warehouse_id=@warehouse_id AND org_id=@org_id
      ELSE
        INSERT INTO stock_levels (org_id, product_id, warehouse_id, qty_on_hand, qty_reserved, qty_on_order, updated_at)
        VALUES (@org_id, @product_id, @warehouse_id, @delta, 0, 0, GETDATE())
    `);

  // Write audit log entry (best-effort)
  try {
    const productRow = await pool.request()
      .input('id', sql.Int, product_id)
      .query('SELECT product_code, name FROM products WHERE id=@id');
    const pCode = productRow.recordset[0]?.product_code || String(product_id);
    const pName = productRow.recordset[0]?.name         || '';
    const whRow  = await pool.request()
      .input('id', sql.Int, warehouse_id)
      .query('SELECT name FROM warehouses WHERE id=@id');
    const whName = whRow.recordset[0]?.name || String(warehouse_id);

    await pool.request()
      .input('org_id',      sql.Int,            orgId)
      .input('user_id',     sql.Int,            userId)
      .input('user_email',  sql.VarChar(200),   req.user.email)
      .input('user_name',   sql.NVarChar(200),  req.user.name)
      .input('action_type', sql.VarChar(60),    'inventory.adjust')
      .input('entity_type', sql.VarChar(60),    'product')
      .input('entity_id',   sql.BigInt,         product_id)
      .input('entity_ref',  sql.NVarChar(100),  pCode)
      .input('description', sql.NVarChar(1000),
        `Stock adjustment on ${pName} at ${whName}: ${delta > 0 ? '+' : ''}${delta} ${adjust_type} — ${reason}. ` +
        `Previous: ${currentQty}, New: ${newQty}.`)
      .query(`
        INSERT INTO audit_log
          (org_id,user_id,user_email,user_name,action_type,entity_type,entity_id,entity_ref,description,is_override,occurred_at)
        VALUES
          (@org_id,@user_id,@user_email,@user_name,@action_type,@entity_type,@entity_id,@entity_ref,@description,0,GETDATE())
      `);
  } catch { /* best-effort */ }

  return res.json({
    success: true,
    message: `Stock adjusted. New on-hand: ${newQty}.`,
    data: { previous_qty: currentQty, new_qty: newQty, delta, unit_cost: movUnitCost, total_cost: movTotalCost },
  });
}));

// ── Inventory levels report (no cost, rich filters) ──────────

// GET /api/warehouse/reports/inventory-levels
router.get('/reports/inventory-levels', requirePermission('inventory', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;

  const { search, category_id, warehouse_id, zone_id, supplier_id,
          committed_only, on_order_only, low_stock } = req.query;

  const request = pool.request().input('org_id', sql.Int, req.user.orgId);
  let filter = 'sl.org_id = @org_id AND sl.qty_on_hand > 0';

  if (warehouse_id)   { request.input('warehouse_id', sql.Int, parseInt(warehouse_id));  filter += ' AND sl.warehouse_id = @warehouse_id'; }
  if (category_id)    { request.input('category_id',  sql.Int, parseInt(category_id));   filter += ' AND p.category_id   = @category_id'; }
  if (supplier_id)    { request.input('supplier_id',  sql.Int, parseInt(supplier_id));   filter += ' AND p.preferred_supplier_id = @supplier_id'; }
  if (zone_id)        { request.input('zone_id',      sql.Int, parseInt(zone_id));       filter += ' AND wz.id = @zone_id'; }
  if (search)         { request.input('search',       sql.NVarChar(200), `%${search}%`); filter += ' AND (p.name LIKE @search OR p.product_code LIKE @search OR p.barcode LIKE @search)'; }
  if (committed_only === '1') filter += ' AND sl.qty_reserved > 0';
  if (on_order_only  === '1') filter += ' AND sl.qty_on_order > 0';
  if (low_stock      === '1') filter += ' AND p.min_stock_level > 0 AND (sl.qty_on_hand - sl.qty_reserved) < p.min_stock_level';

  const rows = await request.query(`
    SELECT
      sl.id               AS stock_id,
      sl.product_id,
      p.product_code,
      p.name              AS product_name,
      p.min_stock_level,
      p.max_stock_level,
      pc.name             AS category_name,
      sl.warehouse_id,
      w.code              AS warehouse_code,
      w.name              AS warehouse_name,
      sl.bin_id,
      wb.bin_code,
      wz.id               AS zone_id,
      wz.name             AS zone_name,
      sl.qty_on_hand,
      sl.qty_reserved,
      sl.qty_on_hand - sl.qty_reserved AS qty_available,
      sl.qty_on_order,
      uom.code            AS uom_code,
      uom.name            AS uom_name,
      sup.full_name       AS supplier_name,
      sl.updated_at
    FROM stock_levels sl
    INNER JOIN warehouses w        ON w.id  = sl.warehouse_id
    INNER JOIN products p          ON p.id  = sl.product_id
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    LEFT JOIN warehouse_bins wb    ON wb.id  = sl.bin_id
    LEFT JOIN warehouse_zones wz   ON wz.id  = wb.zone_id
    LEFT JOIN units_of_measure uom ON uom.id = p.base_uom_id
    LEFT JOIN contacts sup         ON sup.id = p.preferred_supplier_id
    WHERE ${filter}
    ORDER BY w.name ASC, wz.name ASC, wb.bin_code ASC, p.name ASC
  `);

  return res.json({ success: true, data: rows.recordset });
}));

// ── Phase 3: Stock reports ────────────────────────────────────

// GET /api/warehouse/reports/stock-value?warehouse_id=
// Stock value by product using FIFO layers
router.get('/reports/stock-value', requirePermission('inventory', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const warehouseId = req.query.warehouse_id ? parseInt(req.query.warehouse_id) : null;
  const search      = req.query.search || '';

  const request = pool.request().input('org_id', sql.Int, req.user.orgId);
  let whFilter = '';
  if (warehouseId) { request.input('warehouse_id', sql.Int, warehouseId); whFilter = ' AND fl.warehouse_id = @warehouse_id'; }
  if (search) { request.input('search', sql.NVarChar(200), `%${search}%`); }

  const rows = await request.query(`
    SELECT
      p.id             AS product_id,
      p.product_code,
      p.name           AS product_name,
      p.min_stock_level,
      SUM(fl.qty_remaining)        AS qty_on_hand,
      SUM(fl.total_cost_remaining) AS stock_value,
      CASE WHEN SUM(fl.qty_remaining) > 0
        THEN SUM(fl.total_cost_remaining) / SUM(fl.qty_remaining)
        ELSE 0 END                 AS avg_unit_cost,
      COUNT(DISTINCT fl.warehouse_id) AS warehouse_count
    FROM fifo_cost_layers fl
    INNER JOIN products p ON p.id = fl.product_id
    WHERE fl.org_id = @org_id
      AND fl.is_fully_consumed = 0
      AND fl.is_active = 1
      ${whFilter}
      ${search ? 'AND (p.name LIKE @search OR p.product_code LIKE @search)' : ''}
    GROUP BY p.id, p.product_code, p.name, p.min_stock_level
    HAVING SUM(fl.qty_remaining) > 0
    ORDER BY p.name ASC
  `);

  const totalValue = rows.recordset.reduce((s, r) => s + parseFloat(r.stock_value || 0), 0);

  return res.json({
    success: true,
    data: rows.recordset,
    meta: { total_value: totalValue, count: rows.recordset.length },
  });
}));

// GET /api/warehouse/reports/by-location?warehouse_id=&zone_id=
// Stock levels with FIFO value, drillable by warehouse → zone → bin
router.get('/reports/by-location', requirePermission('inventory', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const warehouseId = req.query.warehouse_id ? parseInt(req.query.warehouse_id) : null;
  const zoneId      = req.query.zone_id      ? parseInt(req.query.zone_id)      : null;

  const request = pool.request().input('org_id', sql.Int, req.user.orgId);
  let filter = 'sl.org_id = @org_id AND sl.qty_on_hand > 0';
  if (warehouseId) { request.input('warehouse_id', sql.Int, warehouseId); filter += ' AND sl.warehouse_id = @warehouse_id'; }
  if (zoneId)      { request.input('zone_id',      sql.Int, zoneId);      filter += ' AND wb.zone_id      = @zone_id'; }

  const rows = await request.query(`
    SELECT
      sl.product_id,
      p.product_code,
      p.name           AS product_name,
      sl.warehouse_id,
      w.code           AS warehouse_code,
      w.name           AS warehouse_name,
      sl.bin_id,
      wb.bin_code,
      wz.id            AS zone_id,
      wz.name          AS zone_name,
      sl.qty_on_hand,
      sl.qty_reserved,
      sl.qty_on_hand - sl.qty_reserved AS qty_available,
      sl.qty_on_order,
      (
        SELECT COALESCE(SUM(fl2.total_cost_remaining), 0)
        FROM fifo_cost_layers fl2
        WHERE fl2.product_id   = sl.product_id
          AND fl2.warehouse_id = sl.warehouse_id
          AND fl2.org_id       = sl.org_id
          AND fl2.is_fully_consumed = 0
          AND fl2.is_active = 1
      ) AS fifo_value
    FROM stock_levels sl
    INNER JOIN warehouses w ON w.id = sl.warehouse_id
    INNER JOIN products p   ON p.id = sl.product_id
    LEFT JOIN warehouse_bins  wb ON wb.id = sl.bin_id
    LEFT JOIN warehouse_zones wz ON wz.id = wb.zone_id
    WHERE ${filter}
    ORDER BY w.name ASC, wz.name ASC, wb.bin_code ASC, p.name ASC
  `);

  return res.json({ success: true, data: rows.recordset });
}));

module.exports = router;
