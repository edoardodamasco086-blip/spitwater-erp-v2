'use strict';
// ============================================================
// routes/contacts.js
//
// GET    /api/contacts              — list (search, filter, paginate)
// GET    /api/contacts/:id          — single contact + addresses
// POST   /api/contacts              — create contact
// PATCH  /api/contacts/:id          — update contact
// PATCH  /api/contacts/:id/void     — soft delete (no DELETE)
// GET    /api/contacts/:id/activity — activity log for contact
//
// GET    /api/companies             — list companies
// POST   /api/companies             — create company
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth, requireMinRole } = require('../middleware/auth');
const { asyncHandler }                = require('../middleware/errorHandler');
const { requirePermission }           = require('../middleware/permissions');
const logger                          = require('../config/logger');

router.use(requireAuth);

// ────────────────────────────────────────────────────────────────
// GET /api/contacts
// Query params: search, type (customer|supplier|both), page, limit
// ────────────────────────────────────────────────────────────────
router.get('/', requirePermission('contacts','read'), asyncHandler(async (req, res) => {
  await poolConnect;

  const orgId   = req.user.orgId;
  const search  = req.query.search  || '';
  const type    = req.query.type    || '';
  const page    = Math.max(1, parseInt(req.query.page)  || 1);
  const limit   = Math.max(1, Math.min(100, parseInt(req.query.limit) || 50));
  const offset  = (page - 1) * limit;

  // Build WHERE clauses
  const conditions = ['c.org_id = @org_id', 'c.is_void = 0'];
  if (type && type !== 'all') conditions.push('c.contact_type = @type');
  if (search) conditions.push(`(
    c.full_name    LIKE @search OR
    c.email        LIKE @search OR
    c.phone        LIKE @search OR
    c.contact_number LIKE @search OR
    co.name        LIKE @search
  )`);

  const where = 'WHERE ' + conditions.join(' AND ');

  const req1 = pool.request()
    .input('org_id', sql.Int,          orgId)
    .input('type',   sql.VarChar(20),  type)
    .input('search', sql.NVarChar(200), `%${search}%`)
    .input('limit',  sql.Int,          limit)
    .input('offset', sql.Int,          offset);

  const req2 = pool.request()
    .input('org_id', sql.Int,          orgId)
    .input('type',   sql.VarChar(20),  type)
    .input('search', sql.NVarChar(200), `%${search}%`);

  const [dataResult, countResult] = await Promise.all([
    req1.query(`
      SELECT
        c.id,
        c.contact_number,
        c.contact_type,
        c.full_name,
        c.email,
        c.phone,
        c.mobile,
        c.abn,
        c.is_active,
        c.credit_hold,
        c.credit_limit,
        c.credit_terms,
        c.customer_category_id,
        c.created_at,
        co.id   AS company_id,
        co.name AS company_name,
        cc.name AS customer_category_name
      FROM contacts c
      LEFT JOIN companies co ON co.id = c.company_id
      LEFT JOIN customer_categories cc ON cc.id = c.customer_category_id
      ${where}
      ORDER BY c.full_name ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `),
    req2.query(`
      SELECT COUNT(*) AS total
      FROM contacts c
      LEFT JOIN companies co ON co.id = c.company_id
      ${where}
    `),
  ]);

  const total = countResult.recordset[0].total;

  return res.json({
    success: true,
    data:    dataResult.recordset,
    meta: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/contacts/:id
// ────────────────────────────────────────────────────────────────
router.get('/:id', requirePermission('contacts','read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid contact ID.' });

  const [contactResult, addressResult] = await Promise.all([
    pool.request()
      .input('org_id', sql.Int, orgId)
      .input('id',     sql.Int, id)
      .query(`
        SELECT
          c.*,
          co.id   AS company_id,
          co.name AS company_name,
          co.abn  AS company_abn,
          cpl.price_list_id,
          pl.name AS price_list_name
        FROM contacts c
        LEFT JOIN companies            co  ON co.id  = c.company_id
        LEFT JOIN contact_price_lists  cpl ON cpl.contact_id = c.id
        LEFT JOIN price_lists          pl  ON pl.id  = cpl.price_list_id AND pl.is_active = 1
        WHERE c.org_id = @org_id AND c.id = @id AND c.is_void = 0
      `),
    pool.request()
      .input('contact_id', sql.Int, id)
      .query(`
        SELECT * FROM contact_addresses
        WHERE contact_id = @contact_id AND is_active = 1
        ORDER BY is_default DESC, address_type ASC
      `),
  ]);

  if (!contactResult.recordset.length) {
    return res.status(404).json({ success: false, error: 'Contact not found.' });
  }

  return res.json({
    success: true,
    data: {
      ...contactResult.recordset[0],
      addresses: addressResult.recordset,
    },
  });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/contacts
// ────────────────────────────────────────────────────────────────
router.post('/', requirePermission('contacts','write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;

  const {
    contact_type = 'customer',
    full_name,
    email,
    phone,
    mobile,
    abn,
    company_id,
    credit_limit   = 0,
    credit_terms   = 'NET30',
    is_overseas    = false,
    gst_registered = true,
    notes,
    // Address (optional — create billing address in same call)
    address,
  } = req.body;

  if (!full_name) {
    return res.status(400).json({ success: false, error: 'full_name is required.' });
  }

  const result = await pool.request()
    .input('org_id',        sql.Int,          orgId)
    .input('contact_type',  sql.VarChar(20),  contact_type)
    .input('full_name',     sql.NVarChar(200), full_name.trim())
    .input('email',         sql.VarChar(200), email?.trim().toLowerCase() || null)
    .input('phone',         sql.VarChar(30),  phone  || null)
    .input('mobile',        sql.VarChar(30),  mobile || null)
    .input('abn',           sql.VarChar(14),  abn    || null)
    .input('company_id',    sql.Int,          company_id || null)
    .input('credit_limit',  sql.Decimal(18,2), credit_limit)
    .input('credit_terms',  sql.VarChar(20),  credit_terms)
    .input('is_overseas',   sql.Bit,          is_overseas ? 1 : 0)
    .input('gst_registered',sql.Bit,          gst_registered ? 1 : 0)
    .input('notes',         sql.NVarChar(sql.MAX), notes || null)
    .input('created_by',    sql.Int,          req.user.userId)
    .query(`
      INSERT INTO contacts (
        org_id, contact_type, full_name, email, phone, mobile,
        abn, company_id, credit_limit, credit_terms,
        is_overseas, gst_registered, notes,
        is_active, is_void, created_by, created_at, updated_at
      )
      OUTPUT INSERTED.id
      VALUES (
        @org_id, @contact_type, @full_name, @email, @phone, @mobile,
        @abn, @company_id, @credit_limit, @credit_terms,
        @is_overseas, @gst_registered, @notes,
        1, 0, @created_by, GETDATE(), GETDATE()
      )
    `);

  const contactId = result.recordset[0].id;

  // Create billing address if provided
  if (address && (address.address_line1 || address.suburb)) {
    await pool.request()
      .input('contact_id',    sql.Int,          contactId)
      .input('address_type',  sql.VarChar(20),  address.address_type || 'billing')
      .input('is_default',    sql.Bit,          1)
      .input('address_line1', sql.NVarChar(200), address.address_line1 || null)
      .input('address_line2', sql.NVarChar(200), address.address_line2 || null)
      .input('suburb',        sql.NVarChar(100), address.suburb        || null)
      .input('state',         sql.VarChar(10),   address.state         || null)
      .input('postcode',      sql.VarChar(10),   address.postcode      || null)
      .input('country',       sql.NVarChar(100), address.country       || 'Australia')
      .query(`
        INSERT INTO contact_addresses
          (contact_id, address_type, is_default, address_line1, address_line2,
           suburb, state, postcode, country, country_code, is_active)
        VALUES
          (@contact_id, @address_type, @is_default, @address_line1, @address_line2,
           @suburb, @state, @postcode, @country, 'AU', 1)
      `);
  }

  // Audit log
  await pool.request()
    .input('org_id',      sql.Int,           orgId)
    .input('user_id',     sql.Int,           req.user.userId)
    .input('user_email',  sql.VarChar(200),  req.user.email)
    .input('user_name',   sql.NVarChar(200), req.user.name)
    .input('entity_id',   sql.BigInt,        contactId)
    .input('entity_ref',  sql.NVarChar(100), full_name)
    .input('description', sql.NVarChar(1000), `Created ${contact_type} contact: ${full_name}`)
    .query(`
      INSERT INTO audit_log
        (org_id, user_id, user_email, user_name, action_type,
         entity_type, entity_id, entity_ref, description, occurred_at)
      VALUES
        (@org_id, @user_id, @user_email, @user_name, 'contact.create',
         'contact', @entity_id, @entity_ref, @description, GETDATE())
    `);

  logger.info(`Contact created: ${full_name} (id=${contactId}) by [${req.user.email}]`);

  return res.status(201).json({
    success: true,
    data:    { id: contactId },
    message: `Contact "${full_name}" created.`,
  });
}));

// ────────────────────────────────────────────────────────────────
// PATCH /api/contacts/:id
// ────────────────────────────────────────────────────────────────
router.patch('/:id', requirePermission('contacts','update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);

  const {
    full_name, email, phone, mobile, abn,
    company_id, credit_limit, credit_terms,
    credit_hold, is_overseas, gst_registered,
    contact_type, notes, customer_category_id,
  } = req.body;

  // Verify contact belongs to this org
  const check = await pool.request()
    .input('org_id', sql.Int, orgId)
    .input('id',     sql.Int, id)
    .query('SELECT id, full_name FROM contacts WHERE org_id = @org_id AND id = @id AND is_void = 0');

  if (!check.recordset.length) {
    return res.status(404).json({ success: false, error: 'Contact not found.' });
  }

  await pool.request()
    .input('id',            sql.Int,          id)
    .input('contact_type',  sql.VarChar(20),  contact_type  || null)
    .input('full_name',     sql.NVarChar(200), full_name?.trim() || null)
    .input('email',         sql.VarChar(200), email?.trim().toLowerCase() || null)
    .input('phone',         sql.VarChar(30),  phone   || null)
    .input('mobile',        sql.VarChar(30),  mobile  || null)
    .input('abn',           sql.VarChar(14),  abn     || null)
    .input('company_id',    sql.Int,          company_id  || null)
    .input('credit_limit',  sql.Decimal(18,2), credit_limit ?? null)
    .input('credit_terms',  sql.VarChar(20),  credit_terms || null)
    .input('credit_hold',   sql.Bit,          credit_hold != null ? (credit_hold ? 1 : 0) : null)
    .input('is_overseas',   sql.Bit,          is_overseas  != null ? (is_overseas ? 1 : 0) : null)
    .input('gst_registered',sql.Bit,          gst_registered != null ? (gst_registered ? 1 : 0) : null)
    .input('notes',                sql.NVarChar(sql.MAX), notes ?? null)
    .input('customer_category_id', sql.Int, customer_category_id != null ? Number(customer_category_id) : undefined)
    .query(`
      UPDATE contacts SET
        contact_type          = COALESCE(@contact_type,          contact_type),
        full_name             = COALESCE(@full_name,             full_name),
        email                 = COALESCE(@email,                 email),
        phone                 = COALESCE(@phone,                 phone),
        mobile                = COALESCE(@mobile,                mobile),
        abn                   = COALESCE(@abn,                   abn),
        company_id            = COALESCE(@company_id,            company_id),
        credit_limit          = COALESCE(@credit_limit,          credit_limit),
        credit_terms          = COALESCE(@credit_terms,          credit_terms),
        credit_hold           = COALESCE(@credit_hold,           credit_hold),
        is_overseas           = COALESCE(@is_overseas,           is_overseas),
        gst_registered        = COALESCE(@gst_registered,        gst_registered),
        notes                 = COALESCE(@notes,                 notes),
        customer_category_id  = COALESCE(@customer_category_id,  customer_category_id),
        updated_at            = GETDATE()
      WHERE id = @id
    `);

  // Audit
  await pool.request()
    .input('org_id',      sql.Int,           orgId)
    .input('user_id',     sql.Int,           req.user.userId)
    .input('user_email',  sql.VarChar(200),  req.user.email)
    .input('user_name',   sql.NVarChar(200), req.user.name)
    .input('entity_id',   sql.BigInt,        id)
    .input('entity_ref',  sql.NVarChar(100), check.recordset[0].full_name)
    .input('description', sql.NVarChar(1000), `Updated contact: ${check.recordset[0].full_name}`)
    .query(`
      INSERT INTO audit_log
        (org_id, user_id, user_email, user_name, action_type,
         entity_type, entity_id, entity_ref, description, occurred_at)
      VALUES
        (@org_id, @user_id, @user_email, @user_name, 'contact.update',
         'contact', @entity_id, @entity_ref, @description, GETDATE())
    `);

  return res.json({ success: true, message: 'Contact updated.' });
}));

// ────────────────────────────────────────────────────────────────
// PATCH /api/contacts/:id/void   (soft delete — no DELETE)
// ────────────────────────────────────────────────────────────────
router.patch('/:id/void', requirePermission('contacts','delete'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { reason } = req.body;
  const id = parseInt(req.params.id);

  await pool.request()
    .input('id',          sql.Int,          id)
    .input('org_id',      sql.Int,          req.user.orgId)
    .input('void_reason', sql.NVarChar(500), reason || null)
    .input('voided_by',   sql.Int,          req.user.userId)
    .query(`
      UPDATE contacts
      SET is_void    = 1,
          void_reason = @void_reason,
          voided_at   = GETDATE(),
          voided_by   = @voided_by,
          is_active   = 0
      WHERE id = @id AND org_id = @org_id AND is_void = 0
    `);

  return res.json({ success: true, message: 'Contact archived.' });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/companies
// ────────────────────────────────────────────────────────────────
router.get('/companies/list', asyncHandler(async (req, res) => {
  await poolConnect;
  const search = req.query.search || '';

  const rows = await pool.request()
    .input('org_id', sql.Int,          req.user.orgId)
    .input('search', sql.NVarChar(200), `%${search}%`)
    .query(`
      SELECT id, name, abn, phone, email, is_active
      FROM companies
      WHERE org_id = @org_id AND is_void = 0
        AND (@search = '%%' OR name LIKE @search)
      ORDER BY name ASC
    `);

  return res.json({ success: true, data: rows.recordset });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/companies
// ────────────────────────────────────────────────────────────────
router.post('/companies', requireMinRole('editor'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { name, abn, phone, email, website } = req.body;

  if (!name) return res.status(400).json({ success: false, error: 'name is required.' });

  const result = await pool.request()
    .input('org_id',  sql.Int,          req.user.orgId)
    .input('name',    sql.NVarChar(200), name.trim())
    .input('abn',     sql.VarChar(14),  abn     || null)
    .input('phone',   sql.VarChar(30),  phone   || null)
    .input('email',   sql.VarChar(200), email   || null)
    .input('website', sql.NVarChar(200), website || null)
    .query(`
      INSERT INTO companies (org_id, name, abn, phone, email, website, is_active, is_void, created_at, updated_at)
      OUTPUT INSERTED.id
      VALUES (@org_id, @name, @abn, @phone, @email, @website, 1, 0, GETDATE(), GETDATE())
    `);

  return res.status(201).json({
    success: true,
    data: { id: result.recordset[0].id },
    message: `Company "${name}" created.`,
  });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/contacts/:id/price-sheet
// Returns all products priced for this customer (batched, no N+1)
// ────────────────────────────────────────────────────────────────
router.get('/:id/price-sheet', requirePermission('contacts','read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId     = req.user.orgId;
  const contactId = parseInt(req.params.id);
  const overridePlId = req.query.price_list_id ? parseInt(req.query.price_list_id) : null;

  // 1. Customer info
  const custRes = await pool.request()
    .input('id', sql.Int, contactId).input('org_id', sql.Int, orgId)
    .query(`SELECT id, full_name, gst_registered, customer_category_id FROM contacts WHERE id=@id AND org_id=@org_id AND is_void=0`);
  if (!custRes.recordset.length) return res.status(404).json({ success: false, error: 'Contact not found.' });
  const customer = custRes.recordset[0];

  // 2. Resolve price list: override → customer assigned → org base (RRP) → org default
  let plId = overridePlId, plName = null;

  if (!plId) {
    const r = await pool.request().input('cid', sql.Int, contactId)
      .query(`SELECT TOP 1 pl.id, pl.name FROM contact_price_lists cpl
              JOIN price_lists pl ON pl.id=cpl.price_list_id AND pl.is_active=1
              WHERE cpl.contact_id=@cid`);
    if (r.recordset.length) { plId = r.recordset[0].id; plName = r.recordset[0].name; }
  }
  if (!plId) {
    const r = await pool.request().input('org_id', sql.Int, orgId)
      .query(`SELECT TOP 1 id, name FROM price_lists WHERE org_id=@org_id AND is_base=1 AND is_active=1 ORDER BY id`);
    if (r.recordset.length) { plId = r.recordset[0].id; plName = r.recordset[0].name + ' (RRP)'; }
  }
  if (!plId) {
    const r = await pool.request().input('org_id', sql.Int, orgId)
      .query(`SELECT TOP 1 id, name FROM price_lists WHERE org_id=@org_id AND is_default=1 AND is_active=1`);
    if (r.recordset.length) { plId = r.recordset[0].id; plName = r.recordset[0].name + ' (default)'; }
  }
  if (plId && !plName) {
    const r = await pool.request().input('id', sql.Int, plId).query(`SELECT name FROM price_lists WHERE id=@id`);
    plName = r.recordset[0]?.name || null;
  }

  // 3. All active products
  const prodRes = await pool.request().input('org_id', sql.Int, orgId).query(`
    SELECT p.id, p.product_code, p.name, p.category_id, p.retail_price, p.default_sales_price,
           cat.name AS category_name
    FROM products p
    LEFT JOIN product_categories cat ON cat.id = p.category_id
    WHERE p.org_id=@org_id AND p.is_active=1
    ORDER BY cat.name, p.name
  `);
  const products = prodRes.recordset;

  // 4. Price list items for resolved list
  const pliMap = {};
  if (plId) {
    const r = await pool.request().input('pl_id', sql.Int, plId)
      .query(`SELECT product_id, unit_price FROM price_list_items WHERE price_list_id=@pl_id`);
    r.recordset.forEach(row => { pliMap[row.product_id] = Number(row.unit_price); });
  }

  // 5. All pricing conditions applicable to this customer
  const condRes = await pool.request()
    .input('org_id',               sql.Int, orgId)
    .input('customer_id',          sql.Int, contactId)
    .input('customer_category_id', sql.Int, customer.customer_category_id || null)
    .query(`
      SELECT condition_type, discount_value, tax_rate, min_qty, max_qty,
             product_id, category_id, customer_id, customer_category_id, priority
      FROM pricing_conditions
      WHERE org_id=@org_id AND is_active=1
        AND (valid_from IS NULL OR valid_from <= CAST(GETDATE() AS DATE))
        AND (valid_to   IS NULL OR valid_to   >= CAST(GETDATE() AS DATE))
        AND condition_type IN ('customer_discount','volume_break','gst')
        AND (
          condition_type = 'gst'
          OR (condition_type = 'customer_discount' AND (
            customer_id = @customer_id
            OR (customer_id IS NULL AND customer_category_id = @customer_category_id)
            OR (customer_id IS NULL AND customer_category_id IS NULL)
          ))
          OR condition_type = 'volume_break'
        )
      ORDER BY condition_type,
               CASE WHEN customer_id = @customer_id THEN 0
                    WHEN customer_category_id = @customer_category_id THEN 1
                    ELSE 2 END,
               priority ASC
    `);
  const conds = condRes.recordset;

  const gstCond  = conds.find(c => c.condition_type === 'gst');
  const taxRate  = (gstCond && customer.gst_registered !== false) ? Number(gstCond.tax_rate) : 0;
  const discConds = conds.filter(c => c.condition_type === 'customer_discount');
  const volConds  = conds.filter(c => c.condition_type === 'volume_break');

  // 6. Compute price per product (pure JS — no more DB calls)
  const rows = products.map(p => {
    const basePrice = pliMap[p.id] ?? Number(p.retail_price || p.default_sales_price || 0);

    const custDiscCond = discConds.find(c =>
      c.product_id === p.id
      || (c.product_id == null && c.category_id === p.category_id)
      || (c.product_id == null && c.category_id == null)
    );
    const customerDiscountPct = custDiscCond ? Number(custDiscCond.discount_value) : 0;

    const volBreaks = volConds
      .filter(c =>
        c.product_id === p.id
        || (c.product_id == null && c.category_id === p.category_id)
        || (c.product_id == null && c.category_id == null)
      )
      .map(c => {
        const totalDisc = Math.min(customerDiscountPct + Number(c.discount_value), 100);
        const vbUnit    = +(basePrice * (1 - totalDisc / 100)).toFixed(4);
        return {
          min_qty:         c.min_qty,
          max_qty:         c.max_qty,
          volumeDiscountPct: +Number(c.discount_value).toFixed(2),
          unitPrice:       vbUnit,
          unitPriceIncGst: +(vbUnit * (1 + taxRate / 100)).toFixed(4),
        };
      });

    const unitPrice       = +(basePrice * (1 - customerDiscountPct / 100)).toFixed(4);
    const unitPriceIncGst = +(unitPrice * (1 + taxRate / 100)).toFixed(4);

    return {
      id: p.id, product_code: p.product_code, name: p.name, category_name: p.category_name,
      basePrice:           +basePrice.toFixed(4),
      customerDiscountPct: +customerDiscountPct.toFixed(2),
      volumeBreaks:        volBreaks,
      unitPrice,
      taxRate:             +taxRate.toFixed(2),
      unitPriceIncGst,
    };
  });

  res.json({
    success: true,
    data: {
      customer: { id: customer.id, full_name: customer.full_name, gst_registered: !!customer.gst_registered },
      priceList: plId ? { id: plId, name: plName } : null,
      taxRate:   +taxRate.toFixed(2),
      products:  rows,
    },
  });
}));

module.exports = router;
