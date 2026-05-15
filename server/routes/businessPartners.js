'use strict';
// ============================================================
// routes/businessPartners.js
//
// GET    /api/business-partners                       list BPs
// POST   /api/business-partners                       create BP (+ shadow contact)
// GET    /api/business-partners/proposals             list enrichment proposals
// PATCH  /api/business-partners/proposals/:proposalId review proposal
// GET    /api/business-partners/:id                   get BP
// PATCH  /api/business-partners/:id                   update BP
// DELETE /api/business-partners/:id                   soft delete
// GET    /api/business-partners/:id/360               360 aggregate view
// GET    /api/business-partners/:id/relationships     list relationships
// POST   /api/business-partners/:id/relationships     link person ↔ org
// DELETE /api/business-partners/:id/relationships/:relId  unlink
// POST   /api/business-partners/:id/enrich            trigger AI enrichment
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth }            = require('../middleware/auth');
const { requirePermission }      = require('../middleware/permissions');
const { asyncHandler }           = require('../middleware/errorHandler');
const bpEnrichmentService        = require('../services/bpEnrichmentService');

router.use(requireAuth);

// ── Helper: fetch BP (with org tenancy check) ─────────────────
async function getBP(id, orgId) {
  const r = await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query('SELECT * FROM business_partners WHERE id=@id AND org_id=@org_id AND is_active=1');
  return r.recordset[0] || null;
}

// ── Helper: compute display name ──────────────────────────────
function displayName(bp) {
  if (bp.bp_type === 'person') {
    return `${bp.first_name || ''} ${bp.last_name || ''}`.trim();
  }
  return bp.trading_name || bp.legal_entity_name || '';
}

// ────────────────────────────────────────────────────────────────
// STATIC sub-routes MUST come before /:id
// ────────────────────────────────────────────────────────────────

