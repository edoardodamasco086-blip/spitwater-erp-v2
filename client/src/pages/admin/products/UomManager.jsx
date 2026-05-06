import React, { useEffect, useState } from 'react';
import { productsApi } from '../../../api/products';
import { useAuth } from '../../../context/AuthContext';
import styles from './AdminProducts.module.css';

const DEFAULT_UOMS = [
  { code: 'EA',  name: 'Each',        is_base: true  },
  { code: 'CTN', name: 'Carton',      is_base: false },
  { code: 'PK',  name: 'Pack',        is_base: false },
  { code: 'PR',  name: 'Pair',        is_base: false },
  { code: 'SET', name: 'Set',         is_base: false },
  { code: 'KG',  name: 'Kilogram',    is_base: true  },
  { code: 'G',   name: 'Gram',        is_base: false },
  { code: 'L',   name: 'Litre',       is_base: true  },
  { code: 'ML',  name: 'Millilitre',  is_base: false },
  { code: 'M',   name: 'Metre',       is_base: true  },
  { code: 'CM',  name: 'Centimetre',  is_base: false },
  { code: 'MM',  name: 'Millimetre',  is_base: false },
  { code: 'HR',  name: 'Hour',        is_base: true  },
  { code: 'MIN', name: 'Minute',      is_base: false },
  { code: 'DAY', name: 'Day',         is_base: false },
];

export default function UomManager() {
  const { isAdmin } = useAuth();
  const [uoms,    setUoms]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form,    setForm]    = useState({ code: '', name: '', is_base: false });
  const [saving,  setSaving]  = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  async function load() {
    setLoading(true);
    try {
      // Fetch all including inactive
      const { data } = await productsApi.uom();
      setUoms(data.data || []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleSave(e) {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) { setError('Code and name are required.'); return; }
    setSaving(true); setError('');
    try {
      await productsApi.createUom({
        code:    form.code.toUpperCase().trim(),
        name:    form.name.trim(),
        is_base: form.is_base,
      });
      setSuccess(`UOM "${form.code.toUpperCase()}" created.`);
      setEditing(null);
      setForm({ code: '', name: '', is_base: false });
      setTimeout(() => setSuccess(''), 3000);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed. The code may already exist.');
    } finally { setSaving(false); }
  }

  async function handleSeedDefaults() {
    if (!confirm(`This will create ${DEFAULT_UOMS.length} standard units of measure. Existing codes will be skipped. Continue?`)) return;
    setSeeding(true);
    let created = 0, skipped = 0;
    for (const uom of DEFAULT_UOMS) {
      try {
        await productsApi.createUom(uom);
        created++;
      } catch { skipped++; }
    }
    setSuccess(`Created ${created} UOMs. ${skipped > 0 ? `${skipped} already existed.` : ''}`);
    setTimeout(() => setSuccess(''), 5000);
    setSeeding(false);
    load();
  }

  if (!isAdmin) {
    return (
      <div className={styles.page}>
        <div className={styles.stateBlock}>You don't have permission to manage units of measure.</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Units of Measure</h1>
          <p className={styles.sub}>Define the units used for products — Each, Carton, Kilogram, Litre, Hour, etc.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {uoms.length === 0 && (
            <button className="btn btn-outline" onClick={handleSeedDefaults} disabled={seeding}>
              {seeding ? 'Creating...' : 'Seed standard UOMs'}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => { setEditing('new'); setError(''); setForm({ code: '', name: '', is_base: false }); }}>
            <PlusIcon /> New UOM
          </button>
        </div>
      </div>

      {success && <div className={styles.successBox}>{success}</div>}

      {/* Create form */}
      {editing === 'new' && (
        <div className={styles.formCard}>
          <div className={styles.formCardTitle}>New Unit of Measure</div>
          {error && <div className={styles.errorBox}>{error}</div>}
          <form onSubmit={handleSave}>
            <div className={styles.formRow}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Code * (e.g. EA, KG, L)</label>
                <input className="form-input" autoFocus value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="EA" maxLength={10} style={{ fontFamily: 'DM Mono', textTransform: 'uppercase' }} />
              </div>
              <div className="form-group" style={{ flex: 3 }}>
                <label className="form-label">Name *</label>
                <input className="form-input" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Each" />
              </div>
              <div className="form-group" style={{ flex: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 2 }}>
                <label className={styles.checkLabel}>
                  <input type="checkbox" checked={form.is_base}
                    onChange={e => setForm(f => ({ ...f, is_base: e.target.checked }))}
                    style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />
                  Base unit
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? 'Creating...' : 'Create UOM'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* UOM list */}
      <div className={styles.treeCard}>
        {loading ? (
          <div className={styles.stateBlock}><div className="spinner-dark" /><span>Loading...</span></div>
        ) : uoms.length === 0 ? (
          <div className={styles.stateBlock}>
            <UomIcon size={32} />
            <p>No units of measure configured yet.</p>
            <p style={{ fontSize: 12, color: 'var(--text-sub)', maxWidth: 360, textAlign: 'center' }}>
              You need at least one UOM before creating products. Click "Seed standard UOMs" to create the full standard set in one click.
            </p>
            <button className="btn btn-primary btn-sm" onClick={handleSeedDefaults} disabled={seeding}>
              {seeding ? 'Creating...' : 'Seed standard UOMs'}
            </button>
          </div>
        ) : (
          <table className={styles.fieldTable}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Base unit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {uoms.map(u => (
                <tr key={u.id}>
                  <td>
                    <span style={{ fontFamily: 'DM Mono', fontSize: 13, fontWeight: 700, background: 'var(--accent-dim)', color: 'var(--accent)', padding: '2px 10px', borderRadius: 4 }}>
                      {u.code}
                    </span>
                  </td>
                  <td style={{ fontWeight: 500 }}>{u.name}</td>
                  <td className={styles.centerCell}>
                    {u.is_base ? <CheckIcon /> : <span style={{ color: 'var(--text-sub)' }}>—</span>}
                  </td>
                  <td>
                    <span className={`pill ${u.is_active ? 'pill-green' : 'pill-grey'}`}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Quick seed list */}
      {uoms.length > 0 && uoms.length < DEFAULT_UOMS.length && (
        <div style={{ fontSize: 13, color: 'var(--text-sub)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>Missing some standard UOMs?</span>
          <button className="btn btn-outline btn-sm" onClick={handleSeedDefaults} disabled={seeding}>
            {seeding ? 'Creating...' : 'Seed missing defaults'}
          </button>
        </div>
      )}
    </div>
  );
}

function SvgIcon({ children, size = 15 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}
function PlusIcon()          { return <SvgIcon><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></SvgIcon>; }
function CheckIcon()         { return <SvgIcon size={14}><polyline points="20 6 9 17 4 12"/></SvgIcon>; }
function UomIcon({ size=15}) { return <SvgIcon size={size}><path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M14 14h7v7h-7z"/><path d="M3 14h7v7H3z"/></SvgIcon>; }
