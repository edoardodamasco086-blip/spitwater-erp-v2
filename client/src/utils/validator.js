// ============================================================
// src/utils/validator.js
//
// Client-side validation and transform engine.
// Mirrors the server-side rules stored in field_validation_rules.
//
// Usage:
//   import { validateForm, transformForm } from '../utils/validator';
//
//   const errors = validateForm(formData, rules, { categories });
//   if (errors) { setErrors(errors); return; }
//   const cleaned = transformForm(formData, rules);
//   await api.create(cleaned);
// ============================================================

// ── AU ABN checksum validation ────────────────────────────────
function isValidABN(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const d = digits.split('').map(Number);
  d[0] -= 1;
  const sum = weights.reduce((acc, w, i) => acc + w * d[i], 0);
  return sum % 89 === 0;
}

// ── AU ACN checksum validation ────────────────────────────────
function isValidACN(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 9) return false;
  const weights = [8, 7, 6, 5, 4, 3, 2, 1];
  const d = digits.split('').map(Number);
  const sum = weights.reduce((acc, w, i) => acc + w * d[i], 0);
  const complement = (10 - (sum % 10)) % 10;
  return complement === d[8];
}

// ── Phone patterns ────────────────────────────────────────────
const AU_PHONE_REGEX  = /^(\+?61|0)[2-578]\d{8}$|^(\+?61|0)[2-578]\s?\d{4}\s?\d{4}$/;
const AU_MOBILE_REGEX = /^(\+?61|0)4\d{8}$|^(\+?61|0)4\d{2}\s?\d{3}\s?\d{3}$/;
const EMAIL_REGEX     = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_REGEX       = /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/i;
const AU_POSTCODE     = /^\d{4}$/;

// ── Validate a single value against a rule ────────────────────
export function validateField(value, rule, context = {}) {
  const isEmpty = value === undefined || value === null || String(value).trim() === '';

  // Required check
  if (rule.is_required && isEmpty) {
    return rule.validation_msg || `${rule.field_label} is required.`;
  }

  // Skip further validation if empty and not required
  if (isEmpty) return null;

  const str = String(value).trim();
  const num = parseFloat(value);

  switch (rule.validation_type) {
    case 'none':
      return null;

    case 'email':
      return EMAIL_REGEX.test(str) ? null
        : (rule.validation_msg || `${rule.field_label}: Enter a valid email address.`);

    case 'phone_au':
      return AU_PHONE_REGEX.test(str.replace(/\s/g, '')) ? null
        : (rule.validation_msg || `${rule.field_label}: Enter a valid Australian phone number.`);

    case 'mobile_au':
      return AU_MOBILE_REGEX.test(str.replace(/\s/g, '')) ? null
        : (rule.validation_msg || `${rule.field_label}: Enter a valid Australian mobile number (04xx xxx xxx).`);

    case 'abn':
      return isValidABN(str) ? null
        : (rule.validation_msg || `${rule.field_label}: Enter a valid 11-digit ABN.`);

    case 'acn':
      return isValidACN(str) ? null
        : (rule.validation_msg || `${rule.field_label}: Enter a valid 9-digit ACN.`);

    case 'url':
      return URL_REGEX.test(str) ? null
        : (rule.validation_msg || `${rule.field_label}: Enter a valid URL.`);

    case 'postcode_au':
      return AU_POSTCODE.test(str) ? null
        : (rule.validation_msg || `${rule.field_label}: Enter a valid 4-digit Australian postcode.`);

    case 'numeric':
      return !isNaN(num) ? null
        : (rule.validation_msg || `${rule.field_label}: Must be a number.`);

    case 'integer':
      return Number.isInteger(Number(value)) ? null
        : (rule.validation_msg || `${rule.field_label}: Must be a whole number.`);

    case 'positive':
      return (!isNaN(num) && num >= 0) ? null
        : (rule.validation_msg || `${rule.field_label}: Must be zero or a positive number.`);

    case 'percentage':
      return (!isNaN(num) && num >= 0 && num <= 100) ? null
        : (rule.validation_msg || `${rule.field_label}: Must be between 0 and 100.`);

    case 'numeric_only':
      return /^\d+$/.test(str) ? null
        : (rule.validation_msg || `${rule.field_label}: Must contain digits only.`);

    case 'range': {
      const hasMin = rule.validation_min != null;
      const hasMax = rule.validation_max != null;
      if (isNaN(num)) return rule.validation_msg || `${rule.field_label}: Must be a number.`;
      if (hasMin && num < rule.validation_min) return rule.validation_msg || `${rule.field_label}: Must be at least ${rule.validation_min}.`;
      if (hasMax && num > rule.validation_max) return rule.validation_msg || `${rule.field_label}: Must be at most ${rule.validation_max}.`;
      return null;
    }

    case 'min_length': {
      const min = rule.validation_min || 0;
      return str.length >= min ? null
        : (rule.validation_msg || `${rule.field_label}: Must be at least ${min} characters.`);
    }

    case 'max_length': {
      const max = rule.validation_max || 9999;
      return str.length <= max ? null
        : (rule.validation_msg || `${rule.field_label}: Must be at most ${max} characters.`);
    }

    case 'date':
      return !isNaN(Date.parse(str)) ? null
        : (rule.validation_msg || `${rule.field_label}: Enter a valid date.`);

    case 'future_date': {
      const d = new Date(str);
      return (!isNaN(d.getTime()) && d > new Date()) ? null
        : (rule.validation_msg || `${rule.field_label}: Must be a future date.`);
    }

    case 'past_date': {
      const d = new Date(str);
      return (!isNaN(d.getTime()) && d < new Date()) ? null
        : (rule.validation_msg || `${rule.field_label}: Must be a past date.`);
    }

    case 'regex':
      if (!rule.validation_regex) return null;
      try {
        return new RegExp(rule.validation_regex).test(str) ? null
          : (rule.validation_msg || `${rule.field_label}: Invalid format.`);
      } catch {
        return null;
      }

    case 'leaf_category': {
      // Requires context.categories (flat list with has_children)
      const cats = context.categories || [];
      const cat  = cats.find(c => String(c.id) === String(value));
      if (!cat) return rule.validation_msg || `${rule.field_label}: Select a valid category.`;
      if (cat.has_children) return rule.validation_msg || `${rule.field_label}: Select a subcategory (not a parent category).`;
      return null;
    }

    default:
      return null;
  }
}

