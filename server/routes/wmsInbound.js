'use strict';
// ============================================================
// routes/wmsInbound.js  — SAP EWM-style Goods Receipt
//
// GET    /api/wms/inbound                       list deliveries
// POST   /api/wms/inbound                       create delivery (draft)
// GET    /api/wms/inbound/:id                   detail + items + HUs
// PATCH  /api/wms/inbound/:id                   update header (draft only)
// POST   /api/wms/inbound/:id/items             add expected item
// PATCH  /api/wms/inbound/:id/items/:itemId     update item (draft/open)
// DELETE /api/wms/inbound/:id/items/:itemId     remove item (draft/open)
// POST   /api/wms/inbound/:id/open              draft → open
// POST   /api/wms/inbound/:id/hu                create Handling Unit
// GET    /api/wms/inbound/:id/hu                list HUs for delivery
// POST   /api/wms/inbound/:id/scan              parse barcode + suggest bin (no writes)
// POST   /api/wms/inbound/:id/confirm           record scan event + assign HU→bin
// POST   /api/wms/inbound/:id/post              post: stock + FIFO + GL (atomic)
// POST   /api/wms/inbound/:id/cancel            cancel delivery
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect }                        = require('../config/db');
const { requireAuth }                                   = require('../middleware/auth');
const { asyncHandler }                                  = require('../middleware/errorHandler');
const { postJournalEntry }                              = require('../utils/glPosting');
const { getNextNumber }                                 = require('../utils/numbering');
const { resolveAccount, AccountDeterminationError }     = require('../utils/accountDetermination');
const { parseGs1, lookupProduct }                       = require('../utils/gs1Parser');
const { suggestBin }                                    = require('../utils/putawayEngine');
const { applyGrToPo }                                   = require('../utils/p2pApprovalEngine');
const { runRescheduling }                               = require('../utils/reschedulingEngine');

router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────

function parseId(v) { return parseInt(v, 10); }

