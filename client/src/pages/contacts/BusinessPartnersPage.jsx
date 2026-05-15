import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { bpApi } from '../../api/businessPartners';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatABN(abn) {
  if (!abn) return '—';
  const digits = String(abn).replace(/\D/g, '');
  if (digits.length !== 11) return abn;
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
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
const BP_ROLES = [
  { value: 'customer', label: 'Customer' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'both',     label: 'Customer & Supplier' },
  { value: 'lead',     label: 'Lead' },
];

// ── Icons ────────────────────────────────────────────────────────────────────

function SvgIcon({ children, size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
function PlusIcon()     { return <SvgIcon><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></SvgIcon>; }
function SearchIcon()   { return <SvgIcon><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></SvgIcon>; }
function CloseIcon()    { return <SvgIcon size={13}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></SvgIcon>; }
function BuildingIcon() { return <SvgIcon size={13}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></SvgIcon>; }
function PersonIcon()   { return <SvgIcon size={13}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></SvgIcon>; }
function AlertIcon()    { return <SvgIcon size={14}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></SvgIcon>; }
function EmptyIcon()    { return <SvgIcon size={36}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></SvgIcon>; }
function SparkleIcon()  { return <SvgIcon size={12}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></SvgIcon>; }
function ChevronLeft()  { return <SvgIcon size={14}><polyline points="15 18 9 12 15 6"/></SvgIcon>; }
function ChevronRight() { return <SvgIcon size={14}><polyline points="9 18 15 12 9 6"/></SvgIcon>; }

// ── Role / type badge components ─────────────────────────────────────────────

function TypeBadge({ bpType }) {
  if (bpType === 'organization') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
        background: 'rgba(47,127,232,0.12)', color: '#2F7FE8',
        border: '1px solid rgba(47,127,232,0.25)',
      }}>
        <BuildingIcon /> Organization
      </span>
    );
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
      background: 'rgba(147,102,232,0.12)', color: '#9366E8',
      border: '1px solid rgba(147,102,232,0.25)',
    }}>
      <PersonIcon /> Person
    </span>
  );
}

function RoleBadge({ role }) {
  const map = {
    customer: { cls: 'pill-blue',   label: 'Customer' },
    supplier: { cls: 'pill-green',  label: 'Supplier' },
    both:     { cls: 'pill-purple', label: 'Cust & Supp' },
    lead:     { cls: 'pill-orange', label: 'Lead' },
  };
  const { cls = 'pill-grey', label = role || '—' } = map[role] || {};
  return <span className={`pill ${cls}`}>{label}</span>;
}

// ── New Partner Modal ────────────────────────────────────────────────────────

