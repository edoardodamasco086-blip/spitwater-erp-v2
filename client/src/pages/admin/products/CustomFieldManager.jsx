import React, { useEffect, useState, useCallback } from 'react';
import client from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import styles from './AdminProducts.module.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const ENTITIES = [
  { key: 'product',     label: 'Products',      icon: BoxIcon,     scopeLabel: 'Category' },
  { key: 'contact',     label: 'Contacts',      icon: ContactIcon, scopeLabel: 'Contact Type' },
  { key: 'invoice',     label: 'Invoices',      icon: DocIcon,     scopeLabel: null },
  { key: 'sales_order', label: 'Sales Orders',  icon: CartIcon,    scopeLabel: null },
  { key: 'warehouse',   label: 'Warehouses',    icon: WareIcon,    scopeLabel: null },
];

const CONTACT_SCOPES = [
  { key: 'customer', label: 'Customer' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'both',     label: 'Both (Customer & Supplier)' },
];

const FIELD_TYPES = [
  { value: 'text',         label: 'Text',        desc: 'Single line text' },
  { value: 'textarea',     label: 'Textarea',    desc: 'Multi-line text' },
  { value: 'number',       label: 'Number',      desc: 'Decimal or integer' },
  { value: 'boolean',      label: 'Yes / No',    desc: 'Checkbox toggle' },
  { value: 'date',         label: 'Date',        desc: 'Date picker' },
  { value: 'select',       label: 'Dropdown',    desc: 'Single selection' },
  { value: 'multi_select', label: 'Multi-select',desc: 'Multiple selections' },
];

const TYPE_COLOR = {
  text: 'blue', textarea: 'blue', number: 'green',
  boolean: 'orange', date: 'purple', select: 'orange', multi_select: 'orange',
};

