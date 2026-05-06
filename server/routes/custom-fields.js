'use strict';
// ============================================================
// routes/custom-fields.js  —  Generic custom field admin API
//
// GET    /api/custom-fields?entity_key=&scope_key=   list definitions
// POST   /api/custom-fields                          create definition
// PATCH  /api/custom-fields/:id                      update definition
// DELETE /api/custom-fields/:id                      soft-delete
//
// entity_key examples : 'product', 'contact', 'invoice', 'sales_order', 'warehouse'
// scope_key examples  : null (all), '5' (product category id), 'customer', 'supplier'
// ============================================================

const express = require('express');
const router  = express.Router();
const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth }            = require('../middleware/auth');
const { requirePermission }      = require('../middleware/permissions');
const { asyncHandler }           = require('../middleware/errorHandler');

router.use(requireAuth);

// ── GET /api/custom-fields ────────────────────────────────────
// Admin: list all definitions, optionally filtered by entity_key / scope_key
router.get('/', requirePermission('settings', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId      = req.user.orgId;
  const entityKey  = req.query.entity_key || null;
  const scopeKey   = req.query.scope_key  || null;          // empty string → null
  const scopeParam = scopeKey === '' ? null : scopeKey;

  let where = 'WHERE cfd.org_id = @org_id AND cfd.is_active = 1';
  if (entityKey) where += ' AND cfd.entity_key = @entity_key';
  if (scopeParam !== null) where += ' AND (cfd.scope_key = @scope_key OR cfd.scope_key IS NULL)';

  const [fields, options] = await Promise.all([
    pool.request()
      .input('org_id',      sql.Int,           orgId)
      .input('entity_key',  sql.VarChar(100),  entityKey || '')
      .input('scope_key',   sql.NVarChar(100), scopeParam)
      .query(`
        SELECT cfd.id, cfd.entity_key, cfd.scope_key, cfd.field_key, cfd.field_label,
               cfd.field_type, cfd.placeholder, cfd.help_text,
               cfd.is_required, cfd.is_shown_in_list, cfd.is_shown_on_pdf, cfd.is_readonly,
               cfd.is_active, cfd.sort_order,
               cfd.validation_min, cfd.validation_max, cfd.section_key, cfd.default_value
        FROM custom_field_definitions cfd
        ${where}
        ORDER BY cfd.sort_order ASC, cfd.field_label ASC
      `),
    pool.request()
      .input('org_id',     sql.Int,          orgId)
      .input('entity_key', sql.VarChar(100), entityKey || '')
      .query(`
        SELECT cfo.id, cfo.field_definition_id, cfo.option_key, cfo.option_label,
               cfo.option_color, cfo.sort_order
        FROM custom_field_options cfo
        INNER JOIN custom_field_definitions cfd ON cfd.id = cfo.field_definition_id
        WHERE cfd.org_id = @org_id ${entityKey ? 'AND cfd.entity_key = @entity_key' : ''}
        ORDER BY cfo.sort_order ASC
      `),
  ]);

  const optMap = {};
  options.recordset.forEach(o => {
    if (!optMap[o.field_definition_id]) optMap[o.field_definition_id] = [];
    optMap[o.field_definition_id].push(o);
  });
  const data = fields.recordset.map(f => ({ ...f, options: optMap[f.id] || [] }));

  return res.json({ success: true, data });
}));

// ── POST /api/custom-fields ───────────────────────────────────
router.post('/', requirePermission('settings', 'update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const {
    entity_key, scope_key = null,
    field_key, field_label, field_type = 'text',
    placeholder, help_text,
    is_required = false, is_shown_in_list = false, is_shown_on_pdf = false,
    sort_order = 0, validation_min, validation_max, section_key, default_value,
    options = [],
  } = req.body;

  if (!entity_key) return res.status(400).json({ success: false, error: 'entity_key is required.' });
  if (!field_key || !field_label) return res.status(400).json({ success: false, error: 'field_key and field_label are required.' });

  const result = await pool.request()
    .input('org_id',           sql.Int,           req.user.orgId)
    .input('entity_key',       sql.VarChar(100),  entity_key)
    .input('scope_key',        sql.NVarChar(100), scope_key || null)
    .input('field_key',        sql.VarChar(100),  field_key.toLowerCase().replace(/\s+/g, '_'))
    .input('field_label',      sql.NVarChar(200), field_label.trim())
    .input('field_type',       sql.VarChar(30),   field_type)
    .input('placeholder',      sql.NVarChar(200), placeholder  || null)
    .input('help_text',        sql.NVarChar(500), help_text    || null)
    .input('is_required',      sql.Bit,           is_required       ? 1 : 0)
    .input('is_shown_in_list', sql.Bit,           is_shown_in_list  ? 1 : 0)
    .input('is_shown_on_pdf',  sql.Bit,           is_shown_on_pdf   ? 1 : 0)
    .input('sort_order',       sql.Int,           sort_order)
    .input('validation_min',   sql.Decimal(18,4), validation_min  != null && validation_min !== '' ? parseFloat(validation_min)  : null)
    .input('validation_max',   sql.Decimal(18,4), validation_max  != null && validation_max !== '' ? parseFloat(validation_max)  : null)
    .input('section_key',      sql.VarChar(100),  section_key    || null)
    .input('default_value',    sql.NVarChar(1000),default_value  || null)
    .input('created_by',       sql.Int,           req.user.userId)
    .query(`
      INSERT INTO custom_field_definitions
        (org_id, entity_key, scope_key, field_key, field_label, field_type,
         placeholder, help_text, is_required, is_shown_in_list, is_shown_on_pdf,
         is_active, sort_order, validation_min, validation_max,
         section_key, default_value, created_by, created_at, updated_at)
      OUTPUT INSERTED.id
      VALUES
        (@org_id, @entity_key, @scope_key, @field_key, @field_label, @field_type,
         @placeholder, @help_text, @is_required, @is_shown_in_list, @is_shown_on_pdf,
         1, @sort_order, @validation_min, @validation_max,
         @section_key, @default_value, @created_by, GETDATE(), GETDATE())
    `);

  const defId = result.recordset[0].id;

  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    await pool.request()
      .input('field_definition_id', sql.Int,           defId)
      .input('option_key',          sql.VarChar(100),  opt.key   || `option_${i}`)
      .input('option_label',        sql.NVarChar(200), opt.label || `Option ${i + 1}`)
      .input('option_color',        sql.VarChar(7),    opt.color || null)
      .input('sort_order',          sql.Int,           i)
      .query(`
        INSERT INTO custom_field_options (field_definition_id, option_key, option_label, option_color, sort_order)
        VALUES (@field_definition_id, @option_key, @option_label, @option_color, @sort_order)
      `);
  }

  return res.status(201).json({ success: true, data: { id: defId }, message: `Field "${field_label}" created.` });
}));

