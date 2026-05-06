'use strict';
// ============================================================
// routes/product-association-types.js
//
// GET    /api/product-association-types
// POST   /api/product-association-types
// PATCH  /api/product-association-types/:id
// DELETE /api/product-association-types/:id
// ============================================================

const express = require('express');
const router  = express.Router();
const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth }            = require('../middleware/auth');
const { requirePermission }      = require('../middleware/permissions');
const { asyncHandler }           = require('../middleware/errorHandler');

router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  await poolConnect;
  const rows = await pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .query(`
      SELECT id, type_key, label, reverse_label, is_bidirectional, is_active, sort_order, icon, colour
      FROM product_association_types
      WHERE org_id = @org_id AND is_active = 1
      ORDER BY sort_order ASC, label ASC
    `);
  return res.json({ success: true, data: rows.recordset });
}));

router.post('/', requirePermission('settings','update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { type_key, label, reverse_label, is_bidirectional = 0, sort_order = 0, icon, colour } = req.body;
  if (!label) return res.status(400).json({ success: false, error: 'label required.' });

  const result = await pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .input('type_key', sql.VarChar(50), type_key || label.toLowerCase().replace(/[^a-z0-9]/g, '_'))
    .input('label', sql.NVarChar(100), label)
    .input('reverse_label', sql.NVarChar(100), reverse_label || null)
    .input('is_bidirectional', sql.Bit, is_bidirectional ? 1 : 0)
    .input('sort_order', sql.Int, sort_order)
    .input('icon', sql.VarChar(50), icon || null)
    .input('colour', sql.VarChar(20), colour || null)
    .query(`
      INSERT INTO product_association_types (org_id, type_key, label, reverse_label, is_bidirectional, sort_order, icon, colour, is_active)
      OUTPUT INSERTED.id
      VALUES (@org_id, @type_key, @label, @reverse_label, @is_bidirectional, @sort_order, @icon, @colour, 1)
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id } });
}));

router.patch('/:id', requirePermission('settings','update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { label, reverse_label, is_bidirectional, sort_order, icon, colour } = req.body;
  
  await pool.request()
    .input('id', sql.Int, parseInt(req.params.id))
    .input('org_id', sql.Int, req.user.orgId)
    .input('label', sql.NVarChar(100), label)
    .input('reverse_label', sql.NVarChar(100), reverse_label)
    .input('is_bidirectional', sql.Bit, is_bidirectional != null ? (is_bidirectional ? 1 : 0) : null)
    .input('sort_order', sql.Int, sort_order)
    .input('icon', sql.VarChar(50), icon)
    .input('colour', sql.VarChar(20), colour)
    .query(`
      UPDATE product_association_types SET
        label = COALESCE(@label, label),
        reverse_label = COALESCE(@reverse_label, reverse_label),
        is_bidirectional = COALESCE(@is_bidirectional, is_bidirectional),
        sort_order = COALESCE(@sort_order, sort_order),
        icon = COALESCE(@icon, icon),
        colour = COALESCE(@colour, colour)
      WHERE id = @id AND org_id = @org_id
    `);

  return res.json({ success: true, message: 'Type updated.' });
}));

router.delete('/:id', requirePermission('settings','update'), asyncHandler(async (req, res) => {
  await poolConnect;
  await pool.request()
    .input('id', sql.Int, parseInt(req.params.id))
    .input('org_id', sql.Int, req.user.orgId)
    .query('UPDATE product_association_types SET is_active = 0 WHERE id = @id AND org_id = @org_id');
  return res.json({ success: true, message: 'Type removed.' });
}));

module.exports = router;
