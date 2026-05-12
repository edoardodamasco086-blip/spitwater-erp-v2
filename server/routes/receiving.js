'use strict';
// ============================================================
// routes/receiving.js
//
// GET    /api/receiving                     — list sessions
// POST   /api/receiving                     — create session (open)
// GET    /api/receiving/:id                 — session detail + lines
// PATCH  /api/receiving/:id                 — update session header
// POST   /api/receiving/:id/lines           — add / upsert a line
// DELETE /api/receiving/:id/lines/:lineId   — remove a line
// POST   /api/receiving/:id/complete        — complete session:
//           → validate lines have qty + cost
//           → create stock_movements (one per line)
//           → create / extend FIFO cost layers
//           → post GL journal (DR Inventory, CR Accounts Payable)
//           → set session status = 'complete'
// POST   /api/receiving/:id/void            — void open session
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect }            = require('../config/db');
const { requireAuth }                       = require('../middleware/auth');
const { asyncHandler }                      = require('../middleware/errorHandler');
const { postJournalEntry }                  = require('../utils/glPosting');
const { getNextNumber }                     = require('../utils/numbering');
const { resolveAccount, AccountDeterminationError } = require('../utils/accountDetermination');

router.use(requireAuth);

// ============================================================
// LIST
// ============================================================

router.get('/', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId  = req.user.orgId;
  const limit  = Math.max(1, Math.min(200, parseInt(req.query.limit)  || 50));
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const status = req.query.status || null;

  const rows = await pool.request()
    .input('org_id',  sql.Int,        orgId)
    .input('limit',   sql.Int,        limit)
    .input('offset',  sql.Int,        offset)
    .input('status',  sql.VarChar(20), status)
    .query(`
      SELECT
        rs.id, rs.session_number, rs.status, rs.warehouse_id, rs.supplier_id,
        rs.supplier_docket, rs.notes, rs.started_at, rs.completed_at,
        w.name AS warehouse_name,
        c.full_name AS supplier_name,
        (SELECT COUNT(*) FROM receiving_session_lines rsl WHERE rsl.session_id = rs.id) AS line_count,
        (SELECT ISNULL(SUM(rsl.line_total),0) FROM receiving_session_lines rsl WHERE rsl.session_id = rs.id) AS total_value,
        COUNT(*) OVER() AS total_count
      FROM receiving_sessions rs
      LEFT JOIN warehouses w ON w.id = rs.warehouse_id
      LEFT JOIN contacts   c ON c.id = rs.supplier_id
      WHERE rs.org_id = @org_id
        AND (@status IS NULL OR rs.status = @status)
      ORDER BY rs.started_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

  const total = rows.recordset[0]?.total_count ?? 0;
  return res.json({ success: true, data: rows.recordset, meta: { total, limit, offset } });
}));

// ============================================================
// CREATE SESSION
// ============================================================

router.post('/', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const { warehouse_id, supplier_id, supplier_docket, notes, bin_id } = req.body;

  if (!warehouse_id) return res.status(400).json({ success: false, error: 'warehouse_id is required.' });

  // Verify warehouse belongs to org
  const wh = await pool.request()
    .input('id',     sql.Int, warehouse_id)
    .input('org_id', sql.Int, orgId)
    .query('SELECT 1 FROM warehouses WHERE id=@id AND org_id=@org_id AND is_active=1');
  if (!wh.recordset.length) return res.status(400).json({ success: false, error: 'Warehouse not found.' });

  const { number: sessionNumber } = await getNextNumber('goods_receipt', orgId, pool, sql);

  const result = await pool.request()
    .input('org_id',          sql.Int,          orgId)
    .input('session_number',  sql.NVarChar(50),  sessionNumber)
    .input('warehouse_id',    sql.Int,           warehouse_id)
    .input('supplier_id',     sql.Int,           supplier_id || null)
    .input('supplier_docket', sql.NVarChar(100), supplier_docket || null)
    .input('bin_id',          sql.Int,           bin_id || null)
    .input('notes',           sql.NVarChar(1000), notes || null)
    .input('received_by',     sql.Int,           req.user.userId)
    .input('created_by',      sql.Int,           req.user.userId)
    .query(`
      INSERT INTO receiving_sessions
        (org_id, session_number, warehouse_id, supplier_id, supplier_docket, bin_id,
         notes, status, received_by, created_by, started_at, updated_at)
      OUTPUT INSERTED.id
      VALUES
        (@org_id, @session_number, @warehouse_id, @supplier_id, @supplier_docket, @bin_id,
         @notes, 'open', @received_by, @created_by, GETDATE(), GETDATE())
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id, session_number: sessionNumber } });
}));

