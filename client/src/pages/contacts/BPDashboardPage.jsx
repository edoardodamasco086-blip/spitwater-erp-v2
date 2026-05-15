import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { bpApi } from '../../api/businessPartners';
import { getAccessToken } from '../../api/client';

// ── Auth fetch helper (matches SourcingTab pattern) ───────────────────────────
const authH = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${getAccessToken()}`,
});

async function apiFetch(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { ...authH(), ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.message || `HTTP ${res.status}`);
  return body;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatABN(abn) {
  if (!abn) return null;
  const d = String(abn).replace(/\D/g, '');
  if (d.length !== 11) return abn;
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
}

function formatBSB(bsb) {
  if (!bsb) return '—';
  const d = String(bsb).replace(/\D/g, '');
  return d.length >= 6 ? `${d.slice(0, 3)}-${d.slice(3, 6)}` : bsb;
}

function formatDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatCurrency(val) {
  if (val === null || val === undefined) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(parseFloat(val));
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

const AVATAR_COLORS = ['#2F7FE8', '#2ECC8A', '#E89B2F', '#9366E8', '#E05252', '#3BBCD4', '#E84F8C'];
function avatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const CREDIT_TERMS = ['NET7', 'NET14', 'NET30', 'NET45', 'NET60', 'NET90', 'COD', 'PREPAID'];
const INDUSTRIES = [
  'Agriculture', 'Construction', 'Education', 'Finance', 'Healthcare',
  'Hospitality', 'IT & Technology', 'Legal', 'Manufacturing', 'Mining',
  'Retail', 'Transport & Logistics', 'Utilities', 'Wholesale', 'Other',
];
const ADDRESS_ROLES = [
  { value: 'sold_to',  label: 'Sold To',   color: '#2F7FE8' },
  { value: 'ship_to',  label: 'Ship To',   color: '#2ECC8A' },
  { value: 'bill_to',  label: 'Bill To',   color: '#E89B2F' },
  { value: 'payer',    label: 'Payer',     color: '#9366E8' },
  { value: 'remit_to', label: 'Remit To',  color: '#3BBCD4' },
];
const AU_STATES = ['QLD', 'NSW', 'VIC', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

// ── Icons ─────────────────────────────────────────────────────────────────────

function SvgIcon({ children, size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
function ArrowLeftIcon()  { return <SvgIcon size={14}><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></SvgIcon>; }
function EditIcon()       { return <SvgIcon size={13}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></SvgIcon>; }
function SparkleIcon()    { return <SvgIcon size={14}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></SvgIcon>; }
function PlusIcon()       { return <SvgIcon size={13}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></SvgIcon>; }
function TrashIcon()      { return <SvgIcon size={13}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></SvgIcon>; }
function StarIcon()       { return <SvgIcon size={13}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></SvgIcon>; }
function LinkIcon()       { return <SvgIcon size={12}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></SvgIcon>; }
function CheckIcon()      { return <SvgIcon size={13}><polyline points="20 6 9 17 4 12"/></SvgIcon>; }
function CloseIcon()      { return <SvgIcon size={13}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></SvgIcon>; }
function BuildingIcon()   { return <SvgIcon size={14}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></SvgIcon>; }
function PersonIcon()     { return <SvgIcon size={14}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></SvgIcon>; }
function GlobeIcon()      { return <SvgIcon size={13}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></SvgIcon>; }
function LinkedInIcon()   { return <SvgIcon size={13}><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></SvgIcon>; }
function AlertIcon()      { return <SvgIcon size={14}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></SvgIcon>; }
function EmptyDocIcon()   { return <SvgIcon size={32}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></SvgIcon>; }

// ── Reusable field components ─────────────────────────────────────────────────

const S = {
  card: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    marginBottom: 14,
    overflow: 'hidden',
  },
  cardHead: {
    padding: '12px 16px',
    borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: 'var(--bg)',
  },
  cardTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  cardBody: { padding: '14px 16px' },
  fieldRow: { display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
  fieldLabel: { fontSize: 11, color: 'var(--text-sub)', fontWeight: 500, minWidth: 130, flexShrink: 0 },
  fieldValue: { fontSize: 13, color: 'var(--text)', flex: 1 },
  input: {
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 6, padding: '7px 10px',
    fontSize: 13, color: 'var(--text)', width: '100%', boxSizing: 'border-box', outline: 'none',
  },
  label: { fontSize: 11.5, color: 'var(--text-sub)', marginBottom: 4, fontWeight: 500, display: 'block' },
  formGroup: { marginBottom: 12 },
  smallBtn: (variant = 'outline') => ({
    fontSize: 12, padding: '4px 10px',
    borderRadius: 6,
    border: variant === 'primary' ? 'none' : variant === 'danger' ? '1px solid rgba(224,82,82,0.3)' : '1px solid var(--border)',
    background: variant === 'primary' ? 'var(--accent)' : variant === 'danger' ? 'rgba(224,82,82,0.08)' : 'var(--card)',
    color: variant === 'primary' ? '#fff' : variant === 'danger' ? '#E05252' : 'var(--text)',
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, lineHeight: 1.5,
  }),
};

function FieldRow({ label, children }) {
  return (
    <div style={S.fieldRow}>
      <span style={S.fieldLabel}>{label}</span>
      <span style={S.fieldValue}>{children || <span style={{ color: 'var(--text-sub)' }}>—</span>}</span>
    </div>
  );
}

function YesNoBadge({ value }) {
  if (value === null || value === undefined) return <span style={{ color: 'var(--text-sub)' }}>—</span>;
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
      background: value ? 'rgba(46,204,138,0.12)' : 'rgba(224,82,82,0.1)',
      color: value ? '#1a8754' : '#c0392b',
      border: `1px solid ${value ? 'rgba(46,204,138,0.3)' : 'rgba(224,82,82,0.2)'}`,
    }}>
      {value ? 'Yes' : 'No'}
    </span>
  );
}

// ── Toast notification ─────────────────────────────────────────────────────────

function Toast({ message, type = 'success', onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  const colors = {
    success: { bg: 'rgba(46,204,138,0.12)', border: 'rgba(46,204,138,0.3)', text: '#1a8754' },
    error:   { bg: 'rgba(224,82,82,0.1)',   border: 'rgba(224,82,82,0.3)', text: '#c0392b' },
    info:    { bg: 'rgba(47,127,232,0.1)',   border: 'rgba(47,127,232,0.3)', text: '#2F7FE8' },
  };
  const c = colors[type] || colors.info;

  return (
    <div style={{
      position: 'fixed', bottom: 28, right: 28, zIndex: 2000,
      background: c.bg, border: `1px solid ${c.border}`,
      borderRadius: 8, padding: '12px 16px', maxWidth: 380,
      fontSize: 13, color: c.text, fontWeight: 500,
      boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
      display: 'flex', alignItems: 'center', gap: 10,
      animation: 'fadeIn 0.2s ease',
    }}>
      <span style={{ flex: 1 }}>{message}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.text, padding: 0 }}>
        <CloseIcon />
      </button>
    </div>
  );
}

// ── Master Data Card ──────────────────────────────────────────────────────────

function MasterDataCard({ bp, onUpdated }) {
  const [editing,    setEditing]    = useState(false);
  const [form,       setForm]       = useState({});
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const [categories, setCategories] = useState([]);
  const [tiers,      setTiers]      = useState([]);

  useEffect(() => {
    fetch('/api/customer-categories', { headers: authH() })
      .then(r => r.json())
      .then(d => setCategories(d.data || []));
    fetch('/api/product-uom/tiers', { headers: authH() })
      .then(r => r.json())
      .then(d => setTiers(d.data || []));
  }, []);

  function startEdit() {
    setForm({
      legal_entity_name:     bp.legal_entity_name     || '',
      trading_name:          bp.trading_name          || '',
      first_name:            bp.first_name            || '',
      last_name:             bp.last_name             || '',
      job_title:             bp.job_title             || '',
      bp_role:               bp.bp_role               || 'customer',
      abn:                   bp.abn                   || '',
      acn:                   bp.acn                   || '',
      gst_registered:        bp.gst_registered !== false,
      gst_registration_date: bp.gst_registration_date ? bp.gst_registration_date.split('T')[0] : '',
      website:               bp.website               || '',
      industry:              bp.industry              || '',
      linkedin_url:          bp.linkedin_url          || '',
      email:                 bp.email                 || '',
      email_secondary:       bp.email_secondary       || '',
      phone:                 bp.phone                 || '',
      mobile:                bp.mobile                || '',
      credit_limit:          bp.credit_limit !== null ? String(bp.credit_limit) : '',
      payment_terms:         bp.payment_terms         || 'NET30',
      is_overseas:           bp.is_overseas           === true,
      notes:                 bp.notes                 || '',
      customer_category_id:  bp.customer_category_id  ?? null,
      customer_tier_id:      bp.customer_tier_id      ?? null,
    });
    setEditing(true);
    setError('');
  }

  function setF(field, val) {
    setForm(f => ({ ...f, [field]: val }));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const payload = { ...form };
      if (payload.credit_limit !== '') payload.credit_limit = parseFloat(payload.credit_limit);
      else payload.credit_limit = null;
      if (!payload.gst_registration_date) payload.gst_registration_date = null;
      Object.keys(payload).forEach(k => {
        if (payload[k] === '') payload[k] = null;
      });
      await bpApi.update(bp.id, payload);
      setEditing(false);
      onUpdated();
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  const iS = { ...S.input };
  const rowGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 };

  if (editing) {
    return (
      <div style={S.card}>
        <div style={S.cardHead}>
          <div style={S.cardTitle}>Master Data — Editing</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={S.smallBtn('outline')} onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
            <button style={S.smallBtn('primary')} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
        <div style={S.cardBody}>
          {error && (
            <div style={{
              background: 'rgba(224,82,82,0.1)', border: '1px solid rgba(224,82,82,0.25)',
              borderRadius: 6, padding: '8px 12px', marginBottom: 12,
              fontSize: 12.5, color: '#E05252', display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <AlertIcon /> {error}
            </div>
          )}

          {bp.bp_type === 'organization' && (
            <>
              <div style={rowGrid}>
                <div>
                  <label style={S.label}>Legal Entity Name *</label>
                  <input style={iS} value={form.legal_entity_name}
                    onChange={e => setF('legal_entity_name', e.target.value)} />
                </div>
                <div>
                  <label style={S.label}>Trading Name</label>
                  <input style={iS} value={form.trading_name}
                    onChange={e => setF('trading_name', e.target.value)} />
                </div>
              </div>
              <div style={rowGrid}>
                <div>
                  <label style={S.label}>ABN</label>
                  <input style={iS} value={form.abn} onChange={e => setF('abn', e.target.value)} />
                </div>
                <div>
                  <label style={S.label}>ACN</label>
                  <input style={iS} value={form.acn} onChange={e => setF('acn', e.target.value)} />
                </div>
              </div>
              <div style={rowGrid}>
                <div>
                  <label style={S.label}>GST Reg Date</label>
                  <input style={iS} type="date" value={form.gst_registration_date}
                    onChange={e => setF('gst_registration_date', e.target.value)} />
                </div>
                <div>
                  <label style={S.label}>Industry</label>
                  <select style={iS} value={form.industry} onChange={e => setF('industry', e.target.value)}>
                    <option value="">Select...</option>
                    {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
              </div>
              <div style={rowGrid}>
                <div>
                  <label style={S.label}>Website</label>
                  <input style={iS} value={form.website} onChange={e => setF('website', e.target.value)} placeholder="https://..." />
                </div>
                <div>
                  <label style={S.label}>LinkedIn</label>
                  <input style={iS} value={form.linkedin_url} onChange={e => setF('linkedin_url', e.target.value)} placeholder="https://linkedin.com/..." />
                </div>
              </div>
            </>
          )}

          {bp.bp_type === 'person' && (
            <div style={rowGrid}>
              <div>
                <label style={S.label}>First Name *</label>
                <input style={iS} value={form.first_name} onChange={e => setF('first_name', e.target.value)} />
              </div>
              <div>
                <label style={S.label}>Last Name *</label>
                <input style={iS} value={form.last_name} onChange={e => setF('last_name', e.target.value)} />
              </div>
            </div>
          )}

          <div style={rowGrid}>
            <div>
              <label style={S.label}>Job Title</label>
              <input style={iS} value={form.job_title} onChange={e => setF('job_title', e.target.value)} />
            </div>
            <div>
              <label style={S.label}>BP Role</label>
              <select style={iS} value={form.bp_role} onChange={e => setF('bp_role', e.target.value)}>
                <option value="customer">Customer</option>
                <option value="supplier">Supplier</option>
                <option value="both">Customer & Supplier</option>
                <option value="lead">Lead</option>
              </select>
            </div>
          </div>
          <div style={rowGrid}>
            <div>
              <label style={S.label}>Email</label>
              <input style={iS} type="email" value={form.email} onChange={e => setF('email', e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Email (secondary)</label>
              <input style={iS} type="email" value={form.email_secondary} onChange={e => setF('email_secondary', e.target.value)} />
            </div>
          </div>
          <div style={rowGrid}>
            <div>
              <label style={S.label}>Phone</label>
              <input style={iS} type="tel" value={form.phone} onChange={e => setF('phone', e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Mobile</label>
              <input style={iS} type="tel" value={form.mobile} onChange={e => setF('mobile', e.target.value)} />
            </div>
          </div>

          {bp.bp_type === 'organization' && (
            <div style={rowGrid}>
              <div>
                <label style={S.label}>Credit Limit (AUD)</label>
                <input style={iS} type="number" min="0" step="100" value={form.credit_limit}
                  onChange={e => setF('credit_limit', e.target.value)} />
              </div>
              <div>
                <label style={S.label}>Payment Terms</label>
                <select style={iS} value={form.payment_terms} onChange={e => setF('payment_terms', e.target.value)}>
                  {CREDIT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            {bp.bp_type === 'organization' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.gst_registered}
                  onChange={e => setF('gst_registered', e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }} />
                GST Registered
              </label>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_overseas}
                onChange={e => setF('is_overseas', e.target.checked)}
                style={{ accentColor: 'var(--accent)' }} />
              Overseas
            </label>
          </div>

          <div>
            <label style={S.label}>Notes</label>
            <textarea style={{ ...iS, minHeight: 64, resize: 'vertical' }}
              value={form.notes} onChange={e => setF('notes', e.target.value)}
              placeholder="Internal notes..." />
          </div>

          {(form.bp_role === 'customer' || form.bp_role === 'both') && (
            <div style={rowGrid}>
              <div>
                <label style={S.label}>Customer Category</label>
                <select style={iS}
                  value={form.customer_category_id || ''}
                  onChange={e => setF('customer_category_id', e.target.value ? parseInt(e.target.value) : null)}>
                  <option value="">— None —</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={S.label}>Customer Tier</label>
                <select style={iS}
                  value={form.customer_tier_id || ''}
                  onChange={e => setF('customer_tier_id', e.target.value ? parseInt(e.target.value) : null)}>
                  <option value="">— None —</option>
                  {tiers.map(t => (
                    <option key={t.id} value={t.id} style={{ color: t.color }}>
                      {t.name}{t.discount_pct > 0 ? ` (${t.discount_pct}% off)` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Read-only view
  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <div style={S.cardTitle}>Master Data</div>
        <button style={S.smallBtn('outline')} onClick={startEdit}>
          <EditIcon /> Edit
        </button>
      </div>
      <div style={S.cardBody}>
        {bp.bp_type === 'organization' && (
          <>
            <FieldRow label="Legal Entity Name">{bp.legal_entity_name}</FieldRow>
            {bp.trading_name && <FieldRow label="Trading Name">{bp.trading_name}</FieldRow>}
            <FieldRow label="ABN">{formatABN(bp.abn) || '—'}</FieldRow>
            {bp.acn && <FieldRow label="ACN"><span style={{ fontFamily: 'DM Mono, monospace' }}>{bp.acn}</span></FieldRow>}
            <FieldRow label="GST Registered"><YesNoBadge value={bp.gst_registered} /></FieldRow>
            {bp.gst_registration_date && (
              <FieldRow label="GST Reg Date">{formatDate(bp.gst_registration_date)}</FieldRow>
            )}
            {bp.industry && <FieldRow label="Industry">{bp.industry}</FieldRow>}
            {bp.website && (
              <FieldRow label="Website">
                <a href={bp.website} target="_blank" rel="noopener noreferrer"
                  style={{ color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <GlobeIcon /> {bp.website}
                </a>
              </FieldRow>
            )}
            {bp.linkedin_url && (
              <FieldRow label="LinkedIn">
                <a href={bp.linkedin_url} target="_blank" rel="noopener noreferrer"
                  style={{ color: '#0A66C2', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <LinkedInIcon /> View Profile
                </a>
              </FieldRow>
            )}
          </>
        )}

        {bp.bp_type === 'person' && (
          <>
            <FieldRow label="Full Name">{`${bp.first_name || ''} ${bp.last_name || ''}`.trim()}</FieldRow>
            {bp.job_title && <FieldRow label="Job Title">{bp.job_title}</FieldRow>}
          </>
        )}

        {bp.email && <FieldRow label="Email"><a href={`mailto:${bp.email}`} style={{ color: 'var(--accent)' }}>{bp.email}</a></FieldRow>}
        {bp.email_secondary && <FieldRow label="Email (2)">{bp.email_secondary}</FieldRow>}
        {bp.phone && <FieldRow label="Phone">{bp.phone}</FieldRow>}
        {bp.mobile && <FieldRow label="Mobile">{bp.mobile}</FieldRow>}

        {bp.bp_type === 'organization' && (
          <>
            <FieldRow label="Credit Limit">{formatCurrency(bp.credit_limit)}</FieldRow>
            <FieldRow label="Payment Terms">
              {bp.payment_terms
                ? <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12 }}>{bp.payment_terms}</span>
                : '—'}
            </FieldRow>
            <FieldRow label="Overseas"><YesNoBadge value={bp.is_overseas} /></FieldRow>
          </>
        )}

        {(bp.bp_role === 'customer' || bp.bp_role === 'both') && (bp.customer_category_id || bp.customer_tier_id) && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {bp.customer_category_id && (() => {
              const cat = categories.find(c => c.id === bp.customer_category_id);
              return cat ? (
                <div style={S.fieldRow}>
                  <span style={S.fieldLabel}>Category</span>
                  <span style={{
                    fontSize: 11.5, fontWeight: 600, padding: '2px 10px', borderRadius: 20,
                    background: cat.color ? `${cat.color}18` : 'var(--bg)',
                    color: cat.color || 'var(--text)',
                    border: `1px solid ${cat.color ? `${cat.color}40` : 'var(--border)'}`,
                    display: 'inline-block',
                  }}>{cat.name}</span>
                </div>
              ) : null;
            })()}
            {bp.customer_tier_id && (() => {
              const tier = tiers.find(t => t.id === bp.customer_tier_id);
              return tier ? (
                <div style={S.fieldRow}>
                  <span style={S.fieldLabel}>Tier</span>
                  <span style={{
                    fontSize: 11.5, fontWeight: 600, padding: '2px 10px', borderRadius: 20,
                    background: tier.color ? `${tier.color}18` : 'var(--bg)',
                    color: tier.color || 'var(--text)',
                    border: `1px solid ${tier.color ? `${tier.color}40` : 'var(--border)'}`,
                    display: 'inline-block',
                  }}>
                    {tier.name}{tier.discount_pct > 0 ? ` (${tier.discount_pct}% off)` : ''}
                  </span>
                </div>
              ) : null;
            })()}
          </div>
        )}

        {bp.notes && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-sub)', fontWeight: 500, marginBottom: 4 }}>Notes</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{bp.notes}</div>
          </div>
        )}

        {bp.ai_summary && (
          <div style={{
            marginTop: 10, padding: '10px 12px', borderRadius: 8,
            background: 'rgba(47,127,232,0.05)', border: '1px solid rgba(47,127,232,0.15)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#2F7FE8', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <SparkleIcon /> AI Summary
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--text)' }}>{bp.ai_summary}</div>
            {bp.ai_enriched_at && (
              <div style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 4 }}>
                Enriched {formatDate(bp.ai_enriched_at)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Addresses Card ────────────────────────────────────────────────────────────

function AddressesCard({ addresses, legacyContactId, onReload }) {
  const [showAdd, setShowAdd]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [newAddr, setNewAddr]   = useState({
    address_role: 'sold_to', label: '', address_line1: '',
    address_line2: '', suburb: '', state: '', postcode: '', country: 'Australia', is_default: false,
  });

  const roleInfo = (r) => ADDRESS_ROLES.find(a => a.value === r) || { label: r, color: '#999' };

  async function addAddress() {
    if (!newAddr.address_line1.trim()) { setError('Address Line 1 is required.'); return; }
    setSaving(true); setError('');
    try {
      await apiFetch(`/bp/addresses/${legacyContactId}`, {
        method: 'POST',
        body: JSON.stringify({
          address_role:  newAddr.address_role,
          label:         newAddr.label.trim()         || null,
          address_line1: newAddr.address_line1.trim(),
          address_line2: newAddr.address_line2.trim() || null,
          suburb:        newAddr.suburb.trim()        || null,
          state:         newAddr.state               || null,
          postcode:      newAddr.postcode.trim()      || null,
          country:       newAddr.country             || 'Australia',
          is_default:    newAddr.is_default,
        }),
      });
      setShowAdd(false);
      setNewAddr({ address_role: 'sold_to', label: '', address_line1: '', address_line2: '', suburb: '', state: '', postcode: '', country: 'Australia', is_default: false });
      onReload();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function deleteAddress(id) {
    if (!confirm('Delete this address?')) return;
    try {
      await apiFetch(`/bp/addresses/${legacyContactId}/${id}`, { method: 'DELETE' });
      onReload();
    } catch (e) { alert(e.message); }
  }

  const iS = { ...S.input, fontSize: 12.5 };
  const lS = { ...S.label, fontSize: 11 };

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <div style={S.cardTitle}>Addresses</div>
        <button style={S.smallBtn('outline')} onClick={() => { setShowAdd(v => !v); setError(''); }}>
          <PlusIcon /> Add
        </button>
      </div>
      <div style={S.cardBody}>
        {error && (
          <div style={{ fontSize: 12, color: '#E05252', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
            <AlertIcon /> {error}
          </div>
        )}

        {/* Add form */}
        {showAdd && (
          <div style={{
            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
            padding: 14, marginBottom: 14,
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={lS}>Role</label>
                <select style={iS} value={newAddr.address_role}
                  onChange={e => setNewAddr(a => ({ ...a, address_role: e.target.value }))}>
                  {ADDRESS_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lS}>Label (optional)</label>
                <input style={iS} placeholder="e.g. Head Office"
                  value={newAddr.label} onChange={e => setNewAddr(a => ({ ...a, label: e.target.value }))} />
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={lS}>Address Line 1 *</label>
              <input style={iS} placeholder="123 Main Street"
                value={newAddr.address_line1} onChange={e => setNewAddr(a => ({ ...a, address_line1: e.target.value }))} />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={lS}>Address Line 2</label>
              <input style={iS} placeholder="Suite 4, Level 2"
                value={newAddr.address_line2} onChange={e => setNewAddr(a => ({ ...a, address_line2: e.target.value }))} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
              <div>
                <label style={lS}>Suburb</label>
                <input style={iS} value={newAddr.suburb} onChange={e => setNewAddr(a => ({ ...a, suburb: e.target.value }))} />
              </div>
              <div>
                <label style={lS}>State</label>
                <select style={iS} value={newAddr.state}
                  onChange={e => setNewAddr(a => ({ ...a, state: e.target.value }))}>
                  <option value="">—</option>
                  {AU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={lS}>Postcode</label>
                <input style={iS} maxLength={10}
                  value={newAddr.postcode} onChange={e => setNewAddr(a => ({ ...a, postcode: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={newAddr.is_default}
                  onChange={e => setNewAddr(a => ({ ...a, is_default: e.target.checked }))}
                  style={{ accentColor: 'var(--accent)' }} />
                Set as default
              </label>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={S.smallBtn('primary')} onClick={addAddress} disabled={saving}>
                {saving ? 'Saving...' : 'Add Address'}
              </button>
              <button style={S.smallBtn('outline')} onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        )}

        {addresses.length === 0 ? (
          <div style={{ color: 'var(--text-sub)', fontSize: 13, textAlign: 'center', padding: '10px 0' }}>
            No addresses recorded.
          </div>
        ) : (
          addresses.map(addr => {
            const ri = roleInfo(addr.address_role);
            return (
              <div key={addr.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10,
                paddingBottom: 10, borderBottom: '1px solid var(--border)',
              }}>
                <span style={{
                  fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                  background: `${ri.color}18`, color: ri.color,
                  border: `1px solid ${ri.color}40`, whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  {ri.label}
                </span>
                <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text)' }}>
                  {addr.label && <div style={{ fontWeight: 600 }}>{addr.label}</div>}
                  <div>{addr.address_line1}</div>
                  {addr.address_line2 && <div>{addr.address_line2}</div>}
                  <div>{[addr.suburb, addr.state, addr.postcode].filter(Boolean).join(' ')}</div>
                  {addr.country && addr.country !== 'Australia' && <div>{addr.country}</div>}
                </div>
                {addr.is_default && (
                  <span style={{ color: '#E89B2F', flexShrink: 0 }} title="Default address"><StarIcon /></span>
                )}
                <button style={{ ...S.smallBtn('danger'), padding: '2px 6px', flexShrink: 0 }}
                  onClick={() => deleteAddress(addr.id)}>
                  <TrashIcon />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Banking Card ──────────────────────────────────────────────────────────────

function BankingCard({ banking, legacyContactId, onReload }) {
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [newBnk, setNewBnk]   = useState({
    account_name: '', bank_name: '', bsb: '', account_number: '',
    swift_code: '', iban: '', currency_code: 'AUD', is_default: false,
  });

  async function addBanking() {
    if (!newBnk.account_name.trim()) { setError('Account name is required.'); return; }
    setSaving(true); setError('');
    try {
      await apiFetch(`/bp/banking/${legacyContactId}`, {
        method: 'POST',
        body: JSON.stringify({
          account_name:   newBnk.account_name.trim(),
          bank_name:      newBnk.bank_name.trim()      || null,
          bsb:            newBnk.bsb.trim()            || null,
          account_number: newBnk.account_number.trim() || null,
          swift_code:     newBnk.swift_code.trim()     || null,
          iban:           newBnk.iban.trim()            || null,
          currency_code:  newBnk.currency_code         || 'AUD',
          is_default:     newBnk.is_default,
        }),
      });
      setShowAdd(false);
      setNewBnk({ account_name: '', bank_name: '', bsb: '', account_number: '', swift_code: '', iban: '', currency_code: 'AUD', is_default: false });
      onReload();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function deleteBanking(id) {
    if (!confirm('Delete this bank account?')) return;
    try {
      await apiFetch(`/bp/banking/${legacyContactId}/${id}`, { method: 'DELETE' });
      onReload();
    } catch (e) { alert(e.message); }
  }

  const iS = { ...S.input, fontSize: 12.5 };
  const lS = { ...S.label, fontSize: 11 };
  const mono = { fontFamily: 'DM Mono, monospace', fontSize: 12.5 };

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <div style={S.cardTitle}>Banking</div>
        <button style={S.smallBtn('outline')} onClick={() => { setShowAdd(v => !v); setError(''); }}>
          <PlusIcon /> Add
        </button>
      </div>
      <div style={S.cardBody}>
        {error && (
          <div style={{ fontSize: 12, color: '#E05252', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
            <AlertIcon /> {error}
          </div>
        )}

        {showAdd && (
          <div style={{
            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
            padding: 14, marginBottom: 14,
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={lS}>Account Name *</label>
                <input style={iS} placeholder="e.g. Accounts Payable"
                  value={newBnk.account_name} onChange={e => setNewBnk(b => ({ ...b, account_name: e.target.value }))} />
              </div>
              <div>
                <label style={lS}>Bank Name</label>
                <input style={iS} placeholder="e.g. Commonwealth Bank"
                  value={newBnk.bank_name} onChange={e => setNewBnk(b => ({ ...b, bank_name: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={lS}>BSB</label>
                <input style={iS} placeholder="xxx-xxx"
                  value={newBnk.bsb} onChange={e => setNewBnk(b => ({ ...b, bsb: e.target.value }))} />
              </div>
              <div>
                <label style={lS}>Account Number</label>
                <input style={iS} placeholder="xxxxxxxx"
                  value={newBnk.account_number} onChange={e => setNewBnk(b => ({ ...b, account_number: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
              <div>
                <label style={lS}>SWIFT</label>
                <input style={iS} placeholder="e.g. CTBAAU2S"
                  value={newBnk.swift_code} onChange={e => setNewBnk(b => ({ ...b, swift_code: e.target.value }))} />
              </div>
              <div>
                <label style={lS}>IBAN</label>
                <input style={iS} value={newBnk.iban} onChange={e => setNewBnk(b => ({ ...b, iban: e.target.value }))} />
              </div>
              <div>
                <label style={lS}>Currency</label>
                <select style={iS} value={newBnk.currency_code}
                  onChange={e => setNewBnk(b => ({ ...b, currency_code: e.target.value }))}>
                  {['AUD', 'USD', 'EUR', 'GBP', 'NZD'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={newBnk.is_default}
                  onChange={e => setNewBnk(b => ({ ...b, is_default: e.target.checked }))}
                  style={{ accentColor: 'var(--accent)' }} />
                Set as default
              </label>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={S.smallBtn('primary')} onClick={addBanking} disabled={saving}>
                {saving ? 'Saving...' : 'Add Account'}
              </button>
              <button style={S.smallBtn('outline')} onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        )}

        {banking.length === 0 ? (
          <div style={{ color: 'var(--text-sub)', fontSize: 13, textAlign: 'center', padding: '10px 0' }}>
            No bank accounts recorded.
          </div>
        ) : (
          banking.map(acct => (
            <div key={acct.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10,
              paddingBottom: 10, borderBottom: '1px solid var(--border)',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{acct.account_name}</div>
                {acct.bank_name && <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>{acct.bank_name}</div>}
                <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                  {acct.bsb && (
                    <span>
                      <span style={{ fontSize: 11, color: 'var(--text-sub)' }}>BSB </span>
                      <span style={mono}>{formatBSB(acct.bsb)}</span>
                    </span>
                  )}
                  {acct.account_number && (
                    <span>
                      <span style={{ fontSize: 11, color: 'var(--text-sub)' }}>Acct </span>
                      <span style={mono}>{acct.account_number}</span>
                    </span>
                  )}
                  {acct.swift_code && (
                    <span>
                      <span style={{ fontSize: 11, color: 'var(--text-sub)' }}>SWIFT </span>
                      <span style={mono}>{acct.swift_code}</span>
                    </span>
                  )}
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 10,
                    background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-sub)',
                  }}>{acct.currency_code || 'AUD'}</span>
                </div>
              </div>
              {acct.is_default && (
                <span style={{ color: '#E89B2F', flexShrink: 0 }} title="Default account"><StarIcon /></span>
              )}
              <button style={{ ...S.smallBtn('danger'), padding: '2px 6px', flexShrink: 0 }}
                onClick={() => deleteBanking(acct.id)}>
                <TrashIcon />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Linked Persons Card (for orgs) ────────────────────────────────────────────

function LinkedPersonsCard({ bpId, linkedPersons, onReload }) {
  const [showLink, setShowLink]     = useState(false);
  const [personSearch, setPersonSearch] = useState('');
  const [personResults, setPersonResults] = useState([]);
  const [searching, setSearching]   = useState(false);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [roleLabel, setRoleLabel]   = useState('');
  const [isPrimary, setIsPrimary]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const searchTimeout = useRef(null);

  useEffect(() => {
    if (!personSearch.trim()) { setPersonResults([]); return; }
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await bpApi.list({ search: personSearch, bp_type: 'person', limit: 10 });
        setPersonResults(data.data || []);
      } catch { setPersonResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(searchTimeout.current);
  }, [personSearch]);

  async function linkPerson() {
    if (!selectedPerson) { setError('Please select a person.'); return; }
    setSaving(true); setError('');
    try {
      await bpApi.addRelationship(bpId, {
        person_bp_id:       selectedPerson.id,
        org_bp_id:          parseInt(bpId),
        role_label:         roleLabel.trim() || null,
        is_primary_contact: isPrimary,
      });
      setShowLink(false);
      setPersonSearch(''); setPersonResults([]); setSelectedPerson(null);
      setRoleLabel(''); setIsPrimary(false);
      onReload();
    } catch (e) { setError(e.message || 'Failed to link person.'); }
    finally { setSaving(false); }
  }

  async function unlink(relId) {
    if (!confirm('Remove this person link?')) return;
    try {
      await bpApi.removeRelationship(bpId, relId);
      onReload();
    } catch (e) { alert(e.message); }
  }

  const iS = { ...S.input, fontSize: 12.5 };

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <div style={S.cardTitle}>Linked Persons</div>
        <button style={S.smallBtn('outline')} onClick={() => { setShowLink(v => !v); setError(''); }}>
          <PlusIcon /> Link Person
        </button>
      </div>
      <div style={S.cardBody}>
        {error && (
          <div style={{ fontSize: 12, color: '#E05252', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
            <AlertIcon /> {error}
          </div>
        )}

        {showLink && (
          <div style={{
            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
            padding: 14, marginBottom: 14,
          }}>
            <div style={{ marginBottom: 8, position: 'relative' }}>
              <label style={{ ...S.label, fontSize: 11 }}>Search Person *</label>
              <input style={iS} placeholder="Type a name..."
                value={personSearch}
                onChange={e => { setPersonSearch(e.target.value); setSelectedPerson(null); }} />
              {searching && (
                <div style={{ position: 'absolute', right: 10, top: '60%' }}>
                  <div className="spinner-dark" style={{ width: 12, height: 12 }} />
                </div>
              )}
              {personResults.length > 0 && !selectedPerson && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                  background: 'var(--card)', border: '1px solid var(--border)',
                  borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', maxHeight: 180, overflowY: 'auto',
                }}>
                  {personResults.map(p => (
                    <button key={p.id} type="button"
                      onClick={() => { setSelectedPerson(p); setPersonSearch(p.display_name); setPersonResults([]); }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '7px 12px', background: 'none', border: 'none',
                        borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 12.5, color: 'var(--text)',
                      }}>
                      {p.display_name}
                      {p.job_title && <span style={{ color: 'var(--text-sub)', marginLeft: 6 }}>— {p.job_title}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginBottom: 10, alignItems: 'end' }}>
              <div>
                <label style={{ ...S.label, fontSize: 11 }}>Role / Title</label>
                <input style={iS} placeholder="e.g. Finance Director"
                  value={roleLabel} onChange={e => setRoleLabel(e.target.value)} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', paddingBottom: 2 }}>
                <input type="checkbox" checked={isPrimary}
                  onChange={e => setIsPrimary(e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }} />
                Primary
              </label>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={S.smallBtn('primary')} onClick={linkPerson} disabled={saving || !selectedPerson}>
                {saving ? 'Linking...' : 'Link Person'}
              </button>
              <button style={S.smallBtn('outline')} onClick={() => setShowLink(false)}>Cancel</button>
            </div>
          </div>
        )}

        {linkedPersons.length === 0 ? (
          <div style={{ color: 'var(--text-sub)', fontSize: 13, textAlign: 'center', padding: '10px 0' }}>
            No linked persons.
          </div>
        ) : (
          linkedPersons.map(p => (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
              paddingBottom: 10, borderBottom: '1px solid var(--border)',
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                background: avatarColor(p.display_name),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: '#fff',
              }}>
                {initials(p.display_name)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {p.display_name}
                  {p.is_primary_contact && (
                    <span style={{
                      marginLeft: 6, fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10,
                      background: 'rgba(47,127,232,0.1)', color: '#2F7FE8', border: '1px solid rgba(47,127,232,0.2)',
                    }}>Primary</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
                  {[p.role_label || p.job_title, p.email].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button style={{ ...S.smallBtn('danger'), padding: '2px 6px' }} onClick={() => unlink(p.id)}>
                <TrashIcon />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Linked Orgs Card (for persons) ────────────────────────────────────────────

function LinkedOrgsCard({ bpId, linkedOrgs, onReload }) {
  const [showLink, setShowLink]   = useState(false);
  const [orgSearch, setOrgSearch] = useState('');
  const [orgResults, setOrgResults] = useState([]);
  const [searching, setSearching]   = useState(false);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [roleLabel, setRoleLabel]   = useState('');
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const searchTimeout = useRef(null);

  useEffect(() => {
    if (!orgSearch.trim()) { setOrgResults([]); return; }
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await bpApi.list({ search: orgSearch, bp_type: 'organization', limit: 10 });
        setOrgResults(data.data || []);
      } catch { setOrgResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(searchTimeout.current);
  }, [orgSearch]);

  async function linkOrg() {
    if (!selectedOrg) { setError('Please select an organization.'); return; }
    setSaving(true); setError('');
    try {
      await bpApi.addRelationship(selectedOrg.id, {
        person_bp_id: parseInt(bpId),
        org_bp_id:    selectedOrg.id,
        role_label:   roleLabel.trim() || null,
      });
      setShowLink(false);
      setOrgSearch(''); setOrgResults([]); setSelectedOrg(null); setRoleLabel('');
      onReload();
    } catch (e) { setError(e.message || 'Failed to link org.'); }
    finally { setSaving(false); }
  }

  async function unlink(relId) {
    if (!confirm('Remove this organisation link?')) return;
    try {
      await bpApi.removeRelationship(bpId, relId);
      onReload();
    } catch (e) { alert(e.message); }
  }

  const iS = { ...S.input, fontSize: 12.5 };

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <div style={S.cardTitle}>Linked Organisations</div>
        <button style={S.smallBtn('outline')} onClick={() => { setShowLink(v => !v); setError(''); }}>
          <PlusIcon /> Link Org
        </button>
      </div>
      <div style={S.cardBody}>
        {error && (
          <div style={{ fontSize: 12, color: '#E05252', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
            <AlertIcon /> {error}
          </div>
        )}

        {showLink && (
          <div style={{
            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
            padding: 14, marginBottom: 14,
          }}>
            <div style={{ marginBottom: 8, position: 'relative' }}>
              <label style={{ ...S.label, fontSize: 11 }}>Search Organization *</label>
              <input style={iS} placeholder="Type org name..."
                value={orgSearch}
                onChange={e => { setOrgSearch(e.target.value); setSelectedOrg(null); }} />
              {searching && (
                <div style={{ position: 'absolute', right: 10, top: '60%' }}>
                  <div className="spinner-dark" style={{ width: 12, height: 12 }} />
                </div>
              )}
              {orgResults.length > 0 && !selectedOrg && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                  background: 'var(--card)', border: '1px solid var(--border)',
                  borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', maxHeight: 180, overflowY: 'auto',
                }}>
                  {orgResults.map(o => (
                    <button key={o.id} type="button"
                      onClick={() => { setSelectedOrg(o); setOrgSearch(o.display_name || o.legal_entity_name); setOrgResults([]); }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '7px 12px', background: 'none', border: 'none',
                        borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 12.5, color: 'var(--text)',
                      }}>
                      {o.display_name || o.legal_entity_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ ...S.label, fontSize: 11 }}>Role / Title</label>
              <input style={iS} placeholder="e.g. Finance Director"
                value={roleLabel} onChange={e => setRoleLabel(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={S.smallBtn('primary')} onClick={linkOrg} disabled={saving || !selectedOrg}>
                {saving ? 'Linking...' : 'Link Organisation'}
              </button>
              <button style={S.smallBtn('outline')} onClick={() => setShowLink(false)}>Cancel</button>
            </div>
          </div>
        )}

        {linkedOrgs.length === 0 ? (
          <div style={{ color: 'var(--text-sub)', fontSize: 13, textAlign: 'center', padding: '10px 0' }}>
            No linked organisations.
          </div>
        ) : (
          linkedOrgs.map(o => (
            <div key={o.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
              paddingBottom: 10, borderBottom: '1px solid var(--border)',
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: 6, flexShrink: 0,
                background: avatarColor(o.display_name),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: '#fff',
              }}>
                {initials(o.display_name)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{o.display_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
                  {[o.role_label, o.bp_role].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button style={{ ...S.smallBtn('danger'), padding: '2px 6px' }} onClick={() => unlink(o.id)}>
                <TrashIcon />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── AI Proposals Panel ────────────────────────────────────────────────────────

function ProposalsPanel({ proposals, onReviewed }) {
  const [expanded, setExpanded]       = useState(true);
  const [editingId, setEditingId]     = useState(null);
  const [editValue, setEditValue]     = useState('');
  const [processing, setProcessing]   = useState({});

  if (!proposals || proposals.length === 0) return null;

  async function review(id, action, edited_value) {
    setProcessing(p => ({ ...p, [id]: true }));
    try {
      const body = { action };
      if (action === 'edit' && edited_value !== undefined) body.edited_value = edited_value;
      await bpApi.reviewProposal(id, body);
      onReviewed();
    } catch (e) { alert(e.message || 'Review failed.'); }
    finally { setProcessing(p => ({ ...p, [id]: false })); }
  }

  function confidenceStyle(conf) {
    const n = parseFloat(conf);
    if (n > 75) return { bg: 'rgba(46,204,138,0.12)', color: '#1a8754', border: 'rgba(46,204,138,0.3)' };
    if (n > 50) return { bg: 'rgba(232,155,47,0.12)', color: '#a06010', border: 'rgba(232,155,47,0.3)' };
    return { bg: 'rgba(224,82,82,0.1)', color: '#c0392b', border: 'rgba(224,82,82,0.3)' };
  }

  return (
    <div style={{
      background: 'rgba(232,155,47,0.06)', border: '1px solid rgba(232,155,47,0.3)',
      borderRadius: 10, marginBottom: 14, overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        style={{
          padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', borderBottom: expanded ? '1px solid rgba(232,155,47,0.2)' : 'none',
        }}
        onClick={() => setExpanded(v => !v)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SparkleIcon />
          <span style={{ fontWeight: 700, fontSize: 13, color: '#a06010' }}>
            {proposals.length} AI enrichment proposal{proposals.length !== 1 ? 's' : ''} pending review
          </span>
        </div>
        <span style={{ color: '#a06010', fontSize: 12 }}>{expanded ? '▲ Collapse' : '▼ Expand'}</span>
      </div>

      {expanded && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'rgba(232,155,47,0.06)' }}>
                {['Field', 'Current Value', 'Proposed Value', 'Source', 'Confidence', 'Actions'].map((h, i) => (
                  <th key={i} style={{
                    padding: '8px 12px', textAlign: 'left', fontWeight: 600,
                    color: '#a06010', borderBottom: '1px solid rgba(232,155,47,0.2)', whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {proposals.map(p => {
                const cs = confidenceStyle(p.confidence);
                const busy = processing[p.id];
                return (
                  <React.Fragment key={p.id}>
                    <tr style={{ borderBottom: '1px solid rgba(232,155,47,0.1)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {p.field_name}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-sub)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.current_value || <em style={{ opacity: 0.5 }}>empty</em>}
                      </td>
                      <td style={{ padding: '8px 12px', fontWeight: 500, maxWidth: 200 }}>
                        {editingId === p.id ? (
                          <input
                            style={{ ...S.input, fontSize: 12, padding: '4px 8px', width: '100%' }}
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            autoFocus
                          />
                        ) : (
                          <span style={{ wordBreak: 'break-word' }}>{p.proposed_value}</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {p.source_url ? (
                          <a href={p.source_url} target="_blank" rel="noopener noreferrer"
                            style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                            title={p.source_snippet || 'View source'}>
                            <LinkIcon /> Source
                          </a>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
                          background: cs.bg, color: cs.color, border: `1px solid ${cs.border}`,
                        }}>
                          {p.confidence !== null ? `${Math.round(p.confidence)}%` : '—'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                        {editingId === p.id ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button style={{ ...S.smallBtn('primary'), padding: '2px 8px', fontSize: 11 }}
                              disabled={busy}
                              onClick={() => { review(p.id, 'edit', editValue); setEditingId(null); }}>
                              <CheckIcon /> Save
                            </button>
                            <button style={{ ...S.smallBtn('outline'), padding: '2px 8px', fontSize: 11 }}
                              onClick={() => setEditingId(null)}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              style={{ ...S.smallBtn('outline'), padding: '2px 7px', fontSize: 11, color: '#1a8754', borderColor: 'rgba(46,204,138,0.3)' }}
                              disabled={busy}
                              onClick={() => review(p.id, 'accept')}
                              title="Accept proposal"
                            >
                              <CheckIcon />
                            </button>
                            <button
                              style={{ ...S.smallBtn('danger'), padding: '2px 7px', fontSize: 11 }}
                              disabled={busy}
                              onClick={() => review(p.id, 'reject')}
                              title="Reject proposal"
                            >
                              <CloseIcon />
                            </button>
                            <button
                              style={{ ...S.smallBtn('outline'), padding: '2px 7px', fontSize: 11 }}
                              disabled={busy}
                              onClick={() => { setEditingId(p.id); setEditValue(p.proposed_value); }}
                              title="Edit value"
                            >
                              <EditIcon />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {p.source_snippet && (
                      <tr>
                        <td colSpan={6} style={{
                          padding: '0 12px 8px 12px',
                          fontSize: 11.5, color: 'var(--text-sub)', fontStyle: 'italic',
                        }}>
                          "{p.source_snippet}"
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Open Documents Timeline ───────────────────────────────────────────────────

function OpenDocumentsPanel({ documents }) {
  const docTypeBadge = (type) => {
    const map = {
      quote:        { bg: 'rgba(59,188,212,0.12)', color: '#1a7a8a', label: 'Quote' },
      sales_order:  { bg: 'rgba(47,127,232,0.12)', color: '#1a5fa0', label: 'Sales Order' },
      invoice:      { bg: 'rgba(232,155,47,0.12)', color: '#a06010', label: 'Invoice' },
    };
    const s = map[type] || { bg: 'var(--bg)', color: 'var(--text-sub)', label: type };
    return (
      <span style={{
        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
        background: s.bg, color: s.color,
      }}>{s.label}</span>
    );
  };

  const statusBadge = (status) => {
    const map = {
      draft:    { cls: 'pill-grey',   label: 'Draft' },
      sent:     { cls: 'pill-blue',   label: 'Sent' },
      approved: { cls: 'pill-green',  label: 'Approved' },
      invoiced: { cls: 'pill-orange', label: 'Invoiced' },
      partial:  { cls: 'pill-purple', label: 'Partial' },
    };
    const { cls = 'pill-grey', label = status } = map[status] || {};
    return <span className={`pill ${cls}`}>{label}</span>;
  };

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <div style={S.cardTitle}>Open Documents ({documents.length})</div>
        <button style={S.smallBtn('primary')}>
          <PlusIcon /> New Quote
        </button>
      </div>
      <div style={S.cardBody}>
        {documents.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 10, padding: '28px 0', color: 'var(--text-sub)',
          }}>
            <div style={{ opacity: 0.3 }}><EmptyDocIcon /></div>
            <div style={{ fontSize: 13 }}>No open documents</div>
          </div>
        ) : (
          documents.map(doc => (
            <div key={doc.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0',
              borderBottom: '1px solid var(--border)',
            }}>
              {/* Date stripe */}
              <div style={{
                width: 44, flexShrink: 0, textAlign: 'center',
                borderRight: '2px solid var(--border)', paddingRight: 10,
              }}>
                <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1 }}>
                  {doc.document_date ? new Date(doc.document_date).getDate() : '—'}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-sub)', textTransform: 'uppercase' }}>
                  {doc.document_date ? new Date(doc.document_date).toLocaleDateString('en-AU', { month: 'short' }) : ''}
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{doc.document_number}</span>
                  {docTypeBadge(doc.document_type)}
                  {statusBadge(doc.status)}
                </div>
                {doc.due_date && (
                  <div style={{ fontSize: 11.5, color: 'var(--text-sub)' }}>
                    Due {formatDate(doc.due_date)}
                  </div>
                )}
              </div>

              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  {formatCurrency(doc.total_inc_gst)}
                </div>
                {doc.amount_outstanding > 0 && (
                  <div style={{ fontSize: 11.5, color: '#E89B2F' }}>
                    {formatCurrency(doc.amount_outstanding)} outstanding
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Main BPDashboardPage ──────────────────────────────────────────────────────

export default function BPDashboardPage() {
  const { id }   = useParams();
  const navigate = useNavigate();

  const [data360,        setData360]        = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [enriching,      setEnriching]      = useState(false);
  const [enrichPending,  setEnrichPending]  = useState(false);
  const [toast,          setToast]          = useState(null); // { message, type }
  const pollRef = useRef(null);

  const load360 = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await bpApi.get360(id);
      const d = data.data || data;
      setData360(d);
      if (d.pending_proposals?.length > 0) setEnrichPending(false);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Failed to load business partner.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load360(); }, [load360]);

  // Clean up polling on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function handleEnrich() {
    setEnriching(true);
    try {
      await bpApi.enrich(id);
      showToast('AI enrichment running — proposals will appear below in a few seconds.', 'success');
      setEnrichPending(true);
      // Poll every 5 s up to 4 times (20 s window) until proposals arrive
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        try {
          const { data } = await bpApi.get360(id);
          const d = data.data || data;
          setData360(d);
          if (d.pending_proposals?.length > 0 || attempts >= 4) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setEnrichPending(false);
          }
        } catch { /* ignore poll errors */ }
      }, 5000);
    } catch (e) {
      showToast(e.response?.data?.message || 'Enrichment failed.', 'error');
    } finally {
      setEnriching(false);
    }
  }

  function showToast(message, type = 'success') {
    setToast({ message, type });
  }

  // Loading state
  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '60vh', gap: 12, color: 'var(--text-sub)', fontSize: 14,
      }}>
        <div className="spinner-dark" /> Loading...
      </div>
    );
  }

  // Error state
  if (error || !data360) {
    return (
      <div style={{ padding: '40px 32px', textAlign: 'center' }}>
        <div style={{ fontSize: 15, color: '#E05252', marginBottom: 12 }}>
          {error || 'Business partner not found.'}
        </div>
        <button className="btn btn-outline" onClick={() => navigate('/bp')}>
          <ArrowLeftIcon /> Back to Partners
        </button>
      </div>
    );
  }

  const { bp, addresses, banking, linked_persons, linked_orgs, open_documents, pending_proposals } = data360;
  const legacyId = bp.legacy_contact_id;

  const roleBadgeMap = {
    customer: { cls: 'pill-blue',   label: 'Customer' },
    supplier: { cls: 'pill-green',  label: 'Supplier' },
    both:     { cls: 'pill-purple', label: 'Cust & Supp' },
    lead:     { cls: 'pill-orange', label: 'Lead' },
  };
  const roleB = roleBadgeMap[bp.bp_role] || { cls: 'pill-grey', label: bp.bp_role };

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 22 }}>
        <button
          onClick={() => navigate('/bp')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-sub)',
            fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5, padding: 0, marginBottom: 12,
          }}
        >
          <ArrowLeftIcon /> Back to Partners
        </button>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* Avatar */}
            <div style={{
              width: 52, height: 52, borderRadius: bp.bp_type === 'organization' ? 10 : '50%',
              background: avatarColor(bp.display_name),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 700, color: '#fff', flexShrink: 0,
            }}>
              {initials(bp.display_name)}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{bp.display_name}</h1>
                {/* Type badge */}
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20,
                  background: bp.bp_type === 'organization' ? 'rgba(47,127,232,0.12)' : 'rgba(147,102,232,0.12)',
                  color: bp.bp_type === 'organization' ? '#2F7FE8' : '#9366E8',
                  border: `1px solid ${bp.bp_type === 'organization' ? 'rgba(47,127,232,0.25)' : 'rgba(147,102,232,0.25)'}`,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  {bp.bp_type === 'organization' ? <BuildingIcon /> : <PersonIcon />}
                  {bp.bp_type === 'organization' ? 'Organization' : 'Person'}
                </span>
                <span className={`pill ${roleB.cls}`}>{roleB.label}</span>
                {!bp.is_active && (
                  <span className="pill pill-grey">Inactive</span>
                )}
              </div>
              {bp.bp_type === 'organization' && bp.trading_name && (
                <div style={{ fontSize: 13, color: 'var(--text-sub)', marginTop: 2 }}>
                  Trading as {bp.trading_name}
                </div>
              )}
              {bp.bp_type === 'person' && bp.job_title && (
                <div style={{ fontSize: 13, color: 'var(--text-sub)', marginTop: 2 }}>{bp.job_title}</div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
            {enrichPending && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12,
                padding: '6px 12px', borderRadius: 6,
                background: 'rgba(100,116,139,0.1)', color: 'var(--text-sub)',
                border: '1px solid var(--border)',
              }}>
                <span className="spinner-dark" style={{ width: 12, height: 12 }} /> Checking for proposals…
              </span>
            )}
            {!enrichPending && pending_proposals?.length > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12,
                padding: '6px 12px', borderRadius: 6,
                background: 'rgba(232,155,47,0.12)', color: '#a06010',
                border: '1px solid rgba(232,155,47,0.3)', fontWeight: 600,
              }}>
                <SparkleIcon /> {pending_proposals.length} Proposals
              </span>
            )}
            <button
              onClick={handleEnrich}
              disabled={enriching}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 6,
                border: '1px solid rgba(47,127,232,0.3)',
                background: 'rgba(47,127,232,0.08)', color: '#2F7FE8',
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
                opacity: enriching ? 0.7 : 1,
              }}
            >
              {enriching ? <span className="spinner-dark" style={{ width: 13, height: 13 }} /> : <SparkleIcon />}
              {enriching ? 'Enriching...' : 'Enrich AI'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Two-column layout ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 3fr', gap: 20, alignItems: 'start' }}>

        {/* ── LEFT COLUMN ── */}
        <div>
          <MasterDataCard bp={bp} onUpdated={load360} />

          {legacyId && (
            <>
              <AddressesCard
                addresses={addresses || []}
                legacyContactId={legacyId}
                onReload={load360}
              />
              <BankingCard
                banking={banking || []}
                legacyContactId={legacyId}
                onReload={load360}
              />
            </>
          )}

          {bp.bp_type === 'organization' && (
            <LinkedPersonsCard
              bpId={id}
              linkedPersons={linked_persons || []}
              onReload={load360}
            />
          )}

          {bp.bp_type === 'person' && (
            <LinkedOrgsCard
              bpId={id}
              linkedOrgs={linked_orgs || []}
              onReload={load360}
            />
          )}
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div>
          {/* AI Proposals */}
          {pending_proposals?.length > 0 && (
            <ProposalsPanel
              proposals={pending_proposals}
              onReviewed={load360}
            />
          )}

          {/* Open Documents */}
          <OpenDocumentsPanel documents={open_documents || []} />
        </div>
      </div>

      {/* Toast notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
