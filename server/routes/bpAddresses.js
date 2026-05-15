'use strict';
// ============================================================
// routes/bpAddresses.js
//
// Business Partner Addresses (contact_addresses) + Bank Accounts (bp_bank_accounts)
//
// GET    /api/bp/addresses/:contactId         list all addresses for contact
// POST   /api/bp/addresses/:contactId         create address with role
// PATCH  /api/bp/addresses/:contactId/:id     update address
// DELETE /api/bp/addresses/:contactId/:id     delete address
//
// GET    /api/bp/banking/:contactId           list bank accounts
// POST   /api/bp/banking/:contactId           create bank account
// PATCH  /api/bp/banking/:contactId/:id       update bank account
// DELETE /api/bp/banking/:contactId/:id       delete bank account
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth }            = require('../middleware/auth');
const { asyncHandler }           = require('../middleware/errorHandler');

router.use(requireAuth);

const VALID_ADDRESS_ROLES = ['sold_to', 'ship_to', 'bill_to', 'payer', 'remit_to'];

// ── Helper: verify contact belongs to org ────────────────────
async function getContactOrg(contactId, orgId) {
  const r = await pool.request()
    .input('id',     sql.Int, contactId)
    .input('org_id', sql.Int, orgId)
    .query('SELECT id FROM contacts WHERE id=@id AND org_id=@org_id AND is_void=0');
  return r.recordset.length > 0;
}

// ────────────────────────────────────────────────────────────────
// ADDRESSES
// ────────────────────────────────────────────────────────────────

// ── GET /api/bp/addresses/:contactId ────────────────────────
router.get('/addresses/:contactId', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId     = req.user.orgId;
  const contactId = parseInt(req.params.contactId);

  if (!(await getContactOrg(contactId, orgId))) {
    return res.status(404).json({ success: false, error: 'Contact not found.' });
  }

  const rows = await pool.request()
    .input('contact_id', sql.Int, contactId)
    .query(`
      SELECT id, contact_id, address_role, address_type, label,
             address_line1, address_line2, suburb, state, postcode, country,
             country_code, is_default, is_active
      FROM contact_addresses
      WHERE contact_id = @contact_id AND is_active = 1
      ORDER BY is_default DESC, address_role ASC, id ASC
    `);

  return res.json({ success: true, data: rows.recordset });
}));