// ============================================================
// SESSION DETAIL
// ============================================================

router.get('/:id', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);

  const [sessionRes, linesRes] = await Promise.all([
    pool.request()
      .input('id',     sql.Int, id)
      .input('org_id', sql.Int, orgId)
      .query(`
        SELECT
          rs.*,
          w.name  AS warehouse_name,
          c.full_name AS supplier_name,
          u.full_name AS received_by_name
        FROM receiving_sessions rs
        LEFT JOIN warehouses w ON w.id = rs.warehouse_id
        LEFT JOIN contacts   c ON c.id = rs.supplier_id
        LEFT JOIN users      u ON u.id = rs.received_by
        WHERE rs.id = @id AND rs.org_id = @org_id
      `),
    pool.request()
      .input('session_id', sql.Int, id)
      .query(`
        SELECT
          rsl.*,
          p.name         AS product_name,
          p.product_code AS product_sku,
          p.base_uom_id  AS uom_id,
          uom.code       AS uom_code,
          wb.bin_code    AS bin_code
        FROM receiving_session_lines rsl
        JOIN products              p   ON p.id  = rsl.product_id
        LEFT JOIN units_of_measure uom ON uom.id = p.base_uom_id
        LEFT JOIN warehouse_bins   wb  ON wb.id  = rsl.put_away_bin_id
        ORDER BY rsl.id
      `),
  ]);

  if (!sessionRes.recordset.length) {
    return res.status(404).json({ success: false, error: 'Receiving session not found.' });
  }

  return res.json({
    success: true,
    data:    { ...sessionRes.recordset[0], lines: linesRes.recordset },
  });
}));

// ============================================================
// UPDATE HEADER
// ============================================================

router.patch('/:id', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);

  const session = await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query('SELECT status FROM receiving_sessions WHERE id=@id AND org_id=@org_id');

  if (!session.recordset.length) return res.status(404).json({ success: false, error: 'Session not found.' });
  if (session.recordset[0].status !== 'open') {
    return res.status(409).json({ success: false, error: 'Only open sessions can be edited.' });
  }

  const { supplier_id, supplier_docket, notes, bin_id } = req.body;

  await pool.request()
    .input('id',              sql.Int,          id)
    .input('org_id',          sql.Int,          orgId)
    .input('supplier_id',     sql.Int,          supplier_id     ?? null)
    .input('supplier_docket', sql.NVarChar(100), supplier_docket ?? null)
    .input('bin_id',          sql.Int,          bin_id          ?? null)
    .input('notes',           sql.NVarChar(1000), notes          ?? null)
    .query(`
      UPDATE receiving_sessions
      SET supplier_id     = COALESCE(@supplier_id,     supplier_id),
          supplier_docket = COALESCE(@supplier_docket, supplier_docket),
          bin_id          = COALESCE(@bin_id,          bin_id),
          notes           = COALESCE(@notes,           notes),
          updated_at      = GETDATE()
      WHERE id=@id AND org_id=@org_id
    `);

  return res.json({ success: true });
}));

// ============================================================
// ADD / UPDATE LINE
// ============================================================

