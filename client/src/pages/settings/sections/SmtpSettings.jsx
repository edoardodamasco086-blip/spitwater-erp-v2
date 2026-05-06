import React, { useEffect, useState } from 'react';
import { settingsApi } from '../../../api/settings';
import styles from './Section.module.css';

const ENCRYPTION = ['tls', 'ssl', 'none'];
const DEFAULT_PORTS = { tls: 587, ssl: 465, none: 25 };

const EMPTY = {
  profile_name: '', is_default: false,
  smtp_host: '', smtp_port: 587, smtp_username: '', smtp_password: '',
  encryption_type: 'tls', from_email: '', from_name: '', reply_to_email: '',
  max_per_hour: '', max_per_day: '',
};

export default function SmtpSettings() {
  const [profiles, setProfiles] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState(null);  // null | 'new' | id
  const [form,     setForm]     = useState(EMPTY);
  const [saving,   setSaving]   = useState(false);
  const [testing,  setTesting]  = useState(null);
  const [testResult, setTestResult] = useState({});
  const [error,    setError]    = useState('');

  async function load() {
    setLoading(true);
    try {
      const { data } = await settingsApi.listSmtp();
      setProfiles(data.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function startNew() {
    setForm(EMPTY);
    setEditing('new');
    setError('');
    setTestResult({});
  }

  function startEdit(p) {
    setForm({
      profile_name:    p.profile_name    || '',
      is_default:      p.is_default      || false,
      smtp_host:       p.smtp_host       || '',
      smtp_port:       p.smtp_port       || 587,
      smtp_username:   p.smtp_username   || '',
      smtp_password:   '',  // never pre-fill password
      encryption_type: p.encryption_type || 'tls',
      from_email:      p.from_email      || '',
      from_name:       p.from_name       || '',
      reply_to_email:  p.reply_to_email  || '',
      max_per_hour:    p.max_per_hour    || '',
      max_per_day:     p.max_per_day     || '',
    });
    setEditing(p.id);
    setError('');
    setTestResult({});
  }

  function set(field, value) {
    setForm(f => {
      const next = { ...f, [field]: value };
      if (field === 'encryption_type') next.smtp_port = DEFAULT_PORTS[value] || 587;
      return next;
    });
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.smtp_host || !form.smtp_username || !form.from_email) {
      setError('Host, username and from email are required.');
      return;
    }
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        smtp_port:    parseInt(form.smtp_port)  || 587,
        max_per_hour: form.max_per_hour ? parseInt(form.max_per_hour) : null,
        max_per_day:  form.max_per_day  ? parseInt(form.max_per_day)  : null,
      };
      if (editing === 'new') {
        await settingsApi.createSmtp(payload);
      } else {
        // Don't send empty password — backend uses COALESCE
        if (!payload.smtp_password) delete payload.smtp_password;
        await settingsApi.updateSmtp(editing, payload);
      }
      setEditing(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(id) {
    setTesting(id);
    setTestResult(r => ({ ...r, [id]: null }));
    try {
      const { data } = await settingsApi.testSmtp(id);
      setTestResult(r => ({ ...r, [id]: { ok: data.success, msg: data.message } }));
      load(); // refresh last_test fields
    } catch (err) {
      setTestResult(r => ({ ...r, [id]: { ok: false, msg: err.response?.data?.message || 'Test failed.' } }));
    } finally {
      setTesting(null);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this SMTP profile?')) return;
    try {
      await settingsApi.deleteSmtp(id);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Cannot delete — this may be the default profile.');
    }
  }

  return (
    <div>
      <div className={styles.infoBox}>
        SMTP profiles define how the ERP sends email. Set one as default and it will be used for all outbound mail. You can add multiple profiles and route specific email types (invoices, service jobs, etc.) through different accounts.
      </div>

      {loading ? (
        <div className={styles.loading}><div className="spinner-dark" /> Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {profiles.length === 0 && editing !== 'new' && (
            <div className={styles.empty}>
              No SMTP profiles configured yet.<br />Add one to enable email sending.
            </div>
          )}

          {profiles.map(p => (
            <div key={p.id}>
              <div className={[styles.itemCard, p.is_default ? styles.defaultCard : ''].join(' ')}>
                <div className={styles.itemLeft}>
                  <div className={styles.itemTitle}>
                    <div className={[styles.statusDot, p.last_test_success === true ? styles.dotGreen : p.last_test_success === false ? styles.dotRed : styles.dotGrey].join(' ')} />
                    {p.profile_name}
                    {p.is_default && <span className="pill pill-blue">Default</span>}
                  </div>
                  <div className={styles.itemMeta}>{p.smtp_host}:{p.smtp_port} · {p.encryption_type.toUpperCase()}</div>
                  <div className={styles.itemDesc}>From: {p.from_name} &lt;{p.from_email}&gt;</div>
                  {testResult[p.id] && (
                    <div style={{ fontSize: 12, marginTop: 4, color: testResult[p.id].ok ? 'var(--green)' : 'var(--red)' }}>
                      {testResult[p.id].msg}
                    </div>
                  )}
                </div>
                <div className={styles.itemActions}>
                  <button className="btn btn-outline btn-sm" onClick={() => handleTest(p.id)} disabled={testing === p.id}>
                    {testing === p.id ? <><span className="spinner-dark" style={{width:12,height:12}} /> Testing...</> : 'Test'}
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => editing === p.id ? setEditing(null) : startEdit(p)}>
                    {editing === p.id ? 'Cancel' : 'Edit'}
                  </button>
                  {!p.is_default && (
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(p.id)}>Delete</button>
                  )}
                </div>
              </div>

              {editing === p.id && (
                <SmtpForm
                  form={form} set={set} error={error}
                  saving={saving} onSave={handleSave}
                  onCancel={() => setEditing(null)} isNew={false}
                />
              )}
            </div>
          ))}

          {editing === 'new' && (
            <SmtpForm
              form={form} set={set} error={error}
              saving={saving} onSave={handleSave}
              onCancel={() => setEditing(null)} isNew={true}
            />
          )}

          {editing !== 'new' && (
            <button className={styles.addBtn} onClick={startNew}>
              <PlusIcon /> Add SMTP Profile
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SmtpForm({ form, set, error, saving, onSave, onCancel, isNew }) {
  return (
    <form className={styles.editForm} onSubmit={onSave}>
      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.editFormRow}>
        <div className="form-group" style={{flex:2}}>
          <label className="form-label">Profile name</label>
          <input className="form-input" value={form.profile_name} onChange={e => set('profile_name', e.target.value)} placeholder="Main SMTP" />
        </div>
        <div className="form-group" style={{flex:1}}>
          <label className="form-label">Set as default</label>
          <select className="form-input" value={form.is_default ? '1' : '0'} onChange={e => set('is_default', e.target.value === '1')}>
            <option value="0">No</option>
            <option value="1">Yes</option>
          </select>
        </div>
      </div>

      <div className={styles.editFormRow}>
        <div className="form-group" style={{flex:3}}>
          <label className="form-label">SMTP host *</label>
          <input className="form-input" value={form.smtp_host} onChange={e => set('smtp_host', e.target.value)} placeholder="smtp.office365.com" />
        </div>
        <div className="form-group" style={{flex:1}}>
          <label className="form-label">Port</label>
          <input className="form-input" type="number" value={form.smtp_port} onChange={e => set('smtp_port', e.target.value)} />
        </div>
        <div className="form-group" style={{flex:1}}>
          <label className="form-label">Encryption</label>
          <select className="form-input" value={form.encryption_type} onChange={e => set('encryption_type', e.target.value)}>
            {ENCRYPTION.map(e => <option key={e} value={e}>{e.toUpperCase()}</option>)}
          </select>
        </div>
      </div>

      <div className={styles.editFormRow}>
        <div className="form-group" style={{flex:1}}>
          <label className="form-label">Username *</label>
          <input className="form-input" value={form.smtp_username} onChange={e => set('smtp_username', e.target.value)} placeholder="user@domain.com" autoComplete="off" />
        </div>
        <div className="form-group" style={{flex:1}}>
          <label className="form-label">{isNew ? 'Password *' : 'Password (leave blank to keep)'}</label>
          <input className="form-input" type="password" value={form.smtp_password} onChange={e => set('smtp_password', e.target.value)} placeholder="••••••••" autoComplete="new-password" />
        </div>
      </div>

      <div className={styles.editFormRow}>
        <div className="form-group" style={{flex:1}}>
          <label className="form-label">From email *</label>
          <input className="form-input" type="email" value={form.from_email} onChange={e => set('from_email', e.target.value)} placeholder="accounts@company.com.au" />
        </div>
        <div className="form-group" style={{flex:1}}>
          <label className="form-label">From name</label>
          <input className="form-input" value={form.from_name} onChange={e => set('from_name', e.target.value)} placeholder="Spitwater Australia" />
        </div>
      </div>

      <div className={styles.editFormRow}>
        <div className="form-group" style={{flex:1}}>
          <label className="form-label">Reply-to email</label>
          <input className="form-input" type="email" value={form.reply_to_email} onChange={e => set('reply_to_email', e.target.value)} placeholder="info@company.com.au" />
        </div>
        <div className="form-group" style={{flex:1}}>
          <label className="form-label">Max per hour</label>
          <input className="form-input" type="number" value={form.max_per_hour} onChange={e => set('max_per_hour', e.target.value)} placeholder="Unlimited" />
        </div>
        <div className="form-group" style={{flex:1}}>
          <label className="form-label">Max per day</label>
          <input className="form-input" type="number" value={form.max_per_day} onChange={e => set('max_per_day', e.target.value)} placeholder="Unlimited" />
        </div>
      </div>

      <div className={styles.editFormActions}>
        <button type="button" className="btn btn-outline btn-sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
          {saving ? <><span className="spinner" /> Saving...</> : isNew ? 'Create profile' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

function PlusIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