async function getDelivery(id, orgId) {
  await poolConnect;
  const r = await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT d.*, w.name AS warehouse_name, c.full_name AS supplier_name
      FROM inbound_deliveries d
      LEFT JOIN warehouses w ON w.id = d.warehouse_id
      LEFT JOIN contacts   c ON c.id = d.supplier_id
      WHERE d.id = @id AND d.org_id = @org_id
    `);
  return r.recordset[0] || null;
}

// ============================================================
// LIST
// ============================================================
router.get('/', asyncHandler(async (req, res) => {
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
        d.id, d.delivery_number, d.status, d.warehouse_id, d.supplier_id,
        d.supplier_ref, d.expected_date, d.notes, d.created_at, d.posted_at,
        w.name  AS warehouse_name,
        c.full_name AS supplier_name,
        (SELECT COUNT(*)         FROM inbound_delivery_items i WHERE i.delivery_id = d.id) AS item_count,
        (SELECT ISNULL(SUM(i.received_qty * i.unit_cost), 0)
                                 FROM inbound_delivery_items i WHERE i.delivery_id = d.id) AS total_value,
        COUNT(*) OVER() AS total_count
      FROM inbound_deliveries d
      LEFT JOIN warehouses w ON w.id = d.warehouse_id
      LEFT JOIN contacts   c ON c.id = d.supplier_id
      WHERE d.org_id = @org_id
        AND (@status IS NULL OR d.status = @status)
      ORDER BY d.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

  const total = rows.recordset[0]?.total_count ?? 0;
  res.json({ success: true, data: rows.recordset, meta: { total, limit, offset } });
}));

// ============================================================
// CREATE (DRAFT)
// ============================================================
router.post('/', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const { warehouse_id, supplier_id, supplier_ref, expected_date, notes } = req.body;

  if (!warehouse_id) return res.status(400).json({ success: false, error: 'warehouse_id is required.' });

  const wh = await pool.request()
    .input('id', sql.Int, warehouse_id).input('org_id', sql.Int, orgId)
    .query('SELECT 1 FROM warehouses WHERE id=@id AND org_id=@org_id AND is_active=1');
  if (!wh.recordset.length) return res.status(400).json({ success: false, error: 'Warehouse not found.' });

  const { number: deliveryNumber } = await getNextNumber('inbound_delivery', orgId, pool, sql);

  const r = await pool.request()
    .input('org_id',        sql.Int,          orgId)
    .input('delivery_number', sql.NVarChar(50), deliveryNumber)
    .input('warehouse_id',  sql.Int,          warehouse_id)
    .input('supplier_id',   sql.Int,          supplier_id   || null)
    .input('supplier_ref',  sql.NVarChar(100), supplier_ref || null)
    .input('expected_date', sql.Date,          expected_date ? new Date(expected_date) : null)
    .input('notes',         sql.NVarChar(1000), notes        || null)
    .input('created_by',    sql.Int,           req.user.userId)
    .query(`
      INSERT INTO inbound_deliveries
        (org_id, delivery_number, warehouse_id, supplier_id, supplier_ref,
         expected_date, notes, status, created_by, created_at, updated_at)
      OUTPUT INSERTED.id
      VALUES
        (@org_id, @delivery_number, @warehouse_id, @supplier_id, @supplier_ref,
         @expected_date, @notes, 'draft', @created_by, GETDATE(), GETDATE())
    `);

  res.status(201).json({ success: true, data: { id: r.recordset[0].id, delivery_number: deliveryNumber } });
}));

// ============================================================
// DETAIL
// ============================================================
router.get('/:id', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);

  const [delivRes, itemsRes, husRes] = await Promise.all([
    pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId).query(`
      SELECT d.*, w.name AS warehouse_name, c.full_name AS supplier_name,
             u.full_name AS posted_by_name
      FROM inbound_deliveries d
      LEFT JOIN warehouses w ON w.id = d.warehouse_id
      LEFT JOIN contacts   c ON c.id = d.supplier_id
      LEFT JOIN users      u ON u.id = d.posted_by
      WHERE d.id = @id AND d.org_id = @org_id
    `),
    pool.request().input('delivery_id', sql.Int, id).query(`
      SELECT i.*, p.name AS product_name, p.product_code, p.tracking_type,
             p.base_uom_id, uom.code AS uom_code,
             (SELECT COUNT(*) FROM wms_scan_events se WHERE se.delivery_item_id = i.id) AS scan_count
      FROM inbound_delivery_items i
      JOIN products            p   ON p.id  = i.product_id
      LEFT JOIN units_of_measure uom ON uom.id = p.base_uom_id
      WHERE i.delivery_id = @delivery_id
      ORDER BY i.id
    `),
    pool.request().input('delivery_id', sql.Int, id).query(`
      SELECT hu.*, wb.bin_code,
             (SELECT ISNULL(SUM(hc.qty),0) FROM hu_contents hc WHERE hc.hu_id = hu.id) AS total_qty
      FROM handling_units hu
      LEFT JOIN warehouse_bins wb ON wb.id = hu.bin_id
      WHERE hu.delivery_id = @delivery_id
      ORDER BY hu.created_at DESC
    `),
  ]);

  if (!delivRes.recordset.length) return res.status(404).json({ success: false, error: 'Delivery not found.' });

  res.json({
    success: true,
    data: {
      ...delivRes.recordset[0],
      items: itemsRes.recordset,
      handling_units: husRes.recordset,
    },
  });
}));

// ============================================================
// UPDATE HEADER (draft only)
// ============================================================
router.patch('/:id', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);

  const d = await getDelivery(id, orgId);
  if (!d) return res.status(404).json({ success: false, error: 'Delivery not found.' });
  if (d.status !== 'draft') return res.status(409).json({ success: false, error: 'Only draft deliveries can be edited.' });

  const { supplier_id, supplier_ref, expected_date, notes } = req.body;

  await pool.request()
    .input('id',            sql.Int,          id)
    .input('org_id',        sql.Int,          orgId)
    .input('supplier_id',   sql.Int,          supplier_id   ?? null)
    .input('supplier_ref',  sql.NVarChar(100), supplier_ref ?? null)
    .input('expected_date', sql.Date,          expected_date ? new Date(expected_date) : null)
    .input('notes',         sql.NVarChar(1000), notes        ?? null)
    .query(`
      UPDATE inbound_deliveries
      SET supplier_id   = COALESCE(@supplier_id,   supplier_id),
          supplier_ref  = COALESCE(@supplier_ref,  supplier_ref),
          expected_date = COALESCE(@expected_date, expected_date),
          notes         = COALESCE(@notes,         notes),
          updated_at    = GETDATE()
      WHERE id = @id AND org_id = @org_id
    `);

  res.json({ success: true });
}));

// ============================================================
// ITEMS — ADD
// ============================================================
router.post('/:id/items', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId      = req.user.orgId;
  const deliveryId = parseId(req.params.id);

  const d = await getDelivery(deliveryId, orgId);
  if (!d) return res.status(404).json({ success: false, error: 'Delivery not found.' });
  if (!['draft', 'open'].includes(d.status)) return res.status(409).json({ success: false, error: 'Cannot add items to a posted or cancelled delivery.' });

  const { product_id, expected_qty, unit_cost, lot_number, notes } = req.body;
  if (!product_id) return res.status(400).json({ success: false, error: 'product_id is required.' });

  const prod = await pool.request()
    .input('id', sql.Int, product_id).input('org_id', sql.Int, orgId)
    .query('SELECT 1 FROM products WHERE id=@id AND org_id=@org_id AND is_active=1');
  if (!prod.recordset.length) return res.status(400).json({ success: false, error: 'Product not found.' });

  const r = await pool.request()
    .input('delivery_id',  sql.Int,          deliveryId)
    .input('org_id',       sql.Int,          orgId)
    .input('product_id',   sql.Int,          product_id)
    .input('expected_qty', sql.Decimal(18,4), Number(expected_qty || 0))
    .input('unit_cost',    sql.Decimal(18,4), Number(unit_cost    || 0))
    .input('lot_number',   sql.NVarChar(100), lot_number || null)
    .input('notes',        sql.NVarChar(500), notes      || null)
    .query(`
      INSERT INTO inbound_delivery_items
        (delivery_id, org_id, product_id, expected_qty, received_qty, unit_cost, lot_number, notes)
      OUTPUT INSERTED.id
      VALUES (@delivery_id, @org_id, @product_id, @expected_qty, 0, @unit_cost, @lot_number, @notes)
    `);

  res.status(201).json({ success: true, data: { id: r.recordset[0].id } });
}));

// ============================================================
// ITEMS — UPDATE
// ============================================================
router.patch('/:id/items/:itemId', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId      = req.user.orgId;
  const deliveryId = parseId(req.params.id);
  const itemId     = parseId(req.params.itemId);

  const d = await getDelivery(deliveryId, orgId);
  if (!d) return res.status(404).json({ success: false, error: 'Delivery not found.' });
  if (!['draft', 'open'].includes(d.status)) return res.status(409).json({ success: false, error: 'Cannot edit items on a posted delivery.' });

  const { expected_qty, unit_cost, lot_number, notes } = req.body;
  await pool.request()
    .input('id',           sql.Int,          itemId)
    .input('delivery_id',  sql.Int,          deliveryId)
    .input('expected_qty', sql.Decimal(18,4), Number(expected_qty ?? 0))
    .input('unit_cost',    sql.Decimal(18,4), Number(unit_cost    ?? 0))
    .input('lot_number',   sql.NVarChar(100), lot_number ?? null)
    .input('notes',        sql.NVarChar(500), notes      ?? null)
    .query(`
      UPDATE inbound_delivery_items
      SET expected_qty = COALESCE(@expected_qty, expected_qty),
          unit_cost    = COALESCE(@unit_cost,    unit_cost),
          lot_number   = COALESCE(@lot_number,   lot_number),
          notes        = COALESCE(@notes,        notes)
      WHERE id = @id AND delivery_id = @delivery_id
    `);

  res.json({ success: true });
}));

// ============================================================
// ITEMS — REMOVE
// ============================================================
router.delete('/:id/items/:itemId', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId      = req.user.orgId;
  const deliveryId = parseId(req.params.id);
  const itemId     = parseId(req.params.itemId);

  const d = await getDelivery(deliveryId, orgId);
  if (!d) return res.status(404).json({ success: false, error: 'Delivery not found.' });
  if (!['draft', 'open'].includes(d.status)) return res.status(409).json({ success: false, error: 'Cannot remove items from a posted delivery.' });

  await pool.request()
    .input('id',          sql.Int, itemId)
    .input('delivery_id', sql.Int, deliveryId)
    .query('DELETE FROM inbound_delivery_items WHERE id=@id AND delivery_id=@delivery_id');

  res.json({ success: true });
}));

// ============================================================
// OPEN  (draft → open)
// ============================================================
router.post('/:id/open', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);

  const d = await getDelivery(id, orgId);
  if (!d) return res.status(404).json({ success: false, error: 'Delivery not found.' });
  if (d.status !== 'draft') return res.status(409).json({ success: false, error: `Delivery is already ${d.status}.` });

  const items = await pool.request().input('delivery_id', sql.Int, id)
    .query('SELECT id FROM inbound_delivery_items WHERE delivery_id=@delivery_id');
  if (!items.recordset.length) return res.status(400).json({ success: false, error: 'Add at least one item before opening.' });

  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query(`UPDATE inbound_deliveries SET status='open', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);

  res.json({ success: true, data: { status: 'open' } });
}));