// ── PATCH /api/custom-fields/:id ──────────────────────────────
router.patch('/:id', requirePermission('settings', 'update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const defId = parseInt(req.params.id);
  const {
    field_label, placeholder, help_text, scope_key,
    is_required, is_shown_in_list, is_shown_on_pdf,
    sort_order, validation_min, validation_max, section_key, default_value,
    options,
  } = req.body;

  await pool.request()
    .input('id',               sql.Int,           defId)
    .input('org_id',           sql.Int,           req.user.orgId)
    .input('scope_key',        sql.NVarChar(100), scope_key ?? null)
    .input('field_label',      sql.NVarChar(200), field_label)
    .input('placeholder',      sql.NVarChar(200), placeholder)
    .input('help_text',        sql.NVarChar(500), help_text)
    .input('is_required',      sql.Bit,           is_required       != null ? (is_required       ? 1 : 0) : null)
    .input('is_shown_in_list', sql.Bit,           is_shown_in_list  != null ? (is_shown_in_list  ? 1 : 0) : null)
    .input('is_shown_on_pdf',  sql.Bit,           is_shown_on_pdf   != null ? (is_shown_on_pdf   ? 1 : 0) : null)
    .input('sort_order',       sql.Int,           sort_order)
    .input('validation_min',   sql.Decimal(18,4), validation_min  != null && validation_min !== '' ? parseFloat(validation_min)  : null)
    .input('validation_max',   sql.Decimal(18,4), validation_max  != null && validation_max !== '' ? parseFloat(validation_max)  : null)
    .input('section_key',      sql.VarChar(100),  section_key)
    .input('default_value',    sql.NVarChar(1000),default_value)
    .input('updated_by',       sql.Int,           req.user.userId)
    .query(`
      UPDATE custom_field_definitions SET
        scope_key        = COALESCE(@scope_key, scope_key),
        field_label      = COALESCE(@field_label, field_label),
        placeholder      = COALESCE(@placeholder, placeholder),
        help_text        = COALESCE(@help_text, help_text),
        is_required      = COALESCE(@is_required, is_required),
        is_shown_in_list = COALESCE(@is_shown_in_list, is_shown_in_list),
        is_shown_on_pdf  = COALESCE(@is_shown_on_pdf, is_shown_on_pdf),
        sort_order       = COALESCE(@sort_order, sort_order),
        validation_min   = COALESCE(@validation_min, validation_min),
        validation_max   = COALESCE(@validation_max, validation_max),
        section_key      = COALESCE(@section_key, section_key),
        default_value    = COALESCE(@default_value, default_value),
        updated_by       = @updated_by,
        updated_at       = GETDATE()
      WHERE id = @id AND org_id = @org_id
    `);

  // Replace options if provided
  if (Array.isArray(options)) {
    await pool.request().input('id', sql.Int, defId).query('DELETE FROM custom_field_options WHERE field_definition_id = @id');
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      await pool.request()
        .input('field_definition_id', sql.Int,           defId)
        .input('option_key',          sql.VarChar(100),  opt.key   || `option_${i}`)
        .input('option_label',        sql.NVarChar(200), opt.label || `Option ${i + 1}`)
        .input('option_color',        sql.VarChar(7),    opt.color || null)
        .input('sort_order',          sql.Int,           i)
        .query(`
          INSERT INTO custom_field_options (field_definition_id, option_key, option_label, option_color, sort_order)
          VALUES (@field_definition_id, @option_key, @option_label, @option_color, @sort_order)
        `);
    }
  }

  return res.json({ success: true, message: 'Field updated.' });
}));

// ── DELETE /api/custom-fields/:id ────────────────────────────
router.delete('/:id', requirePermission('settings', 'update'), asyncHandler(async (req, res) => {
  await poolConnect;
  await pool.request()
    .input('id',     sql.Int, parseInt(req.params.id))
    .input('org_id', sql.Int, req.user.orgId)
    .query('UPDATE custom_field_definitions SET is_active = 0 WHERE id = @id AND org_id = @org_id');
  return res.json({ success: true, message: 'Field removed.' });
}));

module.exports = router;