// ── GET /api/business-partners/proposals ─────────────────────
router.get('/proposals', requirePermission('contacts', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId   = req.user.orgId;
  const bpId    = req.query.bp_id  ? parseInt(req.query.bp_id)  : null;
  const status  = req.query.status || 'pending';
  const page    = Math.max(1, parseInt(req.query.page)  || 1);
  const limit   = Math.max(1, Math.min(100, parseInt(req.query.limit) || 50));
  const offset  = (page - 1) * limit;

  const result = await pool.request()
    .input('org_id', sql.Int,        orgId)
    .input('bp_id',  sql.Int,        bpId)
    .input('status', sql.VarChar(20),status)
    .input('limit',  sql.Int,        limit)
    .input('offset', sql.Int,        offset)
    .query(`
      SELECT
        p.id, p.bp_id, p.field_name, p.proposed_value, p.current_value,
        p.source_url, p.source_snippet, p.confidence, p.status,
        p.reviewed_by, p.reviewed_at, p.edited_value, p.created_at,
        CASE bp.bp_type
          WHEN 'person' THEN LTRIM(RTRIM(COALESCE(bp.first_name,'') + ' ' + COALESCE(bp.last_name,'')))
          ELSE COALESCE(bp.trading_name, bp.legal_entity_name)
        END AS bp_display_name
      FROM bp_enrichment_proposals p
      INNER JOIN business_partners bp ON bp.id = p.bp_id
      WHERE p.org_id = @org_id
        AND (@bp_id IS NULL OR p.bp_id = @bp_id)
        AND p.status = @status
      ORDER BY p.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

  return res.json({ success: true, data: result.recordset });
}));

// ── PATCH /api/business-partners/proposals/:proposalId ────────
router.patch('/proposals/:proposalId', requirePermission('contacts', 'update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId      = req.user.orgId;
  const userId     = req.user.userId;
  const proposalId = parseInt(req.params.proposalId);
  const { action, edited_value } = req.body;

  if (!['accept', 'reject', 'edit'].includes(action)) {
    return res.status(400).json({ success: false, error: 'action must be accept | reject | edit' });
  }

  // Load proposal
  const pRes = await pool.request()
    .input('id',     sql.Int, proposalId)
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT p.*, bp.legacy_contact_id
      FROM bp_enrichment_proposals p
      INNER JOIN business_partners bp ON bp.id = p.bp_id
      WHERE p.id = @id AND p.org_id = @org_id
    `);

  if (!pRes.recordset.length) {
    return res.status(404).json({ success: false, error: 'Proposal not found.' });
  }

  const proposal = pRes.recordset[0];
  if (proposal.status !== 'pending') {
    return res.status(409).json({ success: false, error: `Proposal is already ${proposal.status}.` });
  }

  if (action === 'reject') {
    await pool.request()
      .input('id',          sql.Int,      proposalId)
      .input('reviewed_by', sql.Int,      userId)
      .query(`
        UPDATE bp_enrichment_proposals
        SET status='rejected', reviewed_by=@reviewed_by, reviewed_at=GETDATE()
        WHERE id=@id
      `);
    return res.json({ success: true, message: 'Proposal rejected.' });
  }

  // For accept or edit: determine the value to apply
  const valueToApply = action === 'edit'
    ? (edited_value ?? null)
    : proposal.proposed_value;

  if (valueToApply === null || valueToApply === undefined) {
    return res.status(400).json({ success: false, error: 'No value to apply.' });
  }

  // Fields that are safe to write directly to business_partners
  const BP_FIELD_WHITELIST = new Set([
    'email', 'email_secondary', 'phone', 'mobile',
    'website', 'industry', 'linkedin_url', 'ai_summary',
    'abn', 'acn', 'job_title', 'trading_name',
  ]);

  // Fields that also exist on the contacts shadow row
  const CONTACT_FIELDS = new Set(['email', 'phone', 'mobile', 'abn', 'notes']);

  if (!BP_FIELD_WHITELIST.has(proposal.field_name)) {
    return res.status(400).json({
      success: false,
      error: `Field "${proposal.field_name}" cannot be applied via proposal review.`,
    });
  }

  // Apply to business_partners
  // Build dynamic SET — safe because field_name is whitelist-checked above
  await pool.request()
    .input('value', sql.NVarChar(sql.MAX), valueToApply)
    .input('bp_id', sql.Int, proposal.bp_id)
    .query(`
      UPDATE business_partners
      SET [${proposal.field_name}] = @value, updated_at = GETDATE()
      WHERE id = @bp_id
    `);

  // Apply to shadow contacts row if applicable
  if (CONTACT_FIELDS.has(proposal.field_name) && proposal.legacy_contact_id) {
    await pool.request()
      .input('value',      sql.NVarChar(sql.MAX), valueToApply)
      .input('contact_id', sql.Int, proposal.legacy_contact_id)
      .query(`
        UPDATE contacts
        SET [${proposal.field_name}] = @value, updated_at = GETDATE()
        WHERE id = @contact_id
      `);
  }

  // Update proposal status
  const newStatus    = action === 'edit' ? 'edited' : 'accepted';
  const editedInput  = action === 'edit' ? edited_value : null;

  await pool.request()
    .input('id',           sql.Int,              proposalId)
    .input('status',       sql.VarChar(20),      newStatus)
    .input('reviewed_by',  sql.Int,              userId)
    .input('edited_value', sql.NVarChar(sql.MAX),editedInput)
    .query(`
      UPDATE bp_enrichment_proposals
      SET status=@status, reviewed_by=@reviewed_by, reviewed_at=GETDATE(),
          edited_value=@edited_value
      WHERE id=@id
    `);

  return res.json({ success: true, message: `Proposal ${newStatus}.` });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/business-partners  — list
// ────────────────────────────────────────────────────────────────
router.get('/', requirePermission('contacts', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId  = req.user.orgId;
  const search = req.query.search  || '';
  const bpType = req.query.bp_type || '';
  const role   = req.query.role    || '';
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.max(1, Math.min(100, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const conditions = ['bp.org_id = @org_id', 'bp.is_active = 1'];
  if (bpType) conditions.push('bp.bp_type = @bp_type');
  if (role)   conditions.push('bp.bp_role = @role');
  if (search) conditions.push(`(
    bp.legal_entity_name LIKE @search OR
    bp.trading_name      LIKE @search OR
    bp.first_name        LIKE @search OR
    bp.last_name         LIKE @search OR
    bp.email             LIKE @search OR
    bp.phone             LIKE @search OR
    bp.abn               LIKE @search
  )`);

  const where = 'WHERE ' + conditions.join(' AND ');

  const [dataRes, countRes] = await Promise.all([
    pool.request()
      .input('org_id',  sql.Int,          orgId)
      .input('bp_type', sql.VarChar(20),  bpType)
      .input('role',    sql.VarChar(20),  role)
      .input('search',  sql.NVarChar(200),`%${search}%`)
      .input('limit',   sql.Int,          limit)
      .input('offset',  sql.Int,          offset)
      .query(`
        SELECT
          bp.id, bp.bp_type, bp.bp_role, bp.is_active,
          bp.email, bp.phone, bp.mobile, bp.abn,
          bp.credit_limit, bp.payment_terms, bp.is_overseas,
          bp.ai_enriched_at, bp.legacy_contact_id,
          bp.created_at, bp.updated_at,
          CASE bp.bp_type
            WHEN 'person' THEN LTRIM(RTRIM(COALESCE(bp.first_name,'') + ' ' + COALESCE(bp.last_name,'')))
            ELSE COALESCE(bp.trading_name, bp.legal_entity_name)
          END AS display_name,
          (
            SELECT COUNT(*)
            FROM bp_relationships bpr
            WHERE bpr.org_bp_id = bp.id OR bpr.person_bp_id = bp.id
          ) AS relationship_count,
          (
            SELECT COUNT(*)
            FROM bp_enrichment_proposals bpe
            WHERE bpe.bp_id = bp.id AND bpe.status = 'pending'
          ) AS pending_proposals
        FROM business_partners bp
        ${where}
        ORDER BY display_name ASC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `),
    pool.request()
      .input('org_id',  sql.Int,          orgId)
      .input('bp_type', sql.VarChar(20),  bpType)
      .input('role',    sql.VarChar(20),  role)
      .input('search',  sql.NVarChar(200),`%${search}%`)
      .query(`SELECT COUNT(*) AS total FROM business_partners bp ${where}`),
  ]);

  const total = countRes.recordset[0].total;
  return res.json({
    success: true,
    data:    dataRes.recordset,
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}));

// ── POST /api/business-partners ───────────────────────────────
router.post('/', requirePermission('contacts', 'write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId  = req.user.orgId;
  const userId = req.user.userId;

  const {
    bp_type,
    // org fields
    legal_entity_name, trading_name,
    abn, acn, gst_registered = false, gst_registration_date,
    website, industry, linkedin_url,
    // person fields
    first_name, last_name, job_title,
    // shared
    email, email_secondary, phone, mobile,
    bp_role = 'customer',
    // financial
    credit_limit = 0, payment_terms = 'NET30', is_overseas = false,
    // classification
    customer_tier_id, customer_category_id,
    notes,
  } = req.body;

  // Validation
  if (!bp_type || !['organization', 'person'].includes(bp_type)) {
    return res.status(400).json({ success: false, error: 'bp_type must be "organization" or "person".' });
  }
  if (bp_type === 'organization' && !legal_entity_name) {
    return res.status(400).json({ success: false, error: 'legal_entity_name is required for organizations.' });
  }
  if (bp_type === 'person' && (!first_name || !last_name)) {
    return res.status(400).json({ success: false, error: 'first_name and last_name are required for persons.' });
  }

  const dName = bp_type === 'person'
    ? `${first_name} ${last_name}`.trim()
    : (trading_name || legal_entity_name);

  // Map bp_role → contact_type
  const contactTypeMap = { customer: 'customer', supplier: 'supplier', both: 'both', lead: 'lead', other: 'customer' };
  const contactType = contactTypeMap[bp_role] || 'customer';

  // Insert into business_partners
  const bpResult = await pool.request()
    .input('org_id',               sql.Int,           orgId)
    .input('bp_type',              sql.VarChar(20),   bp_type)
    .input('legal_entity_name',    sql.NVarChar(200), legal_entity_name    || null)
    .input('trading_name',         sql.NVarChar(200), trading_name         || null)
    .input('abn',                  sql.VarChar(14),   abn                  || null)
    .input('acn',                  sql.VarChar(11),   acn                  || null)
    .input('gst_registered',       sql.Bit,           gst_registered       ? 1 : 0)
    .input('gst_registration_date',sql.Date,          gst_registration_date|| null)
    .input('website',              sql.NVarChar(300), website              || null)
    .input('industry',             sql.NVarChar(100), industry             || null)
    .input('linkedin_url',         sql.NVarChar(500), linkedin_url         || null)
    .input('first_name',           sql.NVarChar(100), first_name           || null)
    .input('last_name',            sql.NVarChar(100), last_name            || null)
    .input('job_title',            sql.NVarChar(100), job_title            || null)
    .input('email',                sql.NVarChar(200), email?.trim().toLowerCase() || null)
    .input('email_secondary',      sql.NVarChar(200), email_secondary      || null)
    .input('phone',                sql.NVarChar(50),  phone                || null)
    .input('mobile',               sql.NVarChar(50),  mobile               || null)
    .input('bp_role',              sql.VarChar(20),   bp_role)
    .input('credit_limit',         sql.Decimal(18,2), credit_limit ?? 0)
    .input('payment_terms',        sql.VarChar(20),   payment_terms)
    .input('is_overseas',          sql.Bit,           is_overseas          ? 1 : 0)
    .input('customer_tier_id',     sql.Int,           customer_tier_id     || null)
    .input('customer_category_id', sql.Int,           customer_category_id || null)
    .input('notes',                sql.NVarChar(sql.MAX), notes            || null)
    .input('created_by',           sql.Int,           userId)
    .query(`
      INSERT INTO business_partners
        (org_id, bp_type, legal_entity_name, trading_name, abn, acn,
         gst_registered, gst_registration_date, website, industry, linkedin_url,
         first_name, last_name, job_title, email, email_secondary, phone, mobile,
         bp_role, credit_limit, payment_terms, is_overseas,
         customer_tier_id, customer_category_id, notes,
         is_active, created_at, updated_at, created_by)
      OUTPUT INSERTED.id
      VALUES
        (@org_id, @bp_type, @legal_entity_name, @trading_name, @abn, @acn,
         @gst_registered, @gst_registration_date, @website, @industry, @linkedin_url,
         @first_name, @last_name, @job_title, @email, @email_secondary, @phone, @mobile,
         @bp_role, @credit_limit, @payment_terms, @is_overseas,
         @customer_tier_id, @customer_category_id, @notes,
         1, GETDATE(), GETDATE(), @created_by)
    `);

  const bpId = bpResult.recordset[0].id;

  // Create shadow contact
  const contactResult = await pool.request()
    .input('org_id',        sql.Int,           orgId)
    .input('contact_type',  sql.VarChar(20),   contactType)
    .input('full_name',     sql.NVarChar(200), dName)
    .input('first_name',    sql.NVarChar(100), first_name  || null)
    .input('last_name',     sql.NVarChar(100), last_name   || null)
    .input('email',         sql.VarChar(200),  email?.trim().toLowerCase() || null)
    .input('phone',         sql.VarChar(30),   phone       || null)
    .input('mobile',        sql.VarChar(30),   mobile      || null)
    .input('abn',           sql.VarChar(14),   abn         || null)
    .input('acn',           sql.VarChar(11),   acn         || null)
    .input('gst_registered',sql.Bit,           gst_registered ? 1 : 0)
    .input('credit_limit',  sql.Decimal(18,2), credit_limit ?? 0)
    .input('credit_terms',  sql.VarChar(20),   payment_terms)
    .input('is_overseas',   sql.Bit,           is_overseas ? 1 : 0)
    .input('notes',         sql.NVarChar(sql.MAX), notes   || null)
    .input('position',      sql.NVarChar(100), job_title   || null)
    .input('bp_id',         sql.Int,           bpId)
    .input('created_by',    sql.Int,           userId)
    .query(`
      INSERT INTO contacts
        (org_id, contact_type, full_name, first_name, last_name, email, phone, mobile,
         abn, acn, gst_registered, credit_limit, credit_terms,
         is_overseas, notes, position, bp_id,
         is_active, is_void, created_by, created_at, updated_at)
      OUTPUT INSERTED.id
      VALUES
        (@org_id, @contact_type, @full_name, @first_name, @last_name, @email, @phone, @mobile,
         @abn, @acn, @gst_registered, @credit_limit, @credit_terms,
         @is_overseas, @notes, @position, @bp_id,
         1, 0, @created_by, GETDATE(), GETDATE())
    `);

  const shadowContactId = contactResult.recordset[0].id;

  // Write legacy_contact_id back to business_partners
  await pool.request()
    .input('bp_id',             sql.Int, bpId)
    .input('legacy_contact_id', sql.Int, shadowContactId)
    .query('UPDATE business_partners SET legacy_contact_id=@legacy_contact_id WHERE id=@bp_id');

  return res.status(201).json({
    success: true,
    data: { id: bpId, legacy_contact_id: shadowContactId },
    message: `Business partner "${dName}" created.`,
  });
}));

// ── GET /api/business-partners/:id ───────────────────────────
router.get('/:id', requirePermission('contacts', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const id    = parseInt(req.params.id);
  const orgId = req.user.orgId;
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid BP ID.' });

  const bp = await getBP(id, orgId);
  if (!bp) return res.status(404).json({ success: false, error: 'Business partner not found.' });

  bp.display_name = displayName(bp);
  return res.json({ success: true, data: bp });
}));

// ── PATCH /api/business-partners/:id ─────────────────────────
router.patch('/:id', requirePermission('contacts', 'update'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid BP ID.' });

  const bp = await getBP(id, orgId);
  if (!bp) return res.status(404).json({ success: false, error: 'Business partner not found.' });

  const {
    legal_entity_name, trading_name,
    abn, acn, gst_registered, gst_registration_date,
    website, industry, linkedin_url,
    first_name, last_name, job_title,
    email, email_secondary, phone, mobile,
    bp_role,
    credit_limit, payment_terms, is_overseas,
    customer_tier_id, customer_category_id,
    notes, ai_summary,
  } = req.body;

  await pool.request()
    .input('id',                   sql.Int,           id)
    .input('legal_entity_name',    sql.NVarChar(200), legal_entity_name     ?? null)
    .input('trading_name',         sql.NVarChar(200), trading_name          ?? null)
    .input('abn',                  sql.VarChar(14),   abn                   ?? null)
    .input('acn',                  sql.VarChar(11),   acn                   ?? null)
    .input('gst_registered',       sql.Bit,           gst_registered   != null ? (gst_registered  ? 1 : 0) : null)
    .input('gst_registration_date',sql.Date,          gst_registration_date ?? null)
    .input('website',              sql.NVarChar(300), website               ?? null)
    .input('industry',             sql.NVarChar(100), industry              ?? null)
    .input('linkedin_url',         sql.NVarChar(500), linkedin_url          ?? null)
    .input('first_name',           sql.NVarChar(100), first_name            ?? null)
    .input('last_name',            sql.NVarChar(100), last_name             ?? null)
    .input('job_title',            sql.NVarChar(100), job_title             ?? null)
    .input('email',                sql.NVarChar(200), email?.trim().toLowerCase() ?? null)
    .input('email_secondary',      sql.NVarChar(200), email_secondary       ?? null)
    .input('phone',                sql.NVarChar(50),  phone                 ?? null)
    .input('mobile',               sql.NVarChar(50),  mobile                ?? null)
    .input('bp_role',              sql.VarChar(20),   bp_role               ?? null)
    .input('credit_limit',         sql.Decimal(18,2), credit_limit          ?? null)
    .input('payment_terms',        sql.VarChar(20),   payment_terms         ?? null)
    .input('is_overseas',          sql.Bit,           is_overseas      != null ? (is_overseas      ? 1 : 0) : null)
    .input('customer_tier_id',     sql.Int,           customer_tier_id      ?? null)
    .input('customer_category_id', sql.Int,           customer_category_id  ?? null)
    .input('notes',                sql.NVarChar(sql.MAX), notes             ?? null)
    .input('ai_summary',           sql.NVarChar(sql.MAX), ai_summary        ?? null)
    .query(`
      UPDATE business_partners SET
        legal_entity_name     = COALESCE(@legal_entity_name,     legal_entity_name),
        trading_name          = COALESCE(@trading_name,          trading_name),
        abn                   = COALESCE(@abn,                   abn),
        acn                   = COALESCE(@acn,                   acn),
        gst_registered        = COALESCE(@gst_registered,        gst_registered),
        gst_registration_date = COALESCE(@gst_registration_date, gst_registration_date),
        website               = COALESCE(@website,               website),
        industry              = COALESCE(@industry,              industry),
        linkedin_url          = COALESCE(@linkedin_url,          linkedin_url),
        first_name            = COALESCE(@first_name,            first_name),
        last_name             = COALESCE(@last_name,             last_name),
        job_title             = COALESCE(@job_title,             job_title),
        email                 = COALESCE(@email,                 email),
        email_secondary       = COALESCE(@email_secondary,       email_secondary),
        phone                 = COALESCE(@phone,                 phone),
        mobile                = COALESCE(@mobile,                mobile),
        bp_role               = COALESCE(@bp_role,               bp_role),
        credit_limit          = COALESCE(@credit_limit,          credit_limit),
        payment_terms         = COALESCE(@payment_terms,         payment_terms),
        is_overseas           = COALESCE(@is_overseas,           is_overseas),
        customer_tier_id      = COALESCE(@customer_tier_id,      customer_tier_id),
        customer_category_id  = COALESCE(@customer_category_id,  customer_category_id),
        notes                 = COALESCE(@notes,                 notes),
        ai_summary            = COALESCE(@ai_summary,            ai_summary),
        updated_at            = GETDATE()
      WHERE id = @id
    `);

  // Mirror relevant fields to shadow contact
  if (bp.legacy_contact_id) {
    const contactTypeMap = { customer:'customer', supplier:'supplier', both:'both', lead:'lead', other:'customer' };
    await pool.request()
      .input('contact_id',   sql.Int,          bp.legacy_contact_id)
      .input('full_name',    sql.NVarChar(200),
        bp.bp_type === 'person'
          ? `${first_name ?? bp.first_name ?? ''} ${last_name ?? bp.last_name ?? ''}`.trim()
          : (legal_entity_name ?? bp.legal_entity_name ?? ''))
      .input('email',        sql.VarChar(200), email?.trim().toLowerCase() ?? null)
      .input('phone',        sql.VarChar(30),  phone    ?? null)
      .input('mobile',       sql.VarChar(30),  mobile   ?? null)
      .input('abn',          sql.VarChar(14),  abn      ?? null)
      .input('notes',        sql.NVarChar(sql.MAX), notes ?? null)
      .input('credit_limit', sql.Decimal(18,2), credit_limit  ?? null)
      .input('credit_terms', sql.VarChar(20),  payment_terms ?? null)
      .input('is_overseas',  sql.Bit, is_overseas != null ? (is_overseas ? 1 : 0) : null)
      .input('contact_type', sql.VarChar(20),  bp_role ? (contactTypeMap[bp_role] || null) : null)
      .query(`
        UPDATE contacts SET
          full_name    = COALESCE(@full_name,    full_name),
          email        = COALESCE(@email,        email),
          phone        = COALESCE(@phone,        phone),
          mobile       = COALESCE(@mobile,       mobile),
          abn          = COALESCE(@abn,          abn),
          notes        = COALESCE(@notes,        notes),
          credit_limit = COALESCE(@credit_limit, credit_limit),
          credit_terms = COALESCE(@credit_terms, credit_terms),
          is_overseas  = COALESCE(@is_overseas,  is_overseas),
          contact_type = COALESCE(@contact_type, contact_type),
          updated_at   = GETDATE()
        WHERE id = @contact_id
      `);
  }

  return res.json({ success: true, message: 'Business partner updated.' });
}));

// ── DELETE /api/business-partners/:id — soft delete ──────────
router.delete('/:id', requirePermission('contacts', 'delete'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid BP ID.' });

  const bp = await getBP(id, orgId);
  if (!bp) return res.status(404).json({ success: false, error: 'Business partner not found.' });

  await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query(`
      UPDATE business_partners
      SET is_active=0, updated_at=GETDATE()
      WHERE id=@id AND org_id=@org_id
    `);

  // Also deactivate shadow contact
  if (bp.legacy_contact_id) {
    await pool.request()
      .input('id', sql.Int, bp.legacy_contact_id)
      .query('UPDATE contacts SET is_active=0, updated_at=GETDATE() WHERE id=@id');
  }

  return res.json({ success: true, message: 'Business partner deactivated.' });
}));

// ── GET /api/business-partners/:id/360 ───────────────────────
router.get('/:id/360', requirePermission('contacts', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid BP ID.' });

  const bp = await getBP(id, orgId);
  if (!bp) return res.status(404).json({ success: false, error: 'Business partner not found.' });

  bp.display_name = displayName(bp);

  const legacyId = bp.legacy_contact_id || -1;

  const [
    addressesRes,
    bankingRes,
    linkedPersonsRes,
    linkedOrgsRes,
    openDocsRes,
    proposalsRes,
  ] = await Promise.all([
    // Addresses
    pool.request()
      .input('contact_id', sql.Int, legacyId)
      .query(`
        SELECT id, address_role, label, address_line1, address_line2,
               suburb, state, postcode, country, is_default, address_type
        FROM contact_addresses
        WHERE contact_id = @contact_id AND is_active = 1
        ORDER BY is_default DESC
      `),

    // Bank accounts
    pool.request()
      .input('contact_id', sql.Int, legacyId)
      .query(`
        SELECT id, account_name, bank_name, bsb, account_number,
               swift_code, iban, currency_code, is_default
        FROM bp_bank_accounts
        WHERE contact_id = @contact_id
        ORDER BY is_default DESC
      `),

    // Linked persons (if this is an org BP)
    pool.request()
      .input('id',     sql.Int, id)
      .input('org_id', sql.Int, orgId)
      .query(`
        SELECT
          bpr.id, bpr.person_bp_id, bpr.role_label, bpr.is_primary_contact,
          bp.email, bp.phone, bp.mobile, bp.job_title,
          LTRIM(RTRIM(COALESCE(bp.first_name,'') + ' ' + COALESCE(bp.last_name,''))) AS display_name
        FROM bp_relationships bpr
        INNER JOIN business_partners bp ON bp.id = bpr.person_bp_id
        WHERE bpr.org_bp_id = @id AND bpr.org_id = @org_id
        ORDER BY bpr.is_primary_contact DESC
      `),

    // Linked orgs (if this is a person BP)
    pool.request()
      .input('id',     sql.Int, id)
      .input('org_id', sql.Int, orgId)
      .query(`
        SELECT
          bpr.id, bpr.org_bp_id, bpr.role_label, bpr.is_primary_contact,
          bp.email, bp.phone,
          COALESCE(bp.trading_name, bp.legal_entity_name) AS display_name,
          bp.industry
        FROM bp_relationships bpr
        INNER JOIN business_partners bp ON bp.id = bpr.org_bp_id
        WHERE bpr.person_bp_id = @id AND bpr.org_id = @org_id
        ORDER BY bpr.is_primary_contact DESC
      `),

    // Open documents
    pool.request()
      .input('contact_id', sql.Int,    legacyId)
      .input('org_id',     sql.Int,    orgId)
      .query(`
        SELECT
          d.id, d.document_number, d.document_type, d.document_date,
          d.due_date, d.total_inc_gst, d.amount_outstanding, d.status
        FROM documents d
        WHERE d.contact_id = @contact_id
          AND d.org_id = @org_id
          AND d.document_type IN ('quote','sales_order','invoice')
          AND d.status NOT IN ('paid','void','cancelled')
          AND d.is_void = 0
        ORDER BY d.created_at DESC
      `),

    // Pending enrichment proposals
    pool.request()
      .input('bp_id', sql.Int, id)
      .query(`
        SELECT id, field_name, proposed_value, current_value,
               source_url, source_snippet, confidence, created_at
        FROM bp_enrichment_proposals
        WHERE bp_id = @bp_id AND status = 'pending'
        ORDER BY created_at DESC
      `),
  ]);

  return res.json({
    success: true,
    data: {
      bp,
      addresses:         addressesRes.recordset,
      banking:           bankingRes.recordset,
      linked_persons:    linkedPersonsRes.recordset,
      linked_orgs:       linkedOrgsRes.recordset,
      open_documents:    openDocsRes.recordset,
      pending_proposals: proposalsRes.recordset,
    },
  });
}));