const EMPTY_FORM = {
  field_key: '', field_label: '', field_type: 'text',
  placeholder: '', help_text: '', is_required: false,
  is_shown_in_list: false, is_shown_on_pdf: false,
  sort_order: 0, validation_min: '', validation_max: '',
  section_key: '', default_value: '', options: [],
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function CustomFieldManager() {
  const { isAdmin } = useAuth();

  const [entityKey,   setEntityKey]   = useState('product');
  const [scopeKey,    setScopeKey]    = useState('');      // '' = All
  const [categories,  setCategories]  = useState([]);
  const [fields,      setFields]      = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [editing,     setEditing]     = useState(null);   // null | 'new' | id
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [success,     setSuccess]     = useState('');
  const [newOption,   setNewOption]   = useState({ key: '', label: '', color: '' });

  // Load product categories for scope dropdown
  useEffect(() => {
    client.get('/products/categories').then(r => setCategories(r.data.data || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setEditing(null);
    try {
      const params = { entity_key: entityKey };
      // No scope_key filter in admin list — show all fields for this entity
      const r = await client.get('/custom-fields', { params });
      setFields(r.data.data || []);
    } catch { setFields([]); }
    finally { setLoading(false); }
  }, [entityKey]);

  useEffect(() => { load(); }, [load]);

  if (!isAdmin) return (
    <div className={styles.page}>
      <div className={styles.stateBlock}>You don't have permission to manage custom fields.</div>
    </div>
  );

  // ── Form helpers ───────────────────────────────────────────────
  function set(field, value) {
    setForm(f => {
      const next = { ...f, [field]: value };
      if (field === 'field_label' && (editing === 'new' || !f.field_key)) {
        next.field_key = value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      }
      return next;
    });
    setError('');
  }

  function startNew() {
    setForm({ ...EMPTY_FORM, sort_order: fields.length });
    setEditing('new');
    setError('');
  }

  function startEdit(f) {
    setForm({
      field_key:        f.field_key        || '',
      field_label:      f.field_label      || '',
      field_type:       f.field_type       || 'text',
      placeholder:      f.placeholder      || '',
      help_text:        f.help_text        || '',
      is_required:      !!f.is_required,
      is_shown_in_list: !!f.is_shown_in_list,
      is_shown_on_pdf:  !!f.is_shown_on_pdf,
      sort_order:       f.sort_order       || 0,
      validation_min:   f.validation_min   ?? '',
      validation_max:   f.validation_max   ?? '',
      section_key:      f.section_key      || '',
      default_value:    f.default_value    || '',
      options:          f.options?.map(o => ({ key: o.option_key, label: o.option_label, color: o.option_color || '' })) || [],
      _scopeKey:        f.scope_key        || '',
    });
    setEditing(f.id);
    setError('');
  }

  function addOption() {
    if (!newOption.label.trim()) return;
    const key = newOption.key.trim() || newOption.label.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
    setForm(f => ({ ...f, options: [...f.options, { key, label: newOption.label.trim(), color: newOption.color }] }));
    setNewOption({ key: '', label: '', color: '' });
  }

  function removeOption(i) {
    setForm(f => ({ ...f, options: f.options.filter((_, idx) => idx !== i) }));
  }

  // Resolve the scope_key to save for this field
  function resolvedScopeKey() {
    // If editing, the field's own scope key might differ from the panel filter
    if (editing !== 'new' && form._scopeKey !== undefined) return form._scopeKey || null;
    return scopeKey || null;
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.field_label.trim()) { setError('Field label is required.'); return; }
    if (!form.field_key.trim())   { setError('Field key is required.'); return; }
    if ((form.field_type === 'select' || form.field_type === 'multi_select') && form.options.length === 0) {
      setError('Add at least one option for dropdown fields.'); return;
    }
    setSaving(true); setError('');
    const payload = {
      entity_key:       entityKey,
      scope_key:        resolvedScopeKey(),
      field_key:        form.field_key.trim(),
      field_label:      form.field_label.trim(),
      field_type:       form.field_type,
      placeholder:      form.placeholder.trim()  || null,
      help_text:        form.help_text.trim()     || null,
      is_required:      form.is_required,
      is_shown_in_list: form.is_shown_in_list,
      is_shown_on_pdf:  form.is_shown_on_pdf,
      sort_order:       parseInt(form.sort_order) || 0,
      validation_min:   form.validation_min !== '' ? parseFloat(form.validation_min) : null,
      validation_max:   form.validation_max !== '' ? parseFloat(form.validation_max) : null,
      section_key:      form.section_key.trim()   || null,
      default_value:    form.default_value.trim() || null,
      options:          form.options,
    };
    try {
      if (editing === 'new') {
        await client.post('/custom-fields', payload);
        setSuccess('Field created.');
      } else {
        await client.patch(`/custom-fields/${editing}`, payload);
        setSuccess('Field updated.');
      }
      setEditing(null);
      setTimeout(() => setSuccess(''), 3000);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed.');
    } finally { setSaving(false); }
  }

  async function handleDelete(fieldId, label) {
    if (!confirm(`Delete field "${label}"? Existing values will be retained but the field will no longer appear.`)) return;
    try {
      await client.delete(`/custom-fields/${fieldId}`);
      setSuccess('Field removed.');
      setTimeout(() => setSuccess(''), 3000);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed.');
    }
  }

  const currentEntity  = ENTITIES.find(e => e.key === entityKey);
  const scopeOptions   = entityKey === 'product'  ? buildProductScopes(categories) :
                         entityKey === 'contact'   ? CONTACT_SCOPES : [];
  const hasScopeFilter = scopeOptions.length > 0;

  // Filter display by selected scope tab
  const displayedFields = fields.filter(f => {
    if (!hasScopeFilter || scopeKey === '') return true;
    if (f.scope_key === null || f.scope_key === undefined) return false; // global fields show in "All" only
    return f.scope_key === scopeKey;
  });

  // Group by scope_key for "All" view
  const needsOptions = form.field_type === 'select' || form.field_type === 'multi_select';
  const needsValidation = form.field_type === 'number';

  return (
    <div className={styles.page}>

      {/* ── Header ── */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Custom Fields</h1>
          <p className={styles.sub}>Define custom fields per object and optionally per category or type. Fields with no category apply to all.</p>
        </div>
        {!editing && (
          <button className="btn btn-primary" onClick={startNew}>
            <PlusIcon /> New Field
          </button>
        )}
      </div>

      {success && <div className={styles.successBox}>{success}</div>}

      {/* ── Entity tabs ── */}
      <div className={styles.entityTabs}>
        {ENTITIES.map(ent => {
          const Icon = ent.icon;
          return (
            <button
              key={ent.key}
              className={[styles.entityTab, entityKey === ent.key ? styles.entityTabActive : ''].join(' ')}
              onClick={() => { setEntityKey(ent.key); setScopeKey(''); setEditing(null); }}
            >
              <span className={styles.entityTabIcon}><Icon /></span>
              {ent.label}
            </button>
          );
        })}
      </div>

      {/* ── Scope filter row (only for Product & Contact) ── */}
      {hasScopeFilter && (
        <div className={styles.scopeRow}>
          <span className={styles.scopeLabel}>{currentEntity.scopeLabel}:</span>
          <button
            className={[styles.scopeChip, scopeKey === '' ? styles.scopeChipActive : ''].join(' ')}
            onClick={() => setScopeKey('')}
          >All</button>
          {scopeOptions.map(s => (
            <button
              key={s.key}
              className={[styles.scopeChip, scopeKey === s.key ? styles.scopeChipActive : ''].join(' ')}
              onClick={() => setScopeKey(s.key)}
            >{s.label}</button>
          ))}
        </div>
      )}

      {/* ── New / Edit form ── */}
      {editing && (
        <div className={styles.formCard}>
          <div className={styles.formCardTitle}>
            {editing === 'new'
              ? `New field for ${currentEntity.label}${resolvedScopeKey() ? ` › ${scopeLabel(scopeKey, scopeOptions)}` : ' (all)'}`
              : `Editing: ${form.field_label}`}
          </div>
          {error && <div className={styles.errorBox}>{error}</div>}

          <form onSubmit={handleSave}>
            {/* Scope assignment for new fields */}
            {editing === 'new' && hasScopeFilter && (
              <div className={styles.formSection}>
                <div className={styles.formSectionTitle}>Scope</div>
                <div className={styles.formRow}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">{currentEntity.scopeLabel} <span style={{ fontWeight: 400, color: 'var(--text-sub)' }}>(leave blank to apply to ALL)</span></label>
                    <select className="form-input" value={scopeKey} onChange={e => setScopeKey(e.target.value)}>
                      <option value="">All {currentEntity.label}</option>
                      {scopeOptions.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Basic definition */}
            <div className={styles.formSection}>
              <div className={styles.formSectionTitle}>Field definition</div>
              <div className={styles.formRow}>
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Display label *</label>
                  <input className="form-input" autoFocus value={form.field_label}
                    onChange={e => set('field_label', e.target.value)} placeholder="e.g. Pressure (Bar)" />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Field key * <span style={{ fontWeight: 400, color: 'var(--text-sub)', textTransform: 'none' }}>(auto)</span></label>
                  <input className="form-input" value={form.field_key} style={{ fontFamily: 'DM Mono' }}
                    onChange={e => set('field_key', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    placeholder="pressure_bar" />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Field type *</label>
                  <select className="form-input" value={form.field_type} onChange={e => set('field_type', e.target.value)}>
                    {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label} — {t.desc}</option>)}
                  </select>
                </div>
              </div>
              <div className={styles.formRow}>
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Placeholder text</label>
                  <input className="form-input" value={form.placeholder}
                    onChange={e => set('placeholder', e.target.value)} placeholder="e.g. Enter value in Bar..." />
                </div>
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Help text</label>
                  <input className="form-input" value={form.help_text}
                    onChange={e => set('help_text', e.target.value)} placeholder="Shown below the field..." />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Section / group</label>
                  <input className="form-input" value={form.section_key} style={{ fontFamily: 'DM Mono' }}
                    onChange={e => set('section_key', e.target.value)} placeholder="specifications" />
                </div>
                <div className="form-group" style={{ flex: 0, minWidth: 80 }}>
                  <label className="form-label">Order</label>
                  <input className="form-input" type="number" value={form.sort_order}
                    onChange={e => set('sort_order', e.target.value)} />
                </div>
              </div>
            </div>

            {/* Options for select types */}
            {needsOptions && (
              <div className={styles.formSection}>
                <div className={styles.formSectionTitle}>Options</div>
                {form.options.length > 0 && (
                  <div className={styles.optionList}>
                    {form.options.map((opt, i) => (
                      <div key={i} className={styles.optionRow}>
                        <div className={styles.optionColor} style={{ background: opt.color || 'var(--border)' }} />
                        <span className={styles.optionLabel}>{opt.label}</span>
                        <span className={styles.optionKey}>{opt.key}</span>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => removeOption(i)}>Remove</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className={styles.addOptionRow}>
                  <input className="form-input" placeholder="Option label" value={newOption.label}
                    onChange={e => setNewOption(o => ({ ...o, label: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addOption())}
                    style={{ flex: 2 }} />
                  <input className="form-input" placeholder="Key (auto)" value={newOption.key}
                    style={{ flex: 1, fontFamily: 'DM Mono' }}
                    onChange={e => setNewOption(o => ({ ...o, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,'') }))} />
                  <input type="color" className={styles.colorInput} value={newOption.color || '#2F7FE8'}
                    onChange={e => setNewOption(o => ({ ...o, color: e.target.value }))} title="Option colour" />
                  <button type="button" className="btn btn-outline btn-sm" onClick={addOption} disabled={!newOption.label.trim()}>
                    Add option
                  </button>
                </div>
              </div>
            )}

            {/* Number validation */}
            {needsValidation && (
              <div className={styles.formSection}>
                <div className={styles.formSectionTitle}>Validation</div>
                <div className={styles.formRow}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Minimum value</label>
                    <input className="form-input" type="number" step="any" value={form.validation_min}
                      onChange={e => set('validation_min', e.target.value)} placeholder="No minimum" />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Maximum value</label>
                    <input className="form-input" type="number" step="any" value={form.validation_max}
                      onChange={e => set('validation_max', e.target.value)} placeholder="No maximum" />
                  </div>
                  <div className="form-group" style={{ flex: 2 }}>
                    <label className="form-label">Default value</label>
                    <input className="form-input" value={form.default_value}
                      onChange={e => set('default_value', e.target.value)} placeholder="Leave blank for no default" />
                  </div>
                </div>
              </div>
            )}

            {/* Display options */}
            <div className={styles.formSection}>
              <div className={styles.formSectionTitle}>Display options</div>
              <div className={styles.checkboxRow}>
                {[
                  ['is_required',      'Required field'],
                  ['is_shown_in_list', 'Show in list view'],
                  ['is_shown_on_pdf',  'Print on documents / PDF'],
                ].map(([field, label]) => (
                  <label key={field} className={styles.checkLabel}>
                    <input type="checkbox" checked={!!form[field]} onChange={e => set(field, e.target.checked)}
                      style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div className={styles.formActions}>
              <button type="button" className="btn btn-outline" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : editing === 'new' ? 'Create field' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Fields table ── */}
      <div className={styles.treeCard}>
        {loading ? (
          <div className={styles.stateBlock}><div className="spinner-dark" /><span>Loading...</span></div>
        ) : displayedFields.length === 0 ? (
          <div className={styles.stateBlock}>
            <FieldsIcon size={32} />
            <p>No fields defined{scopeKey ? ` for this ${currentEntity.scopeLabel?.toLowerCase()}` : ''}.</p>
            <button className="btn btn-primary btn-sm" onClick={startNew}>Create first field</button>
          </div>
        ) : (
          <table className={styles.fieldTable}>
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Key</th>
                <th>Scope</th>
                <th>Options</th>
                <th>Required</th>
                <th>In list</th>
                <th>On PDF</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {displayedFields.map(f => (
                <tr key={f.id}>
                  <td>
                    <div className={styles.fieldName}>{f.field_label}</div>
                    {f.help_text && <div className={styles.fieldHelp}>{f.help_text}</div>}
                  </td>
                  <td>
                    <span className={`pill pill-${TYPE_COLOR[f.field_type] || 'grey'}`}>
                      {FIELD_TYPES.find(t => t.value === f.field_type)?.label || f.field_type}
                    </span>
                  </td>
                  <td><span className={styles.fieldKey}>{f.field_key}</span></td>
                  <td>
                    {f.scope_key
                      ? <span className="pill pill-blue">{scopeLabel(f.scope_key, scopeOptions) || f.scope_key}</span>
                      : <span className="pill pill-grey">All</span>
                    }
                  </td>
                  <td>
                    {f.options?.length > 0
                      ? <span className="pill pill-grey">{f.options.length} options</span>
                      : <span style={{ color: 'var(--text-sub)', fontSize: 12 }}>—</span>}
                  </td>
                  <td className={styles.centerCell}>{f.is_required      ? <CheckIcon /> : <span style={{color:'var(--text-sub)'}}>—</span>}</td>
                  <td className={styles.centerCell}>{f.is_shown_in_list ? <CheckIcon /> : <span style={{color:'var(--text-sub)'}}>—</span>}</td>
                  <td className={styles.centerCell}>{f.is_shown_on_pdf  ? <CheckIcon /> : <span style={{color:'var(--text-sub)'}}>—</span>}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn btn-outline btn-sm" onClick={() => startEdit(f)}>Edit</button>
                      <button className="btn btn-danger btn-sm"  onClick={() => handleDelete(f.id, f.field_label)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildProductScopes(categories) {
  const result = [];
  function walk(cats, prefix) {
    cats.forEach(c => {
      result.push({ key: String(c.id), label: prefix + c.name });
      if (c.children?.length) walk(c.children, prefix + c.name + ' › ');
    });
  }
  walk(categories, '');
  return result;
}

function scopeLabel(key, scopeOptions) {
  return scopeOptions.find(s => s.key === key)?.label || key;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function SvgIcon({ children, size = 15 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}
function PlusIcon()    { return <SvgIcon><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></SvgIcon>; }
function CheckIcon()   { return <SvgIcon size={14}><polyline points="20 6 9 17 4 12"/></SvgIcon>; }
function FieldsIcon({ size = 15 }) { return <SvgIcon size={size}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></SvgIcon>; }
function BoxIcon()     { return <SvgIcon><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></SvgIcon>; }
function ContactIcon() { return <SvgIcon><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></SvgIcon>; }
function DocIcon()     { return <SvgIcon><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></SvgIcon>; }
function CartIcon()    { return <SvgIcon><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></SvgIcon>; }
function WareIcon()    { return <SvgIcon><path d="M1 22h22"/><rect x="3" y="10" width="18" height="12"/><path d="M3 10L12 3l9 7"/></SvgIcon>; }
