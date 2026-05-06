import React, { useEffect, useState } from 'react';
import { settingsApi } from '../../../api/settings';
import styles from './Section.module.css';

const AU_STATES = ['QLD','NSW','VIC','WA','SA','TAS','ACT','NT'];
const BAS_FREQ  = [{ v:'quarterly', l:'Quarterly' },{ v:'monthly', l:'Monthly' },{ v:'annual', l:'Annual' }];
const BAS_METH  = [{ v:'accrual', l:'Accrual (invoice)' },{ v:'cash', l:'Cash basis' }];
const MONTHS    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function OrgSettings() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState('');

  useEffect(() => {
    settingsApi.getOrg()
      .then(({ data: r }) => setData(r.data))
      .catch(() => setError('Failed to load settings.'))
      .finally(() => setLoading(false));
  }, []);

  function set(field, value) {
    setData(d => ({ ...d, [field]: value }));
    setSaved(false);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setError(''); setSaved(false);
    try {
      await settingsApi.updateOrg(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className={styles.loading}><div className="spinner-dark" /> Loading...</div>;

  return (
    <form onSubmit={handleSave}>
      {error  && <div className={styles.errorBox}>{error}</div>}
      {saved  && <div className={styles.successBox}>Settings saved successfully.</div>}

      {/* Business details */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Business Details</div>
        <div className={styles.grid2}>
          <Field label="Trading name *">
            <input className="form-input" value={data?.name || ''} onChange={e => set('name', e.target.value)} placeholder="Spitwater Australia" />
          </Field>
          <Field label="Legal name">
            <input className="form-input" value={data?.legal_name || ''} onChange={e => set('legal_name', e.target.value)} placeholder="Spitwater Australia Pty Ltd" />
          </Field>
          <Field label="ABN">
            <input className="form-input" value={data?.abn || ''} onChange={e => set('abn', e.target.value)} placeholder="xx xxx xxx xxx" maxLength={14} />
          </Field>
          <Field label="ACN">
            <input className="form-input" value={data?.acn || ''} onChange={e => set('acn', e.target.value)} placeholder="xxx xxx xxx" maxLength={11} />
          </Field>
          <Field label="Phone">
            <input className="form-input" value={data?.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="07 3xxx xxxx" />
          </Field>
          <Field label="Email">
            <input className="form-input" type="email" value={data?.email || ''} onChange={e => set('email', e.target.value)} placeholder="info@company.com.au" />
          </Field>
          <Field label="Website">
            <input className="form-input" value={data?.website || ''} onChange={e => set('website', e.target.value)} placeholder="www.spitwater.com.au" />
          </Field>
        </div>
      </div>

      {/* Address */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Business Address</div>
        <div className={styles.grid2}>
          <Field label="Address line 1" span2>
            <input className="form-input" value={data?.address_line1 || ''} onChange={e => set('address_line1', e.target.value)} placeholder="123 Example Street" />
          </Field>
          <Field label="Address line 2" span2>
            <input className="form-input" value={data?.address_line2 || ''} onChange={e => set('address_line2', e.target.value)} placeholder="Unit 4, Level 2" />
          </Field>
          <Field label="Suburb">
            <input className="form-input" value={data?.suburb || ''} onChange={e => set('suburb', e.target.value)} placeholder="Brisbane City" />
          </Field>
          <Field label="State">
            <select className="form-input" value={data?.state || ''} onChange={e => set('state', e.target.value)}>
              <option value="">Select...</option>
              {AU_STATES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Postcode">
            <input className="form-input" value={data?.postcode || ''} onChange={e => set('postcode', e.target.value)} placeholder="4000" maxLength={10} />
          </Field>
        </div>
      </div>

      {/* Financial year & GST */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Financial Year & GST</div>
        <div className={styles.grid2}>
          <Field label="Financial year starts">
            <select className="form-input" value={data?.financial_year_start_month || 7} onChange={e => set('financial_year_start_month', parseInt(e.target.value))}>
              {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m} ({i+1 < 10 ? '0'+(i+1) : i+1})</option>)}
            </select>
          </Field>
          <Field label="BAS frequency">
            <select className="form-input" value={data?.bas_frequency || 'quarterly'} onChange={e => set('bas_frequency', e.target.value)}>
              {BAS_FREQ.map(f => <option key={f.v} value={f.v}>{f.l}</option>)}
            </select>
          </Field>
          <Field label="Accounting method">
            <select className="form-input" value={data?.bas_method || 'accrual'} onChange={e => set('bas_method', e.target.value)}>
              {BAS_METH.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          </Field>
          <Field label="GST registered">
            <select className="form-input" value={data?.gst_registered ? '1' : '0'} onChange={e => set('gst_registered', e.target.value === '1')}>
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </Field>
          <Field label="Default invoice due (days)">
            <input className="form-input" type="number" min="0" max="365" value={data?.invoice_due_days || 30} onChange={e => set('invoice_due_days', parseInt(e.target.value))} />
          </Field>
          <Field label="Default quote expiry (days)">
            <input className="form-input" type="number" min="0" max="365" value={data?.quote_expiry_days || 30} onChange={e => set('quote_expiry_days', parseInt(e.target.value))} />
          </Field>
        </div>
      </div>

      {/* Bank details */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Bank Details</div>
        <p className={styles.sectionNote}>These print on invoices for direct bank transfers.</p>
        <div className={styles.grid2}>
          <Field label="Bank name">
            <input className="form-input" value={data?.bank_name || ''} onChange={e => set('bank_name', e.target.value)} placeholder="Commonwealth Bank" />
          </Field>
          <Field label="Account name">
            <input className="form-input" value={data?.bank_account_name || ''} onChange={e => set('bank_account_name', e.target.value)} placeholder="Spitwater Australia Pty Ltd" />
          </Field>
          <Field label="BSB">
            <input className="form-input" value={data?.bank_bsb || ''} onChange={e => set('bank_bsb', e.target.value)} placeholder="06x-xxx" maxLength={10} />
          </Field>
          <Field label="Account number">
            <input className="form-input" value={data?.bank_account_number || ''} onChange={e => set('bank_account_number', e.target.value)} placeholder="xxxx xxxx" maxLength={20} />
          </Field>
        </div>
      </div>

      <div className={styles.saveRow}>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? <><span className="spinner" /> Saving...</> : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children, span2 }) {
  return (
    <div className={span2 ? styles.span2 : ''} style={{ display:'flex', flexDirection:'column', gap:6 }}>
      <label className="form-label">{label}</label>
      {children}
    </div>
  );
}
