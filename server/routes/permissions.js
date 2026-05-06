'use strict';
// ============================================================
// routes/permissions.js
//
// Teams (now using DB table instead of JSON):
// GET    /api/permissions/teams              — list all teams
// POST   /api/permissions/teams              — create team
// PATCH  /api/permissions/teams/:id          — update team
// DELETE /api/permissions/teams/:id          — delete team
// POST   /api/permissions/teams/:id/members  — add member
// DELETE /api/permissions/teams/:id/members/:uid — remove member
// GET    /api/permissions/teams/:id/members  — list members
//
// Permissions:
// GET    /api/permissions/teams/:id/perms    — get team permissions
// PUT    /api/permissions/teams/:id/perms    — save all permissions for team
// GET    /api/permissions/my                 — current user's effective permissions
// GET    /api/permissions/resources          — list all available resources
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect }           = require('../config/db');
const { requireAuth, requireRole }         = require('../middleware/auth');
const { asyncHandler }                     = require('../middleware/errorHandler');
const { invalidateCache, getUserPermissions } = require('../middleware/permissions');
const logger                               = require('../config/logger');

router.use(requireAuth);

// All available resources and which actions apply
const RESOURCES = [
  { key: 'contacts',        label: 'Contacts',        actions: ['read','write','update','delete'] },
  { key: 'products',        label: 'Products',        actions: ['read','write','update','delete'] },
  { key: 'quotes',          label: 'Quotes',          actions: ['read','write','update','delete'] },
  { key: 'invoices',        label: 'Invoices',        actions: ['read','write','update','delete'] },
  { key: 'credit_notes',    label: 'Credit Notes',    actions: ['read','write','update','delete'] },
  { key: 'purchase_orders', label: 'Purchase Orders', actions: ['read','write','update','delete'] },
  { key: 'goods_receipts',  label: 'Goods Receipts',  actions: ['read','write','update','delete'] },
  { key: 'service_jobs',    label: 'Service Jobs',    actions: ['read','write','update','delete'] },
  { key: 'warranties',      label: 'Warranties',      actions: ['read','write','update','delete'] },
  { key: 'inventory',       label: 'Inventory',       actions: ['read','write','update','delete'] },
  { key: 'warehouses',      label: 'Warehouses',      actions: ['read','write','update','delete'] },
  { key: 'reports',         label: 'Reports',         actions: ['read'] },
  { key: 'bas',             label: 'BAS & Tax',       actions: ['read','write'] },
  { key: 'journals',        label: 'Journals',        actions: ['read','write'] },
  { key: 'settings',        label: 'Settings',        actions: ['read','write'] },
  { key: 'users',           label: 'Users & Teams',   actions: ['read','write','update','delete'] },
  { key: 'audit_log',       label: 'Audit Log',       actions: ['read'] },
];

