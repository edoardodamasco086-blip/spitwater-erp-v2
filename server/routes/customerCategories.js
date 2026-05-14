'use strict';
// ============================================================
// routes/customerCategories.js
//
// GET    /api/customer-categories            list all
// POST   /api/customer-categories            create
// PATCH  /api/customer-categories/:id        update
// DELETE /api/customer-categories/:id        delete (blocks if contacts assigned)
// GET    /api/customer-categories/:id/contacts
// POST   /api/customer-categories/:id/contacts  { contact_id }
// DELETE /api/customer-categories/:id/contacts/:cid
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth }            = require('../middleware/auth');
const { asyncHandler }           = require('../middleware/errorHandler');
const { requirePermission }      = require('../middleware/permissions');

router.use(requireAuth);
const perm = action => requirePermission('contacts', action);

// ── LIST ──────────────────────────────────────────────────────
router.get('/', perm('read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;

  const rows = await pool.request()
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT cc.*,
             COUNT(c.id) AS contact_count
      FROM customer_categories cc
      LEFT JOIN contacts c ON c.customer_category_id = cc.id AND c.is_void = 0
      WHERE cc.org_id = @org_id AND cc.is_active = 1
      GROUP BY cc.id, cc.org_id, cc.name, cc.description, cc.color, cc.is_active, cc.created_at
      ORDER BY cc.name
    `);
  res.json({ success: true, data: rows.recordset });
}));

// ── CREATE ────────────────────────────────────────────────────
router.post('/', perm('write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const { name, description, color } = req.body;

  if (!name?.trim()) return res.status(400).json({ success: false, error: 'name is required.' });

  const r = await pool.request()
    .input('org_id',      sql.Int,           orgId)
    .input('name',        sql.NVarChar(100), name.trim())
    .input('description', sql.NVarChar(500), description?.trim() || null)
    .input('color',       sql.VarChar(7),    color || '#2F7FE8')
    .query(`
      DECLARE @out TABLE (id INT);
      INSERT INTO customer_categories (org_id, name, description, color, is_active, created_at)
      OUTPUT INSERTED.id INTO @out
      VALUES (@org_id, @name, @description, @color, 1, GETDATE());
      SELECT id FROM @out;
    `);
  res.status(201).json({ success: true, data: { id: r.recordset[0].id } });
}));

// ── UPDATE ────────────────────────────────────────────────────
router.patch('/:id', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id, 10);
  const { name, description, color } = req.body;

  await pool.request()
    .input('id',          sql.Int,           id)
    .input('org_id',      sql.Int,           orgId)
    .input('name',        sql.NVarChar(100), name?.trim()          || null)
    .input('description', sql.NVarChar(500), description?.trim()   || null)
    .input('color',       sql.VarChar(7),    color                 || null)
    .query(`
      UPDATE customer_categories
      SET name        = COALESCE(@name,        name),
          description = COALESCE(@description, description),
          color       = COALESCE(@color,       color)
      WHERE id=@id AND org_id=@org_id
    `);
  res.json({ success: true });
}));

// ── DELETE ────────────────────────────────────────────────────
router.delete('/:id', perm('delete'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id, 10);

  const usageRes = await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query(`SELECT COUNT(*) AS n FROM contacts WHERE customer_category_id=@id AND is_void=0`);

  if (usageRes.recordset[0].n > 0) {
    return res.status(409).json({
      success: false,
      error: `Cannot delete — ${usageRes.recordset[0].n} contact(s) are assigned to this category. Reassign them first.`,
    });
  }

  await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query('DELETE FROM customer_categories WHERE id=@id AND org_id=@org_id');
  res.json({ success: true });
}));

// ── GET CONTACTS IN CATEGORY ──────────────────────────────────
router.get('/:id/contacts', perm('read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const id    = parseInt(req.params.id, 10);
  const orgId = req.user.orgId;

  const rows = await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT id, full_name, email, contact_type
      FROM contacts
      WHERE customer_category_id=@id AND org_id=@org_id AND is_void=0
      ORDER BY full_name
    `);
  res.json({ success: true, data: rows.recordset });
}));

// ── ASSIGN CONTACT ────────────────────────────────────────────
router.post('/:id/contacts', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const id        = parseInt(req.params.id, 10);
  const orgId     = req.user.orgId;
  const contactId = parseInt(req.body.contact_id, 10);

  await pool.request()
    .input('category_id', sql.Int, id)
    .input('contact_id',  sql.Int, contactId)
    .input('org_id',      sql.Int, orgId)
    .query(`
      UPDATE contacts SET customer_category_id=@category_id, updated_at=GETDATE()
      WHERE id=@contact_id AND org_id=@org_id AND is_void=0
    `);
  res.json({ success: true });
}));

// ── REMOVE CONTACT FROM CATEGORY ─────────────────────────────
router.delete('/:id/contacts/:cid', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const contactId = parseInt(req.params.cid, 10);
  const orgId     = req.user.orgId;

  await pool.request()
    .input('contact_id', sql.Int, contactId)
    .input('org_id',     sql.Int, orgId)
    .query(`
      UPDATE contacts SET customer_category_id=NULL, updated_at=GETDATE()
      WHERE id=@contact_id AND org_id=@org_id
    `);
  res.json({ success: true });
}));

module.exports = router;