function NewPartnerModal({ onClose, onCreated }) {
  const [step, setStep]     = useState(1); // 1=choose type, 2=fill form
  const [bpType, setBpType] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  // Org search for linking a person to an org
  const [orgSearch, setOrgSearch]   = useState('');
  const [orgResults, setOrgResults] = useState([]);
  const [orgSearching, setOrgSearching] = useState(false);
  const orgSearchTimeout = useRef(null);

  const [form, setForm] = useState({
    // org fields
    legal_entity_name: '',
    trading_name: '',
    bp_role: 'customer',
    abn: '',
    acn: '',
    gst_registered: true,
    website: '',
    industry: '',
    email: '',
    phone: '',
    payment_terms: 'NET30',
    credit_limit: '',
    notes: '',
    // person fields
    first_name: '',
    last_name: '',
    job_title: '',
    mobile: '',
    linked_org_id: '',
  });

  function setF(field, val) {
    setForm(f => ({ ...f, [field]: val }));
    setError('');
  }

  // Debounced org search
  useEffect(() => {
    if (!orgSearch.trim() || bpType !== 'person') {
      setOrgResults([]);
      return;
    }
    clearTimeout(orgSearchTimeout.current);
    orgSearchTimeout.current = setTimeout(async () => {
      setOrgSearching(true);
      try {
        const { data } = await bpApi.list({ search: orgSearch, bp_type: 'organization', limit: 10 });
        setOrgResults(data.data || []);
      } catch { setOrgResults([]); }
      finally { setOrgSearching(false); }
    }, 300);
    return () => clearTimeout(orgSearchTimeout.current);
  }, [orgSearch, bpType]);

  async function handleCreate(e) {
    e.preventDefault();

    // Validate
    if (bpType === 'organization' && !form.legal_entity_name.trim()) {
      setError('Legal Entity Name is required.'); return;
    }
    if (bpType === 'person' && !form.first_name.trim()) {
      setError('First Name is required.'); return;
    }
    if (bpType === 'person' && !form.last_name.trim()) {
      setError('Last Name is required.'); return;
    }

    setSaving(true);
    setError('');

    const payload = {
      bp_type: bpType,
      bp_role: form.bp_role,
      ...(bpType === 'organization' ? {
        legal_entity_name: form.legal_entity_name.trim(),
        trading_name:      form.trading_name.trim()   || null,
        abn:               form.abn.trim()             || null,
        acn:               form.acn.trim()             || null,
        gst_registered:    form.gst_registered,
        website:           form.website.trim()         || null,
        industry:          form.industry               || null,
        email:             form.email.trim()           || null,
        phone:             form.phone.trim()           || null,
        payment_terms:     form.payment_terms          || null,
        credit_limit:      form.credit_limit !== '' ? parseFloat(form.credit_limit) : 0,
        notes:             form.notes.trim()           || null,
      } : {
        first_name: form.first_name.trim(),
        last_name:  form.last_name.trim(),
        job_title:  form.job_title.trim()  || null,
        email:      form.email.trim()      || null,
        mobile:     form.mobile.trim()     || null,
      }),
    };

    try {
      const { data } = await bpApi.create(payload);
      const newId = data.data?.id;

      // If person linked to org, create relationship
      if (bpType === 'person' && form.linked_org_id && newId) {
        try {
          await bpApi.addRelationship(form.linked_org_id, {
            person_bp_id: newId,
            org_bp_id: parseInt(form.linked_org_id),
            role_label: form.job_title.trim() || 'Contact',
          });
        } catch {/* non-fatal */}
      }

      onCreated(newId);
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || 'Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const iS = {
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius, 6px)', padding: '8px 10px',
    fontSize: 13, color: 'var(--text)', width: '100%', boxSizing: 'border-box',
    outline: 'none',
  };
  const lS = { fontSize: 12, color: 'var(--text-sub)', marginBottom: 4, fontWeight: 500, display: 'block' };
  const gS = { marginBottom: 14 };
  const rowS = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--card)', borderRadius: 12, width: '100%', maxWidth: 540,
          maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '18px 22px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>New Business Partner</div>
            <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 2 }}>
              {step === 1 ? 'Step 1 of 2 — Choose type' : `Step 2 of 2 — ${bpType === 'organization' ? 'Organization' : 'Person'} details`}
            </div>
          </div>
          <button
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 6,
              padding: '4px 8px', cursor: 'pointer', color: 'var(--text-sub)',
              display: 'flex', alignItems: 'center',
            }}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, background: 'var(--border)' }}>
          <div style={{
            height: '100%', width: step === 1 ? '50%' : '100%',
            background: 'var(--accent)', transition: 'width 0.3s ease', borderRadius: 2,
          }} />
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>

          {/* ── Step 1: Choose type ── */}
          {step === 1 && (
            <div style={{ padding: '28px 22px' }}>
              <p style={{ margin: '0 0 20px', color: 'var(--text-sub)', fontSize: 13 }}>
                Choose the type of business partner you want to create.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {/* Organization card */}
                <button
                  onClick={() => { setBpType('organization'); setStep(2); }}
                  style={{
                    background: 'var(--bg)', border: '2px solid var(--border)',
                    borderRadius: 10, padding: '22px 18px', cursor: 'pointer',
                    textAlign: 'center', transition: 'all 0.15s',
                    color: 'var(--text)',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = '#2F7FE8';
                    e.currentTarget.style.background = 'rgba(47,127,232,0.05)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.background = 'var(--bg)';
                  }}
                >
                  <div style={{
                    width: 48, height: 48, borderRadius: 12, background: 'rgba(47,127,232,0.12)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 12px',
                  }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2F7FE8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                    </svg>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Organization</div>
                  <div style={{ fontSize: 12, color: 'var(--text-sub)', lineHeight: 1.4 }}>
                    Company, business or legal entity
                  </div>
                </button>

                {/* Person card */}
                <button
                  onClick={() => { setBpType('person'); setStep(2); }}
                  style={{
                    background: 'var(--bg)', border: '2px solid var(--border)',
                    borderRadius: 10, padding: '22px 18px', cursor: 'pointer',
                    textAlign: 'center', transition: 'all 0.15s',
                    color: 'var(--text)',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = '#9366E8';
                    e.currentTarget.style.background = 'rgba(147,102,232,0.05)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.background = 'var(--bg)';
                  }}
                >
                  <div style={{
                    width: 48, height: 48, borderRadius: 12, background: 'rgba(147,102,232,0.12)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 12px',
                  }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9366E8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Person</div>
                  <div style={{ fontSize: 12, color: 'var(--text-sub)', lineHeight: 1.4 }}>
                    Individual contact or representative
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Form ── */}
          {step === 2 && (
            <form id="bp-create-form" onSubmit={handleCreate}>
              <div style={{ padding: '22px 22px 10px' }}>
                {error && (
                  <div style={{
                    background: 'rgba(224,82,82,0.1)', border: '1px solid rgba(224,82,82,0.3)',
                    borderRadius: 6, padding: '10px 12px', marginBottom: 16,
                    fontSize: 13, color: '#E05252', display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <AlertIcon /> {error}
                  </div>
                )}

                {bpType === 'organization' && (
                  <>
                    <div style={gS}>
                      <label style={lS}>Legal Entity Name *</label>
                      <input style={iS} placeholder="e.g. ABC Holdings Pty Ltd" autoFocus
                        value={form.legal_entity_name} onChange={e => setF('legal_entity_name', e.target.value)} />
                    </div>
                    <div style={rowS}>
                      <div>
                        <label style={lS}>Trading Name</label>
                        <input style={iS} placeholder="e.g. ABC Pumps"
                          value={form.trading_name} onChange={e => setF('trading_name', e.target.value)} />
                      </div>
                      <div>
                        <label style={lS}>BP Role *</label>
                        <select style={iS} value={form.bp_role} onChange={e => setF('bp_role', e.target.value)}>
                          {BP_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={rowS}>
                      <div>
                        <label style={lS}>ABN</label>
                        <input style={iS} placeholder="xx xxx xxx xxx"
                          value={form.abn} onChange={e => setF('abn', e.target.value)} />
                      </div>
                      <div>
                        <label style={lS}>ACN</label>
                        <input style={iS} placeholder="xxx xxx xxx"
                          value={form.acn} onChange={e => setF('acn', e.target.value)} />
                      </div>
                    </div>
                    <div style={rowS}>
                      <div>
                        <label style={lS}>Email</label>
                        <input style={iS} type="email" placeholder="accounts@company.com"
                          value={form.email} onChange={e => setF('email', e.target.value)} />
                      </div>
                      <div>
                        <label style={lS}>Phone</label>
                        <input style={iS} type="tel" placeholder="07 3xxx xxxx"
                          value={form.phone} onChange={e => setF('phone', e.target.value)} />
                      </div>
                    </div>
                    <div style={rowS}>
                      <div>
                        <label style={lS}>Website</label>
                        <input style={iS} placeholder="https://..."
                          value={form.website} onChange={e => setF('website', e.target.value)} />
                      </div>
                      <div>
                        <label style={lS}>Industry</label>
                        <select style={iS} value={form.industry} onChange={e => setF('industry', e.target.value)}>
                          <option value="">Select...</option>
                          {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={rowS}>
                      <div>
                        <label style={lS}>Payment Terms</label>
                        <select style={iS} value={form.payment_terms} onChange={e => setF('payment_terms', e.target.value)}>
                          {CREDIT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={lS}>Credit Limit (AUD)</label>
                        <input style={iS} type="number" min="0" step="100" placeholder="0"
                          value={form.credit_limit} onChange={e => setF('credit_limit', e.target.value)} />
                      </div>
                    </div>
                    <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox" id="gst_reg" checked={form.gst_registered}
                        onChange={e => setF('gst_registered', e.target.checked)}
                        style={{ accentColor: 'var(--accent)', width: 15, height: 15 }}
                      />
                      <label htmlFor="gst_reg" style={{ fontSize: 13, cursor: 'pointer' }}>GST Registered</label>
                    </div>
                    <div style={gS}>
                      <label style={lS}>Notes</label>
                      <textarea style={{ ...iS, minHeight: 60, resize: 'vertical' }}
                        placeholder="Internal notes..."
                        value={form.notes} onChange={e => setF('notes', e.target.value)} />
                    </div>
                  </>
                )}

                {bpType === 'person' && (
                  <>
                    <div style={rowS}>
                      <div>
                        <label style={lS}>First Name *</label>
                        <input style={iS} placeholder="John" autoFocus
                          value={form.first_name} onChange={e => setF('first_name', e.target.value)} />
                      </div>
                      <div>
                        <label style={lS}>Last Name *</label>
                        <input style={iS} placeholder="Smith"
                          value={form.last_name} onChange={e => setF('last_name', e.target.value)} />
                      </div>
                    </div>
                    <div style={rowS}>
                      <div>
                        <label style={lS}>Job Title</label>
                        <input style={iS} placeholder="Procurement Manager"
                          value={form.job_title} onChange={e => setF('job_title', e.target.value)} />
                      </div>
                      <div>
                        <label style={lS}>BP Role</label>
                        <select style={iS} value={form.bp_role} onChange={e => setF('bp_role', e.target.value)}>
                          {BP_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={rowS}>
                      <div>
                        <label style={lS}>Email</label>
                        <input style={iS} type="email" placeholder="john@company.com"
                          value={form.email} onChange={e => setF('email', e.target.value)} />
                      </div>
                      <div>
                        <label style={lS}>Mobile</label>
                        <input style={iS} type="tel" placeholder="04xx xxx xxx"
                          value={form.mobile} onChange={e => setF('mobile', e.target.value)} />
                      </div>
                    </div>

                    {/* Link to org */}
                    <div style={gS}>
                      <label style={lS}>Link to Organization (optional)</label>
                      <div style={{ position: 'relative' }}>
                        <input style={iS} placeholder="Search organizations..."
                          value={orgSearch} onChange={e => { setOrgSearch(e.target.value); setF('linked_org_id', ''); }} />
                        {orgSearching && (
                          <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}>
                            <div className="spinner-dark" style={{ width: 14, height: 14 }} />
                          </div>
                        )}
                        {orgResults.length > 0 && !form.linked_org_id && (
                          <div style={{
                            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                            background: 'var(--card)', border: '1px solid var(--border)',
                            borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                            maxHeight: 200, overflowY: 'auto', marginTop: 2,
                          }}>
                            {orgResults.map(org => (
                              <button
                                key={org.id} type="button"
                                onClick={() => {
                                  setF('linked_org_id', String(org.id));
                                  setOrgSearch(org.display_name || org.legal_entity_name);
                                  setOrgResults([]);
                                }}
                                style={{
                                  display: 'block', width: '100%', textAlign: 'left',
                                  padding: '8px 12px', background: 'none', border: 'none',
                                  borderBottom: '1px solid var(--border)', cursor: 'pointer',
                                  fontSize: 13, color: 'var(--text)',
                                }}
                              >
                                {org.display_name || org.legal_entity_name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {form.linked_org_id && (
                        <div style={{ marginTop: 4, fontSize: 12, color: '#2ECC8A' }}>
                          Linked to organization ID #{form.linked_org_id}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 22px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          {step === 2 ? (
            <button
              type="button"
              onClick={() => { setStep(1); setError(''); }}
              style={{
                background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                padding: '7px 14px', cursor: 'pointer', fontSize: 13, color: 'var(--text)',
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              <ChevronLeft /> Back
            </button>
          ) : (
            <button type="button" onClick={onClose} style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 6,
              padding: '7px 14px', cursor: 'pointer', fontSize: 13, color: 'var(--text)',
            }}>
              Cancel
            </button>
          )}

          {step === 2 && (
            <button
              type="submit" form="bp-create-form"
              disabled={saving}
              style={{
                background: 'var(--accent)', color: '#fff', border: 'none',
                borderRadius: 6, padding: '7px 18px', cursor: 'pointer',
                fontSize: 13, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 6,
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? <><span className="spinner" style={{ borderTopColor: '#fff' }} /> Creating...</> : 'Create Partner'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page Component ───────────────────────────────────────────────────────

export default function BusinessPartnersPage() {
  const navigate = useNavigate();

  const [bps,         setBps]         = useState([]);
  const [meta,        setMeta]        = useState({ total: 0, page: 1, pages: 1 });
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [typeFilter,  setTypeFilter]  = useState('');   // '' | 'organization' | 'person'
  const [roleFilter,  setRoleFilter]  = useState('');   // '' | 'customer' | 'supplier' | 'both' | 'lead'
  const [page,        setPage]        = useState(1);
  const [showModal,   setShowModal]   = useState(false);

  const load = useCallback(async (p = page, s = search, t = typeFilter, r = roleFilter) => {
    setLoading(true);
    try {
      const params = { page: p, limit: 50 };
      if (s)  params.search  = s;
      if (t)  params.bp_type = t;
      if (r)  params.role    = r;
      const { data } = await bpApi.list(params);
      setBps(data.data || []);
      setMeta(data.meta || { total: 0, page: 1, pages: 1 });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, search, typeFilter, roleFilter]);

  // Debounced search
  const searchTimeout = useRef(null);
  useEffect(() => {
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setPage(1);
      load(1, search, typeFilter, roleFilter);
    }, 300);
    return () => clearTimeout(searchTimeout.current);
  }, [search, typeFilter, roleFilter]); // eslint-disable-line

  useEffect(() => { load(page, search, typeFilter, roleFilter); }, [page]); // eslint-disable-line

  function handleCreated(id) {
    setShowModal(false);
    if (id) navigate(`/bp/${id}`);
    else load(1, search, typeFilter, roleFilter);
  }

  const TYPE_TABS = [
    { value: '',             label: 'All' },
    { value: 'organization', label: 'Organizations' },
    { value: 'person',       label: 'Persons' },
  ];
  const ROLE_PILLS = [
    { value: 'customer', label: 'Customer', cls: 'pill-blue' },
    { value: 'supplier', label: 'Supplier', cls: 'pill-green' },
    { value: 'both',     label: 'Both',     cls: 'pill-purple' },
    { value: 'lead',     label: 'Lead',     cls: 'pill-orange' },
  ];

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1300, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Business Partners</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-sub)', fontSize: 14 }}>
            {meta.total} partner{meta.total !== 1 ? 's' : ''} in your organisation
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowModal(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <PlusIcon /> New Partner
        </button>
      </div>

      {/* Toolbar */}
      <div style={{ marginBottom: 20 }}>
        {/* Search + type tabs row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          {/* Search */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '7px 12px', flex: 1, maxWidth: 360,
          }}>
            <span style={{ color: 'var(--text-sub)', flexShrink: 0 }}><SearchIcon /></span>
            <input
              style={{ background: 'none', border: 'none', outline: 'none', flex: 1, fontSize: 13, color: 'var(--text)' }}
              placeholder="Search name, email, ABN..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-sub)', padding: 0 }}
              >
                <CloseIcon />
              </button>
            )}
          </div>

          {/* Type tabs */}
          <div style={{
            display: 'flex', background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 8, overflow: 'hidden',
          }}>
            {TYPE_TABS.map(tab => (
              <button
                key={tab.value}
                onClick={() => { setTypeFilter(tab.value); setPage(1); }}
                style={{
                  padding: '7px 14px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                  background: typeFilter === tab.value ? 'var(--accent)' : 'transparent',
                  color: typeFilter === tab.value ? '#fff' : 'var(--text-sub)',
                  borderRight: '1px solid var(--border)',
                  transition: 'all 0.15s',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Role filter pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={() => { setRoleFilter(''); setPage(1); }}
            style={{
              padding: '4px 12px', borderRadius: 20, border: '1px solid var(--border)',
              background: roleFilter === '' ? 'var(--accent)' : 'var(--card)',
              color: roleFilter === '' ? '#fff' : 'var(--text-sub)',
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
            }}
          >
            All Roles
          </button>
          {ROLE_PILLS.map(rp => (
            <button
              key={rp.value}
              onClick={() => { setRoleFilter(rp.value); setPage(1); }}
              className={roleFilter === rp.value ? `pill ${rp.cls}` : ''}
              style={{
                padding: '4px 12px', borderRadius: 20,
                border: roleFilter === rp.value ? 'none' : '1px solid var(--border)',
                background: roleFilter === rp.value ? undefined : 'var(--card)',
                color: roleFilter === rp.value ? undefined : 'var(--text-sub)',
                fontSize: 12, fontWeight: 500, cursor: 'pointer',
              }}
            >
              {rp.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 10, overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 10, padding: '60px 20px', color: 'var(--text-sub)', fontSize: 14,
          }}>
            <div className="spinner-dark" /> Loading business partners...
          </div>
        ) : bps.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 12, padding: '60px 20px', color: 'var(--text-sub)',
          }}>
            <div style={{ color: 'var(--border)' }}><EmptyIcon /></div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>No business partners found</div>
            <div style={{ fontSize: 13 }}>
              {search || typeFilter || roleFilter ? 'Try adjusting your filters.' : 'Create your first business partner to get started.'}
            </div>
            {!search && !typeFilter && !roleFilter && (
              <button className="btn btn-primary" onClick={() => setShowModal(true)}
                style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <PlusIcon /> Create Partner
              </button>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  {['Name', 'Type', 'Role', 'ABN', 'Email', 'Phone', ''].map((h, i) => (
                    <th key={i} style={{
                      padding: '10px 14px', textAlign: 'left', fontSize: 11.5, fontWeight: 600,
                      color: 'var(--text-sub)', borderBottom: '1px solid var(--border)',
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bps.map((bp, idx) => (
                  <tr
                    key={bp.id}
                    onClick={() => navigate(`/bp/${bp.id}`)}
                    style={{
                      cursor: 'pointer',
                      background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-dim, rgba(47,127,232,0.05))'}
                    onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)'}
                  >
                    {/* Name + avatar */}
                    <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                          background: avatarColor(bp.display_name),
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700, color: '#fff',
                        }}>
                          {initials(bp.display_name)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{bp.display_name}</div>
                          {bp.trading_name && bp.trading_name !== bp.display_name && (
                            <div style={{ fontSize: 11, color: 'var(--text-sub)' }}>{bp.trading_name}</div>
                          )}
                          {bp.job_title && (
                            <div style={{ fontSize: 11, color: 'var(--text-sub)' }}>{bp.job_title}</div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Type badge */}
                    <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                      <TypeBadge bpType={bp.bp_type} />
                    </td>

                    {/* Role badge */}
                    <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                      <RoleBadge role={bp.bp_role} />
                    </td>

                    {/* ABN */}
                    <td style={{
                      padding: '11px 14px', borderBottom: '1px solid var(--border)',
                      fontFamily: 'DM Mono, monospace', fontSize: 12.5, whiteSpace: 'nowrap',
                    }}>
                      {bp.bp_type === 'organization' ? formatABN(bp.abn) : '—'}
                    </td>

                    {/* Email */}
                    <td style={{
                      padding: '11px 14px', borderBottom: '1px solid var(--border)',
                      fontSize: 13, color: 'var(--text-sub)', maxWidth: 200,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {bp.email || '—'}
                    </td>

                    {/* Phone */}
                    <td style={{
                      padding: '11px 14px', borderBottom: '1px solid var(--border)',
                      fontSize: 13, color: 'var(--text-sub)', whiteSpace: 'nowrap',
                    }}>
                      {bp.phone || bp.mobile || '—'}
                    </td>

                    {/* AI badge */}
                    <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>
                      {bp.pending_proposals_count > 0 && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                          background: 'rgba(232,155,47,0.15)', color: '#E89B2F',
                          border: '1px solid rgba(232,155,47,0.3)',
                        }}>
                          <SparkleIcon /> {bp.pending_proposals_count} AI
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {meta.pages > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 20,
        }}>
          <button
            className="btn btn-outline btn-sm"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <ChevronLeft /> Previous
          </button>
          <span style={{ fontSize: 13, color: 'var(--text-sub)' }}>
            Page {page} of {meta.pages} ({meta.total} partners)
          </span>
          <button
            className="btn btn-outline btn-sm"
            disabled={page >= meta.pages}
            onClick={() => setPage(p => p + 1)}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            Next <ChevronRight />
          </button>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <NewPartnerModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
