'use strict';

/**
 * P2P Approval Engine — multi-level PO release strategy.
 *
 * Approval levels are configured per-org in po_approval_levels.
 * A PO requires approval from ALL levels whose min_amount <= po.total_value.
 * Levels are processed sequentially (level 1 first, then 2, etc.).
 *
 * State machine:
 *   draft → pending_approval → approved   (if all levels pass)
 *                            → rejected   (if any level rejects)
 *   approved → sent → partially_received → fully_received → closed
 */

/**
 * Returns ordered approval levels that apply to a given PO total value.
 * If no levels apply → auto-approve (empty array).
 */
async function getRequiredLevels(totalValue, orgId, pool, sql) {
  const res = await pool.request()
    .input('org_id', sql.Int,         orgId)
    .input('amount', sql.Decimal(18,4), Number(totalValue))
    .query(`
      SELECT id, level, level_name, min_amount, max_amount, approver_role
      FROM po_approval_levels
      WHERE org_id   = @org_id
        AND is_active = 1
        AND min_amount <= @amount
      ORDER BY level ASC
    `);
  return res.recordset;
}

/**
 * Submit a PO for approval.
 * Creates approval request(s) starting at level 1.
 * If no levels apply → immediately approves the PO.
 *
 * Returns { autoApproved: bool, levelsRequired: number }
 */
async function submitForApproval(po, requesterId, pool, sql) {
  const levels = await getRequiredLevels(po.total_value, po.org_id, pool, sql);

  if (!levels.length) {
    // No approval rules → auto-approve
    await pool.request()
      .input('id',     sql.Int, po.id)
      .input('org_id', sql.Int, po.org_id)
      .query(`
        UPDATE purchase_orders
        SET status                  = 'approved',
            approval_levels_required = 0,
            current_approval_level   = 0,
            updated_at               = GETDATE()
        WHERE id = @id AND org_id = @org_id
      `);
    return { autoApproved: true, levelsRequired: 0 };
  }

  // Persist required level count on the PO
  await pool.request()
    .input('id',      sql.Int, po.id)
    .input('org_id',  sql.Int, po.org_id)
    .input('levels',  sql.Int, levels.length)
    .query(`
      UPDATE purchase_orders
      SET status                  = 'pending_approval',
          approval_levels_required = @levels,
          current_approval_level   = 1,
          updated_at               = GETDATE()
      WHERE id = @id AND org_id = @org_id
    `);

  // Create approval request for level 1 only (next levels created on approval)
  const l1 = levels[0];
  await pool.request()
    .input('po_id',          sql.Int,          po.id)
    .input('org_id',         sql.Int,          po.org_id)
    .input('approval_level', sql.Int,          l1.level)
    .input('level_name',     sql.NVarChar(100), l1.level_name)
    .input('requested_by',   sql.Int,          requesterId)
    .query(`
      INSERT INTO po_approval_requests (po_id, org_id, approval_level, level_name, status, requested_by, requested_at)
      VALUES (@po_id, @org_id, @approval_level, @level_name, 'pending', @requested_by, GETDATE())
    `);

  return { autoApproved: false, levelsRequired: levels.length };
}

/**
 * Process an approval action (approve or reject) on the current pending level.
 *
 * Returns { newStatus, nextLevel }
 */
