'use strict';
// ============================================================
// routes/products.js
//
// GET    /api/products                     — list (search, filter, paginate)
// GET    /api/products/:id                 — full detail
// POST   /api/products                     — create (auto-number from series)
// PATCH  /api/products/:id                 — update
// PATCH  /api/products/:id/void            — soft archive
//
// Categories:
// GET    /api/products/categories          — category tree
// POST   /api/products/categories          — create category
// PATCH  /api/products/categories/:id      — update category
//
// Units of measure:
// GET    /api/products/uom                 — list UOMs
// POST   /api/products/uom                 — create UOM
//
// Images (multipart upload):
// POST   /api/products/:id/images          — upload image
// PATCH  /api/products/:id/images/:imgId/primary — set as primary
// DELETE /api/products/:id/images/:imgId   — delete image
//
// Documents (multipart upload):
// POST   /api/products/:id/documents       — upload document
// DELETE /api/products/:id/documents/:docId— delete document
//
// Custom fields:
// GET    /api/products/custom-fields        — list field definitions
// POST   /api/products/custom-fields        — create field
// PATCH  /api/products/custom-fields/:id    — update field
// GET    /api/products/:id/custom-values    — get values for product
// PUT    /api/products/:id/custom-values    — save all values for product
//
// Pricing:
// GET    /api/products/price-lists          — list price lists
// POST   /api/products/price-lists          — create price list
// GET    /api/products/:id/pricing          — get all price list entries for product
// PUT    /api/products/:id/pricing          — save all pricing for product
//
// Stock:
// GET    /api/products/:id/stock            — stock levels per warehouse
// ============================================================

const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');

const { sql, pool, poolConnect }              = require('../config/db');
const { requireAuth, requireRole, requireMinRole } = require('../middleware/auth');
const { requirePermission }                   = require('../middleware/permissions');
const { asyncHandler }                        = require('../middleware/errorHandler');
const { uploadProductImage, uploadProductDocument, deleteFile } = require('../middleware/upload');
const { getNextNumber }                       = require('../utils/numbering');
const logger                                  = require('../config/logger');

router.use(requireAuth);

// ── Helper: write audit log ───────────────────────────────────
async function audit(req, action, entityId, entityRef, description) {
  try {
    await pool.request()
      .input('org_id',      sql.Int,           req.user.orgId)
      .input('user_id',     sql.Int,           req.user.userId)
      .input('user_email',  sql.VarChar(200),  req.user.email)
      .input('user_name',   sql.NVarChar(200), req.user.name)
      .input('action_type', sql.VarChar(60),   action)
      .input('entity_id',   sql.BigInt,        entityId)
      .input('entity_ref',  sql.NVarChar(100), entityRef)
      .input('description', sql.NVarChar(1000), description)
      .query(`
        INSERT INTO audit_log (org_id,user_id,user_email,user_name,action_type,
          entity_type,entity_id,entity_ref,description,occurred_at)
        VALUES (@org_id,@user_id,@user_email,@user_name,@action_type,
          'product',@entity_id,@entity_ref,@description,GETDATE())
      `);
  } catch { /* best-effort */ }
}

// ────────────────────────────────────────────────────────────────
// GET /api/products/categories
// ────────────────────────────────────────────────────────────────
router.get('/categories', asyncHandler(async (req, res) => {
  await poolConnect;
  const rows = await pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .query(`
      SELECT id, name, parent_id, description, sort_order, is_active,
        (SELECT COUNT(*) FROM products p WHERE p.category_id = pc.id AND p.is_void = 0) AS product_count
      FROM product_categories pc
      WHERE org_id = @org_id
      ORDER BY sort_order ASC, name ASC
    `);

  const all = rows.recordset;

  // Build map first so parent references always resolve
  const map = {};
  all.forEach(r => { map[r.id] = { ...r, children: [] }; });

  // Build tree
  const tree = [];
  all.forEach(r => {
    if (r.parent_id && map[r.parent_id]) {
      map[r.parent_id].children.push(map[r.id]);
    } else {
      tree.push(map[r.id]);
    }
  });

  // Sort children at each level by sort_order then name
  function sortChildren(nodes) {
    nodes.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
    nodes.forEach(n => { if (n.children.length) sortChildren(n.children); });
  }
  sortChildren(tree);

  // Build flat ordered list with sort_path (e.g. "1", "1.1", "1.2", "2")
  // preserving hierarchy for dropdowns
  function buildFlat(nodes, parentPath = '', result = []) {
    nodes.forEach((node, i) => {
      const path = parentPath ? `${parentPath}.${i + 1}` : `${i + 1}`;
      const hasChildren = node.children && node.children.length > 0;
      result.push({ ...node, sort_path: path, depth: parentPath ? parentPath.split('.').length : 0, has_children: hasChildren });
      if (hasChildren) buildFlat(node.children, path, result);
    });
    return result;
  }
  const flat = buildFlat(tree);

  return res.json({ success: true, data: tree, flat });
}));

