import React, { useEffect, useState } from 'react';
import { contactsApi } from '../../api/contacts';
import { getAccessToken } from '../../api/client';
import CustomerPriceSheet from './CustomerPriceSheet';
import styles from './ContactDetail.module.css';

function formatCurrency(val) {
  if (!val && val !== 0) return '-';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(val);
}

const AVATAR_COLORS = ['#2F7FE8','#2ECC8A','#E89B2F','#9366E8','#E05252','#3BBCD4','#E84F8C'];
function avatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}
function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

export default function ContactDetail({ contact, onEdit, onClose, onVoided }) {
  const [tab,        setTab]        = useState('details');
  const [voiding,    setVoiding]    = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [showVoid,   setShowVoid]   = useState(false);

  const billingAddr = contact.addresses?.find(a => a.address_type === 'billing') || contact.addresses?.[0];

  async function handleVoid() {
    if (!voidReason.trim()) return;
    setVoiding(true);
    try {
      await contactsApi.void(contact.id, voidReason);
      onVoided();
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to archive contact.');
    } finally {
      setVoiding(false);
    }
  }

  const showPricingTab = contact.contact_type === 'customer' || contact.contact_type === 'both';

  return (
    <div className={styles.panel}>
      {/* Panel header */}
      <div className={styles.panelHead}>
        <span className={styles.panelTitle}>Contact Details</span>
        <div className={styles.panelActions}>
          <button className="btn btn-outline btn-sm" onClick={onEdit}>Edit</button>
          <button className={styles.closeBtn} onClick={onClose}><CloseIcon /></button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--card)', flexShrink: 0, overflowX: 'auto' }}>
        <TabBtn active={tab === 'details'}   onClick={() => setTab('details')}>Details</TabBtn>
        <TabBtn active={tab === 'addresses'} onClick={() => setTab('addresses')}>Addresses</TabBtn>
        <TabBtn active={tab === 'banking'}   onClick={() => setTab('banking')}>Banking</TabBtn>
        {showPricingTab && (
          <TabBtn active={tab === 'pricing'} onClick={() => setTab('pricing')}>Pricing</TabBtn>
        )}
      </div>

      <div className={styles.panelBody}>
        {tab === 'details' && (
          <>
            {/* Avatar + name */}
            <div className={styles.contactHero}>
              <div className={styles.avatar} style={{ background: avatarColor(contact.full_name) }}>
                {initials(contact.full_name)}
              </div>
              <div>
                <div className={styles.contactName}>{contact.full_name}</div>
                {contact.company_name && (
                  <div className={styles.contactCompany}>{contact.company_name}</div>
                )}
                <div className={styles.badges}>
                  <span className={['pill', contact.contact_type === 'customer' ? 'pill-blue' : contact.contact_type === 'supplier' ? 'pill-green' : 'pill-purple'].join(' ')}>
                    {contact.contact_type ? contact.contact_type.charAt(0).toUpperCase() + contact.contact_type.slice(1) : '-'}
                  </span>
                  {contact.credit_hold && <span className="pill pill-red">Credit Hold</span>}
                  {!contact.is_active  && <span className="pill pill-grey">Inactive</span>}
                </div>
              </div>
            </div>

            {/* Contact info */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Contact Information</div>
              <div className={styles.fieldGrid}>
                <Field label="Email"  value={contact.email  || '-'} mono />
                <Field label="Phone"  value={contact.phone  || '-'} mono />
                <Field label="Mobile" value={contact.mobile || '-'} mono />
                <Field label="ABN"    value={contact.abn    || '-'} mono />
              </div>
            </div>

            {/* Address */}
            {billingAddr && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Billing Address</div>
                <div className={styles.address}>
                  {billingAddr.address_line1 && <div>{billingAddr.address_line1}</div>}
                  {billingAddr.address_line2 && <div>{billingAddr.address_line2}</div>}
                  {(billingAddr.suburb || billingAddr.state || billingAddr.postcode) && (
                    <div>{[billingAddr.suburb, billingAddr.state, billingAddr.postcode].filter(Boolean).join(' ')}</div>
                  )}
                  {billingAddr.country && billingAddr.country !== 'Australia' && <div>{billingAddr.country}</div>}
                </div>
              </div>
            )}

            {/* Financial */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Financial</div>
              <div className={styles.fieldGrid}>
                <Field label="Credit limit"   value={formatCurrency(contact.credit_limit)} />
                <Field label="Payment terms"  value={contact.credit_terms || '-'} />
                <Field label="GST registered" value={contact.gst_registered ? 'Yes' : 'No'} />
                <Field label="Overseas"       value={contact.is_overseas ? 'Yes' : 'No'} />
              </div>
            </div>

            {/* Notes */}
            {contact.notes && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Notes</div>
                <div className={styles.notes}>{contact.notes}</div>
              </div>
            )}

            {/* Void section */}
            {!showVoid ? (
              <button className={styles.voidBtn} onClick={() => setShowVoid(true)}>
                Archive this contact
              </button>
            ) : (
              <div className={styles.voidBox}>
                <div className={styles.voidTitle}>Archive contact</div>
                <p className={styles.voidSub}>This contact will be hidden from lists but all history is preserved.</p>
                <input
                  className="form-input"
                  placeholder="Reason for archiving..."
                  value={voidReason}
                  onChange={e => setVoidReason(e.target.value)}
                />
                <div className={styles.voidActions}>
                  <button className="btn btn-outline btn-sm" onClick={() => setShowVoid(false)}>Cancel</button>
                  <button className="btn btn-danger btn-sm" disabled={voiding || !voidReason.trim()} onClick={handleVoid}>
                    {voiding ? 'Archiving...' : 'Confirm archive'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'addresses' && <AddressesTab contact={contact} />}
        {tab === 'banking'   && <BankingTab   contact={contact} />}

        {tab === 'pricing' && showPricingTab && (
          <PricingTab contact={contact} />
        )}
      </div>
    </div>
  );
}

// ── Pricing tab ───────────────────────────────────────────────
function PricingTab({ contact }) {
  const [priceLists,   setPriceLists]   = useState([]);
  const [selectedPlId, setSelectedPlId] = useState(contact.price_list_id || '');
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [showSheet,    setShowSheet]    = useState(false);

  useEffect(() => {
    fetch('/api/price-lists', {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    }).then(r => r.json()).then(d => setPriceLists(d.data || [])).catch(() => {});
  }, []);

  async function saveAssignment() {
    setSaving(true); setSaved(false);
    try {
      if (selectedPlId) {
        await fetch(`/api/price-lists/${selectedPlId}/contacts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAccessToken()}` },
          body: JSON.stringify({ contactId: contact.id }),
        });
      } else if (contact.price_list_id) {
        await fetch(`/api/price-lists/${contact.price_list_id}/contacts/${contact.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${getAccessToken()}` },
        });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch { /* silently fail */ }
    finally { setSaving(false); }
  }

  const effectivePlId = selectedPlId || null;

  return (
    <>
      <div className={styles.section} style={{ paddingTop: 0, borderTop: 'none' }}>
        <div className={styles.sectionTitle}>Assigned Price List</div>
        {contact.price_list_name && !selectedPlId && (
          <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 6 }}>
            Currently: <strong>{contact.price_list_name}</strong>
          </div>
        )}
        {!contact.price_list_name && !selectedPlId && (
          <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 6 }}>
            No list assigned — will use Retail RRP
          </div>
        )}
        <select
          className="form-input"
          value={selectedPlId}
          onChange={e => setSelectedPlId(e.target.value)}
          style={{ fontSize: 13, marginBottom: 8 }}
        >
          <option value="">— None (Retail RRP) —</option>
          {priceLists.filter(pl => pl.is_active).map(pl => (
            <option key={pl.id} value={pl.id}>{pl.name}</option>
          ))}
        </select>
        <button
          className="btn btn-primary btn-sm"
          onClick={saveAssignment}
          disabled={saving}
          style={{ width: '100%' }}
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Price List'}
        </button>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Price Sheet</div>
        <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 10 }}>
          View all product prices for this customer — with their discounts, volume breaks and GST applied.
        </div>
        <button
          className="btn btn-outline"
          style={{ width: '100%', fontSize: 13 }}
          onClick={() => setShowSheet(true)}
        >
          Open Price Sheet ↗
        </button>
      </div>

      {showSheet && (
        <CustomerPriceSheet
          contact={contact}
          priceListId={effectivePlId}
          onClose={() => setShowSheet(false)}
        />
      )}
    </>
  );
}

