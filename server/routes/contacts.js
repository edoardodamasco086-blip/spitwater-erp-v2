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
  const limit   = Math.min(100, parseInt(req.query.limit) || 50);
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
        c.created_at,
        co.id   AS company_id,
        co.name AS company_name
      FROM contacts c
      LEFT JOIN companies co ON co.id = c.company_id
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

  const [contactResult, addressResult] = await Promise.all([
    pool.request()
      .input('org_id', sql.Int, orgId)
      .input('id',     sql.Int, id)
      .query(`
        SELECT
          c.*,
          co.id   AS company_id,
          co.name AS company_name,
          co.abn  AS company_abn
        FROM contacts c
        LEFT JOIN companies co ON co.id = c.company_id
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
    contact_type, notes,
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
    .input('notes',         sql.NVarChar(sql.MAX), notes ?? null)
    .query(`
      UPDATE contacts SET
        contact_type   = COALESCE(@contact_type,   contact_type),
        full_name      = COALESCE(@full_name,       full_name),
        email          = COALESCE(@email,           email),
        phone          = COALESCE(@phone,           phone),
        mobile         = COALESCE(@mobile,          mobile),
        abn            = COALESCE(@abn,             abn),
        company_id     = COALESCE(@company_id,      company_id),
        credit_limit   = COALESCE(@credit_limit,    credit_limit),
        credit_terms   = COALESCE(@credit_terms,    credit_terms),
        credit_hold    = COALESCE(@credit_hold,     credit_hold),
        is_overseas    = COALESCE(@is_overseas,     is_overseas),
        gst_registered = COALESCE(@gst_registered,  gst_registered),
        notes          = COALESCE(@notes,           notes),
        updated_at     = GETDATE()
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

module.exports = router;