// POST /api/products/categories
router.post('/categories', requireMinRole('editor'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { name, parent_id, description, sort_order } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'name is required.' });

  const result = await pool.request()
    .input('org_id',      sql.Int,          req.user.orgId)
    .input('name',        sql.NVarChar(100), name.trim())
    .input('parent_id',   sql.Int,          parent_id   || null)
    .input('description', sql.NVarChar(500), description || null)
    .input('sort_order',  sql.Int,          sort_order  || 0)
    .query(`
      INSERT INTO product_categories (org_id, name, parent_id, description, sort_order, is_active)
      OUTPUT INSERTED.id
      VALUES (@org_id, @name, @parent_id, @description, @sort_order, 1)
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id }, message: `Category "${name}" created.` });
}));

// PATCH /api/products/categories/:id
router.patch('/categories/:id', requireMinRole('editor'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { name, description, sort_order, is_active, parent_id } = req.body;

  await pool.request()
    .input('id',          sql.Int,          parseInt(req.params.id))
    .input('org_id',      sql.Int,          req.user.orgId)
    .input('name',        sql.NVarChar(100), name        || null)
    .input('description', sql.NVarChar(500), description || null)
    .input('sort_order',  sql.Int,          sort_order  != null ? sort_order : null)
    .input('is_active',   sql.Bit,          is_active   != null ? (is_active ? 1 : 0) : null)
    .input('parent_id',   sql.Int,          parent_id   || null)
    .query(`
      UPDATE product_categories SET
        name        = COALESCE(@name,       name),
        description = COALESCE(@description,description),
        sort_order  = COALESCE(@sort_order, sort_order),
        is_active   = COALESCE(@is_active,  is_active),
        parent_id   = COALESCE(@parent_id,  parent_id)
      WHERE id = @id AND org_id = @org_id
    `);

  return res.json({ success: true, message: 'Category updated.' });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/products/uom
// ────────────────────────────────────────────────────────────────
router.get('/uom', asyncHandler(async (req, res) => {
  await poolConnect;
  const rows = await pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .query(`
      SELECT id, code, name, is_base, is_active, sort_order
      FROM units_of_measure
      WHERE org_id = @org_id AND is_active = 1
      ORDER BY sort_order ASC, code ASC
    `);
  return res.json({ success: true, data: rows.recordset });
}));

// POST /api/products/uom
router.post('/uom', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { code, name, is_base } = req.body;
  if (!code || !name) return res.status(400).json({ success: false, error: 'code and name are required.' });

  const result = await pool.request()
    .input('org_id',   sql.Int,         req.user.orgId)
    .input('code',     sql.VarChar(10), code.toUpperCase().trim())
    .input('name',     sql.NVarChar(50), name.trim())
    .input('is_base',  sql.Bit,         is_base ? 1 : 0)
    .query(`
      INSERT INTO units_of_measure (org_id, code, name, is_base, is_active, sort_order)
      OUTPUT INSERTED.id
      VALUES (@org_id, @code, @name, @is_base, 1, 0)
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id } });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/products/price-lists
// ────────────────────────────────────────────────────────────────
router.get('/price-lists', asyncHandler(async (req, res) => {
  await poolConnect;
  const rows = await pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .query(`
      SELECT id, name, price_list_type, currency_code, is_default,
             is_tax_inclusive, description, valid_from, valid_to, is_active
      FROM price_lists
      WHERE org_id = @org_id AND is_active = 1
      ORDER BY is_default DESC, name ASC
    `);
  return res.json({ success: true, data: rows.recordset });
}));

