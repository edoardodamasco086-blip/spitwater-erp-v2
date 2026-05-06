import React, { useEffect, useState } from 'react';
import { productsApi } from '../../../api/products';
import styles from './AdminProducts.module.css';

const FIELD_TYPES = [
  { value: 'text',         label: 'Text',          desc: 'Single line text input' },
  { value: 'textarea',     label: 'Textarea',       desc: 'Multi-line text' },
  { value: 'number',       label: 'Number',         desc: 'Decimal or integer number' },
  { value: 'boolean',      label: 'Yes / No',       desc: 'Checkbox toggle' },
  { value: 'date',         label: 'Date',           desc: 'Date picker' },
  { value: 'select',       label: 'Dropdown',       desc: 'Single selection from list' },
  { value: 'multi_select', label: 'Multi-select',   desc: 'Multiple selections from list' },
];

const TYPE_COLORS = {
  text: 'blue', textarea: 'blue', number: 'green',
  boolean: 'orange', date: 'purple', select: 'orange', multi_select: 'orange',
};

const EMPTY_FORM = {
  field_key: '', field_label: '', field_type: 'text',
  placeholder: '', help_text: '', is_required: false,
  is_shown_in_list: false, is_shown_on_pdf: false,
  sort_order: 0, validation_min: '', validation_max: '',
  section_key: '', default_value: '',
  options: [], // for select/multi_select
};

