'use strict';
// ============================================================
// routes/o2cOutbound.js  — Outbound Deliveries (WMS Picking)
//
// GET    /api/o2c/outbound                    list
// GET    /api/o2c/outbound/:id                detail + items
// PATCH  /api/o2c/outbound/:id                update header (tracking, carrier)
// POST   /api/o2c/outbound/:id/start-picking  open → picking
// POST   /api/o2c/outbound/:id/items/:iid/pick  record qty_picked
// POST   /api/o2c/outbound/:id/ship           picking → shipped (deducts stock)
// POST   /api/o2c/outbound/:id/cancel         → cancelled + release allocations
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth }            = require('../middleware/auth');
const { asyncHandler }           = require('../middleware/errorHandler');
const { requirePermission }      = require('../middleware/permissions');

router.use(requireAuth);
const perm    = action => requirePermission('sales_orders', action);
const parseId = v => parseInt(v, 10);

// ── LIST ──────────────────────────────────────────────────────
router.get('/', perm('read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId  = req.user.orgId;
  const limit  = Math.min(200, parseInt(req.query.limit)  || 50);
  const offset = Math.max(0,   parseInt(req.query.offset) || 0);
  const status = req.query.status || null;

  const rows = await pool.request()
    .input('org_id',  sql.Int,         orgId)
    .input('limit',   sql.Int,         limit)
    .input('offset',  sql.Int,         offset)
    .input('status',  sql.VarChar(20), status)
    .query(`
      SELECT
        od.id, od.delivery_number, od.status, od.planned_ship_date,
        od.actual_ship_date, od.tracking_number, od.carrier, od.created_at,
        so.so_number, c.full_name AS customer_name,
        (SELECT COUNT(*) FROM outbound_delivery_items odi WHERE odi.delivery_id = od.id) AS item_count,
        COUNT(*) OVER() AS total_count
      FROM outbound_deliveries od
      JOIN sales_orders so ON so.id = od.so_id
      JOIN contacts c ON c.id = so.customer_id
      WHERE od.org_id = @org_id
        AND (@status IS NULL OR od.status = @status)
      ORDER BY od.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

  res.json({ success: true, data: rows.recordset, meta: { total: rows.recordset[0]?.total_count ?? 0, limit, offset } });
}));

// ── DETAIL ────────────────────────────────────────────────────
router.get('/:id', perm('read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);

  const [odRes, itemsRes] = await Promise.all([
    pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId).query(`
      SELECT od.*, so.so_number, so.customer_id,
             c.full_name AS customer_name, w.name AS warehouse_name
      FROM outbound_deliveries od
      JOIN sales_orders so ON so.id = od.so_id
      JOIN contacts c ON c.id = so.customer_id
      LEFT JOIN warehouses w ON w.id = od.warehouse_id
      WHERE od.id=@id AND od.org_id=@org_id
    `),
    pool.request().input('delivery_id', sql.Int, id).query(`
      SELECT odi.*, p.name AS product_name, p.product_code, uom.code AS uom_code,
             w.name AS warehouse_name
      FROM outbound_delivery_items odi
      JOIN products p ON p.id = odi.product_id
      LEFT JOIN units_of_measure uom ON uom.id = p.base_uom_id
      LEFT JOIN warehouses w ON w.id = odi.warehouse_id
      WHERE odi.delivery_id = @delivery_id ORDER BY odi.id
    `),
  ]);

  if (!odRes.recordset.length) return res.status(404).json({ success: false, error: 'Delivery not found.' });
  res.json({ success: true, data: { ...odRes.recordset[0], items: itemsRes.recordset } });
}));

// ── UPDATE HEADER ─────────────────────────────────────────────
router.patch('/:id', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const { tracking_number, carrier, planned_ship_date, notes, ship_to_name, ship_to_address } = req.body;

  await pool.request()
    .input('id',               sql.Int,          id)
    .input('org_id',           sql.Int,          orgId)
    .input('tracking_number',  sql.NVarChar(100), tracking_number  ?? null)
    .input('carrier',          sql.NVarChar(100), carrier          ?? null)
    .input('planned_ship_date',sql.Date,          planned_ship_date ? new Date(planned_ship_date) : null)
    .input('notes',            sql.NVarChar(500), notes            ?? null)
    .input('ship_to_name',     sql.NVarChar(200), ship_to_name     ?? null)
    .input('ship_to_address',  sql.NVarChar(500), ship_to_address  ?? null)
    .query(`
      UPDATE outbound_deliveries
      SET tracking_number   = COALESCE(@tracking_number,   tracking_number),
          carrier           = COALESCE(@carrier,           carrier),
          planned_ship_date = COALESCE(@planned_ship_date, planned_ship_date),
          notes             = COALESCE(@notes,             notes),
          ship_to_name      = COALESCE(@ship_to_name,      ship_to_name),
          ship_to_address   = COALESCE(@ship_to_address,   ship_to_address),
          updated_at        = GETDATE()
      WHERE id=@id AND org_id=@org_id
    `);
  res.json({ success: true });
}));

// ── START PICKING ─────────────────────────────────────────────
router.post('/:id/start-picking', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);

  const od = await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query('SELECT id, status FROM outbound_deliveries WHERE id=@id AND org_id=@org_id');
  if (!od.recordset.length) return res.status(404).json({ success: false, error: 'Delivery not found.' });
  if (od.recordset[0].status !== 'open') return res.status(409).json({ success: false, error: 'Delivery is not open.' });

  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query(`UPDATE outbound_deliveries SET status='picking', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);
  await pool.request().input('delivery_id', sql.Int, id)
    .query(`UPDATE outbound_delivery_items SET status='picking' WHERE delivery_id=@delivery_id AND status='open'`);

  res.json({ success: true, data: { status: 'picking' } });
}));