// POST /api/products/price-lists
router.post('/price-lists', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { name, price_list_type, currency_code, is_default, is_tax_inclusive, description } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'name is required.' });

  if (is_default) {
    await pool.request().input('org_id', sql.Int, req.user.orgId)
      .query('UPDATE price_lists SET is_default=0 WHERE org_id=@org_id');
  }

  const result = await pool.request()
    .input('org_id',          sql.Int,          req.user.orgId)
    .input('name',            sql.NVarChar(200), name.trim())
    .input('price_list_type', sql.VarChar(20),   price_list_type  || 'retail')
    .input('currency_code',   sql.VarChar(3),    currency_code    || 'AUD')
    .input('is_default',      sql.Bit,           is_default       ? 1 : 0)
    .input('is_tax_inclusive',sql.Bit,           is_tax_inclusive ? 1 : 0)
    .input('description',     sql.NVarChar(500), description      || null)
    .query(`
      INSERT INTO price_lists (org_id,name,price_list_type,currency_code,is_default,is_tax_inclusive,description,is_active,created_at,updated_at)
      OUTPUT INSERTED.id
      VALUES (@org_id,@name,@price_list_type,@currency_code,@is_default,@is_tax_inclusive,@description,1,GETDATE(),GETDATE())
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id }, message: `Price list "${name}" created.` });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/products/custom-fields
// ────────────────────────────────────────────────────────────────
router.get('/custom-fields', asyncHandler(async (req, res) => {
  await poolConnect;

  const [fields, options] = await Promise.all([
    pool.request()
      .input('org_id', sql.Int, req.user.orgId)
      .query(`
        SELECT id, entity_key, field_key, field_label, field_type,
               placeholder, help_text, is_required, is_shown_in_list,
               is_shown_on_pdf, is_readonly, is_active, sort_order,
               validation_min, validation_max, section_key, default_value
        FROM custom_field_definitions
        WHERE org_id = @org_id AND entity_key = 'product'
        ORDER BY sort_order ASC, field_label ASC
      `),
    pool.request()
      .input('org_id', sql.Int, req.user.orgId)
      .query(`
        SELECT cfo.id, cfo.field_definition_id, cfo.option_key, cfo.option_label,
               cfo.option_color, cfo.sort_order
        FROM custom_field_options cfo
        INNER JOIN custom_field_definitions cfd ON cfd.id = cfo.field_definition_id
        WHERE cfd.org_id = @org_id AND cfd.entity_key = 'product'
        ORDER BY cfo.sort_order ASC
      `),
  ]);

  // Attach options to their fields
  const optMap = {};
  options.recordset.forEach(o => {
    if (!optMap[o.field_definition_id]) optMap[o.field_definition_id] = [];
    optMap[o.field_definition_id].push(o);
  });
  const data = fields.recordset.map(f => ({ ...f, options: optMap[f.id] || [] }));

  return res.json({ success: true, data });
}));

// POST /api/products/custom-fields
router.post('/custom-fields', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const {
    field_key, field_label, field_type = 'text', placeholder, help_text,
    is_required = false, is_shown_in_list = false, is_shown_on_pdf = false,
    sort_order = 0, validation_min, validation_max, section_key, default_value,
    options = [],
  } = req.body;

  if (!field_key || !field_label) return res.status(400).json({ success: false, error: 'field_key and field_label are required.' });

  const result = await pool.request()
    .input('org_id',           sql.Int,          req.user.orgId)
    .input('entity_key',       sql.VarChar(100), 'product')
    .input('field_key',        sql.VarChar(100), field_key.toLowerCase().replace(/\s+/g,'_'))
    .input('field_label',      sql.NVarChar(200), field_label.trim())
    .input('field_type',       sql.VarChar(30),   field_type)
    .input('placeholder',      sql.NVarChar(200), placeholder  || null)
    .input('help_text',        sql.NVarChar(500), help_text    || null)
    .input('is_required',      sql.Bit,           is_required       ? 1 : 0)
    .input('is_shown_in_list', sql.Bit,           is_shown_in_list  ? 1 : 0)
    .input('is_shown_on_pdf',  sql.Bit,           is_shown_on_pdf   ? 1 : 0)
    .input('sort_order',       sql.Int,           sort_order)
    .input('validation_min',   sql.Decimal(18,4), validation_min  != null ? validation_min  : null)
    .input('validation_max',   sql.Decimal(18,4), validation_max  != null ? validation_max  : null)
    .input('section_key',      sql.VarChar(100), section_key    || null)
    .input('default_value',    sql.NVarChar(1000), default_value || null)
    .input('created_by',       sql.Int,           req.user.userId)
    .query(`
      INSERT INTO custom_field_definitions
        (org_id,entity_key,field_key,field_label,field_type,placeholder,help_text,
         is_required,is_shown_in_list,is_shown_on_pdf,is_active,sort_order,
         validation_min,validation_max,section_key,default_value,created_by,created_at,updated_at)
      OUTPUT INSERTED.id
      VALUES
        (@org_id,'product',@field_key,@field_label,@field_type,@placeholder,@help_text,
         @is_required,@is_shown_in_list,@is_shown_on_pdf,1,@sort_order,
         @validation_min,@validation_max,@section_key,@default_value,@created_by,GETDATE(),GETDATE())
    `);

  const defId = result.recordset[0].id;

  // Seed options for select/multi_select fields
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    await pool.request()
      .input('field_definition_id', sql.Int,           defId)
      .input('option_key',          sql.VarChar(100),  opt.key   || `option_${i}`)
      .input('option_label',        sql.NVarChar(200), opt.label || `Option ${i+1}`)
      .input('option_color',        sql.VarChar(7),    opt.color || null)
      .input('sort_order',          sql.Int,           i)
      .query(`
        INSERT INTO custom_field_options (field_definition_id,option_key,option_label,option_color,sort_order)
        VALUES (@field_definition_id,@option_key,@option_label,@option_color,@sort_order)
      `);
  }

  return res.status(201).json({ success: true, data: { id: defId }, message: `Custom field "${field_label}" created.` });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/products  — list with search, filter, pagination
// ────────────────────────────────────────────────────────────────
router.get('/', requirePermission('products','read'), asyncHandler(async (req, res) => {
  await poolConnect;

  const orgId      = req.user.orgId;
  const search     = req.query.search     || '';
  const categoryId = req.query.category   || '';
  const type       = req.query.type       || '';
  const active     = req.query.active     !== 'false';
  const page       = Math.max(1, parseInt(req.query.page)  || 1);
  const limit      = Math.min(200, parseInt(req.query.limit) || 50);
  const offset     = (page - 1) * limit;

  const conditions = ['p.org_id = @org_id', 'p.is_void = 0'];
  if (active)      conditions.push('p.is_active = 1');
  if (categoryId)  conditions.push('p.category_id = @category_id');
  if (type)        conditions.push('p.product_type = @type');
  if (search)      conditions.push(`(p.product_code LIKE @search OR p.name LIKE @search OR p.barcode LIKE @search)`);

  const where = 'WHERE ' + conditions.join(' AND ');

  const [dataRes, countRes] = await Promise.all([
    pool.request()
      .input('org_id',      sql.Int,          orgId)
      .input('category_id', sql.Int,          categoryId || null)
      .input('type',        sql.VarChar(20),  type       || null)
      .input('search',      sql.NVarChar(200), `%${search}%`)
      .input('limit',       sql.Int,          limit)
      .input('offset',      sql.Int,          offset)
      .query(`
        SELECT
          p.id, p.product_code, p.barcode, p.name, p.product_type,
          p.category_id, pc.name AS category_name,
          p.can_be_sold, p.can_be_purchased,
          p.default_sales_price, p.default_purchase_price,
          p.last_cost, p.fifo_stock_value,
          p.tracking_type, p.is_active,
          p.warranty_months,
          p.weight_kg, p.primary_image_url,
          uom.code AS uom_code, uom.name AS uom_name,
          p.min_stock_level,
          ISNULL(SUM(sl.qty_on_hand), 0) AS total_stock,
          p.created_at, p.updated_at
        FROM products p
        LEFT JOIN product_categories pc ON pc.id = p.category_id
        LEFT JOIN units_of_measure uom  ON uom.id = p.base_uom_id
        LEFT JOIN stock_levels sl       ON sl.product_id = p.id AND sl.org_id = p.org_id
        ${where}
        GROUP BY
          p.id, p.product_code, p.barcode, p.name, p.product_type,
          p.category_id, pc.name, p.can_be_sold, p.can_be_purchased,
          p.default_sales_price, p.default_purchase_price,
          p.last_cost, p.fifo_stock_value, p.tracking_type, p.is_active,
          p.warranty_months, p.weight_kg, p.primary_image_url,
          uom.code, uom.name, p.min_stock_level, p.created_at, p.updated_at
        ORDER BY p.name ASC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `),
    pool.request()
      .input('org_id',      sql.Int,          orgId)
      .input('category_id', sql.Int,          categoryId || null)
      .input('type',        sql.VarChar(20),  type       || null)
      .input('search',      sql.NVarChar(200), `%${search}%`)
      .query(`SELECT COUNT(*) AS total FROM products p ${where}`),
  ]);

  const total = countRes.recordset[0].total;
  return res.json({
    success: true,
    data: dataRes.recordset,
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/products/:id  — full product detail
// ────────────────────────────────────────────────────────────────
router.get('/:id', requirePermission('products','read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const id    = parseInt(req.params.id);
  const orgId = req.user.orgId;

  const [productRes, imagesRes, docsRes] = await Promise.all([
    pool.request()
      .input('id',     sql.Int, id)
      .input('org_id', sql.Int, orgId)
      .query(`
        SELECT
          p.*,
          pc.name  AS category_name,
          uom.code AS uom_code, uom.name AS uom_name,
          sup.full_name AS preferred_supplier_name
        FROM products p
        LEFT JOIN product_categories pc ON pc.id = p.category_id
        LEFT JOIN units_of_measure uom  ON uom.id = p.base_uom_id
        LEFT JOIN contacts sup          ON sup.id = p.preferred_supplier_id
        WHERE p.id = @id AND p.org_id = @org_id AND p.is_void = 0
      `),
    pool.request()
      .input('product_id', sql.Int, id)
      .query(`
        SELECT id, image_url, alt_text, is_primary, sort_order, uploaded_at
        FROM product_images
        WHERE product_id = @product_id
        ORDER BY is_primary DESC, sort_order ASC
      `),
    pool.request()
      .input('entity_type', sql.VarChar(100), 'product')
      .input('entity_id',   sql.Int,          id)
      .input('org_id',      sql.Int,          orgId)
      .query(`
        SELECT id, file_name, file_size, mime_type, storage_path,
               description, is_visible_to_dealer, is_visible_to_customer, uploaded_at
        FROM document_attachments
        WHERE entity_type = @entity_type AND entity_id = @entity_id
          AND org_id = @org_id AND is_active = 1
        ORDER BY uploaded_at DESC
      `),
  ]);

  if (!productRes.recordset.length) {
    return res.status(404).json({ success: false, error: 'Product not found.' });
  }

  return res.json({
    success: true,
    data: {
      ...productRes.recordset[0],
      images:    imagesRes.recordset,
      documents: docsRes.recordset,
    },
  });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/products  — create product
// ────────────────────────────────────────────────────────────────
router.post('/', requirePermission('products','write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;

  const {
    product_code,             // if null, auto-generate from series
    name, barcode, description,
    product_type   = 'product',
    category_id,
    base_uom_id,
    tracking_type  = 'none',
    can_be_sold    = true,
    default_sales_price = 0,
    can_be_purchased    = true,
    default_purchase_price = 0,
    preferred_supplier_id,
    supplier_part_number,
    lead_time_days = 0,
    min_order_qty  = 1,
    order_multiple = 1,
    min_stock_level = 0,
    max_stock_level = 0,
    reorder_qty    = 0,
    warranty_months = 0,
    extended_warranty_months = 0,
    weight_kg, length_cm, width_cm, height_cm,
    is_kit = false,
    is_component = false,
  } = req.body;

  if (!name) return res.status(400).json({ success: false, error: 'name is required.' });

  // Auto-generate product code if not provided
  let code = product_code?.trim();
  if (!code) {
    try {
      const { number } = await getNextNumber('product', orgId, pool, sql);
      code = number;
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  // Check for duplicate product code
  const dupCheck = await pool.request()
    .input('org_id', sql.Int, orgId)
    .input('code',   sql.NVarChar(50), code)
    .query('SELECT id FROM products WHERE org_id=@org_id AND product_code=@code AND is_void=0');

  if (dupCheck.recordset.length) {
    return res.status(409).json({ success: false, error: `Product code "${code}" already exists.` });
  }

  const result = await pool.request()
    .input('org_id',                    sql.Int,          orgId)
    .input('product_code',              sql.NVarChar(50), code)
    .input('barcode',                   sql.NVarChar(100), barcode               || null)
    .input('name',                      sql.NVarChar(200), name.trim())
    .input('description',               sql.NVarChar(sql.MAX), description       || null)
    .input('product_type',              sql.VarChar(20),  product_type)
    .input('category_id',               sql.Int,          category_id            || null)
    .input('base_uom_id',               sql.Int,          base_uom_id            || null)
    .input('tracking_type',             sql.VarChar(10),  tracking_type)
    .input('can_be_sold',               sql.Bit,          can_be_sold    ? 1 : 0)
    .input('default_sales_price',       sql.Decimal(18,4), default_sales_price)
    .input('can_be_purchased',          sql.Bit,          can_be_purchased ? 1 : 0)
    .input('default_purchase_price',    sql.Decimal(18,4), default_purchase_price)
    .input('preferred_supplier_id',     sql.Int,          preferred_supplier_id  || null)
    .input('supplier_part_number',      sql.NVarChar(50), supplier_part_number   || null)
    .input('lead_time_days',            sql.Int,          lead_time_days)
    .input('min_order_qty',             sql.Decimal(18,4), min_order_qty)
    .input('order_multiple',            sql.Decimal(18,4), order_multiple)
    .input('min_stock_level',           sql.Decimal(18,4), min_stock_level)
    .input('max_stock_level',           sql.Decimal(18,4), max_stock_level)
    .input('reorder_qty',               sql.Decimal(18,4), reorder_qty)
    .input('warranty_months',           sql.Int,          warranty_months)
    .input('extended_warranty_months',  sql.Int,          extended_warranty_months)
    .input('weight_kg',                 sql.Decimal(10,4), weight_kg              || null)
    .input('length_cm',                 sql.Decimal(10,2), length_cm              || null)
    .input('width_cm',                  sql.Decimal(10,2), width_cm               || null)
    .input('height_cm',                 sql.Decimal(10,2), height_cm              || null)
    .input('is_kit',                    sql.Bit,          is_kit       ? 1 : 0)
    .input('is_component',              sql.Bit,          is_component ? 1 : 0)
    .input('created_by',                sql.Int,          req.user.userId)
    .query(`
      INSERT INTO products (
        org_id, product_code, barcode, name, description, product_type,
        category_id, base_uom_id, tracking_type,
        can_be_sold, default_sales_price,
        can_be_purchased, default_purchase_price,
        preferred_supplier_id, supplier_part_number,
        lead_time_days, min_order_qty, order_multiple,
        min_stock_level, max_stock_level, reorder_qty,
        warranty_months, extended_warranty_months,
        weight_kg, length_cm, width_cm, height_cm,
        is_kit, is_component,
        is_active, is_void, created_by, created_at, updated_at
      )
      OUTPUT INSERTED.id
      VALUES (
        @org_id, @product_code, @barcode, @name, @description, @product_type,
        @category_id, @base_uom_id, @tracking_type,
        @can_be_sold, @default_sales_price,
        @can_be_purchased, @default_purchase_price,
        @preferred_supplier_id, @supplier_part_number,
        @lead_time_days, @min_order_qty, @order_multiple,
        @min_stock_level, @max_stock_level, @reorder_qty,
        @warranty_months, @extended_warranty_months,
        @weight_kg, @length_cm, @width_cm, @height_cm,
        @is_kit, @is_component,
        1, 0, @created_by, GETDATE(), GETDATE()
      )
    `);

  const productId = result.recordset[0].id;
  await audit(req, 'product.create', productId, code, `Created product: ${name} (${code})`);

  return res.status(201).json({
    success: true,
    data:    { id: productId, product_code: code },
    message: `Product "${name}" created.`,
  });
}));

// ────────────────────────────────────────────────────────────────
// PATCH /api/products/:id
// ────────────────────────────────────────────────────────────────
router.patch('/:id', requirePermission('products','update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const id    = parseInt(req.params.id);
  const orgId = req.user.orgId;

  // Verify exists
  const check = await pool.request()
    .input('id', sql.Int, id).input('org_id', sql.Int, orgId)
    .query('SELECT product_code, name FROM products WHERE id=@id AND org_id=@org_id AND is_void=0');
  if (!check.recordset.length) return res.status(404).json({ success: false, error: 'Product not found.' });

  const {
    barcode, name, description, product_type, category_id,
    base_uom_id, tracking_type, can_be_sold, default_sales_price,
    can_be_purchased, default_purchase_price, preferred_supplier_id,
    supplier_part_number, lead_time_days, min_order_qty, order_multiple,
    min_stock_level, max_stock_level, reorder_qty,
    warranty_months, extended_warranty_months, warranty_terms_text,
    weight_kg, length_cm, width_cm, height_cm,
    is_active,
  } = req.body;

  await pool.request()
    .input('id',                        sql.Int,              id)
    .input('barcode',                   sql.NVarChar(100),    barcode                   || null)
    .input('name',                      sql.NVarChar(200),    name?.trim()              || null)
    .input('description',               sql.NVarChar(sql.MAX), description              || null)
    .input('product_type',              sql.VarChar(20),      product_type              || null)
    .input('category_id',               sql.Int,              category_id               || null)
    .input('base_uom_id',               sql.Int,              base_uom_id               || null)
    .input('tracking_type',             sql.VarChar(10),      tracking_type             || null)
    .input('can_be_sold',               sql.Bit,              can_be_sold    != null ? (can_be_sold    ? 1 : 0) : null)
    .input('default_sales_price',       sql.Decimal(18,4),    default_sales_price       ?? null)
    .input('can_be_purchased',          sql.Bit,              can_be_purchased != null ? (can_be_purchased ? 1 : 0) : null)
    .input('default_purchase_price',    sql.Decimal(18,4),    default_purchase_price    ?? null)
    .input('preferred_supplier_id',     sql.Int,              preferred_supplier_id     || null)
    .input('supplier_part_number',      sql.NVarChar(50),     supplier_part_number      || null)
    .input('lead_time_days',            sql.Int,              lead_time_days            ?? null)
    .input('min_order_qty',             sql.Decimal(18,4),    min_order_qty             ?? null)
    .input('order_multiple',            sql.Decimal(18,4),    order_multiple            ?? null)
    .input('min_stock_level',           sql.Decimal(18,4),    min_stock_level           ?? null)
    .input('max_stock_level',           sql.Decimal(18,4),    max_stock_level           ?? null)
    .input('reorder_qty',               sql.Decimal(18,4),    reorder_qty               ?? null)
    .input('warranty_months',           sql.Int,              warranty_months           ?? null)
    .input('extended_warranty_months',  sql.Int,              extended_warranty_months  ?? null)
    .input('warranty_terms_text',       sql.NVarChar(sql.MAX), warranty_terms_text      || null)
    .input('weight_kg',                 sql.Decimal(10,4),    weight_kg                 ?? null)
    .input('length_cm',                 sql.Decimal(10,2),    length_cm                 ?? null)
    .input('width_cm',                  sql.Decimal(10,2),    width_cm                  ?? null)
    .input('height_cm',                 sql.Decimal(10,2),    height_cm                 ?? null)
    .input('is_active',                 sql.Bit,              is_active != null ? (is_active ? 1 : 0) : null)
    .query(`
      UPDATE products SET
        barcode                  = COALESCE(@barcode,                  barcode),
        name                     = COALESCE(@name,                     name),
        description              = COALESCE(@description,              description),
        product_type             = COALESCE(@product_type,             product_type),
        category_id              = COALESCE(@category_id,              category_id),
        base_uom_id              = COALESCE(@base_uom_id,              base_uom_id),
        tracking_type            = COALESCE(@tracking_type,            tracking_type),
        can_be_sold              = COALESCE(@can_be_sold,              can_be_sold),
        default_sales_price      = COALESCE(@default_sales_price,      default_sales_price),
        can_be_purchased         = COALESCE(@can_be_purchased,         can_be_purchased),
        default_purchase_price   = COALESCE(@default_purchase_price,   default_purchase_price),
        preferred_supplier_id    = COALESCE(@preferred_supplier_id,    preferred_supplier_id),
        supplier_part_number     = COALESCE(@supplier_part_number,     supplier_part_number),
        lead_time_days           = COALESCE(@lead_time_days,           lead_time_days),
        min_order_qty            = COALESCE(@min_order_qty,            min_order_qty),
        order_multiple           = COALESCE(@order_multiple,           order_multiple),
        min_stock_level          = COALESCE(@min_stock_level,          min_stock_level),
        max_stock_level          = COALESCE(@max_stock_level,          max_stock_level),
        reorder_qty              = COALESCE(@reorder_qty,              reorder_qty),
        warranty_months          = COALESCE(@warranty_months,          warranty_months),
        extended_warranty_months = COALESCE(@extended_warranty_months, extended_warranty_months),
        warranty_terms_text      = COALESCE(@warranty_terms_text,      warranty_terms_text),
        weight_kg                = COALESCE(@weight_kg,                weight_kg),
        length_cm                = COALESCE(@length_cm,                length_cm),
        width_cm                 = COALESCE(@width_cm,                 width_cm),
        height_cm                = COALESCE(@height_cm,                height_cm),
        is_active                = COALESCE(@is_active,                is_active),
        updated_at               = GETDATE()
      WHERE id = @id
    `);

  await audit(req, 'product.update', id, check.recordset[0].product_code, `Updated product: ${check.recordset[0].name}`);
  return res.json({ success: true, message: 'Product updated.' });
}));

// ────────────────────────────────────────────────────────────────
// PATCH /api/products/:id/void
// ────────────────────────────────────────────────────────────────
router.patch('/:id/void', requirePermission('products','delete'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { reason } = req.body;
  const id = parseInt(req.params.id);

  await pool.request()
    .input('id',          sql.Int,          id)
    .input('org_id',      sql.Int,          req.user.orgId)
    .input('void_reason', sql.NVarChar(500), reason    || null)
    .input('voided_by',   sql.Int,          req.user.userId)
    .query(`
      UPDATE products SET
        is_void     = 1, is_active  = 0,
        void_reason = @void_reason,
        voided_at   = GETDATE(), voided_by = @voided_by,
        updated_at  = GETDATE()
      WHERE id = @id AND org_id = @org_id AND is_void = 0
    `);

  return res.json({ success: true, message: 'Product archived.' });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/products/:id/images  — upload image
// ────────────────────────────────────────────────────────────────
router.post('/:id/images', requirePermission('products','update'), uploadProductImage, asyncHandler(async (req, res) => {
  await poolConnect;
  const productId = parseInt(req.params.id);
  const orgId     = req.user.orgId;

  if (!req.file) return res.status(400).json({ success: false, error: 'No image file uploaded.' });

  // Verify product belongs to org
  const check = await pool.request()
    .input('id', sql.Int, productId).input('org_id', sql.Int, orgId)
    .query('SELECT id FROM products WHERE id=@id AND org_id=@org_id AND is_void=0');
  if (!check.recordset.length) return res.status(404).json({ success: false, error: 'Product not found.' });

  // Check if this should be primary (first image auto-primary)
  const existingCount = await pool.request()
    .input('product_id', sql.Int, productId)
    .query('SELECT COUNT(*) AS n FROM product_images WHERE product_id=@product_id');
  const isPrimary = existingCount.recordset[0].n === 0;

  // Build relative URL path
  const relativePath = `products/images/${productId}/${req.file.filename}`;
  const imageUrl     = `/uploads/${relativePath}`;

  const result = await pool.request()
    .input('product_id',   sql.Int,          productId)
    .input('image_url',    sql.NVarChar(500), imageUrl)
    .input('alt_text',     sql.NVarChar(200), req.body.alt_text || null)
    .input('is_primary',   sql.Bit,          isPrimary ? 1 : 0)
    .input('sort_order',   sql.Int,          existingCount.recordset[0].n)
    .input('uploaded_by',  sql.Int,          req.user.userId)
    .query(`
      INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order, uploaded_by, uploaded_at)
      OUTPUT INSERTED.id
      VALUES (@product_id, @image_url, @alt_text, @is_primary, @sort_order, @uploaded_by, GETDATE())
    `);

  // Update primary_image_url on product if this is the primary
  if (isPrimary) {
    await pool.request()
      .input('id',        sql.Int,          productId)
      .input('image_url', sql.NVarChar(500), imageUrl)
      .query('UPDATE products SET primary_image_url=@image_url, updated_at=GETDATE() WHERE id=@id');
  }

  return res.status(201).json({
    success: true,
    data: {
      id:        result.recordset[0].id,
      image_url: imageUrl,
      is_primary: isPrimary,
      filename:  req.file.filename,
      size:      req.file.size,
    },
    message: 'Image uploaded.',
  });
}));

// PATCH /api/products/:id/images/:imgId/primary
router.patch('/:id/images/:imgId/primary', requirePermission('products','update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const productId = parseInt(req.params.id);
  const imgId     = parseInt(req.params.imgId);

  // Clear all primary flags for this product
  await pool.request()
    .input('product_id', sql.Int, productId)
    .query('UPDATE product_images SET is_primary=0 WHERE product_id=@product_id');

  // Set new primary
  const imgRes = await pool.request()
    .input('id',         sql.Int, imgId)
    .input('product_id', sql.Int, productId)
    .query('UPDATE product_images SET is_primary=1 OUTPUT INSERTED.image_url WHERE id=@id AND product_id=@product_id');

  if (imgRes.recordset.length) {
    await pool.request()
      .input('id',        sql.Int,          productId)
      .input('image_url', sql.NVarChar(500), imgRes.recordset[0].image_url)
      .query('UPDATE products SET primary_image_url=@image_url, updated_at=GETDATE() WHERE id=@id');
  }

  return res.json({ success: true, message: 'Primary image updated.' });
}));

// DELETE /api/products/:id/images/:imgId
router.delete('/:id/images/:imgId', requirePermission('products','update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const productId = parseInt(req.params.id);
  const imgId     = parseInt(req.params.imgId);

  const img = await pool.request()
    .input('id',         sql.Int, imgId)
    .input('product_id', sql.Int, productId)
    .query('SELECT image_url, is_primary FROM product_images WHERE id=@id AND product_id=@product_id');

  if (!img.recordset.length) return res.status(404).json({ success: false, error: 'Image not found.' });

  // Delete from DB
  await pool.request()
    .input('id', sql.Int, imgId)
    .query('DELETE FROM product_images WHERE id=@id');

  // Delete file from disk
  const storagePath = img.recordset[0].image_url.replace('/uploads/', '');
  deleteFile(storagePath);

  // If was primary, assign new primary
  if (img.recordset[0].is_primary) {
    const next = await pool.request()
      .input('product_id', sql.Int, productId)
      .query('SELECT TOP 1 id, image_url FROM product_images WHERE product_id=@product_id ORDER BY sort_order ASC');
    if (next.recordset.length) {
      await pool.request()
        .input('id', sql.Int, next.recordset[0].id)
        .query('UPDATE product_images SET is_primary=1 WHERE id=@id');
      await pool.request()
        .input('product_id', sql.Int, productId)
        .input('url', sql.NVarChar(500), next.recordset[0].image_url)
        .query('UPDATE products SET primary_image_url=@url WHERE id=@product_id');
    } else {
      await pool.request()
        .input('id', sql.Int, productId)
        .query("UPDATE products SET primary_image_url=NULL WHERE id=@id");
    }
  }

  return res.json({ success: true, message: 'Image deleted.' });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/products/:id/documents  — upload document
// ────────────────────────────────────────────────────────────────
router.post('/:id/documents', requirePermission('products','update'), uploadProductDocument, asyncHandler(async (req, res) => {
  await poolConnect;
  const productId = parseInt(req.params.id);
  const orgId     = req.user.orgId;

  if (!req.file) return res.status(400).json({ success: false, error: 'No document file uploaded.' });

  const check = await pool.request()
    .input('id', sql.Int, productId).input('org_id', sql.Int, orgId)
    .query('SELECT id FROM products WHERE id=@id AND org_id=@org_id AND is_void=0');
  if (!check.recordset.length) return res.status(404).json({ success: false, error: 'Product not found.' });

  const storagePath = `products/documents/${productId}/${req.file.filename}`;

  const result = await pool.request()
    .input('org_id',                   sql.Int,          orgId)
    .input('entity_type',              sql.VarChar(100), 'product')
    .input('entity_id',                sql.Int,          productId)
    .input('file_name',                sql.NVarChar(255), req.file.originalname)
    .input('file_size',                sql.BigInt,       req.file.size)
    .input('mime_type',                sql.VarChar(100), req.file.mimetype)
    .input('storage_path',             sql.NVarChar(500), storagePath)
    .input('description',              sql.NVarChar(500), req.body.description              || null)
    .input('is_visible_to_dealer',     sql.Bit,          req.body.is_visible_to_dealer     ? 1 : 0)
    .input('is_visible_to_customer',   sql.Bit,          req.body.is_visible_to_customer   ? 1 : 0)
    .input('uploaded_by',              sql.Int,          req.user.userId)
    .query(`
      INSERT INTO document_attachments
        (org_id,entity_type,entity_id,file_name,file_size,mime_type,storage_path,
         description,is_visible_to_dealer,is_visible_to_customer,is_active,uploaded_by,uploaded_at)
      OUTPUT INSERTED.id
      VALUES
        (@org_id,'product',@entity_id,@file_name,@file_size,@mime_type,@storage_path,
         @description,@is_visible_to_dealer,@is_visible_to_customer,1,@uploaded_by,GETDATE())
    `);

  return res.status(201).json({
    success: true,
    data: {
      id:           result.recordset[0].id,
      file_name:    req.file.originalname,
      file_size:    req.file.size,
      storage_path: storagePath,
      download_url: `/uploads/${storagePath}`,
    },
    message: 'Document uploaded.',
  });
}));

// DELETE /api/products/:id/documents/:docId
router.delete('/:id/documents/:docId', requirePermission('products','update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const docId  = parseInt(req.params.docId);
  const orgId  = req.user.orgId;

  const doc = await pool.request()
    .input('id',          sql.Int,          docId)
    .input('org_id',      sql.Int,          orgId)
    .input('entity_type', sql.VarChar(100), 'product')
    .query('SELECT storage_path FROM document_attachments WHERE id=@id AND org_id=@org_id AND entity_type=@entity_type');

  if (!doc.recordset.length) return res.status(404).json({ success: false, error: 'Document not found.' });

  await pool.request()
    .input('id', sql.Int, docId)
    .query('UPDATE document_attachments SET is_active=0 WHERE id=@id');

  deleteFile(doc.recordset[0].storage_path);
  return res.json({ success: true, message: 'Document deleted.' });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/products/:id/custom-values
// ────────────────────────────────────────────────────────────────
router.get('/:id/custom-values', requirePermission('products','read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const productId = parseInt(req.params.id);

  const rows = await pool.request()
    .input('entity_key', sql.VarChar(100), 'product')
    .input('entity_id',  sql.BigInt,       productId)
    .input('org_id',     sql.Int,          req.user.orgId)
    .query(`
      SELECT cfv.id, cfv.field_definition_id, cfd.field_key, cfd.field_label, cfd.field_type,
             cfv.value_text, cfv.value_number, cfv.value_date, cfv.value_boolean, cfv.value_json
      FROM custom_field_values cfv
      INNER JOIN custom_field_definitions cfd ON cfd.id = cfv.field_definition_id
      WHERE cfv.entity_key = @entity_key AND cfv.entity_id = @entity_id AND cfv.org_id = @org_id
    `);

  // Return as map: { field_key: value }
  const values = {};
  rows.recordset.forEach(r => {
    values[r.field_key] = r.value_text ?? r.value_number ?? r.value_date ?? r.value_boolean ?? r.value_json;
  });

  return res.json({ success: true, data: values, raw: rows.recordset });
}));

// PUT /api/products/:id/custom-values
router.put('/:id/custom-values', requirePermission('products','update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const productId = parseInt(req.params.id);
  const orgId     = req.user.orgId;
  const { values } = req.body; // { field_key: value }

  if (!values || typeof values !== 'object') {
    return res.status(400).json({ success: false, error: 'values object required.' });
  }

  // Get field definitions
  const defs = await pool.request()
    .input('org_id',     sql.Int,          orgId)
    .input('entity_key', sql.VarChar(100), 'product')
    .query('SELECT id, field_key, field_type FROM custom_field_definitions WHERE org_id=@org_id AND entity_key=@entity_key AND is_active=1');

  const defMap = {};
  defs.recordset.forEach(d => { defMap[d.field_key] = d; });

  for (const [fieldKey, rawValue] of Object.entries(values)) {
    const def = defMap[fieldKey];
    if (!def) continue;

    // Determine which column to use
    let valueText = null, valueNumber = null, valueDate = null, valueBoolean = null, valueJson = null;
    if (['text','textarea','select','multi_select'].includes(def.field_type)) {
      valueText   = rawValue != null ? String(rawValue) : null;
    } else if (def.field_type === 'number') {
      valueNumber = rawValue != null ? parseFloat(rawValue) : null;
    } else if (def.field_type === 'date') {
      valueDate   = rawValue || null;
    } else if (def.field_type === 'boolean') {
      valueBoolean = rawValue ? 1 : 0;
    } else {
      valueJson   = rawValue != null ? JSON.stringify(rawValue) : null;
    }

    await pool.request()
      .input('org_id',              sql.Int,          orgId)
      .input('field_definition_id', sql.Int,          def.id)
      .input('entity_key',          sql.VarChar(100), 'product')
      .input('entity_id',           sql.BigInt,       productId)
      .input('value_text',          sql.NVarChar(sql.MAX), valueText)
      .input('value_number',        sql.Decimal(18,4), valueNumber)
      .input('value_date',          sql.Date,          valueDate)
      .input('value_boolean',       sql.Bit,           valueBoolean)
      .input('value_json',          sql.NVarChar(sql.MAX), valueJson)
      .input('updated_by',          sql.Int,           req.user.userId)
      .query(`
        IF EXISTS (SELECT 1 FROM custom_field_values WHERE org_id=@org_id AND field_definition_id=@field_definition_id AND entity_key=@entity_key AND entity_id=@entity_id)
          UPDATE custom_field_values SET
            value_text=@value_text, value_number=@value_number, value_date=@value_date,
            value_boolean=@value_boolean, value_json=@value_json,
            updated_by=@updated_by, updated_at=GETDATE()
          WHERE org_id=@org_id AND field_definition_id=@field_definition_id AND entity_key=@entity_key AND entity_id=@entity_id
        ELSE
          INSERT INTO custom_field_values (org_id,field_definition_id,entity_key,entity_id,value_text,value_number,value_date,value_boolean,value_json,created_by,created_at,updated_by,updated_at)
          VALUES (@org_id,@field_definition_id,@entity_key,@entity_id,@value_text,@value_number,@value_date,@value_boolean,@value_json,@updated_by,GETDATE(),@updated_by,GETDATE())
      `);
  }

  return res.json({ success: true, message: 'Custom values saved.' });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/products/:id/pricing
// ────────────────────────────────────────────────────────────────
router.get('/:id/pricing', requirePermission('products','read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const productId = parseInt(req.params.id);
  const orgId     = req.user.orgId;

  const [listsRes, itemsRes] = await Promise.all([
    pool.request()
      .input('org_id', sql.Int, orgId)
      .query('SELECT id, name, price_list_type, currency_code, is_default, is_tax_inclusive FROM price_lists WHERE org_id=@org_id AND is_active=1 ORDER BY name ASC'),
    pool.request()
      .input('product_id', sql.Int, productId)
      .input('org_id',     sql.Int, orgId)
      .query(`
        SELECT pli.id, pli.price_list_id, pl.name AS price_list_name,
               pli.unit_price, pli.min_qty, pli.discount_pct, pli.valid_from, pli.valid_to
        FROM price_list_items pli
        INNER JOIN price_lists pl ON pl.id = pli.price_list_id
        WHERE pli.product_id = @product_id AND pl.org_id = @org_id
        ORDER BY pl.name ASC
      `),
  ]);

  // Merge: all price lists with current product price (null if not set)
  const itemMap = {};
  itemsRes.recordset.forEach(i => { itemMap[i.price_list_id] = i; });

  const pricing = listsRes.recordset.map(pl => ({
    price_list_id:   pl.id,
    price_list_name: pl.name,
    price_list_type: pl.price_list_type,
    is_default:      pl.is_default,
    is_tax_inclusive: pl.is_tax_inclusive,
    ...(itemMap[pl.id] || { unit_price: null, min_qty: 1, discount_pct: 0 }),
  }));

  return res.json({ success: true, data: pricing });
}));

// PUT /api/products/:id/pricing
router.put('/:id/pricing', requirePermission('products','update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const productId = parseInt(req.params.id);
  const { prices } = req.body; // [{ price_list_id, unit_price, min_qty, discount_pct }]

  if (!Array.isArray(prices)) return res.status(400).json({ success: false, error: 'prices array required.' });

  for (const entry of prices) {
    if (entry.unit_price == null) {
      // Remove entry if price is cleared
      await pool.request()
        .input('price_list_id', sql.Int, entry.price_list_id)
        .input('product_id',    sql.Int, productId)
        .query('DELETE FROM price_list_items WHERE price_list_id=@price_list_id AND product_id=@product_id');
      continue;
    }

    await pool.request()
      .input('price_list_id', sql.Int,          entry.price_list_id)
      .input('product_id',    sql.Int,          productId)
      .input('unit_price',    sql.Decimal(18,4), parseFloat(entry.unit_price) || 0)
      .input('min_qty',       sql.Decimal(18,4), parseFloat(entry.min_qty)    || 1)
      .input('discount_pct',  sql.Decimal(5,2),  parseFloat(entry.discount_pct) || 0)
      .query(`
        IF EXISTS (SELECT 1 FROM price_list_items WHERE price_list_id=@price_list_id AND product_id=@product_id)
          UPDATE price_list_items SET unit_price=@unit_price, min_qty=@min_qty, discount_pct=@discount_pct
          WHERE price_list_id=@price_list_id AND product_id=@product_id
        ELSE
          INSERT INTO price_list_items (price_list_id,product_id,unit_price,min_qty,discount_pct)
          VALUES (@price_list_id,@product_id,@unit_price,@min_qty,@discount_pct)
      `);
  }

  return res.json({ success: true, message: 'Pricing saved.' });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/products/:id/stock  — stock per warehouse
// ────────────────────────────────────────────────────────────────
router.get('/:id/stock', requirePermission('products','read'), asyncHandler(async (req, res) => {
  await poolConnect;

  const rows = await pool.request()
    .input('product_id', sql.Int, parseInt(req.params.id))
    .input('org_id',     sql.Int, req.user.orgId)
    .query(`
      SELECT
        sl.id, sl.warehouse_id, w.name AS warehouse_name, w.code AS warehouse_code,
        sl.qty_on_hand, sl.qty_reserved, sl.qty_on_order,
        sl.qty_on_hand - sl.qty_reserved AS qty_available,
        sl.updated_at
      FROM stock_levels sl
      INNER JOIN warehouses w ON w.id = sl.warehouse_id
      WHERE sl.product_id = @product_id AND sl.org_id = @org_id
      ORDER BY w.name ASC
    `);

  const total = rows.recordset.reduce((sum, r) => sum + (r.qty_on_hand || 0), 0);
  return res.json({ success: true, data: rows.recordset, meta: { total_on_hand: total } });
}));

module.exports = router;