// ── helpers ───────────────────────────────────────────────────
function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '9px 16px', background: 'none', border: 'none', cursor: 'pointer',
      borderBottom: active ? '2px solid var(--accent, #2F7FE8)' : '2px solid transparent',
      color: active ? 'var(--accent, #2F7FE8)' : 'var(--text-sub)',
      fontSize: 13, fontFamily: 'inherit', fontWeight: active ? 500 : 400,
      marginBottom: -1,
    }}>
      {children}
    </button>
  );
}

function Field({ label, value, mono }) {
  return (
    <div>
      <div className={styles.fieldLabel}>{label}</div>
      <div className={[styles.fieldValue, mono ? styles.mono : ''].join(' ')}>{value}</div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}

// ── Address Roles Tab ─────────────────────────────────────────
const ADDR_ROLES = [
  { value: 'sold_to',  label: 'Sold-To' },
  { value: 'ship_to',  label: 'Ship-To' },
  { value: 'bill_to',  label: 'Bill-To' },
  { value: 'payer',    label: 'Payer'   },
  { value: 'remit_to', label: 'Remit-To' },
];
const ROLE_COLORS = { sold_to: '#2F7FE8', ship_to: '#2ECC8A', bill_to: '#E89B2F', payer: '#9366E8', remit_to: '#3BBCD4' };
const EMPTY_ADDR = { address_role: 'ship_to', label: '', address_line1: '', address_line2: '', suburb: '', state: '', postcode: '', country: 'Australia', is_default: false };

function AddressesTab({ contact }) {
  const [addresses, setAddresses] = useState([]);
  const [showForm,  setShowForm]  = useState(false);
  const [editId,    setEditId]    = useState(null);
  const [form,      setForm]      = useState(EMPTY_ADDR);
  const [saving,    setSaving]    = useState(false);

  const auth = { Authorization: `Bearer ${getAccessToken()}` };
  const base = `/api/bp/addresses/${contact.id}`;

  async function load() {
    const r = await fetch(base, { headers: auth });
    const d = await r.json();
    setAddresses(d.data || []);
  }

  useEffect(() => { load(); }, [contact.id]);

  async function handleSave(e) {
    e.preventDefault(); setSaving(true);
    const method = editId ? 'PATCH' : 'POST';
    const url    = editId ? `${base}/${editId}` : base;
    await fetch(url, { method, headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setSaving(false); setShowForm(false); setEditId(null); setForm(EMPTY_ADDR);
    load();
  }

  async function handleDelete(id) {
    if (!confirm('Delete this address?')) return;
    await fetch(`${base}/${id}`, { method: 'DELETE', headers: auth });
    load();
  }

  function startEdit(a) {
    setForm({ address_role: a.address_role || 'ship_to', label: a.label || '', address_line1: a.address_line1 || '', address_line2: a.address_line2 || '', suburb: a.suburb || '', state: a.state || '', postcode: a.postcode || '', country: a.country || 'Australia', is_default: !!a.is_default });
    setEditId(a.id); setShowForm(true);
  }

  const inp = { width: '100%', boxSizing: 'border-box', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', fontSize: 12.5, fontFamily: 'inherit' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-sub)', fontWeight: 600 }}>Partner Addresses</div>
        <button className="btn btn-primary btn-sm" onClick={() => { setShowForm(true); setEditId(null); setForm(EMPTY_ADDR); }}>+ Add</button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 3 }}>Role *</div>
              <select style={inp} value={form.address_role} onChange={e => setForm(f => ({ ...f, address_role: e.target.value }))}>
                {ADDR_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 3 }}>Label</div>
              <input style={inp} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Head Office" />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 3 }}>Street *</div>
            <input style={inp} required value={form.address_line1} onChange={e => setForm(f => ({ ...f, address_line1: e.target.value }))} placeholder="Address line 1" />
          </div>
          <input style={inp} value={form.address_line2} onChange={e => setForm(f => ({ ...f, address_line2: e.target.value }))} placeholder="Address line 2 (optional)" />
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 7 }}>
            <input style={inp} value={form.suburb}   onChange={e => setForm(f => ({ ...f, suburb: e.target.value }))}   placeholder="Suburb" />
            <input style={inp} value={form.state}    onChange={e => setForm(f => ({ ...f, state: e.target.value }))}    placeholder="State" maxLength={4} />
            <input style={inp} value={form.postcode} onChange={e => setForm(f => ({ ...f, postcode: e.target.value }))} placeholder="Post" maxLength={4} />
          </div>
          <input style={inp} value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="Country" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.is_default} onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))} style={{ accentColor: 'var(--accent)' }} />
            Default for this role
          </label>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { setShowForm(false); setEditId(null); }}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : editId ? 'Update' : 'Add'}</button>
          </div>
        </form>
      )}

      {addresses.length === 0 && !showForm && (
        <div style={{ fontSize: 13, color: 'var(--text-sub)', textAlign: 'center', padding: '20px 0' }}>No addresses yet.</div>
      )}

      {addresses.map(a => (
        <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 7, padding: '9px 11px', background: 'var(--card)', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ background: ROLE_COLORS[a.address_role] || '#aaa', color: '#fff', borderRadius: 4, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>
                {ADDR_ROLES.find(r => r.value === a.address_role)?.label || a.address_role}
              </span>
              {a.is_default && <span style={{ fontSize: 10, color: 'var(--accent)' }}>Default</span>}
              {a.label && <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>{a.label}</span>}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-outline btn-sm" style={{ padding: '2px 7px', fontSize: 11 }} onClick={() => startEdit(a)}>Edit</button>
              <button className="btn btn-danger btn-sm"  style={{ padding: '2px 7px', fontSize: 11 }} onClick={() => handleDelete(a.id)}>✕</button>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text)' }}>
            {a.address_line1}{a.address_line2 ? `, ${a.address_line2}` : ''}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
            {[a.suburb, a.state, a.postcode].filter(Boolean).join(' ')}{a.country && a.country !== 'Australia' ? `, ${a.country}` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Banking Tab ───────────────────────────────────────────────
const EMPTY_BANK = { account_name: '', bank_name: '', bsb: '', account_number: '', swift_code: '', iban: '', currency_code: 'AUD', is_default: false, notes: '' };

function BankingTab({ contact }) {
  const [accounts, setAccounts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editId,   setEditId]   = useState(null);
  const [form,     setForm]     = useState(EMPTY_BANK);
  const [saving,   setSaving]   = useState(false);

  const auth = { Authorization: `Bearer ${getAccessToken()}` };
  const base = `/api/bp/banking/${contact.id}`;

  async function load() {
    const r = await fetch(base, { headers: auth });
    const d = await r.json();
    setAccounts(d.data || []);
  }

  useEffect(() => { load(); }, [contact.id]);

  async function handleSave(e) {
    e.preventDefault(); setSaving(true);
    const method = editId ? 'PATCH' : 'POST';
    const url    = editId ? `${base}/${editId}` : base;
    await fetch(url, { method, headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setSaving(false); setShowForm(false); setEditId(null); setForm(EMPTY_BANK);
    load();
  }

  async function handleDelete(id) {
    if (!confirm('Delete this bank account?')) return;
    await fetch(`${base}/${id}`, { method: 'DELETE', headers: auth });
    load();
  }

  function startEdit(a) {
    setForm({ account_name: a.account_name || '', bank_name: a.bank_name || '', bsb: a.bsb || '', account_number: a.account_number || '', swift_code: a.swift_code || '', iban: a.iban || '', currency_code: a.currency_code || 'AUD', is_default: !!a.is_default, notes: a.notes || '' });
    setEditId(a.id); setShowForm(true);
  }

  const inp = { width: '100%', boxSizing: 'border-box', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', fontSize: 12.5, fontFamily: 'inherit' };
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-sub)', fontWeight: 600 }}>Bank Accounts</div>
        <button className="btn btn-primary btn-sm" onClick={() => { setShowForm(true); setEditId(null); setForm(EMPTY_BANK); }}>+ Add</button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 3 }}>Account Name *</div>
            <input style={inp} required value={form.account_name} onChange={f('account_name')} placeholder="e.g. Trading Account" />
          </div>
          <input style={inp} value={form.bank_name} onChange={f('bank_name')} placeholder="Bank name (e.g. ANZ, CBA)" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 3 }}>BSB</div>
              <input style={{ ...inp, fontFamily: 'DM Mono, monospace' }} value={form.bsb} onChange={f('bsb')} placeholder="000-000" maxLength={7} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 3 }}>Account #</div>
              <input style={{ ...inp, fontFamily: 'DM Mono, monospace' }} value={form.account_number} onChange={f('account_number')} placeholder="XXXXXXXXXX" maxLength={20} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            <input style={inp} value={form.swift_code} onChange={f('swift_code')} placeholder="SWIFT (international)" maxLength={11} />
            <select style={inp} value={form.currency_code} onChange={f('currency_code')}>
              {['AUD','USD','EUR','GBP','NZD','SGD'].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <input style={inp} value={form.iban} onChange={f('iban')} placeholder="IBAN (if applicable)" maxLength={34} />
          <input style={inp} value={form.notes} onChange={f('notes')} placeholder="Notes" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.is_default} onChange={e => setForm(p => ({ ...p, is_default: e.target.checked }))} style={{ accentColor: 'var(--accent)' }} />
            Default account
          </label>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { setShowForm(false); setEditId(null); }}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : editId ? 'Update' : 'Add'}</button>
          </div>
        </form>
      )}

      {accounts.length === 0 && !showForm && (
        <div style={{ fontSize: 13, color: 'var(--text-sub)', textAlign: 'center', padding: '20px 0' }}>No bank accounts on file.</div>
      )}

      {accounts.map(a => (
        <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 7, padding: '9px 11px', background: 'var(--card)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{a.account_name}</div>
              {a.bank_name && <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>{a.bank_name}</div>}
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {a.is_default && <span style={{ fontSize: 10, color: 'var(--accent)' }}>Default</span>}
              <button className="btn btn-outline btn-sm" style={{ padding: '2px 7px', fontSize: 11 }} onClick={() => startEdit(a)}>Edit</button>
              <button className="btn btn-danger btn-sm"  style={{ padding: '2px 7px', fontSize: 11 }} onClick={() => handleDelete(a.id)}>✕</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 12, fontFamily: 'DM Mono, monospace', color: 'var(--text)' }}>
            {a.bsb && <span>BSB: {a.bsb}</span>}
            {a.account_number && <span>Acct: {a.account_number}</span>}
            {a.currency_code && a.currency_code !== 'AUD' && <span>{a.currency_code}</span>}
          </div>
          {a.swift_code && <div style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 2 }}>SWIFT: {a.swift_code}</div>}
        </div>
      ))}
    </div>
  );
}
