import React, { useState, useEffect } from 'react';
import { contactsApi } from '../../api/contacts';
import styles from './ContactModal.module.css';

const CREDIT_TERMS = ['NET7','NET14','NET30','NET45','NET60','NET90','COD','PREPAID'];

export default function ContactModal({ contact, onSaved, onClose }) {
  const isEdit = !!contact;

  const [form, setForm] = useState({
    contact_type:   'customer',
    full_name:      '',
    email:          '',
    phone:          '',
    mobile:         '',
    abn:            '',
    company_id:     '',
    credit_limit:   '0',
    credit_terms:   'NET30',
    gst_registered: true,
    is_overseas:    false,
    notes:          '',
    // Address fields
    address_line1: '',
    address_line2: '',
    suburb:        '',
    state:         '',
    postcode:      '',
  });

  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [tab,      setTab]      = useState('details'); // details | address | financial

  // Populate form when editing
  useEffect(() => {
    if (contact) {
      setForm({
        contact_type:   contact.contact_type   || 'customer',
        full_name:      contact.full_name       || '',
        email:          contact.email           || '',
        phone:          contact.phone           || '',
        mobile:         contact.mobile          || '',
        abn:            contact.abn             || '',
        company_id:     contact.company_id      || '',
        credit_limit:   String(contact.credit_limit ?? 0),
        credit_terms:   contact.credit_terms    || 'NET30',
        gst_registered: contact.gst_registered !== false,
        is_overseas:    contact.is_overseas     === true,
        notes:          contact.notes           || '',
        address_line1:  contact.addresses?.[0]?.address_line1 || '',
        address_line2:  contact.addresses?.[0]?.address_line2 || '',
        suburb:         contact.addresses?.[0]?.suburb        || '',
        state:          contact.addresses?.[0]?.state         || '',
        postcode:       contact.addresses?.[0]?.postcode      || '',
      });
    }
  }, [contact]);

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }));
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.full_name.trim()) { setError('Name is required.'); return; }

    setSaving(true);
    setError('');

    const payload = {
      contact_type:   form.contact_type,
      full_name:      form.full_name.trim(),
      email:          form.email.trim() || null,
      phone:          form.phone.trim() || null,
      mobile:         form.mobile.trim() || null,
      abn:            form.abn.trim() || null,
      company_id:     form.company_id ? parseInt(form.company_id) : null,
      credit_limit:   parseFloat(form.credit_limit) || 0,
      credit_terms:   form.credit_terms,
      gst_registered: form.gst_registered,
      is_overseas:    form.is_overseas,
      notes:          form.notes.trim() || null,
      address: {
        address_type:  'billing',
        address_line1: form.address_line1.trim() || null,
        address_line2: form.address_line2.trim() || null,
        suburb:        form.suburb.trim()        || null,
        state:         form.state.trim()         || null,
        postcode:      form.postcode.trim()       || null,
      },
    };

    try {
      if (isEdit) {
        await contactsApi.update(contact.id, payload);
      } else {
        await contactsApi.create(payload);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const TABS = [
    { key: 'details',   label: 'Details'    },
    { key: 'address',   label: 'Address'    },
    { key: 'financial', label: 'Financial'  },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-head">
          <span className="modal-title">
            {isEdit ? `Edit: ${contact.full_name}` : 'New Contact'}
          </span>
          <button className="btn btn-outline btn-sm btn-icon" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          {TABS.map(t => (
            <button
              key={t.key}
              className={[styles.tab, tab === t.key ? styles.tabActive : ''].join(' ')}
              onClick={() => setTab(t.key)}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.body}>

            {error && (
              <div className={styles.errorBox}>
                <AlertIcon />
                {error}
              </div>
            )}

            {/* ── DETAILS TAB ── */}
            {tab === 'details' && (
              <>
                <div className={styles.row}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Contact type *</label>
                    <select className="form-input" value={form.contact_type} onChange={e => set('contact_type', e.target.value)}>
                      <option value="customer">Customer</option>
                      <option value="supplier">Supplier</option>
                      <option value="both">Customer & Supplier</option>
                      <option value="dealer">Dealer</option>
                      <option value="employee">Employee</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>

                <div className={styles.row}>
                  <div className="form-group" style={{ flex: 2 }}>
                    <label className="form-label">Full name / Business name *</label>
                    <input
                      className="form-input"
                      placeholder="e.g. John Smith or ABC Cleaning Pty Ltd"
                      value={form.full_name}
                      onChange={e => set('full_name', e.target.value)}
                      autoFocus
                    />
                  </div>
                </div>

                <div className={styles.row}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Email</label>
                    <input className="form-input" type="email" placeholder="contact@company.com.au" value={form.email} onChange={e => set('email', e.target.value)} />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Phone</label>
                    <input className="form-input" type="tel" placeholder="07 3xxx xxxx" value={form.phone} onChange={e => set('phone', e.target.value)} />
                  </div>
                </div>

                <div className={styles.row}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Mobile</label>
                    <input className="form-input" type="tel" placeholder="04xx xxx xxx" value={form.mobile} onChange={e => set('mobile', e.target.value)} />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">ABN</label>
                    <input className="form-input" placeholder="xx xxx xxx xxx" value={form.abn} onChange={e => set('abn', e.target.value)} />
                  </div>
                </div>

                <div className={styles.row}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Notes</label>
                    <textarea
                      className="form-input"
                      rows={3}
                      style={{ resize: 'vertical' }}
                      placeholder="Internal notes..."
                      value={form.notes}
                      onChange={e => set('notes', e.target.value)}
                    />
                  </div>
                </div>

                <div className={styles.checkboxRow}>
                  <label className={styles.checkLabel}>
                    <input type="checkbox" checked={form.gst_registered} onChange={e => set('gst_registered', e.target.checked)} />
                    GST Registered
                  </label>
                  <label className={styles.checkLabel}>
                    <input type="checkbox" checked={form.is_overseas} onChange={e => set('is_overseas', e.target.checked)} />
                    Overseas contact
                  </label>
                </div>
              </>
            )}

            {/* ── ADDRESS TAB ── */}
            {tab === 'address' && (
              <>
                <div className="form-group">
                  <label className="form-label">Address Line 1</label>
                  <input className="form-input" placeholder="123 Example Street" value={form.address_line1} onChange={e => set('address_line1', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Address Line 2</label>
                  <input className="form-input" placeholder="Suite 4, Level 2..." value={form.address_line2} onChange={e => set('address_line2', e.target.value)} />
                </div>
                <div className={styles.row}>
                  <div className="form-group" style={{ flex: 2 }}>
                    <label className="form-label">Suburb</label>
                    <input className="form-input" placeholder="Brisbane City" value={form.suburb} onChange={e => set('suburb', e.target.value)} />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">State</label>
                    <select className="form-input" value={form.state} onChange={e => set('state', e.target.value)}>
                      <option value="">Select...</option>
                      {['QLD','NSW','VIC','WA','SA','TAS','ACT','NT'].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Postcode</label>
                    <input className="form-input" placeholder="4000" maxLength={10} value={form.postcode} onChange={e => set('postcode', e.target.value)} />
                  </div>
                </div>
              </>
            )}

            {/* ── FINANCIAL TAB ── */}
            {tab === 'financial' && (
              <>
                <div className={styles.row}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Credit limit (AUD)</label>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="100"
                      placeholder="0"
                      value={form.credit_limit}
                      onChange={e => set('credit_limit', e.target.value)}
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Payment terms</label>
                    <select className="form-input" value={form.credit_terms} onChange={e => set('credit_terms', e.target.value)}>
                      {CREDIT_TERMS.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div className={styles.infoBox}>
                  To place a credit hold on this contact, use the Edit button from the contact detail panel after saving.
                </div>
              </>
            )}

          </div>

          {/* Footer */}
          <div className="modal-foot">
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || !form.full_name.trim()}>
              {saving ? <><span className="spinner" /> Saving...</> : isEdit ? 'Save changes' : 'Create contact'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CloseIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>; }
function AlertIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{flexShrink:0}}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>; }