// ============================================================
// CREATE HANDLING UNIT
// ============================================================
router.post('/:id/hu', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId      = req.user.orgId;
  const deliveryId = parseId(req.params.id);

  const d = await getDelivery(deliveryId, orgId);
  if (!d) return res.status(404).json({ success: false, error: 'Delivery not found.' });
  if (!['open', 'in_progress'].includes(d.status)) return res.status(409).json({ success: false, error: 'Delivery must be open to create HUs.' });

  const { hu_type = 'carton', hu_number: providedNumber, parent_hu_id } = req.body;

  // Auto-generate LPN if not provided
  const ts       = Date.now().toString(36).toUpperCase();
  const rand     = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
  const huNumber = providedNumber || `LPN-${ts}-${rand}`;

  // Check uniqueness
  const dup = await pool.request()
    .input('org_id',    sql.Int,         orgId)
    .input('hu_number', sql.NVarChar(50), huNumber)
    .query('SELECT id FROM handling_units WHERE org_id=@org_id AND hu_number=@hu_number');
  if (dup.recordset.length) return res.status(409).json({ success: false, error: `HU number ${huNumber} already exists.` });

  const r = await pool.request()
    .input('org_id',       sql.Int,         orgId)
    .input('hu_number',    sql.NVarChar(50), huNumber)
    .input('hu_type',      sql.VarChar(20),  hu_type)
    .input('delivery_id',  sql.Int,          deliveryId)
    .input('warehouse_id', sql.Int,          d.warehouse_id)
    .input('parent_hu_id', sql.Int,          parent_hu_id || null)
    .input('created_by',   sql.Int,          req.user.userId)
    .query(`
      INSERT INTO handling_units
        (org_id, hu_number, hu_type, status, warehouse_id, delivery_id, parent_hu_id, created_by, created_at, updated_at)
      OUTPUT INSERTED.id
      VALUES
        (@org_id, @hu_number, @hu_type, 'open', @warehouse_id, @delivery_id, @parent_hu_id, @created_by, GETDATE(), GETDATE())
    `);

  // Transition delivery to in_progress
  if (d.status === 'open') {
    await pool.request().input('id', sql.Int, deliveryId).input('org_id', sql.Int, orgId)
      .query(`UPDATE inbound_deliveries SET status='in_progress', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);
  }

  res.status(201).json({ success: true, data: { id: r.recordset[0].id, hu_number: huNumber } });
}));

// ============================================================
// LIST HUs
// ============================================================
router.get('/:id/hu', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId      = req.user.orgId;
  const deliveryId = parseId(req.params.id);

  const d = await getDelivery(deliveryId, orgId);
  if (!d) return res.status(404).json({ success: false, error: 'Delivery not found.' });

  const husRes = await pool.request().input('delivery_id', sql.Int, deliveryId).query(`
    SELECT hu.*, wb.bin_code
    FROM handling_units hu
    LEFT JOIN warehouse_bins wb ON wb.id = hu.bin_id
    WHERE hu.delivery_id = @delivery_id
    ORDER BY hu.created_at DESC
  `);

  const huIds = husRes.recordset.map(h => h.id);
  let contentsByHu = {};
  if (huIds.length) {
    const contRes = await pool.request().query(`
      SELECT hc.hu_id, hc.product_id, hc.qty, hc.lot_number,
             p.name AS product_name, p.product_code
      FROM hu_contents hc
      JOIN products p ON p.id = hc.product_id
      WHERE hc.hu_id IN (${huIds.join(',')})
    `);
    for (const c of contRes.recordset) {
      if (!contentsByHu[c.hu_id]) contentsByHu[c.hu_id] = [];
      contentsByHu[c.hu_id].push(c);
    }
  }

  const data = husRes.recordset.map(h => ({ ...h, contents: contentsByHu[h.id] || [] }));
  res.json({ success: true, data });
}));

// ============================================================
// SCAN — parse barcode + suggest bin (read-only, no DB writes)
// ============================================================
router.post('/:id/scan', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId      = req.user.orgId;
  const deliveryId = parseId(req.params.id);

  const d = await getDelivery(deliveryId, orgId);
  if (!d) return res.status(404).json({ success: false, error: 'Delivery not found.' });
  if (!['open', 'in_progress'].includes(d.status)) {
    return res.status(409).json({ success: false, error: 'Delivery is not open for receiving.' });
  }

  const { barcode } = req.body;
  if (!barcode) return res.status(400).json({ success: false, error: 'barcode is required.' });

  // Parse barcode
  const parsed  = parseGs1(barcode);
  const product = await lookupProduct(parsed, orgId, pool, sql);

  if (!product) {
    return res.status(404).json({
      success: false,
      error:   'Product not found for this barcode.',
      parsed,
    });
  }

  // Find matching delivery item
  const itemRes = await pool.request()
    .input('delivery_id', sql.Int, deliveryId)
    .input('product_id',  sql.Int, product.id)
    .query(`
      SELECT id, expected_qty, received_qty, unit_cost, lot_number
      FROM inbound_delivery_items
      WHERE delivery_id = @delivery_id AND product_id = @product_id
    `);
  const deliveryItem = itemRes.recordset[0] || null;

  // Serial validation: check if serial already exists for this product in this org
  let serialConflict = false;
  if (product.tracking_type === 'serial' && parsed.serial) {
    const snCheck = await pool.request()
      .input('org_id',        sql.Int,          orgId)
      .input('product_id',    sql.Int,          product.id)
      .input('serial_number', sql.NVarChar(100), parsed.serial)
      .query(`
        SELECT id FROM wms_serial_numbers
        WHERE org_id=@org_id AND product_id=@product_id AND serial_number=@serial_number
      `);
    serialConflict = snCheck.recordset.length > 0;
  }

  // Suggest putaway bin
  const suggestedBin = await suggestBin({
    productId:   product.id,
    categoryId:  product.category_id || null,
    warehouseId: d.warehouse_id,
    orgId,
    pool,
    sql,
  });

  res.json({
    success: true,
    data: {
      parsed,
      product: {
        id:            product.id,
        name:          product.name,
        product_code:  product.product_code,
        tracking_type: product.tracking_type,
        category_id:   product.category_id,
      },
      delivery_item:    deliveryItem,
      suggested_bin:    suggestedBin,
      serial_required:  product.tracking_type === 'serial',
      serial_conflict:  serialConflict,
      quantity:         parsed.quantity || 1,
      lot:              parsed.lot || deliveryItem?.lot_number || null,
      serial:           parsed.serial || null,
    },
  });
}));

// ============================================================
// CONFIRM PUTAWAY — record scan event, assign HU → bin
// ============================================================
router.post('/:id/confirm', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId      = req.user.orgId;
  const deliveryId = parseId(req.params.id);

  const d = await getDelivery(deliveryId, orgId);
  if (!d) return res.status(404).json({ success: false, error: 'Delivery not found.' });
  if (!['open', 'in_progress'].includes(d.status)) {
    return res.status(409).json({ success: false, error: 'Delivery is not open for receiving.' });
  }

  const {
    delivery_item_id,
    hu_id,
    bin_id,
    product_id,
    qty         = 1,
    lot_number  = null,
    serial_number = null,
    raw_barcode = null,
    parsed_gtin = null,
  } = req.body;

  if (!product_id) return res.status(400).json({ success: false, error: 'product_id is required.' });
  if (!hu_id)      return res.status(400).json({ success: false, error: 'hu_id is required.' });
  if (!bin_id)     return res.status(400).json({ success: false, error: 'bin_id is required.' });

  // Validate HU belongs to this delivery
  const huRes = await pool.request()
    .input('id',          sql.Int, hu_id)
    .input('delivery_id', sql.Int, deliveryId)
    .input('org_id',      sql.Int, orgId)
    .query('SELECT id, status FROM handling_units WHERE id=@id AND delivery_id=@delivery_id AND org_id=@org_id');
  if (!huRes.recordset.length) return res.status(400).json({ success: false, error: 'HU not found on this delivery.' });
  if (huRes.recordset[0].status === 'closed') return res.status(409).json({ success: false, error: 'HU is already closed.' });

  // Validate bin belongs to this warehouse
  const binRes = await pool.request()
    .input('id',           sql.Int, bin_id)
    .input('org_id',       sql.Int, orgId)
    .input('warehouse_id', sql.Int, d.warehouse_id)
    .query('SELECT id, bin_code FROM warehouse_bins WHERE id=@id AND org_id=@org_id AND warehouse_id=@warehouse_id AND is_active=1 AND is_locked=0');
  if (!binRes.recordset.length) return res.status(400).json({ success: false, error: 'Bin not found or locked.' });

  // Product tracking_type check
  const prodRes = await pool.request()
    .input('id',     sql.Int, product_id)
    .input('org_id', sql.Int, orgId)
    .query('SELECT id, tracking_type FROM products WHERE id=@id AND org_id=@org_id');
  if (!prodRes.recordset.length) return res.status(400).json({ success: false, error: 'Product not found.' });
  const product = prodRes.recordset[0];

  if (product.tracking_type === 'serial' && !serial_number) {
    return res.status(400).json({ success: false, error: 'Serial number is required for serialized products.' });
  }

  // Check serial uniqueness
  if (serial_number) {
    const snCheck = await pool.request()
      .input('org_id',        sql.Int,          orgId)
      .input('product_id',    sql.Int,          product_id)
      .input('serial_number', sql.NVarChar(100), serial_number)
      .query('SELECT id FROM wms_serial_numbers WHERE org_id=@org_id AND product_id=@product_id AND serial_number=@serial_number');
    if (snCheck.recordset.length) {
      return res.status(409).json({ success: false, error: `Serial number ${serial_number} already exists for this product.` });
    }
    // Also check scan events for this delivery (in-flight duplicates)
    const inFlight = await pool.request()
      .input('delivery_id',   sql.Int,          deliveryId)
      .input('product_id',    sql.Int,          product_id)
      .input('serial_number', sql.NVarChar(100), serial_number)
      .query('SELECT id FROM wms_scan_events WHERE delivery_id=@delivery_id AND product_id=@product_id AND serial_number=@serial_number');
    if (inFlight.recordset.length) {
      return res.status(409).json({ success: false, error: `Serial number ${serial_number} already scanned on this delivery.` });
    }
  }

  // Record scan event
  const evtRes = await pool.request()
    .input('org_id',           sql.Int,          orgId)
    .input('delivery_id',      sql.Int,          deliveryId)
    .input('delivery_item_id', sql.Int,          delivery_item_id || null)
    .input('hu_id',            sql.Int,          hu_id)
    .input('bin_id',           sql.Int,          bin_id)
    .input('product_id',       sql.Int,          product_id)
    .input('lot_number',       sql.NVarChar(100), lot_number     || null)
    .input('serial_number',    sql.NVarChar(100), serial_number  || null)
    .input('qty_scanned',      sql.Decimal(18,4), Number(qty))
    .input('raw_barcode',      sql.NVarChar(500), raw_barcode    || null)
    .input('parsed_gtin',      sql.NVarChar(20),  parsed_gtin    || null)
    .input('scanned_by',       sql.Int,           req.user.userId)
    .query(`
      INSERT INTO wms_scan_events
        (org_id, delivery_id, delivery_item_id, hu_id, bin_id, product_id,
         lot_number, serial_number, qty_scanned, raw_barcode, parsed_gtin, scanned_by, scanned_at)
      OUTPUT INSERTED.id
      VALUES
        (@org_id, @delivery_id, @delivery_item_id, @hu_id, @bin_id, @product_id,
         @lot_number, @serial_number, @qty_scanned, @raw_barcode, @parsed_gtin, @scanned_by, GETDATE())
    `);

  const scanEventId = evtRes.recordset[0].id;

  // Upsert hu_contents (accumulate qty for same product+lot in same HU)
  const existingContent = await pool.request()
    .input('hu_id',      sql.Int,          hu_id)
    .input('product_id', sql.Int,          product_id)
    .input('lot_number', sql.NVarChar(100), lot_number || null)
    .query(`
      SELECT id, qty FROM hu_contents
      WHERE hu_id=@hu_id AND product_id=@product_id
        AND ((@lot_number IS NULL AND lot_number IS NULL) OR lot_number=@lot_number)
    `);

  if (existingContent.recordset.length) {
    await pool.request()
      .input('id',  sql.Int,          existingContent.recordset[0].id)
      .input('qty', sql.Decimal(18,4), Number(qty))
      .query('UPDATE hu_contents SET qty = qty + @qty WHERE id=@id');
  } else {
    await pool.request()
      .input('hu_id',            sql.Int,          hu_id)
      .input('org_id',           sql.Int,          orgId)
      .input('delivery_item_id', sql.Int,          delivery_item_id || null)
      .input('product_id',       sql.Int,          product_id)
      .input('lot_number',       sql.NVarChar(100), lot_number || null)
      .input('qty',              sql.Decimal(18,4), Number(qty))
      .query(`
        INSERT INTO hu_contents (hu_id, org_id, delivery_item_id, product_id, lot_number, qty)
        VALUES (@hu_id, @org_id, @delivery_item_id, @product_id, @lot_number, @qty)
      `);
  }

  // Update HU bin location
  await pool.request()
    .input('id',     sql.Int, hu_id)
    .input('bin_id', sql.Int, bin_id)
    .query('UPDATE handling_units SET bin_id=@bin_id, updated_at=GETDATE() WHERE id=@id');

  // Update delivery item received_qty
  if (delivery_item_id) {
    await pool.request()
      .input('id',  sql.Int,          delivery_item_id)
      .input('qty', sql.Decimal(18,4), Number(qty))
      .query('UPDATE inbound_delivery_items SET received_qty = received_qty + @qty WHERE id=@id');
  }

  // Transition delivery to in_progress if still open
  if (d.status === 'open') {
    await pool.request().input('id', sql.Int, deliveryId).input('org_id', sql.Int, orgId)
      .query(`UPDATE inbound_deliveries SET status='in_progress', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);
  }

  res.json({
    success: true,
    data: {
      scan_event_id: scanEventId,
      bin_code:      binRes.recordset[0].bin_code,
    },
  });
}));

