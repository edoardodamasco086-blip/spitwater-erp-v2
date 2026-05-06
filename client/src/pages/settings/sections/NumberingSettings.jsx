import React, { useEffect, useState, useCallback } from 'react';
import styles from './Section.module.css';

const API = (path, opts = {}) =>
  fetch(`/api/numbering${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
    ...opts,
  }).then(r => r.json());

const SERIES_TYPES = [
  { type: 'invoice',        label: 'Sales Invoice'    },
  { type: 'quote',          label: 'Quote'            },
  { type: 'credit_note',    label: 'Credit Note'      },
  { type: 'purchase_order', label: 'Purchase Order'   },
  { type: 'goods_receipt',  label: 'Goods Receipt'    },
  { type: 'service_job',    label: 'Service Job'      },
  { type: 'delivery',       label: 'Delivery Docket'  },
  { type: 'journal',        label: 'Journal Entry'    },
  { type: 'product',        label: 'Product Code'     },
  { type: 'warranty',       label: 'Warranty'         },
  { type: 'stocktake',      label: 'Stocktake'        },
];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const RESET_OPTIONS = [
  { v: 'none',    l: 'Never reset'         },
  { v: 'yearly',  l: 'Every financial year' },
  { v: 'monthly', l: 'Every month'          },
];

function buildPreview(form) {
  const sep     = form.separator || '-';
  const padding = parseInt(form.padding) || 5;
  const seq     = String(form.next_number || 1).padStart(padding, '0');
  const fyStart = parseInt(form.fy_start_month) || 7;

  // Compute financial year label
  const now   = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();
  const fyLabel = month >= fyStart ? String(year + 1) : String(year);
  const monthLabel = String(now.getMonth() + 1).padStart(2, '0');

  const parts = [];
  if (form.prefix)        parts.push(form.prefix);
  if (form.include_year)  parts.push(fyLabel);
  if (form.include_month) parts.push(monthLabel);
  parts.push(seq);

  return parts.join(sep) + (form.suffix || '');
}

const EMPTY_FORM = {
  name: '', code: '', series_type: 'invoice', prefix: '', suffix: '',
  separator: '-', include_year: true, include_month: false,
  padding: 5, next_number: 1, reset_frequency: 'yearly',
  fy_start_month: 7, is_default: true, allow_manual: false,
};

export default function NumberingSettings() {
  const [series,   setSeries]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [seeding,  setSeeding]  = useState(false);
  const [editing,  setEditing]  = useState(null); // null | 'new' | id
  const [form,     setForm]     = useState(EMPTY_FORM);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API('/');
      if (res.success) setSeries(res.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function set(field, value) {
    setForm(f => {
      const next = { ...f, [field]: value };
      // Auto-fill prefix from type suggestion
      if (field === 'series_type') {
        const t = SERIES_TYPES.find(t => t.type === value);
        if (t && !f.prefix) {
          const prefix = value === 'invoice' ? 'SLS' : value === 'purchase_order' ? 'PO' :
                         value === 'service_job' ? 'SRV' : value.slice(0, 3).toUpperCase();
          next.prefix = prefix;
          next.name   = t.label;
          next.code   = prefix;
        }
      }
      return next;
    });
    setError('');
  }

  function startEdit(s) {
    setForm({
      name: s.name, code: s.code, series_type: s.series_type,
      prefix: s.prefix || '', suffix: s.suffix || '',
      separator: s.separator || '-',
      include_year: !!s.include_year, include_month: !!s.include_month,
      padding: s.padding || 5, next_number: s.next_number || 1,
      reset_frequency: s.reset_frequency || 'yearly',
      fy_start_month: s.fy_start_month || 7,
      is_default: !!s.is_default, allow_manual: !!s.allow_manual,
    });
    setEditing(s.id);
    setError('');
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        padding:       parseInt(form.padding)       || 5,
        next_number:   parseInt(form.next_number)   || 1,
        fy_start_month: parseInt(form.fy_start_month) || 7,
      };
      const res = editing === 'new'
        ? await API('/', { method: 'POST', body: JSON.stringify(payload) })
        : await API(`/${editing}`, { method: 'PATCH', body: JSON.stringify(payload) });

      if (!res.success) { setError(res.error || 'Save failed.'); return; }
      setSuccess(editing === 'new' ? 'Series created.' : 'Series updated.');
      setEditing(null);
      setTimeout(() => setSuccess(''), 3000);
      load();
    } finally { setSaving(false); }
  }

  async function handleSeedDefaults() {
    if (!confirm('Create the standard Australian numbering series for all document types?\n\nAny types that already have a series will be skipped.')) return;
    setSeeding(true);
    try {
      const res = await API('/seed-defaults', { method: 'POST', body: JSON.stringify({ fy_start_month: 7 }) });
      if (res.success) {
        setSuccess(`Created: ${res.data.created.join(', ')}${res.data.skipped.length ? `. Skipped (already exist): ${res.data.skipped.join(', ')}` : ''}`);
        setTimeout(() => setSuccess(''), 8000);
        load();
      } else {
        setError(res.error || 'Seed failed.');
      }
    } finally { setSeeding(false); }
  }

  async function handleDeactivate(id, name) {
    if (!confirm(`Deactivate series "${name}"?`)) return;
    const res = await API(`/${id}`, { method: 'DELETE' });
    if (res.success) { load(); }
    else alert(res.error || 'Cannot deactivate.');
  }

  // Group series by type
  const grouped = SERIES_TYPES.map(t => ({
    ...t,
    items: series.filter(s => s.series_type === t.type),
  })).filter(g => g.items.length > 0);

  const unconfiguredTypes = SERIES_TYPES.filter(t => !series.find(s => s.series_type === t.type));

  if (loading) return <div className={styles.loading}><div className="spinner-dark" /> Loading...</div>;

  return (
    <div>
      {error   && <div className={styles.errorBox}>{error}</div>}
      {success && <div className={styles.successBox}>{success}</div>}

      {/* Info */}
      <div className={styles.infoBox}>
        <strong>Financial year reset:</strong> Series with yearly reset will automatically restart at 1 on July 1 each year (or your configured FY start month in Organisation settings). The year shown in numbers reflects the end year of the financial year (e.g. July 2025 = FY2026).
      </div>

      {/* Seed defaults button */}
      {series.length === 0 && (
        <div className={styles.empty}>
          <p>No numbering series configured yet.</p>
          <button className="btn btn-primary" onClick={handleSeedDefaults} disabled={seeding}>
            {seeding ? 'Creating...' : 'Create standard Australian series'}
          </button>
        </div>
      )}

      {series.length > 0 && (
        <>
          {/* Unconfigured types banner */}
          {unconfiguredTypes.length > 0 && (
            <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--orange-dim)', border: '1px solid rgba(232,155,47,0.25)', borderRadius: 8, fontSize: 13, color: '#B87A1A' }}>
              <strong>Missing series:</strong> {unconfiguredTypes.map(t => t.label).join(', ')} — documents of these types cannot be created until a series is configured.
            </div>
          )}

          {/* Series list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {grouped.map(group => (
              <div key={group.type}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-sub)', fontWeight: 600, marginBottom: 6 }}>
                  {group.label}
                </div>
                {group.items.map(s => (
                  <div key={s.id}>
                    <div className={[styles.itemCard, s.is_default ? styles.defaultCard : '', !s.is_active ? styles.inactiveCard : ''].filter(Boolean).join(' ')}>
                      <div className={styles.itemLeft}>
                        <div className={styles.itemTitle}>
                          <span style={{ fontFamily: 'DM Mono', fontSize: 12.5, background: 'var(--accent-dim)', color: 'var(--accent)', padding: '1px 8px', borderRadius: 4 }}>
                            {s.code}
                          </span>
                          {s.name}
                          {s.is_default && <span className="pill pill-blue">Default</span>}
                          {!s.is_active  && <span className="pill pill-grey">Inactive</span>}
                        </div>
                        <div className={styles.itemMeta}>
                          {s.reset_frequency === 'yearly' ? 'Resets annually (FY)' : s.reset_frequency === 'monthly' ? 'Resets monthly' : 'Never resets'}
                          {' · '}
                          {s.allow_manual ? 'Manual override allowed' : 'Auto only'}
                          {s.next_number > 1 && ` · ${s.next_number - 1} issued so far`}
                        </div>
                        {/* Live preview */}
                        <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <div style={{ fontFamily: 'DM Mono', fontSize: 22, fontWeight: 700, color: 'var(--accent)', letterSpacing: -0.5 }}>
                            {s.preview}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-sub)' }}>next number</div>
                        </div>
                      </div>
                      <div className={styles.itemActions}>
                        <button className="btn btn-outline btn-sm" onClick={() => editing === s.id ? setEditing(null) : startEdit(s)}>
                          {editing === s.id ? 'Cancel' : 'Edit'}
                        </button>
                        {!s.is_default && s.is_active && (
                          <button className="btn btn-danger btn-sm" onClick={() => handleDeactivate(s.id, s.name)}>
                            Deactivate
                          </button>
                        )}
                      </div>
                    </div>

                    {editing === s.id && (
                      <SeriesForm
                        form={form} set={set} error={error} saving={saving}
                        onSave={handleSave} onCancel={() => setEditing(null)} isNew={false}
                      />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Add new series */}
          <div style={{ marginTop: 16 }}>
            {editing === 'new' ? (
              <SeriesForm
                form={form} set={set} error={error} saving={saving}
                onSave={handleSave} onCancel={() => setEditing(null)} isNew={true}
              />
            ) : (
              <div style={{ display: 'flex', gap: 10 }}>
                <button className={styles.addBtn} onClick={() => { setForm(EMPTY_FORM); setEditing('new'); setError(''); }}>
                  <PlusIcon /> Add numbering series
                </button>
                {unconfiguredTypes.length > 0 && (
                  <button className="btn btn-outline btn-sm" onClick={handleSeedDefaults} disabled={seeding}>
                    {seeding ? 'Creating...' : 'Seed missing defaults'}
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SeriesForm({ form, set, saving, onSave, onCancel, isNew }) {
  const preview = buildPreview(form);

  return (
    <form className={styles.editForm} onSubmit={onSave}>
      <div className={styles.editFormRow}>
        <div className="form-group" style={{ flex: 2 }}>
          <label className="form-label">Series name *</label>
          <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Sales Invoice" required />
        </div>
        {isNew && (
          <div className="form-group" style={{ flex: 2 }}>
            <label className="form-label">Document type *</label>
            <select className="form-input" value={form.series_type} onChange={e => set('series_type', e.target.value)}>
              {SERIES_TYPES.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
            </select>
          </div>
        )}
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Code *</label>
          <input className="form-input" value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} placeholder="SLS" maxLength={20} required />
        </div>
      </div>

      <div className={styles.editFormRow}>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Prefix</label>
          <input className="form-input" value={form.prefix} onChange={e => set('prefix', e.target.value)} placeholder="SLS" />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Separator</label>
          <input className="form-input" value={form.separator} onChange={e => set('separator', e.target.value)} maxLength={5} placeholder="-" />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Suffix</label>
          <input className="form-input" value={form.suffix} onChange={e => set('suffix', e.target.value)} placeholder="(optional)" />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Padding digits</label>
          <input className="form-input" type="number" min={1} max={10} value={form.padding} onChange={e => set('padding', e.target.value)} />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Next number</label>
          <input className="form-input" type="number" min={1} value={form.next_number} onChange={e => set('next_number', e.target.value)} />
        </div>
      </div>

      <div className={styles.editFormRow}>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Reset frequency</label>
          <select className="form-input" value={form.reset_frequency} onChange={e => set('reset_frequency', e.target.value)}>
            {RESET_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </div>
        {form.reset_frequency !== 'none' && (
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Financial year starts</label>
            <select className="form-input" value={form.fy_start_month} onChange={e => set('fy_start_month', parseInt(e.target.value))}>
              {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className={styles.editFormRow} style={{ gap: 24, flexWrap: 'wrap' }}>
        {[
          ['include_year',  'Include financial year'],
          ['include_month', 'Include month'],
          ['is_default',    'Set as default for this type'],
          ['allow_manual',  'Allow manual number entry'],
        ].map(([field, label]) => (
          <label key={field} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form[field]} onChange={e => set(field, e.target.checked)} style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />
            {label}
          </label>
        ))}
      </div>

      {/* Live preview */}
      <div style={{ padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8 }}>
        <div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Preview</div>
        <div style={{ fontFamily: 'DM Mono', fontSize: 26, fontWeight: 700, color: 'var(--accent)', letterSpacing: -0.5 }}>{preview}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-sub)', marginTop: 3 }}>
          This is what the next generated number will look like.
          {form.reset_frequency === 'yearly' && ' Sequence resets to 1 at the start of each financial year.'}
        </div>
      </div>

      <div className={styles.editFormActions}>
        <button type="button" className="btn btn-outline btn-sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !form.name || !form.code}>
          {saving ? 'Saving...' : isNew ? 'Create series' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  );
}
