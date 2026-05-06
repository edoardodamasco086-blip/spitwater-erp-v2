'use strict';
// ============================================================
// routes/price-lists.js
//
// GET    /api/price-lists                    — list all
// POST   /api/price-lists                    — create
// PATCH  /api/price-lists/:id                — update
// DELETE /api/price-lists/:id                — deactivate
//
// Contact assignments:
// GET    /api/price-lists/:id/contacts       — contacts on this list
// POST   /api/price-lists/:id/contacts       — assign contact
// DELETE /api/price-lists/:id/contacts/:cid  — unassign contact
//
// Stats:
// GET    /api/price-lists/:id/stats          — product count, contact count
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect }          = require('../config/db');
const { requireAuth, requireRole }        = require('../middleware/auth');
const { asyncHandler }                    = require('../middleware/errorHandler');

router.use(requireAuth);

const PRICE_LIST_TYPES = ['retail','wholesale','dealer','trade','cost','special'];

// ── GET /api/price-lists ──────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  await poolConnect;
  const rows = await pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .query(`
      SELECT
        pl.id, pl.name, pl.price_list_type, pl.currency_code,
        pl.is_default, pl.is_tax_inclusive, pl.description,
        pl.valid_from, pl.valid_to, pl.is_active,
        pl.created_at, pl.updated_at,
        (SELECT COUNT(DISTINCT pli.product_id)
         FROM price_list_items pli WHERE pli.price_list_id = pl.id) AS product_count,
        (SELECT COUNT(*) FROM contact_price_lists cpl WHERE cpl.price_list_id = pl.id) AS contact_count
      FROM price_lists pl
      WHERE pl.org_id = @org_id
      ORDER BY pl.is_default DESC, pl.name ASC
    `);
  return res.json({ success: true, data: rows.recordset });
}));