// ── POST /api/bp/addresses/:contactId ───────────────────────
router.post('/addresses/:contactId', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId     = req.user.orgId;
  const contactId = parseInt(req.params.contactId);

  if (!(await getContactOrg(contactId, orgId))) {
    return res.status(404).json({ success: false, error: 'Contact not found.' });
  }

  const {
    address_role, label,
    address_line1, address_line2, suburb, state, postcode, country,
    country_code,
    is_default = false,
  } = req.body;

  if (!address_line1) {
    return res.status(400).json({ success: false, error: 'address_line1 is required.' });
  }

  if (address_role && !VALID_ADDRESS_ROLES.includes(address_role)) {
    return res.status(400).json({
      success: false,
      error: `address_role must be one of: ${VALID_ADDRESS_ROLES.join(', ')}.`,
    });
  }

  const addressType = address_role === 'ship_to' ? 'shipping' : 'billing';

  // Clear other defaults for same address_role if is_default
  if (is_default && address_role) {
    await pool.request()
      .input('contact_id',   sql.Int,        contactId)
      .input('address_role', sql.VarChar(20), address_role)
      .query(`
        UPDATE contact_addresses SET is_default = 0
        WHERE contact_id = @contact_id AND address_role = @address_role
      `);
  }

  const result = await pool.request()
    .input('contact_id',   sql.Int,          contactId)
    .input('address_role', sql.VarChar(20),  address_role  || null)
    .input('address_type', sql.VarChar(20),  addressType)
    .input('label',        sql.NVarChar(100), label        || null)
    .input('address_line1', sql.NVarChar(255), address_line1.trim())
    .input('address_line2', sql.NVarChar(255), address_line2 || null)
    .input('suburb',       sql.NVarChar(100), suburb        || null)
    .input('state',        sql.NVarChar(100), state         || null)
    .input('postcode',     sql.VarChar(20),  postcode       || null)
    .input('country',      sql.NVarChar(100), country       || 'Australia')
    .input('country_code', sql.VarChar(5),   country_code  || 'AU')
    .input('is_default',   sql.Bit,          is_default ? 1 : 0)
    .query(`
      INSERT INTO contact_addresses
        (contact_id, address_role, address_type, label, address_line1, address_line2,
         suburb, state, postcode, country, country_code, is_default, is_active)
      OUTPUT INSERTED.id
      VALUES (@contact_id, @address_role, @address_type, @label, @address_line1, @address_line2,
              @suburb, @state, @postcode, @country, @country_code, @is_default, 1)
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id }, message: 'Address created.' });
}));

// ── PATCH /api/bp/addresses/:contactId/:id ──────────────────
router.patch('/addresses/:contactId/:id', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId     = req.user.orgId;
  const contactId = parseInt(req.params.contactId);
  const id        = parseInt(req.params.id);

  if (!(await getContactOrg(contactId, orgId))) {
    return res.status(404).json({ success: false, error: 'Contact not found.' });
  }

  const {
    address_role, label,
    address_line1, address_line2, suburb, state, postcode, country,
    is_default,
  } = req.body;

  if (address_role && !VALID_ADDRESS_ROLES.includes(address_role)) {
    return res.status(400).json({
      success: false,
      error: `address_role must be one of: ${VALID_ADDRESS_ROLES.join(', ')}.`,
    });
  }

  // Clear other defaults for same address_role if setting is_default
  if (is_default && address_role) {
    await pool.request()
      .input('contact_id',   sql.Int,        contactId)
      .input('address_role', sql.VarChar(20), address_role)
      .input('exclude_id',   sql.Int,        id)
      .query(`
        UPDATE contact_addresses SET is_default = 0
        WHERE contact_id = @contact_id AND address_role = @address_role AND id <> @exclude_id
      `);
  }

  await pool.request()
    .input('id',           sql.Int,          id)
    .input('contact_id',   sql.Int,          contactId)
    .input('address_role', sql.VarChar(20),  address_role  || null)
    .input('label',        sql.NVarChar(100), label        || null)
    .input('address_line1', sql.NVarChar(255), address_line1 ? address_line1.trim() : null)
    .input('address_line2', sql.NVarChar(255), address_line2 || null)
    .input('suburb',       sql.NVarChar(100), suburb        || null)
    .input('state',        sql.NVarChar(100), state         || null)
    .input('postcode',     sql.VarChar(20),  postcode       || null)
    .input('country',      sql.NVarChar(100), country       || null)
    .input('is_default',   sql.Bit,          is_default != null ? (is_default ? 1 : 0) : null)
    .query(`
      UPDATE contact_addresses SET
        address_role  = COALESCE(@address_role,  address_role),
        label         = COALESCE(@label,         label),
        address_line1 = COALESCE(@address_line1, address_line1),
        address_line2 = COALESCE(@address_line2, address_line2),
        suburb        = COALESCE(@suburb,        suburb),
        state         = COALESCE(@state,         state),
        postcode      = COALESCE(@postcode,      postcode),
        country       = COALESCE(@country,       country),
        is_default    = COALESCE(@is_default,    is_default)
      WHERE id = @id AND contact_id = @contact_id
    `);

  return res.json({ success: true, message: 'Address updated.' });
}));

// ── DELETE /api/bp/addresses/:contactId/:id ─────────────────
router.delete('/addresses/:contactId/:id', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId     = req.user.orgId;
  const contactId = parseInt(req.params.contactId);
  const id        = parseInt(req.params.id);

  if (!(await getContactOrg(contactId, orgId))) {
    return res.status(404).json({ success: false, error: 'Contact not found.' });
  }

  await pool.request()
    .input('id',         sql.Int, id)
    .input('contact_id', sql.Int, contactId)
    .query('DELETE FROM contact_addresses WHERE id=@id AND contact_id=@contact_id');

  return res.json({ success: true, message: 'Address deleted.' });
}));

// ────────────────────────────────────────────────────────────────
// BANK ACCOUNTS
// ────────────────────────────────────────────────────────────────

// ── GET /api/bp/banking/:contactId ──────────────────────────
router.get('/banking/:contactId', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId     = req.user.orgId;
  const contactId = parseInt(req.params.contactId);

  if (!(await getContactOrg(contactId, orgId))) {
    return res.status(404).json({ success: false, error: 'Contact not found.' });
  }

  const rows = await pool.request()
    .input('contact_id', sql.Int, contactId)
    .query(`
      SELECT id, contact_id, account_name, bank_name, bsb, account_number,
             swift_code, iban, currency_code, is_default, notes, created_at, updated_at
      FROM bp_bank_accounts
      WHERE contact_id = @contact_id
      ORDER BY is_default DESC, id ASC
    `);

  return res.json({ success: true, data: rows.recordset });
}));

// ── POST /api/bp/banking/:contactId ─────────────────────────
router.post('/banking/:contactId', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId     = req.user.orgId;
  const contactId = parseInt(req.params.contactId);

  if (!(await getContactOrg(contactId, orgId))) {
    return res.status(404).json({ success: false, error: 'Contact not found.' });
  }

  const {
    account_name, bank_name, bsb, account_number,
    swift_code, iban, currency_code, is_default = false, notes,
  } = req.body;

  if (!account_name || !account_number) {
    return res.status(400).json({ success: false, error: 'account_name and account_number are required.' });
  }

  // Clear other defaults if is_default
  if (is_default) {
    await pool.request()
      .input('contact_id', sql.Int, contactId)
      .query('UPDATE bp_bank_accounts SET is_default=0 WHERE contact_id=@contact_id');
  }

  const result = await pool.request()
    .input('contact_id',     sql.Int,          contactId)
    .input('account_name',   sql.NVarChar(200), account_name.trim())
    .input('bank_name',      sql.NVarChar(200), bank_name      || null)
    .input('bsb',            sql.VarChar(10),  bsb             || null)
    .input('account_number', sql.VarChar(50),  account_number.trim())
    .input('swift_code',     sql.VarChar(20),  swift_code      || null)
    .input('iban',           sql.VarChar(50),  iban            || null)
    .input('currency_code',  sql.VarChar(3),   currency_code   || 'AUD')
    .input('is_default',     sql.Bit,          is_default ? 1 : 0)
    .input('notes',          sql.NVarChar(sql.MAX), notes      || null)
    .query(`
      INSERT INTO bp_bank_accounts
        (contact_id, account_name, bank_name, bsb, account_number, swift_code, iban, currency_code, is_default, notes, created_at, updated_at)
      OUTPUT INSERTED.id
      VALUES (@contact_id, @account_name, @bank_name, @bsb, @account_number, @swift_code, @iban, @currency_code, @is_default, @notes, GETDATE(), GETDATE())
    `);

  return res.status(201).json({ success: true, data: { id: result.recordset[0].id }, message: 'Bank account created.' });
}));

// ── PATCH /api/bp/banking/:contactId/:id ────────────────────
router.patch('/banking/:contactId/:id', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId     = req.user.orgId;
  const contactId = parseInt(req.params.contactId);
  const id        = parseInt(req.params.id);

  if (!(await getContactOrg(contactId, orgId))) {
    return res.status(404).json({ success: false, error: 'Contact not found.' });
  }

  const {
    account_name, bank_name, bsb, account_number,
    swift_code, iban, currency_code, is_default, notes,
  } = req.body;

  // Clear other defaults if setting is_default
  if (is_default) {
    await pool.request()
      .input('contact_id',  sql.Int, contactId)
      .input('exclude_id',  sql.Int, id)
      .query('UPDATE bp_bank_accounts SET is_default=0 WHERE contact_id=@contact_id AND id<>@exclude_id');
  }

  await pool.request()
    .input('id',             sql.Int,          id)
    .input('contact_id',     sql.Int,          contactId)
    .input('account_name',   sql.NVarChar(200), account_name   ? account_name.trim() : null)
    .input('bank_name',      sql.NVarChar(200), bank_name      || null)
    .input('bsb',            sql.VarChar(10),  bsb             || null)
    .input('account_number', sql.VarChar(50),  account_number  ? account_number.trim() : null)
    .input('swift_code',     sql.VarChar(20),  swift_code      || null)
    .input('iban',           sql.VarChar(50),  iban            || null)
    .input('currency_code',  sql.VarChar(3),   currency_code   || null)
    .input('is_default',     sql.Bit,          is_default != null ? (is_default ? 1 : 0) : null)
    .input('notes',          sql.NVarChar(sql.MAX), notes      || null)
    .query(`
      UPDATE bp_bank_accounts SET
        account_name   = COALESCE(@account_name,   account_name),
        bank_name      = COALESCE(@bank_name,      bank_name),
        bsb            = COALESCE(@bsb,            bsb),
        account_number = COALESCE(@account_number, account_number),
        swift_code     = COALESCE(@swift_code,     swift_code),
        iban           = COALESCE(@iban,           iban),
        currency_code  = COALESCE(@currency_code,  currency_code),
        is_default     = COALESCE(@is_default,     is_default),
        notes          = COALESCE(@notes,          notes),
        updated_at     = GETDATE()
      WHERE id = @id AND contact_id = @contact_id
    `);

  return res.json({ success: true, message: 'Bank account updated.' });
}));

// ── DELETE /api/bp/banking/:contactId/:id ───────────────────
router.delete('/banking/:contactId/:id', asyncHandler(async (req, res) => {
  await poolConnect;
  const orgId     = req.user.orgId;
  const contactId = parseInt(req.params.contactId);
  const id        = parseInt(req.params.id);

  if (!(await getContactOrg(contactId, orgId))) {
    return res.status(404).json({ success: false, error: 'Contact not found.' });
  }

  await pool.request()
    .input('id',         sql.Int, id)
    .input('contact_id', sql.Int, contactId)
    .query('DELETE FROM bp_bank_accounts WHERE id=@id AND contact_id=@contact_id');

  return res.json({ success: true, message: 'Bank account deleted.' });
}));

module.exports = router;