// ── GET /api/business-partners/:id/relationships ──────────────
router.get('/:id/relationships', requirePermission('contacts', 'read'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid BP ID.' });

  const bp = await getBP(id, orgId);
  if (!bp) return res.status(404).json({ success: false, error: 'Business partner not found.' });

  const result = await pool.request()
    .input('id',     sql.Int, id)
    .input('org_id', sql.Int, orgId)
    .query(`
      SELECT
        bpr.id, bpr.person_bp_id, bpr.org_bp_id,
        bpr.role_label, bpr.is_primary_contact, bpr.created_at,
        person_bp.email             AS person_email,
        person_bp.phone             AS person_phone,
        person_bp.job_title         AS person_job_title,
        LTRIM(RTRIM(COALESCE(person_bp.first_name,'') + ' ' + COALESCE(person_bp.last_name,'')))
                                    AS person_display_name,
        COALESCE(org_bp.trading_name, org_bp.legal_entity_name)
                                    AS org_display_name,
        org_bp.email                AS org_email,
        org_bp.phone                AS org_phone,
        org_bp.industry             AS org_industry
      FROM bp_relationships bpr
      INNER JOIN business_partners person_bp ON person_bp.id = bpr.person_bp_id
      INNER JOIN business_partners org_bp    ON org_bp.id    = bpr.org_bp_id
      WHERE bpr.org_id = @org_id
        AND (bpr.person_bp_id = @id OR bpr.org_bp_id = @id)
      ORDER BY bpr.is_primary_contact DESC, bpr.created_at ASC
    `);

  return res.json({ success: true, data: result.recordset });
}));