// ── POST /api/price-lists ─────────────────────────────────────
router.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const {
    name, price_list_type = 'retail', currency_code = 'AUD',
    is_default = false, is_tax_inclusive = false,
    description, valid_from, valid_to,
  } = req.body;

  if (!name?.trim()) return res.status(400).json({ success: false, error: 'name is required.' });
  if (!PRICE_LIST_TYPES.includes(price_list_type))
    return res.status(400).json({ success: false, error: `Invalid type. Must be: ${PRICE_LIST_TYPES.join(', ')}` });

  // Only one default per org
  if (is_default) {
    await pool.request().input('org_id', sql.Int, req.user.orgId)
      .query('UPDATE price_lists SET is_default=0 WHERE org_id=@org_id');
  }

  const result = await pool.request()
    .input('org_id',          sql.Int,          req.user.orgId)
    .input('name',            sql.NVarChar(200), name.trim())
    .input('price_list_type', sql.VarChar(20),   price_list_type)
    .input('currency_code',   sql.VarChar(3),    currency_code.toUpperCase())
    .input('is_default',      sql.Bit,           is_default      ? 1 : 0)
    .input('is_tax_inclusive',sql.Bit,           is_tax_inclusive? 1 : 0)
    .input('description',     sql.NVarChar(500), description     || null)
    .input('valid_from',      sql.Date,          valid_from      || null)
    .input('valid_to',        sql.Date,          valid_to        || null)
    .query(`
      INSERT INTO price_lists
        (org_id,name,price_list_type,currency_code,is_default,is_tax_inclusive,description,valid_from,valid_to,is_active,created_at,updated_at)
      OUTPUT INSERTED.id
      VALUES
        (@org_id,@name,@price_list_type,@currency_code,@is_default,@is_tax_inclusive,@description,@valid_from,@valid_to,1,GETDATE(),GETDATE())
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id }, message: `Price list "${name}" created.` });
}));

// ── PATCH /api/price-lists/:id ────────────────────────────────
router.patch('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const id = parseInt(req.params.id);
  const {
    name, price_list_type, currency_code,
    is_default, is_tax_inclusive, description,
    valid_from, valid_to, is_active,
  } = req.body;

  if (is_default) {
    await pool.request().input('org_id', sql.Int, req.user.orgId).input('id', sql.Int, id)
      .query('UPDATE price_lists SET is_default=0 WHERE org_id=@org_id AND id<>@id');
  }

  await pool.request()
    .input('id',              sql.Int,          id)
    .input('org_id',          sql.Int,          req.user.orgId)
    .input('name',            sql.NVarChar(200), name             || null)
    .input('price_list_type', sql.VarChar(20),   price_list_type  || null)
    .input('currency_code',   sql.VarChar(3),    currency_code    || null)
    .input('is_default',      sql.Bit,           is_default      != null ? (is_default       ? 1 : 0) : null)
    .input('is_tax_inclusive',sql.Bit,           is_tax_inclusive != null ? (is_tax_inclusive ? 1 : 0) : null)
    .input('description',     sql.NVarChar(500), description      || null)
    .input('valid_from',      sql.Date,          valid_from       || null)
    .input('valid_to',        sql.Date,          valid_to         || null)
    .input('is_active',       sql.Bit,           is_active       != null ? (is_active        ? 1 : 0) : null)
    .query(`
      UPDATE price_lists SET
        name              = COALESCE(@name,             name),
        price_list_type   = COALESCE(@price_list_type,  price_list_type),
        currency_code     = COALESCE(@currency_code,    currency_code),
        is_default        = COALESCE(@is_default,       is_default),
        is_tax_inclusive  = COALESCE(@is_tax_inclusive, is_tax_inclusive),
        description       = COALESCE(@description,      description),
        valid_from        = COALESCE(@valid_from,       valid_from),
        valid_to          = COALESCE(@valid_to,         valid_to),
        is_active         = COALESCE(@is_active,        is_active),
        updated_at        = GETDATE()
      WHERE id=@id AND org_id=@org_id
    `);

  return res.json({ success: true, message: 'Price list updated.' });
}));

// ── DELETE /api/price-lists/:id ───────────────────────────────
router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const id = parseInt(req.params.id);

  // Check if default — can't delete default
  const check = await pool.request()
    .input('id', sql.Int, id).input('org_id', sql.Int, req.user.orgId)
    .query('SELECT is_default FROM price_lists WHERE id=@id AND org_id=@org_id');
  if (!check.recordset.length) return res.status(404).json({ success: false, error: 'Not found.' });
  if (check.recordset[0].is_default) return res.status(409).json({ success: false, error: 'Cannot delete the default price list. Set another as default first.' });

  // Soft delete
  await pool.request().input('id', sql.Int, id).input('org_id', sql.Int, req.user.orgId)
    .query('UPDATE price_lists SET is_active=0, updated_at=GETDATE() WHERE id=@id AND org_id=@org_id');

  return res.json({ success: true, message: 'Price list deactivated.' });
}));

// ── GET /api/price-lists/:id/contacts ────────────────────────
router.get('/:id/contacts', asyncHandler(async (req, res) => {
  await poolConnect;
  const rows = await pool.request()
    .input('price_list_id', sql.Int, parseInt(req.params.id))
    .query(`
      SELECT c.id, c.full_name, c.email, c.contact_type, cpl.assigned_at
      FROM contact_price_lists cpl
      INNER JOIN contacts c ON c.id = cpl.contact_id
      WHERE cpl.price_list_id = @price_list_id
      ORDER BY c.full_name ASC
    `);
  return res.json({ success: true, data: rows.recordset });
}));

// ── POST /api/price-lists/:id/contacts ────────────────────────
// Assigns a contact — upserts (a contact can only have one price list)
router.post('/:id/contacts', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { contactId } = req.body;
  if (!contactId) return res.status(400).json({ success: false, error: 'contactId required.' });

  await pool.request()
    .input('contact_id',    sql.Int, parseInt(contactId))
    .input('price_list_id', sql.Int, parseInt(req.params.id))
    .input('assigned_by',   sql.Int, req.user.userId)
    .query(`
      IF EXISTS (SELECT 1 FROM contact_price_lists WHERE contact_id=@contact_id)
        UPDATE contact_price_lists SET price_list_id=@price_list_id, assigned_at=GETDATE(), assigned_by=@assigned_by
        WHERE contact_id=@contact_id
      ELSE
        INSERT INTO contact_price_lists (contact_id,price_list_id,assigned_by,assigned_at)
        VALUES (@contact_id,@price_list_id,@assigned_by,GETDATE())
    `);

  return res.json({ success: true, message: 'Contact assigned to price list.' });
}));

// ── DELETE /api/price-lists/:id/contacts/:cid ─────────────────
router.delete('/:id/contacts/:cid', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  await pool.request()
    .input('contact_id',    sql.Int, parseInt(req.params.cid))
    .input('price_list_id', sql.Int, parseInt(req.params.id))
    .query('DELETE FROM contact_price_lists WHERE contact_id=@contact_id AND price_list_id=@price_list_id');
  return res.json({ success: true, message: 'Contact removed from price list.' });
}));

module.exports = router;