// ── RECORD PICK ───────────────────────────────────────────────
router.post('/:id/items/:iid/pick', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId    = req.user.orgId;
  const delivId  = parseId(req.params.id);
  const itemId   = parseId(req.params.iid);
  const { qty_picked, bin_id, batch_number, serial_number } = req.body;

  if (!qty_picked) return res.status(400).json({ success: false, error: 'qty_picked is required.' });

  const itemRes = await pool.request()
    .input('id',          sql.Int, itemId)
    .input('delivery_id', sql.Int, delivId)
    .query('SELECT * FROM outbound_delivery_items WHERE id=@id AND delivery_id=@delivery_id');
  if (!itemRes.recordset.length) return res.status(404).json({ success: false, error: 'Item not found.' });
  const item = itemRes.recordset[0];

  const newPicked = Math.min(Number(item.qty_to_ship), Number(item.qty_picked) + Number(qty_picked));
  const newStatus = newPicked >= Number(item.qty_to_ship) ? 'picked' : 'picking';

  await pool.request()
    .input('id',            sql.Int,           itemId)
    .input('qty_picked',    sql.Decimal(18,4), newPicked)
    .input('status',        sql.VarChar(20),   newStatus)
    .input('bin_id',        sql.Int,           bin_id        || null)
    .input('batch_number',  sql.NVarChar(50),  batch_number  || null)
    .input('serial_number', sql.NVarChar(100), serial_number || null)
    .input('picked_at',     sql.DateTime,      newStatus === 'picked' ? new Date() : null)
    .query(`
      UPDATE outbound_delivery_items
      SET qty_picked=@qty_picked, status=@status,
          bin_id=COALESCE(@bin_id, bin_id),
          batch_number=COALESCE(@batch_number, batch_number),
          serial_number=COALESCE(@serial_number, serial_number),
          picked_at=COALESCE(@picked_at, picked_at)
      WHERE id=@id
    `);

  // If all items picked, move delivery to 'picked'
  const remaining = await pool.request().input('delivery_id', sql.Int, delivId)
    .query(`SELECT COUNT(*) AS cnt FROM outbound_delivery_items WHERE delivery_id=@delivery_id AND status NOT IN ('picked','shipped')`);
  if (remaining.recordset[0].cnt === 0) {
    await pool.request().input('id', sql.Int, delivId).input('org_id', sql.Int, orgId)
      .query(`UPDATE outbound_deliveries SET status='picked', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);
  }

  res.json({ success: true, data: { qty_picked: newPicked, status: newStatus } });
}));

// ── SHIP ──────────────────────────────────────────────────────
router.post('/:id/ship', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);
  const { actual_ship_date, tracking_number, carrier } = req.body;

  const odRes = await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query('SELECT * FROM outbound_deliveries WHERE id=@id AND org_id=@org_id');
  if (!odRes.recordset.length) return res.status(404).json({ success: false, error: 'Delivery not found.' });
  const od = odRes.recordset[0];
  if (!['picking','picked'].includes(od.status)) return res.status(409).json({ success: false, error: 'Delivery must be picked before shipping.' });

  const itemsRes = await pool.request().input('delivery_id', sql.Int, id)
    .query('SELECT * FROM outbound_delivery_items WHERE delivery_id=@delivery_id');

  const shipDate = actual_ship_date ? new Date(actual_ship_date) : new Date();

  for (const item of itemsRes.recordset) {
    const qtyShipped = Number(item.qty_picked) > 0 ? Number(item.qty_picked) : Number(item.qty_to_ship);

    // Mark item as shipped
    await pool.request()
      .input('id',         sql.Int,           item.id)
      .input('qty_shipped',sql.Decimal(18,4), qtyShipped)
      .query(`UPDATE outbound_delivery_items SET qty_shipped=@qty_shipped, status='shipped' WHERE id=@id`);

    // Deduct from stock_levels (on_hand) and release soft allocation
    await pool.request()
      .input('org_id',      sql.Int,           orgId)
      .input('product_id',  sql.Int,           item.product_id)
      .input('warehouse_id',sql.Int,           item.warehouse_id)
      .input('qty',         sql.Decimal(18,4), qtyShipped)
      .query(`
        UPDATE stock_levels
        SET qty_on_hand    = qty_on_hand - @qty,
            soft_allocated = CASE WHEN soft_allocated >= @qty THEN soft_allocated - @qty ELSE 0 END,
            updated_at     = GETDATE()
        WHERE org_id=@org_id AND product_id=@product_id AND warehouse_id=@warehouse_id
      `);

    // Log stock movement
    await pool.request()
      .input('org_id',      sql.Int,           orgId)
      .input('product_id',  sql.Int,           item.product_id)
      .input('warehouse_id',sql.Int,           item.warehouse_id)
      .input('movement_type',sql.VarChar(20),  'outbound_shipment')
      .input('qty',          sql.Decimal(18,4),-qtyShipped)
      .input('ref_id',       sql.Int,           id)
      .query(`
        INSERT INTO stock_movements (org_id, product_id, warehouse_id, movement_type, quantity, reference_id, reference_type, created_at)
        VALUES (@org_id, @product_id, @warehouse_id, @movement_type, @qty, @ref_id, 'outbound_delivery', GETDATE())
      `);

    // Update SO item shipped qty
    await pool.request()
      .input('id',  sql.Int,           item.so_item_id)
      .input('qty', sql.Decimal(18,4), qtyShipped)
      .query(`UPDATE sales_order_items SET qty_shipped = qty_shipped + @qty WHERE id=@id`);

    // Update schedule line status
    if (item.schedule_line_id) {
      await pool.request().input('id', sql.Int, item.schedule_line_id)
        .query(`UPDATE sales_order_schedule_lines SET status='shipped' WHERE id=@id`);
    }
  }

  // Mark delivery shipped
  await pool.request()
    .input('id',               sql.Int,          id)
    .input('org_id',           sql.Int,          orgId)
    .input('actual_ship_date', sql.Date,         shipDate)
    .input('tracking_number',  sql.NVarChar(100), tracking_number || null)
    .input('carrier',          sql.NVarChar(100), carrier         || null)
    .query(`
      UPDATE outbound_deliveries
      SET status='shipped', actual_ship_date=@actual_ship_date,
          tracking_number=COALESCE(@tracking_number, tracking_number),
          carrier=COALESCE(@carrier, carrier),
          updated_at=GETDATE()
      WHERE id=@id AND org_id=@org_id
    `);

  // Update SO status
  const soItemsRes = await pool.request().input('so_id', sql.Int, od.so_id)
    .query('SELECT qty_ordered, qty_shipped FROM sales_order_items WHERE so_id=@so_id');
  const allShipped  = soItemsRes.recordset.every(i => Number(i.qty_shipped) >= Number(i.qty_ordered));
  const someShipped = soItemsRes.recordset.some(i => Number(i.qty_shipped) > 0);
  const soStatus    = allShipped ? 'shipped' : someShipped ? 'partially_shipped' : 'confirmed';

  await pool.request().input('so_id', sql.Int, od.so_id).input('status', sql.VarChar(30), soStatus)
    .query(`UPDATE sales_orders SET status=@status, updated_at=GETDATE() WHERE id=@so_id`);

  res.json({ success: true, data: { status: 'shipped', so_status: soStatus } });
}));

// ── CANCEL ────────────────────────────────────────────────────
router.post('/:id/cancel', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);

  const odRes = await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query('SELECT * FROM outbound_deliveries WHERE id=@id AND org_id=@org_id');
  if (!odRes.recordset.length) return res.status(404).json({ success: false, error: 'Delivery not found.' });
  if (odRes.recordset[0].status === 'shipped') return res.status(409).json({ success: false, error: 'Cannot cancel a shipped delivery.' });

  // Release soft allocations for items
  const items = await pool.request().input('delivery_id', sql.Int, id)
    .query('SELECT * FROM outbound_delivery_items WHERE delivery_id=@delivery_id');
  for (const item of items.recordset) {
    if (!item.warehouse_id) continue;
    await pool.request()
      .input('org_id',      sql.Int,           orgId)
      .input('product_id',  sql.Int,           item.product_id)
      .input('warehouse_id',sql.Int,           item.warehouse_id)
      .input('qty',         sql.Decimal(18,4), Number(item.qty_to_ship))
      .query(`
        UPDATE stock_levels
        SET soft_allocated = CASE WHEN soft_allocated >= @qty THEN soft_allocated - @qty ELSE 0 END,
            updated_at = GETDATE()
        WHERE org_id=@org_id AND product_id=@product_id AND warehouse_id=@warehouse_id
      `);
    if (item.schedule_line_id) {
      await pool.request().input('id', sql.Int, item.schedule_line_id)
        .query(`UPDATE sales_order_schedule_lines SET status='cancelled', outbound_item_id=NULL WHERE id=@id`);
    }
  }

  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query(`UPDATE outbound_deliveries SET status='cancelled', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);

  res.json({ success: true });
}));

module.exports = router;
