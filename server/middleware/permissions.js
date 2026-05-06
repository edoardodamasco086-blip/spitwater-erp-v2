'use strict';
// ============================================================
// middleware/permissions.js
//
// requirePermission(resource, action)
//
// Rules:
//   1. super_admin  → always allowed
//   2. admin        → allowed only if their teams grant it
//                     (they should be in the "Admin" team by default)
//   3. Other roles  → must have permission via a team
//   4. Multiple teams → most permissive wins (any team grants = allowed)
//   5. No teams / no permission row → DENIED
//
// Usage in routes:
//   const { requirePermission } = require('../middleware/permissions');
//   router.post('/', requireAuth, requirePermission('contacts', 'write'), handler)
//
// Actions: 'read' | 'write' | 'update' | 'delete'
// ============================================================

const { sql, pool, poolConnect } = require('../config/db');
const logger = require('../config/logger');

// ── Simple in-process permission cache ───────────────────────
// Permissions rarely change — cache per user per org for 60 seconds
// to avoid a DB hit on every request
const permCache    = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

function cacheKey(userId, orgId) {
  return `${orgId}:${userId}`;
}

function getCached(userId, orgId) {
  const key  = cacheKey(userId, orgId);
  const entry = permCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    permCache.delete(key);
    return null;
  }
  return entry.perms;
}

function setCache(userId, orgId, perms) {
  permCache.set(cacheKey(userId, orgId), { ts: Date.now(), perms });
}

// Call this when permissions change (team update, member add/remove)
function invalidateCache(userId, orgId) {
  if (userId && orgId) {
    permCache.delete(cacheKey(userId, orgId));
  } else {
    // Invalidate all (e.g. when a team's permissions are updated)
    permCache.clear();
  }
}

// ── Fetch merged permissions for a user ──────────────────────
// Returns: Map of resource → { can_read, can_write, can_update, can_delete }
// Most permissive across all teams the user belongs to
async function getUserPermissions(userId, orgId) {
  // Check cache first
  const cached = getCached(userId, orgId);
  if (cached) return cached;

  await poolConnect;

  const rows = await pool.request()
    .input('user_id', sql.Int, userId)
    .input('org_id',  sql.Int, orgId)
    .query(`
      SELECT
        tp.resource,
        MAX(CAST(tp.can_read   AS INT)) AS can_read,
        MAX(CAST(tp.can_write  AS INT)) AS can_write,
        MAX(CAST(tp.can_update AS INT)) AS can_update,
        MAX(CAST(tp.can_delete AS INT)) AS can_delete
      FROM user_teams ut
      INNER JOIN team_permissions tp
        ON tp.team_id = ut.team_id AND tp.org_id = ut.org_id
      WHERE ut.user_id = @user_id
        AND ut.org_id  = @org_id
      GROUP BY tp.resource
    `);

  // Build permission map
  const perms = new Map();
  for (const row of rows.recordset) {
    perms.set(row.resource, {
      can_read:   !!row.can_read,
      can_write:  !!row.can_write,
      can_update: !!row.can_update,
      can_delete: !!row.can_delete,
    });
  }

  setCache(userId, orgId, perms);
  return perms;
}

// ── Action → column name mapping ─────────────────────────────
const ACTION_COLUMNS = {
  read:   'can_read',
  write:  'can_write',
  update: 'can_update',
  delete: 'can_delete',
};

// ── Main middleware factory ───────────────────────────────────
function requirePermission(resource, action) {
  const column = ACTION_COLUMNS[action];
  if (!column) throw new Error(`Invalid permission action: "${action}". Must be read|write|update|delete`);

  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Not authenticated.' });
      }

      const { userId, orgId, role } = req.user;

      // Rule 1: super_admin bypasses everything
      if (role === 'super_admin') return next();

      // Get merged permissions from DB (or cache)
      const perms = await getUserPermissions(userId, orgId);

      const resourcePerms = perms.get(resource);

      if (!resourcePerms || !resourcePerms[column]) {
        logger.warn(`Permission denied: user=${req.user.email} resource=${resource} action=${action}`);
        return res.status(403).json({
          success: false,
          error:   `You do not have permission to ${action} ${resource}.`,
          code:    'PERMISSION_DENIED',
          resource,
          action,
        });
      }

      next();
    } catch (err) {
      logger.error('Permission check error:', err);
      return res.status(500).json({ success: false, error: 'Permission check failed.' });
    }
  };
}

// ── Helper: check permission without middleware (for conditional logic) ──
async function hasPermission(userId, orgId, role, resource, action) {
  if (role === 'super_admin') return true;
  const column = ACTION_COLUMNS[action];
  if (!column) return false;
  const perms = await getUserPermissions(userId, orgId);
  const resourcePerms = perms.get(resource);
  return !!(resourcePerms && resourcePerms[column]);
}

module.exports = { requirePermission, hasPermission, invalidateCache, getUserPermissions };