export default function CustomFieldManager() {
  const [fields,   setFields]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState(null);
  const [form,     setForm]     = useState(EMPTY_FORM);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');
  const [newOption, setNewOption] = useState({ key: '', label: '', color: '' });

  async function load() {
    setLoading(true);
    try {
      const { data } = await productsApi.customFields();
      setFields(data.data || []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function set(field, value) {
    setForm(f => {
      const next = { ...f, [field]: value };
      // Auto-generate field_key from label
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

  function startEdit(field) {
    setForm({
      field_key:        field.field_key        || '',
      field_label:      field.field_label      || '',
      field_type:       field.field_type       || 'text',
      placeholder:      field.placeholder      || '',
      help_text:        field.help_text        || '',
      is_required:      !!field.is_required,
      is_shown_in_list: !!field.is_shown_in_list,
      is_shown_on_pdf:  !!field.is_shown_on_pdf,
      sort_order:       field.sort_order       || 0,
      validation_min:   field.validation_min   ?? '',
      validation_max:   field.validation_max   ?? '',
      section_key:      field.section_key      || '',
      default_value:    field.default_value    || '',
      options:          field.options?.map(o => ({ key: o.option_key, label: o.option_label, color: o.option_color || '' })) || [],
    });
    setEditing(field.id);
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

  async function handleSave(e) {
    e.preventDefault();
    if (!form.field_label.trim()) { setError('Field label is required.'); return; }
    if (!form.field_key.trim())   { setError('Field key is required.'); return; }
    if ((form.field_type === 'select' || form.field_type === 'multi_select') && form.options.length === 0) {
      setError('Add at least one option for dropdown fields.'); return;
    }
    setSaving(true); setError('');
    try {
      const payload = {
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
        section_key:      form.section_key.trim() || null,
        default_value:    form.default_value.trim() || null,
        options:          form.options,
      };
      await productsApi.createCustomField(payload);
      setSuccess('Custom field created.');
      setEditing(null);
      setTimeout(() => setSuccess(''), 3000);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed.');
    } finally { setSaving(false); }
  }

  const needsOptions = form.field_type === 'select' || form.field_type === 'multi_select';
  const needsValidation = form.field_type === 'number';

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Custom Fields</h1>
          <p className={styles.sub}>Define custom fields that appear on every product. These can capture specs, attributes, and any product-specific data.</p>
        </div>
        {editing !== 'new' && (
          <button className="btn btn-primary" onClick={startNew}>
            <PlusIcon /> New Field
          </button>
        )}
      </div>

      {success && <div className={styles.successBox}>{success}</div>}

      {/* New / Edit form */}
      {editing && (
        <div className={styles.formCard}>
          <div className={styles.formCardTitle}>
            {editing === 'new' ? 'New Custom Field' : `Editing: ${form.field_label}`}
          </div>
          {error && <div className={styles.errorBox}>{error}</div>}

          <form onSubmit={handleSave}>
            {/* Basic */}
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
                    onChange={e => set('placeholder', e.target.value)} placeholder="e.g. Enter pressure in Bar..." />
                </div>
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Help text</label>
                  <input className="form-input" value={form.help_text}
                    onChange={e => set('help_text', e.target.value)} placeholder="Shown below the field to guide users..." />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Section / group</label>
                  <input className="form-input" value={form.section_key} style={{ fontFamily: 'DM Mono' }}
                    onChange={e => set('section_key', e.target.value)} placeholder="specifications" />
                </div>
                <div className="form-group" style={{ flex: 0, minWidth: 80 }}>
                  <label className="form-label">Sort order</label>
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
                  <input className="form-input" placeholder="Key (auto)" value={newOption.key} style={{ flex: 1, fontFamily: 'DM Mono' }}
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

            {/* Visibility options */}
            <div className={styles.formSection}>
              <div className={styles.formSectionTitle}>Display options</div>
              <div className={styles.checkboxRow}>
                {[
                  ['is_required',      'Required field'],
                  ['is_shown_in_list', 'Show in product list'],
                  ['is_shown_on_pdf',  'Print on documents / PDF'],
                ].map(([field, label]) => (
                  <label key={field} className={styles.checkLabel}>
                    <input type="checkbox" checked={!!form[field]} onChange={e => set(field, e.target.checked)} style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />
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

      {/* Fields list */}
      <div className={styles.treeCard}>
        {loading ? (
          <div className={styles.stateBlock}><div className="spinner-dark" /><span>Loading...</span></div>
        ) : fields.length === 0 ? (
          <div className={styles.stateBlock}>
            <FieldsIcon size={32} />
            <p>No custom fields defined yet.</p>
            <p style={{ fontSize: 12, maxWidth: 400, textAlign: 'center' }}>
              Custom fields let you capture product-specific data like pressure ratings, flow rates, power source, country of origin, etc.
            </p>
            <button className="btn btn-primary btn-sm" onClick={startNew}>Create first field</button>
          </div>
        ) : (
          <table className={styles.fieldTable}>
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Key</th>
                <th>Options</th>
                <th>Required</th>
                <th>In list</th>
                <th>On PDF</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fields.map(f => (
                <tr key={f.id}>
                  <td>
                    <div className={styles.fieldName}>{f.field_label}</div>
                    {f.help_text && <div className={styles.fieldHelp}>{f.help_text}</div>}
                  </td>
                  <td>
                    <span className={`pill pill-${TYPE_COLORS[f.field_type] || 'grey'}`}>
                      {FIELD_TYPES.find(t => t.value === f.field_type)?.label || f.field_type}
                    </span>
                  </td>
                  <td><span className={styles.fieldKey}>{f.field_key}</span></td>
                  <td>
                    {f.options?.length > 0
                      ? <span className="pill pill-grey">{f.options.length} options</span>
                      : <span style={{ color: 'var(--text-sub)', fontSize: 12 }}>—</span>}
                  </td>
                  <td className={styles.centerCell}>{f.is_required      ? <CheckIcon /> : <span style={{color:'var(--text-sub)'}}>—</span>}</td>
                  <td className={styles.centerCell}>{f.is_shown_in_list ? <CheckIcon /> : <span style={{color:'var(--text-sub)'}}>—</span>}</td>
                  <td className={styles.centerCell}>{f.is_shown_on_pdf  ? <CheckIcon /> : <span style={{color:'var(--text-sub)'}}>—</span>}</td>
                  <td>
                    <button className="btn btn-outline btn-sm" onClick={() => startEdit(f)}>Edit</button>
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

function SvgIcon({ children, size = 15 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}
function PlusIcon()   { return <SvgIcon><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></SvgIcon>; }
function CheckIcon()  { return <SvgIcon size={14}><polyline points="20 6 9 17 4 12"/></SvgIcon>; }
function FieldsIcon({ size = 15 }) { return <SvgIcon size={size}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></SvgIcon>; }