async function processApproval(po, actionUserId, action, comments, pool, sql) {
  if (!['approve', 'reject'].includes(action)) {
    throw new Error('action must be "approve" or "reject".');
  }

  // Get current pending approval request
  const reqRes = await pool.request()
    .input('po_id',  sql.Int, po.id)
    .input('org_id', sql.Int, po.org_id)
    .query(`
      SELECT TOP 1 id, approval_level
      FROM po_approval_requests
      WHERE po_id = @po_id AND org_id = @org_id AND status = 'pending'
      ORDER BY approval_level ASC
    `);

  if (!reqRes.recordset.length) {
    throw new Error('No pending approval request found for this PO.');
  }

  const req          = reqRes.recordset[0];
  const newReqStatus = action === 'approve' ? 'approved' : 'rejected';

  // Update the approval request
  await pool.request()
    .input('id',          sql.Int,          req.id)
    .input('status',      sql.VarChar(20),  newReqStatus)
    .input('actioned_by', sql.Int,          actionUserId)
    .input('comments',    sql.NVarChar(500), comments || null)
    .query(`
      UPDATE po_approval_requests
      SET status      = @status,
          actioned_by = @actioned_by,
          actioned_at = GETDATE(),
          comments    = @comments
      WHERE id = @id
    `);

  if (action === 'reject') {
    await pool.request()
      .input('id',     sql.Int, po.id)
      .input('org_id', sql.Int, po.org_id)
      .query(`
        UPDATE purchase_orders
        SET status     = 'rejected', updated_at = GETDATE()
        WHERE id = @id AND org_id = @org_id
      `);
    return { newStatus: 'rejected', nextLevel: null };
  }

  // Approved — check if more levels remain
  const levels = await getRequiredLevels(po.total_value, po.org_id, pool, sql);
  const nextLevelDef = levels.find(l => l.level > req.approval_level);

  if (!nextLevelDef) {
    // All levels approved
    await pool.request()
      .input('id',     sql.Int, po.id)
      .input('org_id', sql.Int, po.org_id)
      .query(`
        UPDATE purchase_orders
        SET status     = 'approved', updated_at = GETDATE()
        WHERE id = @id AND org_id = @org_id
      `);
    return { newStatus: 'approved', nextLevel: null };
  }

  // Advance to next level
  await pool.request()
    .input('id',     sql.Int, po.id)
    .input('org_id', sql.Int, po.org_id)
    .input('level',  sql.Int, nextLevelDef.level)
    .query(`
      UPDATE purchase_orders
      SET current_approval_level = @level, updated_at = GETDATE()
      WHERE id = @id AND org_id = @org_id
    `);

  await pool.request()
    .input('po_id',          sql.Int,          po.id)
    .input('org_id',         sql.Int,          po.org_id)
    .input('approval_level', sql.Int,          nextLevelDef.level)
    .input('level_name',     sql.NVarChar(100), nextLevelDef.level_name)
    .input('requested_by',   sql.Int,          actionUserId)
    .query(`
      INSERT INTO po_approval_requests (po_id, org_id, approval_level, level_name, status, requested_by, requested_at)
      VALUES (@po_id, @org_id, @approval_level, @level_name, 'pending', @requested_by, GETDATE())
    `);

  return { newStatus: 'pending_approval', nextLevel: nextLevelDef.level };
}

/**
 * Recalculate and sync PO total_value from its items.
 */
async function syncPoTotal(poId, orgId, pool, sql) {
  await pool.request()
    .input('po_id',  sql.Int, poId)
    .input('org_id', sql.Int, orgId)
    .query(`
      UPDATE purchase_orders
      SET total_value = (
            SELECT ISNULL(SUM(qty_ordered * unit_price), 0)
            FROM purchase_order_items
            WHERE po_id = @po_id
          ),
          updated_at = GETDATE()
      WHERE id = @po_id AND org_id = @org_id
    `);
}

/**
 * After WMS GR posts, update qty_received on matching PO items.
 * Returns { updated: number } — count of PO item rows updated.
 */
async function applyGrToPo(poId, deliveryItems, orgId, txnRequest, sql) {
  let updated = 0;
  for (const di of deliveryItems) {
    const r = await txnRequest()
      .input('po_id',      sql.Int,          poId)
      .input('product_id', sql.Int,          di.product_id)
      .input('qty',        sql.Decimal(18,4), Number(di.received_qty))
      .query(`
        UPDATE purchase_order_items
        SET qty_received = qty_received + @qty
        WHERE po_id = @po_id AND product_id = @product_id
      `);
    if (r.rowsAffected[0] > 0) updated++;
  }

  // Check if fully received
  const checkRes = await txnRequest()
    .input('po_id', sql.Int, poId)
    .query(`
      SELECT
        COUNT(*) AS total_lines,
        SUM(CASE WHEN qty_received >= qty_ordered THEN 1 ELSE 0 END) AS fully_received_lines
      FROM purchase_order_items
      WHERE po_id = @po_id
    `);

  const { total_lines, fully_received_lines } = checkRes.recordset[0];
  const newStatus = fully_received_lines >= total_lines ? 'fully_received' : 'partially_received';

  await txnRequest()
    .input('po_id',   sql.Int,     poId)
    .input('status',  sql.VarChar(30), newStatus)
    .query(`
      UPDATE purchase_orders
      SET status = @status, updated_at = GETDATE()
      WHERE id = @po_id AND status IN ('approved','sent','partially_received')
    `);

  return { updated, poStatus: newStatus };
}

module.exports = { getRequiredLevels, submitForApproval, processApproval, syncPoTotal, applyGrToPo };
