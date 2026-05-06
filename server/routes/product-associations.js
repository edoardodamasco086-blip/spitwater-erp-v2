'use strict';
// ============================================================
// routes/product-associations.js
//
// GET    /api/products/:id/associations
// POST   /api/products/:id/associations
// PATCH  /api/products/:id/associations/:assocId
// DELETE /api/products/:id/associations/:assocId
// ============================================================

const express = require('express');
const router  = express.Router({ mergeParams: true });
const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth }            = require('../middleware/auth');
const { requirePermission }      = require('../middleware/permissions');
const { asyncHandler }           = require('../middleware/errorHandler');

router.use(requireAuth);

router.get('/associations', requirePermission('products','read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const productId = parseInt(req.params.id);
  const orgId     = req.user.orgId;

  // We want to fetch BOTH outgoing associations (from_product_id = id)
  // AND incoming associations (to_product_id = id IF is_bidirectional = 1 OR if we want to show reverse)
  // Let's keep it simple: fetch where from_product_id = id
  // If the user wants to see bidirectional, we could union it.
  
  const rows = await pool.request()
    .input('product_id', sql.Int, productId)
    .input('org_id',     sql.Int, orgId)
    .query(`
      SELECT 
        a.id, a.association_type_id, a.from_product_id, a.to_product_id, a.sort_order, a.notes, a.created_at,
        t.type_key, t.label AS type_label, t.is_bidirectional, t.icon AS type_icon, t.colour AS type_colour,
        p.product_code AS to_product_code, p.name AS to_name,
        'outgoing' AS direction
      FROM product_associations a
      INNER JOIN product_association_types t ON t.id = a.association_type_id
      INNER JOIN products p ON p.id = a.to_product_id
      WHERE a.from_product_id = @product_id
        AND a.org_id = @org_id
        AND a.is_active = 1

      UNION ALL

      SELECT 
        a.id, a.association_type_id, a.from_product_id, a.to_product_id, a.sort_order, a.notes, a.created_at,
        t.type_key, COALESCE(t.reverse_label, t.label) AS type_label, t.is_bidirectional, t.icon AS type_icon, t.colour AS type_colour,
        p.product_code AS to_product_code, p.name AS to_name,
        'incoming' AS direction
      FROM product_associations a
      INNER JOIN product_association_types t ON t.id = a.association_type_id
      INNER JOIN products p ON p.id = a.from_product_id
      WHERE a.to_product_id = @product_id
        AND a.org_id = @org_id
        AND a.is_active = 1
        AND t.is_bidirectional = 1

      ORDER BY type_label ASC, sort_order ASC, to_name ASC
    `);

  return res.json({ success: true, data: rows.recordset });
}));

router.post('/associations', requirePermission('products','update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const productId = parseInt(req.params.id);
  const orgId     = req.user.orgId;

  const { association_type_id, to_product_id, sort_order = 0, notes } = req.body;
  if (!association_type_id || !to_product_id) {
    return res.status(400).json({ success: false, error: 'association_type_id and to_product_id are required.' });
  }

  const result = await pool.request()
    .input('org_id', sql.Int, orgId)
    .input('association_type_id', sql.Int, parseInt(association_type_id))
    .input('from_product_id', sql.Int, productId)
    .input('to_product_id', sql.Int, parseInt(to_product_id))
    .input('sort_order', sql.Int, sort_order)
    .input('notes', sql.NVarChar(sql.MAX), notes || null)
    .input('created_by', sql.Int, req.user.userId)
    .query(`
      INSERT INTO product_associations (org_id, association_type_id, from_product_id, to_product_id, sort_order, notes, is_active, created_by)
      OUTPUT INSERTED.id
      VALUES (@org_id, @association_type_id, @from_product_id, @to_product_id, @sort_order, @notes, 1, @created_by)
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id } });
}));

router.patch('/associations/:assocId', requirePermission('products','update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { sort_order, notes } = req.body;
  
  await pool.request()
    .input('id', sql.Int, parseInt(req.params.assocId))
    .input('org_id', sql.Int, req.user.orgId)
    .input('sort_order', sql.Int, sort_order)
    .input('notes', sql.NVarChar(sql.MAX), notes)
    .query(`
      UPDATE product_associations SET
        sort_order = COALESCE(@sort_order, sort_order),
        notes = COALESCE(@notes, notes)
      WHERE id = @id AND org_id = @org_id
    `);

  return res.json({ success: true, message: 'Association updated.' });
}));

router.delete('/associations/:assocId', requirePermission('products','update'), asyncHandler(async (req, res) => {
  await poolConnect;
  await pool.request()
    .input('id', sql.Int, parseInt(req.params.assocId))
    .input('org_id', sql.Int, req.user.orgId)
    .query('UPDATE product_associations SET is_active = 0 WHERE id = @id AND org_id = @org_id');
  return res.json({ success: true, message: 'Association removed.' });
}));

module.exports = router;
