'use strict';
// ============================================================
// routes/teams.js
// Teams don't exist in the schema yet — we add them here.
// Uses a lightweight approach: custom_field_values pattern
// but as a dedicated teams table via org_settings JSON for now,
// then migrate to a proper table in a schema update.
//
// For simplicity, teams are stored as a JSON field in org_settings.
// This avoids a schema migration for now.
//
// GET    /api/teams          — list teams
// POST   /api/teams          — create team
// PATCH  /api/teams/:id      — rename team
// DELETE /api/teams/:id      — delete team (if no members)
// POST   /api/teams/:id/members     — add user to team
// DELETE /api/teams/:id/members/:uid — remove user from team
// ============================================================

const express = require('express');
const router  = express.Router();

const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

router.use(requireAuth);

// We store teams as JSON in a dedicated teams_json column we add to org_settings
// If the column doesn't exist yet, we handle gracefully

async function getTeams(orgId, pool) {
  try {
    const res = await pool.request()
      .input('org_id', sql.Int, orgId)
      .query('SELECT teams_json FROM org_settings WHERE org_id = @org_id');
    const raw = res.recordset[0]?.teams_json;
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveTeams(orgId, teams, pool) {
  try {
    await pool.request()
      .input('org_id',     sql.Int,          orgId)
      .input('teams_json', sql.NVarChar(sql.MAX), JSON.stringify(teams))
      .query(`
        IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('org_settings') AND name = 'teams_json')
        BEGIN
          UPDATE org_settings SET teams_json = @teams_json WHERE org_id = @org_id
        END
      `);
  } catch (e) {
    // Column may not exist yet — ignore silently
  }
}

// ── Add teams_json column if it doesn't exist ─────────────────
async function ensureTeamsColumn(pool) {
  try {
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('org_settings') AND name = 'teams_json'
      )
      BEGIN
        ALTER TABLE org_settings ADD teams_json NVARCHAR(MAX) NULL
      END
    `);
  } catch (e) {
    // Ignore
  }
}

// Run on startup (lazy)
let columnEnsured = false;
async function ensureOnce(pool) {
  if (!columnEnsured) {
    await ensureTeamsColumn(pool);
    columnEnsured = true;
  }
}

// ────────────────────────────────────────────────────────────────
// GET /api/teams
// ────────────────────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  await poolConnect;
  await ensureOnce(pool);

  const teams = await getTeams(req.user.orgId, pool);

  // Enrich with member names
  if (teams.length > 0) {
    const allMemberIds = [...new Set(teams.flatMap(t => t.members || []))];
    if (allMemberIds.length > 0) {
      const users = await pool.request()
        .input('org_id', sql.Int, req.user.orgId)
        .query(`
          SELECT u.id, u.full_name, u.email, om.role
          FROM users u
          INNER JOIN org_members om ON om.user_id = u.id AND om.org_id = @org_id
          WHERE u.is_active = 1
        `);
      const userMap = {};
      users.recordset.forEach(u => { userMap[u.id] = u; });

      teams.forEach(t => {
        t.memberDetails = (t.members || []).map(id => userMap[id]).filter(Boolean);
      });
    }
  }

  return res.json({ success: true, data: teams });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/teams
// Body: { name, description, color }
// ────────────────────────────────────────────────────────────────
router.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  await ensureOnce(pool);

  const { name, description, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ success: false, error: 'Team name is required.' });

  const teams = await getTeams(req.user.orgId, pool);

  if (teams.find(t => t.name.toLowerCase() === name.trim().toLowerCase())) {
    return res.status(409).json({ success: false, error: 'A team with that name already exists.' });
  }

  const newTeam = {
    id:          Date.now(),
    name:        name.trim(),
    description: description || '',
    color:       color || '#2F7FE8',
    members:     [],
    createdAt:   new Date().toISOString(),
    createdBy:   req.user.userId,
  };

  teams.push(newTeam);
  await saveTeams(req.user.orgId, teams, pool);

  return res.status(201).json({ success: true, data: newTeam, message: `Team "${name}" created.` });
}));

// ────────────────────────────────────────────────────────────────
// PATCH /api/teams/:id
// Body: { name, description, color }
// ────────────────────────────────────────────────────────────────
router.patch('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const teamId = parseInt(req.params.id);
  const { name, description, color } = req.body;

  const teams = await getTeams(req.user.orgId, pool);
  const idx = teams.findIndex(t => t.id === teamId);

  if (idx === -1) return res.status(404).json({ success: false, error: 'Team not found.' });

  if (name)        teams[idx].name        = name.trim();
  if (description !== undefined) teams[idx].description = description;
  if (color)       teams[idx].color       = color;

  await saveTeams(req.user.orgId, teams, pool);
  return res.json({ success: true, message: 'Team updated.' });
}));

// ────────────────────────────────────────────────────────────────
// DELETE /api/teams/:id
// ────────────────────────────────────────────────────────────────
router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const teamId = parseInt(req.params.id);

  const teams = await getTeams(req.user.orgId, pool);
  const team  = teams.find(t => t.id === teamId);

  if (!team) return res.status(404).json({ success: false, error: 'Team not found.' });
  if (team.members?.length > 0) return res.status(409).json({ success: false, error: 'Remove all members before deleting the team.' });

  const updated = teams.filter(t => t.id !== teamId);
  await saveTeams(req.user.orgId, updated, pool);
  return res.json({ success: true, message: 'Team deleted.' });
}));

// ────────────────────────────────────────────────────────────────
// POST /api/teams/:id/members   Body: { userId }
// ────────────────────────────────────────────────────────────────
router.post('/:id/members', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const teamId = parseInt(req.params.id);
  const userId = parseInt(req.body.userId);

  if (!userId) return res.status(400).json({ success: false, error: 'userId required.' });

  const teams = await getTeams(req.user.orgId, pool);
  const team  = teams.find(t => t.id === teamId);
  if (!team) return res.status(404).json({ success: false, error: 'Team not found.' });

  if (!team.members) team.members = [];
  if (!team.members.includes(userId)) {
    team.members.push(userId);
    await saveTeams(req.user.orgId, teams, pool);
  }

  return res.json({ success: true, message: 'User added to team.' });
}));

// ────────────────────────────────────────────────────────────────
// DELETE /api/teams/:id/members/:uid
// ────────────────────────────────────────────────────────────────
router.delete('/:id/members/:uid', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const teamId = parseInt(req.params.id);
  const userId = parseInt(req.params.uid);

  const teams = await getTeams(req.user.orgId, pool);
  const team  = teams.find(t => t.id === teamId);
  if (!team) return res.status(404).json({ success: false, error: 'Team not found.' });

  team.members = (team.members || []).filter(id => id !== userId);
  await saveTeams(req.user.orgId, teams, pool);

  return res.json({ success: true, message: 'User removed from team.' });
}));

// GET /api/teams/users — all users available to add to teams
router.get('/users/list', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;

  const rows = await pool.request()
    .input('org_id', sql.Int, req.user.orgId)
    .query(`
      SELECT u.id, u.full_name, u.email, om.role
      FROM users u
      INNER JOIN org_members om ON om.user_id = u.id AND om.org_id = @org_id AND om.is_active = 1
      WHERE u.is_active = 1
      ORDER BY u.full_name ASC
    `);

  return res.json({ success: true, data: rows.recordset });
}));

module.exports = router;
