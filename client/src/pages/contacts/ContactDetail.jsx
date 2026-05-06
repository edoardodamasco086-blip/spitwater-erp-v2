import React, { useState } from 'react';
import { contactsApi } from '../../api/contacts';
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

  return (
    <div className={styles.panel}>
      {/* Panel header */}
      <div className={styles.panelHead}>
        <span className={styles.panelTitle}>Contact Details</span>
        <div className={styles.panelActions}>
          <button className="btn btn-outline btn-sm" onClick={onEdit}>Edit</button>
          <button className={styles.closeBtn} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className={styles.panelBody}>
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
                <div>
                  {[billingAddr.suburb, billingAddr.state, billingAddr.postcode].filter(Boolean).join(' ')}
                </div>
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
          <button
            className={styles.voidBtn}
            onClick={() => setShowVoid(true)}
          >
            Archive this contact
          </button>
        ) : (
          <div className={styles.voidBox}>
            <div className={styles.voidTitle}>Archive contact</div>
            <p className={styles.voidSub}>
              This contact will be hidden from lists but all history is preserved.
            </p>
            <input
              className="form-input"
              placeholder="Reason for archiving..."
              value={voidReason}
              onChange={e => setVoidReason(e.target.value)}
            />
            <div className={styles.voidActions}>
              <button className="btn btn-outline btn-sm" onClick={() => setShowVoid(false)}>Cancel</button>
              <button
                className="btn btn-danger btn-sm"
                disabled={voiding || !voidReason.trim()}
                onClick={handleVoid}
              >
                {voiding ? 'Archiving...' : 'Confirm archive'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
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
