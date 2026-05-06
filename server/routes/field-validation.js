'use strict';
// ============================================================
// routes/field-validation.js  (v2 — multiple rules per field)
//
// GET  /api/field-validation/meta          — entity list, validation types, transforms
// GET  /api/field-validation/:entity       — all rules for entity, ordered by field_key + rule_order
// PUT  /api/field-validation/:entity       — replace ALL rules for entity (bulk)
// ============================================================

const express = require('express');
const router  = express.Router();
const { sql, pool, poolConnect } = require('../config/db');
const { requireAuth, requireRole }  = require('../middleware/auth');
const { asyncHandler }              = require('../middleware/errorHandler');

router.use(requireAuth);

const ENTITIES = [
  { key: 'product',        label: 'Products',        icon: 'box'    },
  { key: 'contact',        label: 'Contacts',        icon: 'users'  },
  { key: 'invoice',        label: 'Invoices',        icon: 'file'   },
  { key: 'quote',          label: 'Quotes',          icon: 'doc'    },
  { key: 'purchase_order', label: 'Purchase Orders', icon: 'cart'   },
  { key: 'service_job',    label: 'Service Jobs',    icon: 'wrench' },
];

const VALIDATION_TYPES = [
  { value: 'none',          label: 'No validation'           },
  { value: 'email',         label: 'Email address'           },
  { value: 'phone_au',      label: 'AU phone number'         },
  { value: 'mobile_au',     label: 'AU mobile number'        },
  { value: 'abn',           label: 'Australian ABN'          },
  { value: 'acn',           label: 'Australian ACN'          },
  { value: 'url',           label: 'URL / Website'           },
  { value: 'postcode_au',   label: 'AU postcode (4 digits)'  },
  { value: 'numeric',       label: 'Numeric value'           },
  { value: 'integer',       label: 'Integer (whole number)'  },
  { value: 'positive',      label: 'Positive number (>= 0)' },
  { value: 'percentage',    label: 'Percentage (0-100)'      },
  { value: 'range',         label: 'Number range (min/max)'  },
  { value: 'min_length',    label: 'Minimum text length'     },
  { value: 'max_length',    label: 'Maximum text length'     },
  { value: 'date',          label: 'Valid date'              },
  { value: 'future_date',   label: 'Future date'             },
  { value: 'past_date',     label: 'Past date'               },
  { value: 'regex',         label: 'Custom regex pattern'    },
  { value: 'leaf_category', label: 'Must be leaf category'   },
  { value: 'numeric_only',  label: 'Digits only'             },
];

const TRANSFORMS = [
  { value: 'none',           label: 'No transform'                     },
  { value: 'trim',           label: 'Trim whitespace'                  },
  { value: 'uppercase',      label: 'UPPERCASE'                        },
  { value: 'lowercase',      label: 'lowercase'                        },
  { value: 'titlecase',      label: 'Title Case'                       },
  { value: 'uppercase_trim', label: 'UPPERCASE + trim'                 },
  { value: 'lowercase_trim', label: 'lowercase + trim'                 },
  { value: 'numeric_only',   label: 'Digits only (strip non-numeric)'  },
  { value: 'phone_au_format',label: 'Format as AU phone'               },
  { value: 'abn_format',     label: 'Format as ABN (xx xxx xxx xxx)'  },
];

// ── GET /api/field-validation/meta ───────────────────────────
router.get('/meta', asyncHandler(async (_req, res) => {
  return res.json({ success: true, data: { entities: ENTITIES, validation_types: VALIDATION_TYPES, transforms: TRANSFORMS } });
}));

// ── GET /api/field-validation/:entity ────────────────────────
// Returns rules ordered by: field_key ASC, rule_order ASC
// Multiple rows per field_key are returned — UI groups them visually
router.get('/:entity', asyncHandler(async (req, res) => {
  await poolConnect;
  const rows = await pool.request()
    .input('org_id',     sql.Int,         req.user.orgId)
    .input('entity_key', sql.VarChar(50), req.params.entity)
    .query(`
      SELECT id, entity_key, field_key, field_label,
             is_required, validation_type,
             validation_min, validation_max,
             validation_regex, validation_msg,
             transform, is_active,
             ISNULL(rule_order, 0) AS rule_order,
             sort_order
      FROM field_validation_rules
      WHERE org_id = @org_id AND entity_key = @entity_key
      ORDER BY sort_order ASC, field_key ASC, ISNULL(rule_order, 0) ASC
    `);

  return res.json({ success: true, data: rows.recordset });
}));

// ── PUT /api/field-validation/:entity ────────────────────────
// Full replace: deletes all existing rules for entity, re-inserts from body
// Body: { rules: [{ field_key, field_label, is_required, validation_type, ... rule_order }] }
router.put('/:entity', requireRole('admin'), asyncHandler(async (req, res) => {
  await poolConnect;
  const { entity }  = req.params;
  const orgId       = req.user.orgId;
  const { rules }   = req.body;

  if (!Array.isArray(rules)) {
    return res.status(400).json({ success: false, error: 'rules array required.' });
  }

  // Delete all existing rules for this entity+org, then re-insert
  await pool.request()
    .input('org_id',     sql.Int,         orgId)
    .input('entity_key', sql.VarChar(50), entity)
    .query('DELETE FROM field_validation_rules WHERE org_id=@org_id AND entity_key=@entity_key');

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    await pool.request()
      .input('org_id',           sql.Int,           orgId)
      .input('entity_key',       sql.VarChar(50),   entity)
      .input('field_key',        sql.VarChar(100),  rule.field_key)
      .input('field_label',      sql.NVarChar(200), rule.field_label)
      .input('is_required',      sql.Bit,           rule.is_required      ? 1 : 0)
      .input('validation_type',  sql.VarChar(30),   rule.validation_type  || 'none')
      .input('validation_min',   sql.Decimal(18,4), rule.validation_min   ?? null)
      .input('validation_max',   sql.Decimal(18,4), rule.validation_max   ?? null)
      .input('validation_regex', sql.NVarChar(500), rule.validation_regex || null)
      .input('validation_msg',   sql.NVarChar(200), rule.validation_msg   || null)
      .input('transform',        sql.VarChar(30),   rule.transform        || 'none')
      .input('is_active',        sql.Bit,           rule.is_active !== false ? 1 : 0)
      .input('sort_order',       sql.Int,           rule.sort_order       ?? i)
      .input('rule_order',       sql.Int,           rule.rule_order       ?? 0)
      .input('updated_by',       sql.Int,           req.user.userId)
      .query(`
        INSERT INTO field_validation_rules
          (org_id, entity_key, field_key, field_label, is_required, validation_type,
           validation_min, validation_max, validation_regex, validation_msg,
           transform, is_active, sort_order, rule_order, updated_at, updated_by)
        VALUES
          (@org_id, @entity_key, @field_key, @field_label, @is_required, @validation_type,
           @validation_min, @validation_max, @validation_regex, @validation_msg,
           @transform, @is_active, @sort_order, @rule_order, GETDATE(), @updated_by)
      `);
  }

  return res.json({ success: true, message: `Saved ${rules.length} validation rules for ${entity}.` });
}));

module.exports = router;
