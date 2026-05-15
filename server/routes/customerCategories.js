'use strict';
// ============================================================
// routes/customerCategories.js
//
// GET    /api/customer-categories            list all
// POST   /api/customer-categories            create
// PATCH  /api/customer-categories/:id        update
// DELETE /api/customer-categories/:id        delete (blocks if BPs assigned)
// GET    /api/customer-categories/:id/contacts
// POST   /api/customer-categories/:id/contacts  { bp_id } (or legacy contact_id)
// DELETE /api/customer-categories/:id/contacts/:cid  (cid = bp_id)
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
             (SELECT COUNT(*) FROM business_partners bp
              WHERE bp.customer_category_id = cc.id
                AND bp.is_active = 1) AS contact_count
      FROM customer_categories cc
      WHERE cc.org_id = @org_id AND cc.is_active = 1
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

  // Check usage in business_partners (primary) and legacy contacts
  const usageRes = await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM business_partners WHERE customer_category_id=@id AND is_active=1) AS bp_count,
        (SELECT COUNT(*) FROM contacts WHERE customer_category_id=@id AND is_void=0) AS legacy_count
    `);

  const total = usageRes.recordset[0].bp_count + usageRes.recordset[0].legacy_count;
  if (total > 0) {
    return res.status(409).json({
      success: false,
      error: `Cannot delete — ${total} partner(s)/contact(s) are assigned to this category. Reassign them first.`,
    });
  }

  await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query('DELETE FROM customer_categories WHERE id=@id AND org_id=@org_id');
  res.json({ success: true });
}));

// ── GET BUSINESS PARTNERS IN CATEGORY ────────────────────────
router.get('/:id/contacts', perm('read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const id    = parseInt(req.params.id, 10);
  const orgId = req.user.orgId;

  const rows = await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT bp.id AS bp_id, bp.bp_type,
        CASE bp.bp_type
          WHEN 'person'
            THEN LTRIM(RTRIM(COALESCE(bp.first_name, '') + ' ' + COALESCE(bp.last_name, '')))
          ELSE COALESCE(bp.trading_name, bp.legal_entity_name)
        END AS display_name,
        bp.email, bp.phone, bp.bp_role
      FROM business_partners bp
      WHERE bp.customer_category_id = @id
        AND bp.org_id  = @org_id
        AND bp.is_active = 1
      ORDER BY display_name
    `);
  res.json({ success: true, data: rows.recordset });
}));

// ── ASSIGN BUSINESS PARTNER TO CATEGORY ──────────────────────
// Accepts { bp_id } (preferred) or legacy { contact_id } for backward compat.
router.post('/:id/contacts', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const categoryId = parseInt(req.params.id, 10);
  const orgId      = req.user.orgId;

  // Prefer bp_id; fall back to resolving via contact_id
  let bpId = req.body.bp_id ? parseInt(req.body.bp_id, 10) : null;

  if (!bpId && req.body.contact_id) {
    // Legacy path: resolve BP from the contact
    const legacyRes = await pool.request()
      .input('contact_id', sql.Int, parseInt(req.body.contact_id, 10))
      .input('org_id',     sql.Int, orgId)
      .query('SELECT id FROM business_partners WHERE legacy_contact_id = @contact_id AND org_id = @org_id AND is_active = 1');
    if (legacyRes.recordset.length) {
      bpId = legacyRes.recordset[0].id;
    }
  }

  if (!bpId) {
    return res.status(400).json({ success: false, error: 'bp_id (or contact_id) is required.' });
  }

  await pool.request()
    .input('category_id', sql.Int, categoryId)
    .input('bp_id',       sql.Int, bpId)
    .input('org_id',      sql.Int, orgId)
    .query(`
      UPDATE business_partners
      SET customer_category_id = @category_id,
          updated_at           = GETDATE()
      WHERE id = @bp_id AND org_id = @org_id AND is_active = 1
    `);
  res.json({ success: true });
}));

// ── REMOVE BUSINESS PARTNER FROM CATEGORY ────────────────────
// :cid is now a bp_id
router.delete('/:id/contacts/:cid', perm('update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const bpId  = parseInt(req.params.cid, 10);
  const orgId = req.user.orgId;

  await pool.request()
    .input('bp_id',  sql.Int, bpId)
    .input('org_id', sql.Int, orgId)
    .query(`
      UPDATE business_partners
      SET customer_category_id = NULL,
          updated_at           = GETDATE()
      WHERE id = @bp_id AND org_id = @org_id
    `);
  res.json({ success: true });
}));

module.exports = router;
