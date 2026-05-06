import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { invalidateValidationCache } from '../../hooks/useFieldValidation';
import styles from './FieldValidationPage.module.css';

const API = (path, opts = {}) =>
  fetch(`/api/field-validation${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
    ...opts,
  }).then(r => r.json());

const ENTITY_FIELDS = {
  product: [
    { key: 'name',                   label: 'Product Name',           hint: "The product's display name" },
    { key: 'product_code',           label: 'Product Code',           hint: 'Unique SKU / part number' },
    { key: 'barcode',                label: 'Barcode / EAN',          hint: 'EAN-13, UPC or custom barcode' },
    { key: 'category_id',            label: 'Category',               hint: 'Must be a leaf category' },
    { key: 'base_uom_id',            label: 'Unit of Measure',        hint: 'Each, Kg, Litre, etc.' },
    { key: 'default_sales_price',    label: 'Default Sales Price',    hint: 'RRP / default price' },
    { key: 'default_purchase_price', label: 'Default Purchase Price', hint: 'Default cost from supplier' },
    { key: 'description',            label: 'Description',            hint: 'Long description / product details' },
    { key: 'weight_kg',              label: 'Weight (kg)',             hint: 'Gross weight in kilograms' },
    { key: 'warranty_months',        label: 'Warranty (months)',       hint: 'Standard warranty period' },
    { key: 'supplier_part_number',   label: 'Supplier Part No.',      hint: 'Manufacturer reference number' },
    { key: 'lead_time_days',         label: 'Lead Time (days)',        hint: 'Days from order to delivery' },
    { key: 'min_order_qty',          label: 'Min Order Qty',          hint: 'Minimum purchasable quantity' },
    { key: 'min_stock_level',        label: 'Min Stock Level',        hint: 'Reorder trigger level' },
  ],
  contact: [
    { key: 'full_name',    label: 'Full Name / Business Name', hint: 'Primary display name' },
    { key: 'email',        label: 'Email Address',             hint: 'Primary contact email' },
    { key: 'phone',        label: 'Phone',                     hint: 'Landline or general phone' },
    { key: 'mobile',       label: 'Mobile',                    hint: 'Mobile / cell number' },
    { key: 'abn',          label: 'ABN',                       hint: 'Australian Business Number (11 digits)' },
    { key: 'acn',          label: 'ACN',                       hint: 'Australian Company Number (9 digits)' },
    { key: 'address_line1',label: 'Address Line 1',            hint: 'Street address' },
    { key: 'suburb',       label: 'Suburb',                    hint: 'City or suburb' },
    { key: 'state',        label: 'State',                     hint: 'Australian state / territory' },
    { key: 'postcode',     label: 'Postcode',                  hint: '4-digit Australian postcode' },
    { key: 'website',      label: 'Website',                   hint: 'Company website URL' },
    { key: 'credit_limit', label: 'Credit Limit',              hint: 'Maximum outstanding balance' },
  ],
  invoice: [
    { key: 'contact_id',    label: 'Customer',           hint: 'Who is being invoiced' },
    { key: 'document_date', label: 'Invoice Date',       hint: 'Date the invoice is issued' },
    { key: 'due_date',      label: 'Due Date',           hint: 'Payment due date' },
    { key: 'reference',     label: 'Customer Reference', hint: "Customer's PO or reference number" },
    { key: 'notes',         label: 'Notes',              hint: 'Internal notes' },
  ],
  quote: [
    { key: 'contact_id',    label: 'Customer',    hint: 'Who the quote is addressed to' },
    { key: 'document_date', label: 'Quote Date',  hint: 'Date the quote is created' },
    { key: 'expiry_date',   label: 'Expiry Date', hint: 'Date the quote expires' },
    { key: 'reference',     label: 'Reference',   hint: 'Internal or customer reference' },
    { key: 'notes',         label: 'Notes',       hint: 'Conditions, payment terms, etc.' },
  ],
  purchase_order: [
    { key: 'contact_id',        label: 'Supplier',           hint: 'Who the PO is sent to' },
    { key: 'document_date',     label: 'Order Date',         hint: 'Date the PO is raised' },
    { key: 'expected_delivery', label: 'Expected Delivery',  hint: 'When goods should arrive' },
    { key: 'reference',         label: 'Supplier Reference', hint: "Supplier's quote or confirmation" },
    { key: 'notes',             label: 'Notes',              hint: 'Special delivery instructions' },
  ],
  service_job: [
    { key: 'contact_id',          label: 'Customer',            hint: 'Machine owner / paying customer' },
    { key: 'machine_serial',      label: 'Machine Serial No.',  hint: 'Serial number of the machine' },
    { key: 'fault_description',   label: 'Fault Description',   hint: 'Customer-reported fault' },
    { key: 'assigned_technician', label: 'Assigned Technician', hint: 'Who is responsible' },
    { key: 'estimated_hours',     label: 'Estimated Hours',     hint: 'Expected labour time' },
    { key: 'promised_date',       label: 'Promised Date',       hint: 'When the job should be completed' },
  ],
};

const NEEDS_MIN = new Set(['range','min_length']);
const NEEDS_MAX = new Set(['range','max_length']);
const NEEDS_REGEX = new Set(['regex']);

export default function FieldValidationPage() {
  const { isAdmin } = useAuth();
  const [meta,            setMeta]            = useState({ entities: [], validation_types: [], transforms: [] });
  const [selectedEntity,  setSelectedEntity]  = useState('product');
  const [rules,           setRules]           = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [saving,          setSaving]          = useState(false);
  const [success,         setSuccess]         = useState('');
  const [error,           setError]           = useState('');
  const [showPicker,      setShowPicker]      = useState(false);
  const [pickedField,     setPickedField]     = useState('');

  useEffect(() => {
    API('/meta').then(({ data }) => { if (data) setMeta(data); });
  }, []);

  const loadRules = useCallback(async (entity) => {
    setLoading(true);
    try {
      const { data } = await API(`/${entity}`);
      setRules(data || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRules(selectedEntity); }, [selectedEntity, loadRules]);

  // Build ordered groups: [{ fieldKey, rules: [] }, ...]
  function getGroups() {
    const seen = [];
    const map  = {};
    for (const rule of rules) {
      if (!map[rule.field_key]) {
        map[rule.field_key] = [];
        seen.push(rule.field_key);
      }
      map[rule.field_key].push(rule);
    }
    return seen.map(k => ({ fieldKey: k, rules: map[k] }));
  }

  function updateRule(ruleIdx, changes) {
    setRules(prev => prev.map((r, i) => i === ruleIdx ? { ...r, ...changes } : r));
  }

  function removeRule(ruleIdx) {
    setRules(prev => prev.filter((_, i) => i !== ruleIdx));
  }

  function removeField(fieldKey) {
    if (!confirm(`Remove ALL rules for "${fieldKey}"?`)) return;
    setRules(prev => prev.filter(r => r.field_key !== fieldKey));
  }

  function addRuleToField(fieldKey) {
    const fieldDef = (ENTITY_FIELDS[selectedEntity] || []).find(f => f.key === fieldKey);
    const newRule  = {
      field_key: fieldKey, field_label: fieldDef?.label || fieldKey,
      is_required: false, validation_type: 'none',
      validation_min: null, validation_max: null,
      validation_regex: '', validation_msg: '',
      transform: 'none', is_active: true,
    };
    // Insert after last rule for this field
    const copy = [...rules];
    const lastIdx = copy.map((r, i) => r.field_key === fieldKey ? i : -1).filter(i => i >= 0).pop();
    copy.splice(lastIdx + 1, 0, newRule);
    setRules(copy);
  }

  function addFieldRule() {
    if (!pickedField) return;
    const fieldDef = (ENTITY_FIELDS[selectedEntity] || []).find(f => f.key === pickedField);
    setRules(prev => [...prev, {
      field_key: pickedField, field_label: fieldDef?.label || pickedField,
      is_required: false, validation_type: 'none',
      validation_min: null, validation_max: null,
      validation_regex: '', validation_msg: '',
      transform: 'none', is_active: true,
    }]);
    setPickedField(''); setShowPicker(false); setError('');
  }

  async function handleSave() {
    setSaving(true); setError(''); setSuccess('');
    try {
      // Compute rule_order and sort_order before saving
      const fieldOrderCounters = {};
      const fieldFirstSeen     = {};
      let sortIdx = 0;
      const toSave = rules.map(r => {
        if (fieldFirstSeen[r.field_key] === undefined) {
          fieldFirstSeen[r.field_key] = sortIdx++;
          fieldOrderCounters[r.field_key] = 0;
        } else {
          fieldOrderCounters[r.field_key]++;
        }
        return {
          ...r,
          sort_order: fieldFirstSeen[r.field_key],
          rule_order: fieldOrderCounters[r.field_key],
        };
      });

      const res = await API(`/${selectedEntity}`, {
        method: 'PUT',
        body: JSON.stringify({ rules: toSave }),
      });
      if (!res.success) throw new Error(res.error);
      invalidateValidationCache(selectedEntity);
      setSuccess('Rules saved.');
      setTimeout(() => setSuccess(''), 4000);
      loadRules(selectedEntity);
    } catch (err) {
      setError(err.message || 'Save failed.');
    } finally { setSaving(false); }
  }

  if (!isAdmin) return <div className={styles.page}><div className={styles.stateBlock}>Access denied.</div></div>;

  const groups          = getGroups();
  const configuredKeys  = [...new Set(rules.map(r => r.field_key))];
  const availableFields = (ENTITY_FIELDS[selectedEntity] || []).filter(f => !configuredKeys.includes(f.key));
  const currentEntity   = meta.entities.find(e => e.key === selectedEntity);
  const totalRules      = rules.filter(r => r.is_active).length;
  const totalRequired   = groups.filter(g => g.rules[0]?.is_required).length;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Field Validation Rules</h1>
          <p className={styles.sub}>Mandatory fields, validation rules and auto-transforms. Each field can have multiple validation rules — all must pass.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={() => setShowPicker(v => !v)}><PlusIcon /> Add Field</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <><span className="spinner" /> Saving...</> : 'Save rules'}
          </button>
        </div>
      </div>

      {error   && <div className={styles.errorBox}><AlertIcon /> {error}</div>}
      {success && <div className={styles.successBox}>{success}</div>}

      <div className={styles.body}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          <div className={styles.sideTitle}>Object type</div>
          {meta.entities.map(e => (
            <button key={e.key}
              className={[styles.sideItem, selectedEntity === e.key ? styles.sideActive : ''].join(' ')}
              onClick={() => { setSelectedEntity(e.key); setShowPicker(false); setPickedField(''); }}>
              <EntityIcon type={e.key} /><span>{e.label}</span>
            </button>
          ))}
        </aside>

        {/* Content */}
        <div className={styles.content}>
          <div className={styles.contentHeader}>
            <div className={styles.contentTitle}>{currentEntity?.label || selectedEntity} Fields</div>
            <div className={styles.contentSub}>
              {groups.length} field{groups.length !== 1 ? 's' : ''} configured
              {' · '}{totalRules} active rule{totalRules !== 1 ? 's' : ''}
              {' · '}{totalRequired} required
            </div>
          </div>

          {/* Field picker */}
          {showPicker && (
            <div className={styles.fieldPickerBar}>
              <select className="form-input" style={{ flex: 1 }} value={pickedField} onChange={e => setPickedField(e.target.value)}>
                <option value="">Select a field...</option>
                {availableFields.map(f => <option key={f.key} value={f.key}>{f.label} — {f.hint}</option>)}
                {availableFields.length === 0 && <option disabled>All fields configured</option>}
                <option value="__custom__">Custom field key...</option>
              </select>
              {pickedField === '__custom__' && (
                <input className="form-input" style={{ flex: 1 }} placeholder="field_key"
                  onChange={e => setPickedField(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,''))} />
              )}
              <button className="btn btn-primary btn-sm" disabled={!pickedField || pickedField === '__custom__'} onClick={addFieldRule}>Add</button>
              <button className="btn btn-outline btn-sm" onClick={() => { setShowPicker(false); setPickedField(''); }}>Cancel</button>
            </div>
          )}

          {loading ? (
            <div className={styles.stateBlock}><div className="spinner-dark" /> Loading...</div>
          ) : groups.length === 0 ? (
            <div className={styles.stateBlock}>
              <ShieldIcon />
              <p>No rules configured. Click "Add Field" to start.</p>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.colField}>Field</th>
                    <th className={styles.colReq}>Required</th>
                    <th className={styles.colValidation}>Validation</th>
                    <th className={styles.colMinMax}>Min</th>
                    <th className={styles.colMinMax}>Max</th>
                    <th className={styles.colTransform}>Transform</th>
                    <th className={styles.colActive}>Active</th>
                    <th className={styles.colActions}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group, gi) => {
                    const fieldDef = (ENTITY_FIELDS[selectedEntity] || []).find(f => f.key === group.fieldKey);
                    return group.rules.map((rule, ri) => {
                      const ruleIdx = rules.indexOf(rule);
                      const isFirst = ri === 0;
                      const isOnly  = group.rules.length === 1;
                      const needsMin = NEEDS_MIN.has(rule.validation_type);
                      const needsMax = NEEDS_MAX.has(rule.validation_type);
                      const needsRegex = NEEDS_REGEX.has(rule.validation_type);

                      return (
                        <tr key={`${group.fieldKey}-${ri}`}
                          className={[
                            styles.ruleRow,
                            isFirst && gi > 0 ? styles.groupBorderTop : '',
                            !isFirst ? styles.extraRule : '',
                            !rule.is_active ? styles.inactiveRow : '',
                          ].join(' ')}>

                          {/* Field cell */}
                          <td className={styles.fieldCell}>
                            {isFirst ? (
                              <div>
                                <div className={styles.fieldName}>{group.rules[0].field_label}</div>
                                <div className={styles.fieldKey}>{group.fieldKey}</div>
                                {fieldDef?.hint && <div className={styles.fieldHint}>{fieldDef.hint}</div>}
                              </div>
                            ) : (
                              <div className={styles.andAlso}>
                                <span className={styles.andAlsoBadge}>AND</span>
                              </div>
                            )}
                          </td>

                          {/* Required — first rule only */}
                          <td className={styles.centerCell}>
                            {isFirst ? (
                              <button
                                className={[styles.toggleBtn, rule.is_required ? styles.toggleOn : ''].join(' ')}
                                onClick={() => updateRule(ruleIdx, { is_required: !rule.is_required })}>
                                {rule.is_required ? 'Yes' : 'No'}
                              </button>
                            ) : <span className={styles.naCell}>—</span>}
                          </td>

                          {/* Validation */}
                          <td>
                            <select className={styles.inlineSelect} value={rule.validation_type || 'none'}
                              onChange={e => updateRule(ruleIdx, { validation_type: e.target.value, validation_min: null, validation_max: null, validation_regex: '' })}>
                              {meta.validation_types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                            {needsRegex && (
                              <input className={styles.inlineInput} style={{ marginTop: 4 }}
                                value={rule.validation_regex || ''}
                                onChange={e => updateRule(ruleIdx, { validation_regex: e.target.value })}
                                placeholder="e.g. ^\d{10,13}$" />
                            )}
                          </td>

                          {/* Min */}
                          <td>
                            {NEEDS_MIN.has(rule.validation_type)
                              ? <input className={styles.inlineInput} type="number" step="any"
                                  placeholder={rule.validation_type === 'min_length' ? 'Min chars' : 'Min'}
                                  value={rule.validation_min ?? ''}
                                  onChange={e => updateRule(ruleIdx, { validation_min: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                              : <span className={styles.naCell}>—</span>}
                          </td>

                          {/* Max */}
                          <td>
                            {NEEDS_MAX.has(rule.validation_type)
                              ? <input className={styles.inlineInput} type="number" step="any"
                                  placeholder={rule.validation_type === 'max_length' ? 'Max chars' : 'Max'}
                                  value={rule.validation_max ?? ''}
                                  onChange={e => updateRule(ruleIdx, { validation_max: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                              : <span className={styles.naCell}>—</span>}
                          </td>

                          {/* Transform — first rule only */}
                          <td>
                            {isFirst ? (
                              <select className={styles.inlineSelect} value={rule.transform || 'none'}
                                onChange={e => updateRule(ruleIdx, { transform: e.target.value })}>
                                {meta.transforms.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                              </select>
                            ) : <span className={styles.naCell}>—</span>}
                          </td>

                          {/* Active */}
                          <td className={styles.centerCell}>
                            <button
                              className={[styles.toggleBtn, rule.is_active ? styles.toggleOn : styles.toggleOff].join(' ')}
                              onClick={() => updateRule(ruleIdx, { is_active: !rule.is_active })}>
                              {rule.is_active ? 'On' : 'Off'}
                            </button>
                          </td>

                          {/* Actions */}
                          <td className={styles.actionsCell}>
                            <input className={styles.msgInput}
                              value={rule.validation_msg || ''}
                              onChange={e => updateRule(ruleIdx, { validation_msg: e.target.value })}
                              placeholder="Custom error message..." />
                            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                              {isFirst && (
                                <button className={styles.iconBtn} title="Add another validation rule for this field"
                                  onClick={() => addRuleToField(group.fieldKey)}>
                                  <PlusIcon />
                                </button>
                              )}
                              {!isOnly && (
                                <button className={[styles.iconBtn, styles.iconBtnDanger].join(' ')}
                                  title="Remove this rule" onClick={() => removeRule(ruleIdx)}>
                                  <TrashIcon />
                                </button>
                              )}
                              {isOnly && (
                                <button className={[styles.iconBtn, styles.iconBtnDanger].join(' ')}
                                  title="Remove field entirely" onClick={() => removeField(group.fieldKey)}>
                                  <TrashIcon />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EntityIcon({ type }) {
  const m = { product: <BoxIcon />, contact: <UsersIcon />, invoice: <FileIcon />, quote: <DocIcon />, purchase_order: <CartIcon />, service_job: <WrenchIcon /> };
  return m[type] || <FileIcon />;
}
function ic(p) { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p}</svg>; }
function PlusIcon()   { return ic(<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>); }
function AlertIcon()  { return ic(<><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>); }
function TrashIcon()  { return ic(<><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></>); }
function ShieldIcon() { return ic(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>); }
function BoxIcon()    { return ic(<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>); }
function UsersIcon()  { return ic(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>); }
function FileIcon()   { return ic(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>); }
function DocIcon()    { return ic(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><line x1="16" y1="13" x2="8" y2="13"/></>); }
function CartIcon()   { return ic(<><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></>); }
function WrenchIcon() { return ic(<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>); }
