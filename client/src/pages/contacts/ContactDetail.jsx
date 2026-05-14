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
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--card)', flexShrink: 0 }}>
        <TabBtn active={tab === 'details'} onClick={() => setTab('details')}>Details</TabBtn>
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