// ── Apply transform to a value ────────────────────────────────
export function transformValue(value, transform) {
  if (value === undefined || value === null) return value;
  const str = String(value);

  switch (transform) {
    case 'trim':          return str.trim();
    case 'uppercase':     return str.toUpperCase();
    case 'lowercase':     return str.toLowerCase();
    case 'titlecase':     return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim();
    case 'uppercase_trim':return str.toUpperCase().trim();
    case 'lowercase_trim':return str.toLowerCase().trim();
    case 'numeric_only':  return str.replace(/\D/g, '');

    case 'phone_au_format': {
      const digits = str.replace(/\D/g, '');
      if (digits.startsWith('61') && digits.length === 11) {
        // +61 4xx xxx xxx
        return `+61 ${digits[2]} ${digits.slice(3,7)} ${digits.slice(7)}`;
      }
      if (digits.startsWith('04') && digits.length === 10) {
        // 04xx xxx xxx
        return `${digits.slice(0,4)} ${digits.slice(4,7)} ${digits.slice(7)}`;
      }
      if (digits.length === 10) {
        // 07 xxxx xxxx
        return `${digits.slice(0,2)} ${digits.slice(2,6)} ${digits.slice(6)}`;
      }
      return str.trim();
    }

    case 'abn_format': {
      const digits = str.replace(/\D/g, '');
      if (digits.length === 11) {
        return `${digits.slice(0,2)} ${digits.slice(2,5)} ${digits.slice(5,8)} ${digits.slice(8)}`;
      }
      return str.trim();
    }

    case 'none':
    default:
      return value;
  }
}

// ── Validate an entire form against an array of rules ─────────
// Supports multiple rules per field_key (v2).
// For each field, runs ALL rules and collects the FIRST error per field.
// Returns null if valid, or { fieldKey: errorMessage } if errors.
export function validateForm(formData, rules, context = {}) {
  const errors = {};

  // Group rules by field_key, preserving order
  const fieldRules = {};
  for (const rule of rules) {
    if (!rule.is_active) continue;
    if (!fieldRules[rule.field_key]) fieldRules[rule.field_key] = [];
    fieldRules[rule.field_key].push(rule);
  }

  for (const [fieldKey, fieldRuleList] of Object.entries(fieldRules)) {
    const value = formData[fieldKey];

    // Check required on the FIRST rule for this field (only one rule per field
    // should have is_required = true — the first/primary one)
    const primaryRule = fieldRuleList[0];
    const isEmpty = value === undefined || value === null || String(value).trim() === '';

    if (primaryRule.is_required && isEmpty) {
      errors[fieldKey] = primaryRule.validation_msg || `${primaryRule.field_label} is required.`;
      continue; // No point validating further if empty and required
    }

    if (isEmpty) continue; // Optional and empty — skip all validations

    // Run every rule for this field, stop at first error
    for (const rule of fieldRuleList) {
      const error = validateField(value, rule, context);
      if (error) {
        errors[fieldKey] = error;
        break; // Show first failing rule's error
      }
    }
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

// ── Transform an entire form ──────────────────────────────────
// Returns a new object with all transforms applied
export function transformForm(formData, rules) {
  const result = { ...formData };
  for (const rule of rules) {
    if (!rule.is_active || !rule.transform || rule.transform === 'none') continue;
    if (result[rule.field_key] !== undefined && result[rule.field_key] !== null) {
      result[rule.field_key] = transformValue(result[rule.field_key], rule.transform);
    }
  }
  return result;
}

// ── Real-time single field validation (for onBlur) ────────────
// Runs ALL rules for the field and returns the first error found.
export function validateFieldLive(fieldKey, value, rules, context = {}) {
  const fieldRules = rules.filter(r => r.field_key === fieldKey && r.is_active !== false);
  if (!fieldRules.length) return null;

  const isEmpty = value === undefined || value === null || String(value).trim() === '';

  // Required check first
  const primary = fieldRules[0];
  if (primary.is_required && isEmpty) {
    return primary.validation_msg || `${primary.field_label} is required.`;
  }
  if (isEmpty) return null;

  // Run each rule until an error is found
  for (const rule of fieldRules) {
    const error = validateField(value, rule, context);
    if (error) return error;
  }
  return null;
}