// ============================================================
// POST DELIVERY — atomic: stock_movements + FIFO + serials + GL
// ============================================================
router.post('/:id/post', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId      = req.user.orgId;
  const deliveryId = parseId(req.params.id);
  const userId     = req.user.userId;

  const d = await getDelivery(deliveryId, orgId);
  if (!d) return res.status(404).json({ success: false, error: 'Delivery not found.' });
  if (!['open', 'in_progress'].includes(d.status)) {
    return res.status(409).json({ success: false, error: `Delivery is ${d.status} — cannot post.` });
  }

  // Fetch items with product info
  const itemsRes = await pool.request()
    .input('delivery_id', sql.Int, deliveryId)
    .query(`
      SELECT i.*, p.tracking_type, p.category_id, p.name AS product_name
      FROM inbound_delivery_items i
      JOIN products p ON p.id = i.product_id
      WHERE i.delivery_id = @delivery_id
    `);

  const items = itemsRes.recordset;
  if (!items.length) return res.status(400).json({ success: false, error: 'No items on this delivery.' });

  // Validate each item
  for (const item of items) {
    if (Number(item.received_qty) <= 0) {
      return res.status(400).json({ success: false, error: `Item ${item.product_name}: received_qty is 0. Scan goods before posting.` });
    }
    if (Number(item.unit_cost) <= 0) {
      return res.status(400).json({ success: false, error: `Item ${item.product_name}: unit cost is 0. Set cost before posting.` });
    }

    // Serialized: count captured serials must equal received_qty
    if (item.tracking_type === 'serial') {
      const snCount = await pool.request()
        .input('delivery_id',      sql.Int, deliveryId)
        .input('delivery_item_id', sql.Int, item.id)
        .query(`
          SELECT COUNT(*) AS n FROM wms_scan_events
          WHERE delivery_id=@delivery_id AND delivery_item_id=@delivery_item_id
            AND serial_number IS NOT NULL AND serial_number != ''
        `);
      const captured = snCount.recordset[0].n;
      if (captured < Math.ceil(Number(item.received_qty))) {
        return res.status(400).json({
          success: false,
          error: `Item ${item.product_name}: serialized product requires ${Math.ceil(Number(item.received_qty))} serial(s), only ${captured} scanned.`,
        });
      }
    }
  }

  // Pre-resolve GL accounts (fail fast before any mutations)
  const resolvedAccounts = {};
  try {
    for (const item of items) {
      const key = `${item.category_id}:${d.warehouse_id}`;
      if (!resolvedAccounts[key]) {
        resolvedAccounts[key] = {
          bsx: await resolveAccount('BSX', item.category_id, d.warehouse_id, orgId, pool, sql),
          wrx: await resolveAccount('WRX', item.category_id, d.warehouse_id, orgId, pool, sql),
        };
      }
    }
  } catch (err) {
    if (err instanceof AccountDeterminationError) {
      return res.status(422).json({ success: false, error: err.message });
    }
    throw err;
  }

  // Fetch scan events for bin assignment (use last confirmed bin per item)
  const scanRes = await pool.request()
    .input('delivery_id', sql.Int, deliveryId)
    .query(`
      SELECT delivery_item_id, bin_id, product_id, lot_number, serial_number, qty_scanned
      FROM wms_scan_events
      WHERE delivery_id = @delivery_id
      ORDER BY scanned_at ASC
    `);
  const scansByItem = {};
  for (const se of scanRes.recordset) {
    if (!scansByItem[se.delivery_item_id]) scansByItem[se.delivery_item_id] = [];
    scansByItem[se.delivery_item_id].push(se);
  }

  const txn = pool.transaction();
  await txn.begin();

  try {
    let totalValue   = 0;
    const glDebits   = {};
    const glCredits  = {};

    for (const item of items) {
      const rcvQty   = Number(item.received_qty);
      const unitCost = Number(item.unit_cost);
      const totalCost = Math.round(rcvQty * unitCost * 10000) / 10000;
      totalValue += totalCost;

      const key        = `${item.category_id}:${d.warehouse_id}`;
      const { bsx, wrx } = resolvedAccounts[key];
      glDebits[bsx]  = (glDebits[bsx]  || 0) + totalCost;
      glCredits[wrx] = (glCredits[wrx] || 0) + totalCost;

      // Determine bin: use first scan event bin, fallback to null
      const itemScans = scansByItem[item.id] || [];
      const binId     = itemScans[0]?.bin_id || null;

      // Stock movement (receive)
      const movRes = await new sql.Request(txn)
        .input('org_id',         sql.Int,          orgId)
        .input('product_id',     sql.Int,          item.product_id)
        .input('warehouse_id',   sql.Int,          d.warehouse_id)
        .input('bin_id',         sql.Int,          binId)
        .input('movement_type',  sql.VarChar(30),  'receive')
        .input('qty',            sql.Decimal(18,4), rcvQty)
        .input('unit_cost',      sql.Decimal(18,4), unitCost)
        .input('total_cost',     sql.Decimal(18,4), totalCost)
        .input('reference_type', sql.VarChar(30),  'inbound_delivery')
        .input('reference_id',   sql.Int,          deliveryId)
        .input('reference_line_id', sql.Int,       item.id)
        .input('notes',          sql.NVarChar(500), item.lot_number ? `Lot: ${item.lot_number}` : null)
        .input('moved_by',       sql.Int,          userId)
        .query(`
          INSERT INTO stock_movements
            (org_id, product_id, warehouse_id, bin_id, movement_type,
             qty, unit_cost, total_cost, reference_type, reference_id, reference_line_id,
             notes, moved_by, moved_at)
          OUTPUT INSERTED.id
          VALUES
            (@org_id, @product_id, @warehouse_id, @bin_id, @movement_type,
             @qty, @unit_cost, @total_cost, @reference_type, @reference_id, @reference_line_id,
             @notes, @moved_by, GETDATE())
        `);

      const movId = movRes.recordset[0].id;

      // FIFO cost layer
      await new sql.Request(txn)
        .input('org_id',               sql.Int,          orgId)
        .input('product_id',           sql.Int,          item.product_id)
        .input('warehouse_id',         sql.Int,          d.warehouse_id)
        .input('reference_type',       sql.VarChar(30),  'inbound_delivery')
        .input('reference_id',         sql.Int,          deliveryId)
        .input('reference_line_id',    sql.Int,          item.id)
        .input('qty_received',         sql.Decimal(18,4), rcvQty)
        .input('unit_cost',            sql.Decimal(18,4), unitCost)
        .input('total_cost_received',  sql.Decimal(18,4), totalCost)
        .query(`
          INSERT INTO fifo_cost_layers
            (org_id, product_id, warehouse_id, receipt_date,
             reference_type, reference_id, reference_line_id,
             qty_received, qty_remaining, qty_consumed,
             unit_cost, unit_cost_landed,
             total_cost_received, total_cost_remaining,
             currency_code, exchange_rate,
             is_fully_consumed, is_active, created_at)
          VALUES
            (@org_id, @product_id, @warehouse_id, GETDATE(),
             @reference_type, @reference_id, @reference_line_id,
             @qty_received, @qty_received, 0,
             @unit_cost, @unit_cost,
             @total_cost_received, @total_cost_received,
             'AUD', 1, 0, 1, GETDATE())
        `);

      // Stock levels (MERGE per bin)
      await new sql.Request(txn)
        .input('org_id',       sql.Int,          orgId)
        .input('product_id',   sql.Int,          item.product_id)
        .input('warehouse_id', sql.Int,          d.warehouse_id)
        .input('bin_id',       sql.Int,          binId)
        .input('qty',          sql.Decimal(18,4), rcvQty)
        .query(`
          MERGE stock_levels AS target
          USING (SELECT @org_id AS o, @product_id AS p, @warehouse_id AS w) AS src
            ON target.org_id=src.o AND target.product_id=src.p AND target.warehouse_id=src.w
          WHEN MATCHED THEN
            UPDATE SET qty_on_hand = qty_on_hand + @qty, updated_at = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (org_id, product_id, warehouse_id, bin_id, qty_on_hand, qty_reserved, qty_on_order, updated_at)
            VALUES (@org_id, @product_id, @warehouse_id, @bin_id, @qty, 0, 0, GETDATE());
        `);

      // Serial number records (one per scan event with a serial)
      for (const se of itemScans.filter(s => s.serial_number)) {
        await new sql.Request(txn)
          .input('org_id',           sql.Int,          orgId)
          .input('product_id',       sql.Int,          item.product_id)
          .input('serial_number',    sql.NVarChar(100), se.serial_number)
          .input('bin_id',           sql.Int,          se.bin_id || null)
          .input('warehouse_id',     sql.Int,          d.warehouse_id)
          .input('delivery_item_id', sql.Int,          item.id)
          .query(`
            INSERT INTO wms_serial_numbers
              (org_id, product_id, serial_number, status, bin_id, warehouse_id, delivery_item_id, received_at)
            VALUES
              (@org_id, @product_id, @serial_number, 'in_stock', @bin_id, @warehouse_id, @delivery_item_id, GETDATE())
          `);
      }

      // Close HUs on this item
      await new sql.Request(txn)
        .input('delivery_id', sql.Int, deliveryId)
        .query(`UPDATE handling_units SET status='closed', updated_at=GETDATE() WHERE delivery_id=@delivery_id`);
    }

    // GL journal: DR Inventory (BSX) / CR GR/IR clearing (WRX)
    const glLines = [];
    for (const [accountId, amount] of Object.entries(glDebits)) {
      glLines.push({ accountId: Number(accountId), debit: Math.round(amount * 10000) / 10000, credit: 0, description: `Goods received — ${d.delivery_number}` });
    }
    for (const [accountId, amount] of Object.entries(glCredits)) {
      glLines.push({ accountId: Number(accountId), debit: 0, credit: Math.round(amount * 10000) / 10000, description: `GR/IR clearing — ${d.delivery_number}` });
    }

    const glResult = await postJournalEntry({
      orgId,
      entryDate:     new Date(),
      description:   `Inbound delivery ${d.delivery_number}`,
      source:        'inbound_delivery',
      referenceType: 'inbound_delivery',
      referenceId:   deliveryId,
      createdBy:     userId,
      lines:         glLines,
    }, pool, sql);

    // Update delivery status
    await new sql.Request(txn)
      .input('id',          sql.Int,      deliveryId)
      .input('gl_entry_id', sql.Int,      glResult.entryId)
      .input('posted_by',   sql.Int,      userId)
      .query(`
        UPDATE inbound_deliveries
        SET status      = 'posted',
            posted_at   = GETDATE(),
            posted_by   = @posted_by,
            gl_entry_id = @gl_entry_id,
            updated_at  = GETDATE()
        WHERE id = @id
      `);

    await txn.commit();

    // Feed qty_received back to linked PO lines (3-way match)
    if (d.po_id) {
      const deliveryItemsForPo = items.map(item => ({
        product_id:   item.product_id,
        received_qty: Number(item.received_qty),
      }));
      await applyGrToPo(d.po_id, deliveryItemsForPo, orgId, () => pool.request(), sql);
    }

    // V_V2 rescheduling — redistribute free ATP to open backorders
    await Promise.allSettled(items.map(item =>
      runRescheduling({ productId: item.product_id, warehouseId: d.warehouse_id, orgId, pool, sql })
    ));

    res.json({
      success: true,
      data: {
        delivery_id:    deliveryId,
        delivery_number: d.delivery_number,
        gl_entry_id:    glResult.entryId,
        journal_number: glResult.entryNumber,
        total_value:    Math.round(totalValue * 100) / 100,
      },
    });

  } catch (err) {
    try { await txn.rollback(); } catch (_) { /* trigger may have rolled back */ }
    throw err;
  }
}));

// ============================================================
// CANCEL
// ============================================================
router.post('/:id/cancel', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseId(req.params.id);

  const d = await getDelivery(id, orgId);
  if (!d) return res.status(404).json({ success: false, error: 'Delivery not found.' });
  if (d.status === 'posted') return res.status(409).json({ success: false, error: 'Posted deliveries cannot be cancelled. Reverse the GL entry instead.' });
  if (d.status === 'cancelled') return res.status(409).json({ success: false, error: 'Already cancelled.' });

  await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query(`UPDATE inbound_deliveries SET status='cancelled', updated_at=GETDATE() WHERE id=@id AND org_id=@org_id`);

  res.json({ success: true });
}));

module.exports = router;