// ── POST /api/business-partners/:id/relationships ─────────────
router.post('/:id/relationships', requirePermission('contacts', 'write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId = req.user.orgId;
  const id    = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid BP ID.' });

  const bp = await getBP(id, orgId);
  if (!bp) return res.status(404).json({ success: false, error: 'Business partner not found.' });

  const {
    person_bp_id,
    org_bp_id,
    role_label,
    is_primary_contact = false,
  } = req.body;

  if (!person_bp_id || !org_bp_id) {
    return res.status(400).json({ success: false, error: 'person_bp_id and org_bp_id are required.' });
  }

  // Verify both BPs belong to this org
  const check = await pool.request()
    .input('person_id', sql.Int, person_bp_id)
    .input('org_id_bp', sql.Int, org_bp_id)
    .input('org_id',    sql.Int, orgId)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM business_partners WHERE id=@person_id AND org_id=@org_id) AS person_ok,
        (SELECT COUNT(*) FROM business_partners WHERE id=@org_id_bp  AND org_id=@org_id) AS org_ok
    `);
  const { person_ok, org_ok } = check.recordset[0];
  if (!person_ok || !org_ok) {
    return res.status(404).json({ success: false, error: 'One or both business partners not found.' });
  }

  try {
    const result = await pool.request()
      .input('org_id',             sql.Int,          orgId)
      .input('person_bp_id',       sql.Int,          person_bp_id)
      .input('org_bp_id',          sql.Int,          org_bp_id)
      .input('role_label',         sql.NVarChar(100),role_label         || null)
      .input('is_primary_contact', sql.Bit,          is_primary_contact ? 1 : 0)
      .input('created_by',         sql.Int,          req.user.userId)
      .query(`
        INSERT INTO bp_relationships
          (org_id, person_bp_id, org_bp_id, role_label, is_primary_contact, created_at, created_by)
        OUTPUT INSERTED.id
        VALUES
          (@org_id, @person_bp_id, @org_bp_id, @role_label, @is_primary_contact, GETDATE(), @created_by)
      `);

    return res.status(201).json({
      success: true,
      data:    { id: result.recordset[0].id },
      message: 'Relationship created.',
    });
  } catch (err) {
    // Unique constraint violation
    if (err.number === 2627 || err.number === 2601) {
      return res.status(409).json({ success: false, error: 'Relationship already exists.' });
    }
    throw err;
  }
}));

// ── DELETE /api/business-partners/:id/relationships/:relId ────
router.delete('/:id/relationships/:relId', requirePermission('contacts', 'delete'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId  = req.user.orgId;
  const id     = parseInt(req.params.id);
  const relId  = parseInt(req.params.relId);
  if (isNaN(id) || isNaN(relId)) return res.status(400).json({ success: false, error: 'Invalid ID.' });

  await pool.request()
    .input('id',     sql.Int, relId)
    .input('org_id', sql.Int, orgId)
    .query('DELETE FROM bp_relationships WHERE id=@id AND org_id=@org_id');

  return res.json({ success: true, message: 'Relationship removed.' });
}));

// ── POST /api/business-partners/:id/enrich ───────────────────
router.post('/:id/enrich', requirePermission('contacts', 'write'), asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId  = req.user.orgId;
  const userId = req.user.userId;
  const id     = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid BP ID.' });

  const bp = await getBP(id, orgId);
  if (!bp) return res.status(404).json({ success: false, error: 'Business partner not found.' });

  // Fire-and-forget
  setImmediate(() => {
    bpEnrichmentService.enrich(bp, orgId, userId, pool, sql)
      .catch(e => console.error('[BP Enrich] Uncaught error:', e.message));
  });

  return res.json({
    success: true,
    message: 'Enrichment started. Check proposals inbox shortly.',
  });
}));

module.exports = router;