router.post('/:id/lines', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId     = req.user.orgId;
  const sessionId = parseInt(req.params.id);

  const session = await pool.request()
    .input('id',     sql.Int, sessionId)
    .input('org_id', sql.Int, orgId)
    .query('SELECT status FROM receiving_sessions WHERE id=@id AND org_id=@org_id');

  if (!session.recordset.length) return res.status(404).json({ success: false, error: 'Session not found.' });
  if (session.recordset[0].status !== 'open') {
    return res.status(409).json({ success: false, error: 'Only open sessions can have lines added.' });
  }

  const { product_id, expected_qty, received_qty, unit_cost, landed_cost_per_unit, put_away_bin_id } = req.body;

  if (!product_id) return res.status(400).json({ success: false, error: 'product_id is required.' });

  const rcvQty    = Math.max(0, Number(received_qty   || 0));
  const unitCost  = Math.max(0, Number(unit_cost      || 0));
  const landedCPU = Math.max(0, Number(landed_cost_per_unit || 0));
  const lineTotal = Math.round(rcvQty * (unitCost + landedCPU) * 10000) / 10000;

  // Verify product belongs to org
  const prod = await pool.request()
    .input('id',     sql.Int, product_id)
    .input('org_id', sql.Int, orgId)
    .query('SELECT 1 FROM products WHERE id=@id AND org_id=@org_id AND is_active=1');
  if (!prod.recordset.length) return res.status(400).json({ success: false, error: 'Product not found.' });

  // Upsert: if this product already has a line in the session, update it
  const existing = await pool.request()
    .input('session_id',  sql.Int, sessionId)
    .input('product_id',  sql.Int, product_id)
    .query('SELECT id FROM receiving_session_lines WHERE session_id=@session_id AND product_id=@product_id');

  if (existing.recordset.length) {
    const lineId = existing.recordset[0].id;
    await pool.request()
      .input('id',                  sql.Int,          lineId)
      .input('expected_qty',        sql.Decimal(18,4), Number(expected_qty || 0))
      .input('received_qty',        sql.Decimal(18,4), rcvQty)
      .input('unit_cost',           sql.Decimal(18,4), unitCost)
      .input('landed_cost_per_unit',sql.Decimal(18,4), landedCPU)
      .input('line_total',          sql.Decimal(18,4), lineTotal)
      .input('put_away_bin_id',     sql.Int,           put_away_bin_id || null)
      .query(`
        UPDATE receiving_session_lines
        SET expected_qty         = @expected_qty,
            received_qty         = @received_qty,
            unit_cost            = @unit_cost,
            landed_cost_per_unit = @landed_cost_per_unit,
            line_total           = @line_total,
            put_away_bin_id      = COALESCE(@put_away_bin_id, put_away_bin_id)
        WHERE id = @id
      `);
    return res.json({ success: true, data: { id: lineId } });
  }

  const result = await pool.request()
    .input('session_id',          sql.Int,          sessionId)
    .input('org_id',              sql.Int,          orgId)
    .input('product_id',          sql.Int,          product_id)
    .input('expected_qty',        sql.Decimal(18,4), Number(expected_qty || 0))
    .input('received_qty',        sql.Decimal(18,4), rcvQty)
    .input('unit_cost',           sql.Decimal(18,4), unitCost)
    .input('landed_cost_per_unit',sql.Decimal(18,4), landedCPU)
    .input('line_total',          sql.Decimal(18,4), lineTotal)
    .input('put_away_bin_id',     sql.Int,           put_away_bin_id || null)
    .query(`
      INSERT INTO receiving_session_lines
        (session_id, org_id, product_id, expected_qty, received_qty,
         unit_cost, landed_cost_per_unit, line_total, put_away_bin_id)
      OUTPUT INSERTED.id
      VALUES
        (@session_id, @org_id, @product_id, @expected_qty, @received_qty,
         @unit_cost, @landed_cost_per_unit, @line_total, @put_away_bin_id)
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id } });
}));

// ============================================================
// REMOVE LINE
// ============================================================

router.delete('/:id/lines/:lineId', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId     = req.user.orgId;
  const sessionId = parseInt(req.params.id);
  const lineId    = parseInt(req.params.lineId);

  const session = await pool.request()
    .input('id',     sql.Int, sessionId)
    .input('org_id', sql.Int, orgId)
    .query('SELECT status FROM receiving_sessions WHERE id=@id AND org_id=@org_id');

  if (!session.recordset.length) return res.status(404).json({ success: false, error: 'Session not found.' });
  if (session.recordset[0].status !== 'open') {
    return res.status(409).json({ success: false, error: 'Only open session lines can be removed.' });
  }

  await pool.request()
    .input('id',         sql.Int, lineId)
    .input('session_id', sql.Int, sessionId)
    .query('DELETE FROM receiving_session_lines WHERE id=@id AND session_id=@session_id');

  return res.json({ success: true });
}));

// ============================================================
// COMPLETE SESSION
// ============================================================

router.post('/:id/complete', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId     = req.user.orgId;
  const sessionId = parseInt(req.params.id);
  const userId    = req.user.userId;

  // ── Fetch session + lines ─────────────────────────────────
  const sessionRes = await pool.request()
    .input('id',     sql.Int, sessionId)
    .input('org_id', sql.Int, orgId)
    .query('SELECT * FROM receiving_sessions WHERE id=@id AND org_id=@org_id');

  if (!sessionRes.recordset.length) return res.status(404).json({ success: false, error: 'Session not found.' });
  const session = sessionRes.recordset[0];

  if (session.status !== 'open') {
    return res.status(409).json({ success: false, error: `Session is already ${session.status}.` });
  }

  const linesRes = await pool.request()
    .input('session_id', sql.Int, sessionId)
    .query('SELECT * FROM receiving_session_lines WHERE session_id=@session_id');

  const lines = linesRes.recordset;
  if (!lines.length) {
    return res.status(400).json({ success: false, error: 'Cannot complete a session with no lines.' });
  }

  // ── Validate lines ────────────────────────────────────────
  for (const l of lines) {
    if (Number(l.received_qty) <= 0) {
      return res.status(400).json({ success: false, error: `Line for product ${l.product_id} has received_qty = 0. Remove it or enter a quantity.` });
    }
    if (Number(l.unit_cost) <= 0) {
      return res.status(400).json({ success: false, error: `Line for product ${l.product_id} has no unit cost. Enter the cost before completing.` });
    }
  }

  // ── Resolve product category_ids for account determination ─
  const productIds = [...new Set(lines.map(l => l.product_id))];
  const prodRows = await pool.request()
    .query(`SELECT id, category_id FROM products WHERE id IN (${productIds.join(',')})`);
  const categoryByProduct = Object.fromEntries(prodRows.recordset.map(p => [p.id, p.category_id]));

  // Pre-resolve GL accounts per (category, warehouse) pair to fail fast before any mutations
  const resolvedMap = {};
  try {
    for (const line of lines) {
      const catId = categoryByProduct[line.product_id] ?? null;
      const key   = `${catId}:${session.warehouse_id}`;
      if (!resolvedMap[key]) {
        resolvedMap[key] = {
          // BSX = Inventory receipt (stock posting)
          bsx: await resolveAccount('BSX', catId, session.warehouse_id, orgId, pool, sql),
          // WRX = GR/IR clearing (AP accrual)
          wrx: await resolveAccount('WRX', catId, session.warehouse_id, orgId, pool, sql),
        };
      }
    }
  } catch (err) {
    if (err instanceof AccountDeterminationError) {
      return res.status(422).json({ success: false, error: err.message });
    }
    throw err;
  }

  const txn = pool.transaction();
  await txn.begin();

  try {
    let totalValue = 0;
    // GL line accumulators keyed by account_id
    const glDebits  = {};  // accountId → amount
    const glCredits = {};  // accountId → amount

    for (const line of lines) {
      const rcvQty   = Number(line.received_qty);
      const unitCost = Number(line.unit_cost) + Number(line.landed_cost_per_unit || 0);
      const totalCost = Math.round(rcvQty * unitCost * 10000) / 10000;
      totalValue += totalCost;

      const catId  = categoryByProduct[line.product_id] ?? null;
      const key    = `${catId}:${session.warehouse_id}`;
      const { bsx, wrx } = resolvedMap[key];

      glDebits[bsx]  = (glDebits[bsx]  || 0) + totalCost;
      glCredits[wrx] = (glCredits[wrx] || 0) + totalCost;

      // ── Stock movement (IN) ───────────────────────────────
      const movRes = await new sql.Request(txn)
        .input('org_id',        sql.Int,          orgId)
        .input('product_id',    sql.Int,          line.product_id)
        .input('warehouse_id',  sql.Int,          session.warehouse_id)
        .input('bin_id',        sql.Int,          line.put_away_bin_id || session.bin_id || null)
        .input('movement_type', sql.VarChar(30),  'receive')
        .input('qty',           sql.Decimal(18,4), rcvQty)
        .input('unit_cost',     sql.Decimal(18,4), unitCost)
        .input('total_cost',    sql.Decimal(18,4), totalCost)
        .input('reference_type',sql.VarChar(30),  'receiving_session')
        .input('reference_id',  sql.Int,          sessionId)
        .input('reference_line_id', sql.Int,      line.id)
        .input('moved_by',      sql.Int,          userId)
        .query(`
          INSERT INTO stock_movements
            (org_id, product_id, warehouse_id, bin_id, movement_type,
             qty, unit_cost, total_cost, reference_type, reference_id, reference_line_id,
             moved_by, moved_at)
          OUTPUT INSERTED.id
          VALUES
            (@org_id, @product_id, @warehouse_id, @bin_id, @movement_type,
             @qty, @unit_cost, @total_cost, @reference_type, @reference_id, @reference_line_id,
             @moved_by, GETDATE())
        `);
      const movId = movRes.recordset[0].id;

      // ── FIFO cost layer ───────────────────────────────────
      await new sql.Request(txn)
        .input('org_id',              sql.Int,          orgId)
        .input('product_id',          sql.Int,          line.product_id)
        .input('warehouse_id',        sql.Int,          session.warehouse_id)
        .input('reference_type',      sql.VarChar(30),  'receiving_session')
        .input('reference_id',        sql.Int,          sessionId)
        .input('reference_line_id',   sql.Int,          line.id)
        .input('qty_received',        sql.Decimal(18,4), rcvQty)
        .input('qty_remaining',       sql.Decimal(18,4), rcvQty)
        .input('unit_cost',           sql.Decimal(18,4), Number(line.unit_cost))
        .input('unit_cost_landed',    sql.Decimal(18,4), unitCost)
        .input('total_cost_received', sql.Decimal(18,4), totalCost)
        .input('total_cost_remaining',sql.Decimal(18,4), totalCost)
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
             @qty_received, @qty_remaining, 0,
             @unit_cost, @unit_cost_landed,
             @total_cost_received, @total_cost_remaining,
             'AUD', 1,
             0, 1, GETDATE())
        `);

      // ── Update stock levels ───────────────────────────────
      await new sql.Request(txn)
        .input('org_id',       sql.Int,          orgId)
        .input('product_id',   sql.Int,          line.product_id)
        .input('warehouse_id', sql.Int,          session.warehouse_id)
        .input('bin_id',       sql.Int,          line.put_away_bin_id || session.bin_id || null)
        .input('qty',          sql.Decimal(18,4), rcvQty)
        .query(`
          MERGE stock_levels AS target
          USING (SELECT @org_id AS org_id, @product_id AS product_id, @warehouse_id AS warehouse_id) AS source
            ON target.org_id=source.org_id AND target.product_id=source.product_id AND target.warehouse_id=source.warehouse_id
          WHEN MATCHED THEN
            UPDATE SET qty_on_hand = qty_on_hand + @qty, updated_at = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (org_id, product_id, warehouse_id, bin_id, qty_on_hand, qty_reserved, qty_on_order, updated_at)
            VALUES (@org_id, @product_id, @warehouse_id, @bin_id, @qty, 0, 0, GETDATE());
        `);
    }

    // ── GL journal entry: DR Inventory (BSX) / CR GR/IR (WRX) ──
    const glLines = [];
    for (const [accountId, amount] of Object.entries(glDebits)) {
      glLines.push({ accountId: Number(accountId), debit: Math.round(amount * 10000) / 10000, credit: 0, description: `Inventory receipt — ${session.session_number}` });
    }
    for (const [accountId, amount] of Object.entries(glCredits)) {
      glLines.push({ accountId: Number(accountId), debit: 0, credit: Math.round(amount * 10000) / 10000, description: `GR/IR clearing — ${session.session_number}` });
    }

    const glResult = await postJournalEntry({
      orgId,
      entryDate:     new Date(),
      description:   `Goods received — session ${session.session_number}`,
      source:        'receiving',
      referenceType: 'receiving_session',
      referenceId:   sessionId,
      createdBy:     userId,
      lines:         glLines,
    }, pool, sql);

    // ── Update session status ─────────────────────────────────
    await new sql.Request(txn)
      .input('id',          sql.Int,      sessionId)
      .input('gl_entry_id', sql.Int,      glResult.entryId)
      .query(`
        UPDATE receiving_sessions
        SET status       = 'complete',
            completed_at = GETDATE(),
            gl_entry_id  = @gl_entry_id,
            updated_at   = GETDATE()
        WHERE id = @id
      `);

    await txn.commit();

    return res.json({
      success: true,
      data: {
        session_id:     sessionId,
        gl_entry_id:    glResult.entryId,
        journal_number: glResult.entryNumber,
        total_value:    Math.round(totalValue * 100) / 100,
      },
    });

  } catch (err) {
    try { await txn.rollback(); } catch (_) { /* trigger may have already rolled back */ }
    throw err;
  }
}));

// ============================================================
// VOID SESSION
// ============================================================

router.post('/:id/void', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId     = req.user.orgId;
  const sessionId = parseInt(req.params.id);

  const session = await pool.request()
    .input('id',     sql.Int, sessionId)
    .input('org_id', sql.Int, orgId)
    .query('SELECT status FROM receiving_sessions WHERE id=@id AND org_id=@org_id');

  if (!session.recordset.length) return res.status(404).json({ success: false, error: 'Session not found.' });
  if (session.recordset[0].status === 'complete') {
    return res.status(409).json({ success: false, error: 'Completed sessions cannot be voided. Contact your accountant to reverse the journal entry.' });
  }

  await pool.request()
    .input('id',     sql.Int, sessionId)
    .input('org_id', sql.Int, orgId)
    .query(`
      UPDATE receiving_sessions
      SET status     = 'voided',
          updated_at = GETDATE()
      WHERE id=@id AND org_id=@org_id
    `);

  return res.json({ success: true });
}));

module.exports = router;