// ────────────────────────────────────────────────────────────────
// GET /api/permissions/resources
// ────────────────────────────────────────────────────────────────
router.get('/resources', asyncHandler(async (_req, res) => {
  return res.json({ success: true, data: RESOURCES });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/permissions/my
// Returns the current user's merged effective permissions
// ────────────────────────────────────────────────────────────────
router.get('/my', asyncHandler(async (req, res) => {
  const { userId, orgId, role } = req.user;

  // super_admin gets everything
  if (role === 'super_admin') {
    const all = {};
    RESOURCES.forEach(r => {
      all[r.key] = { can_read: true, can_write: true, can_update: true, can_delete: true };
    });
    return res.json({ success: true, data: all, isSuperAdmin: true });
  }

  const perms = await getUserPermissions(userId, orgId);
  const result = {};
  RESOURCES.forEach(r => {
    const p = perms.get(r.key) || { can_read: false, can_write: false, can_update: false, can_delete: false };
    result[r.key] = p;
  });

  return res.json({ success: true, data: result, isSuperAdmin: false });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/permissions/teams
// ────────────────────────────────────────────────────────────────
router.get('/teams', asyncHandler(async (req, res) => {
  await poolConnect;

  const rows = await pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .query(`
      SELECT
        t.id, t.name, t.description, t.color, t.is_system, t.is_active, t.created_at,
        (SELECT COUNT(*) FROM user_teams ut WHERE ut.team_id = t.id AND ut.org_id = t.org_id) AS member_count
      FROM teams t
      WHERE t.org_id = @org_id AND t.is_active = 1
      ORDER BY t.is_system DESC, t.name ASC
    `);

  return res.json({ success: true, data: rows.recordset });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/permissions/teams
// ────────────────────────────────────────────────────────────────
router.post('/teams', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { name, description, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ success: false, error: 'Team name is required.' });

  const result = await pool.request()
    .input('org_id',      sql.Int,          req.user.orgId)
    .input('name',        sql.NVarChar(100), name.trim())
    .input('description', sql.NVarChar(500), description || '')
    .input('color',       sql.VarChar(7),    color || '#2F7FE8')
    .input('created_by',  sql.Int,           req.user.userId)
    .query(`
      INSERT INTO teams (org_id, name, description, color, is_system, is_active, created_at, created_by)
      OUTPUT INSERTED.id
      VALUES (@org_id, @name, @description, @color, 0, 1, GETDATE(), @created_by)
    `);

  const teamId = result.recordset[0].id;

  // Seed read-only permissions for new team
  for (const r of RESOURCES) {
    await pool.request()
      .input('org_id',  sql.Int,         req.user.orgId)
      .input('team_id', sql.Int,         teamId)
      .input('resource',sql.VarChar(50), r.key)
      .query(`
        INSERT INTO team_permissions (org_id, team_id, resource, can_read, can_write, can_update, can_delete, updated_at)
        VALUES (@org_id, @team_id, @resource, 0, 0, 0, 0, GETDATE())
      `);
  }

  invalidateCache(null, null);
  return res.status(201).json({ success: true, data: { id: teamId }, message: `Team "${name}" created.` });
}));

// ────────────────────────────────────────────────────────────────
// PATCH /api/permissions/teams/:id
// ────────────────────────────────────────────────────────────────
router.patch('/teams/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const teamId = parseInt(req.params.id);
  const { name, description, color } = req.body;

  // Prevent renaming system teams
  const check = await pool.request()
    .input('id',     sql.Int, teamId)
    .input('org_id', sql.Int, req.user.orgId)
    .query('SELECT is_system FROM teams WHERE id=@id AND org_id=@org_id');

  if (!check.recordset.length) return res.status(404).json({ success: false, error: 'Team not found.' });
  if (check.recordset[0].is_system && name) {
    return res.status(400).json({ success: false, error: 'Cannot rename system teams.' });
  }

  await pool.request()
    .input('id',          sql.Int,          teamId)
    .input('name',        sql.NVarChar(100), name        || null)
    .input('description', sql.NVarChar(500), description !== undefined ? description : null)
    .input('color',       sql.VarChar(7),    color       || null)
    .query(`
      UPDATE teams SET
        name        = COALESCE(@name,        name),
        description = COALESCE(@description, description),
        color       = COALESCE(@color,       color)
      WHERE id = @id
    `);

  invalidateCache(null, null);
  return res.json({ success: true, message: 'Team updated.' });
}));

// ────────────────────────────────────────────────────────────────
// DELETE /api/permissions/teams/:id
// ────────────────────────────────────────────────────────────────
router.delete('/teams/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const teamId = parseInt(req.params.id);

  const check = await pool.request()
    .input('id',     sql.Int, teamId)
    .input('org_id', sql.Int, req.user.orgId)
    .query(`
      SELECT t.is_system,
        (SELECT COUNT(*) FROM user_teams ut WHERE ut.team_id=t.id) AS member_count
      FROM teams t
      WHERE t.id=@id AND t.org_id=@org_id
    `);

  if (!check.recordset.length) return res.status(404).json({ success: false, error: 'Team not found.' });
  if (check.recordset[0].is_system)     return res.status(400).json({ success: false, error: 'Cannot delete system teams.' });
  if (check.recordset[0].member_count > 0) return res.status(409).json({ success: false, error: 'Remove all members before deleting the team.' });

  await pool.request().input('id', sql.Int, teamId)
    .query('DELETE FROM team_permissions WHERE team_id=@id');
  await pool.request().input('id', sql.Int, teamId)
    .query('UPDATE teams SET is_active=0 WHERE id=@id');

  invalidateCache(null, null);
  return res.json({ success: true, message: 'Team deleted.' });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/permissions/teams/:id/members
// ────────────────────────────────────────────────────────────────
router.get('/teams/:id/members', asyncHandler(async (req, res) => {
  await poolConnect;

  const rows = await pool.request()
    .input('team_id', sql.Int, parseInt(req.params.id))
    .input('org_id',  sql.Int, req.user.orgId)
    .query(`
      SELECT u.id, u.full_name, u.email, u.avatar_url,
             om.role, ut.joined_at
      FROM user_teams ut
      INNER JOIN users u      ON u.id  = ut.user_id
      INNER JOIN org_members om ON om.user_id = u.id AND om.org_id = ut.org_id
      WHERE ut.team_id = @team_id AND ut.org_id = @org_id
        AND u.is_active = 1
      ORDER BY u.full_name ASC
    `);

  return res.json({ success: true, data: rows.recordset });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/permissions/teams/:id/members  { userId }
// ────────────────────────────────────────────────────────────────
router.post('/teams/:id/members', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const teamId = parseInt(req.params.id);
  const userId = parseInt(req.body.userId);

  if (!userId) return res.status(400).json({ success: false, error: 'userId required.' });

  await pool.request()
    .input('org_id',  sql.Int, req.user.orgId)
    .input('user_id', sql.Int, userId)
    .input('team_id', sql.Int, teamId)
    .input('added_by',sql.Int, req.user.userId)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM user_teams WHERE org_id=@org_id AND user_id=@user_id AND team_id=@team_id)
        INSERT INTO user_teams (org_id, user_id, team_id, joined_at, added_by)
        VALUES (@org_id, @user_id, @team_id, GETDATE(), @added_by)
    `);

  invalidateCache(userId, req.user.orgId);
  return res.json({ success: true, message: 'User added to team.' });
}));

// ────────────────────────────────────────────────────────────────
// DELETE /api/permissions/teams/:id/members/:uid
// ────────────────────────────────────────────────────────────────
router.delete('/teams/:id/members/:uid', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const teamId = parseInt(req.params.id);
  const userId = parseInt(req.params.uid);

  // Prevent removing super_admin from Admin team
  const check = await pool.request()
    .input('team_id', sql.Int, teamId)
    .input('org_id',  sql.Int, req.user.orgId)
    .query('SELECT is_system FROM teams WHERE id=@team_id AND org_id=@org_id');

  if (check.recordset[0]?.is_system && check.recordset[0]?.name === 'Admin') {
    const memberRole = await pool.request()
      .input('user_id', sql.Int, userId)
      .input('org_id',  sql.Int, req.user.orgId)
      .query('SELECT role FROM org_members WHERE user_id=@user_id AND org_id=@org_id');
    if (memberRole.recordset[0]?.role === 'super_admin') {
      return res.status(400).json({ success: false, error: 'Cannot remove super_admin from the Admin team.' });
    }
  }

  await pool.request()
    .input('org_id',  sql.Int, req.user.orgId)
    .input('user_id', sql.Int, userId)
    .input('team_id', sql.Int, teamId)
    .query('DELETE FROM user_teams WHERE org_id=@org_id AND user_id=@user_id AND team_id=@team_id');

  invalidateCache(userId, req.user.orgId);
  return res.json({ success: true, message: 'User removed from team.' });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/permissions/teams/:id/perms
// ────────────────────────────────────────────────────────────────
router.get('/teams/:id/perms', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const teamId = parseInt(req.params.id);

  const rows = await pool.request()
    .input('team_id', sql.Int, teamId)
    .input('org_id',  sql.Int, req.user.orgId)
    .query(`
      SELECT resource, can_read, can_write, can_update, can_delete
      FROM team_permissions
      WHERE team_id=@team_id AND org_id=@org_id
      ORDER BY resource ASC
    `);

  // Return as object map: { contacts: { can_read: true, ... }, ... }
  const perms = {};
  for (const row of rows.recordset) {
    perms[row.resource] = {
      can_read:   !!row.can_read,
      can_write:  !!row.can_write,
      can_update: !!row.can_update,
      can_delete: !!row.can_delete,
    };
  }

  return res.json({ success: true, data: perms });
}));

// ────────────────────────────────────────────────────────────────
// PUT /api/permissions/teams/:id/perms
// Body: { permissions: { contacts: { can_read, can_write, ... }, ... } }
// Saves the entire permission set for a team in one call
// ────────────────────────────────────────────────────────────────
router.put('/teams/:id/perms', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const teamId = parseInt(req.params.id);
  const { permissions } = req.body;

  if (!permissions || typeof permissions !== 'object') {
    return res.status(400).json({ success: false, error: 'permissions object required.' });
  }

  // Verify team belongs to org
  const check = await pool.request()
    .input('id',     sql.Int, teamId)
    .input('org_id', sql.Int, req.user.orgId)
    .query('SELECT id, is_system FROM teams WHERE id=@id AND org_id=@org_id');

  if (!check.recordset.length) {
    return res.status(404).json({ success: false, error: 'Team not found.' });
  }

  // Upsert each resource permission
  for (const [resource, perms] of Object.entries(permissions)) {
    const resourceDef = RESOURCES.find(r => r.key === resource);
    if (!resourceDef) continue; // Skip unknown resources

    // Enforce read-only resources
    const isReadOnly = resourceDef.actions.length === 1 && resourceDef.actions[0] === 'read';

    await pool.request()
      .input('org_id',     sql.Int,         req.user.orgId)
      .input('team_id',    sql.Int,         teamId)
      .input('resource',   sql.VarChar(50), resource)
      .input('can_read',   sql.Bit,         perms.can_read   ? 1 : 0)
      .input('can_write',  sql.Bit,         isReadOnly ? 0 : (perms.can_write  ? 1 : 0))
      .input('can_update', sql.Bit,         isReadOnly ? 0 : (perms.can_update ? 1 : 0))
      .input('can_delete', sql.Bit,         isReadOnly ? 0 : (perms.can_delete ? 1 : 0))
      .input('updated_by', sql.Int,         req.user.userId)
      .query(`
        IF EXISTS (SELECT 1 FROM team_permissions WHERE org_id=@org_id AND team_id=@team_id AND resource=@resource)
          UPDATE team_permissions SET
            can_read=@can_read, can_write=@can_write,
            can_update=@can_update, can_delete=@can_delete,
            updated_at=GETDATE(), updated_by=@updated_by
          WHERE org_id=@org_id AND team_id=@team_id AND resource=@resource
        ELSE
          INSERT INTO team_permissions (org_id,team_id,resource,can_read,can_write,can_update,can_delete,updated_at,updated_by)
          VALUES (@org_id,@team_id,@resource,@can_read,@can_write,@can_update,@can_delete,GETDATE(),@updated_by)
      `);
  }

  // Invalidate cache for all users in this team
  const members = await pool.request()
    .input('team_id', sql.Int, teamId)
    .query('SELECT user_id FROM user_teams WHERE team_id=@team_id');

  for (const { user_id } of members.recordset) {
    invalidateCache(user_id, req.user.orgId);
  }

  logger.info(`Permissions updated for team ${teamId} by [${req.user.email}]`);
  return res.json({ success: true, message: 'Permissions saved.' });
}));

// ────────────────────────────────────────────────────────────────
// GET /api/permissions/users/list  — all users available to add to teams
// ────────────────────────────────────────────────────────────────
router.get('/users/list', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;

  const rows = await pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .query(`
      SELECT u.id, u.full_name, u.email, om.role
      FROM users u
      INNER JOIN org_members om ON om.user_id=u.id AND om.org_id=@org_id AND om.is_active=1
      WHERE u.is_active=1
      ORDER BY u.full_name ASC
    `);

  return res.json({ success: true, data: rows.recordset });
}));

module.exports = router;
