import React, { useEffect, useState } from 'react';
import { settingsApi } from '../../../api/settings';
import styles from './Section.module.css';

const AU_STATES = ['QLD','NSW','VIC','WA','SA','TAS','ACT','NT'];
const WH_TYPES  = [{ v:'main', l:'Main Warehouse' },{ v:'satellite', l:'Satellite/Branch' },{ v:'consignment', l:'Consignment' },{ v:'virtual', l:'Virtual/Transit' }];
const EMPTY = {
  code:'', name:'', warehouse_type:'main',
  address_line1:'', suburb:'', state:'', postcode:'',
  dealer_visible:false, dealer_buffer_qty:0,
  inventory_account_id:'', use_separate_account:false,
};

export default function WarehouseSettings() {
  const [warehouses, setWarehouses] = useState([]);
  const [accounts,   setAccounts]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [editing,    setEditing]    = useState(null);
  const [form,       setForm]       = useState(EMPTY);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');

  async function load() {
    setLoading(true);
    try {
      const [whRes, coaRes] = await Promise.all([
        settingsApi.listWarehouses(),
        settingsApi.listChartOfAccounts({ type: 'asset' }),
      ]);
      setWarehouses(whRes.data.data);
      setAccounts(coaRes.data.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        dealer_buffer_qty:    parseInt(form.dealer_buffer_qty) || 0,
        inventory_account_id: form.inventory_account_id ? parseInt(form.inventory_account_id) : null,
      };
      if (editing === 'new') {
        await settingsApi.createWarehouse(payload);
      } else {
        await settingsApi.updateWarehouse(editing, payload);
      }
      setEditing(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(w) {
    setForm({
      code:                  w.code,
      name:                  w.name,
      warehouse_type:        w.warehouse_type,
      address_line1:         w.address_line1         || '',
      suburb:                w.suburb                || '',
      state:                 w.state                 || '',
      postcode:              w.postcode              || '',
      dealer_visible:        !!w.dealer_visible,
      dealer_buffer_qty:     w.dealer_buffer_qty     || 0,
      inventory_account_id:  w.inventory_account_id  || '',
      use_separate_account:  !!w.use_separate_account,
    });
    setEditing(w.id);
    setError('');
  }

  if (loading) return <div className={styles.loading}><div className="spinner-dark" /> Loading...</div>;

  return (
    <div>
      <div className={styles.infoBox}>
        Warehouses define physical stock locations. Each warehouse can have zones, aisles, bays and bins for directed
        put-away and picking. Set an <strong>inventory account</strong> to link stock value movements to your chart of
        accounts. Dealer-visible warehouses appear in the dealer portal's available stock.
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {warehouses.length === 0 && editing !== 'new' && (
          <div className={styles.empty}>No warehouses configured. Add at least one before receiving stock.</div>
        )}

        {warehouses.map(w => (
          <div key={w.id}>
            <div className={styles.itemCard}>
              <div className={styles.itemLeft}>
                <div className={styles.itemTitle}>
                  <span style={{fontFamily:'DM Mono', fontSize:13, background:'var(--accent-dim)', color:'var(--accent)', padding:'1px 8px', borderRadius:4}}>{w.code}</span>
                  {w.name}
                  {w.dealer_visible && <span className="pill pill-green">Dealer visible</span>}
                  {!w.is_active && <span className="pill pill-grey">Inactive</span>}
                </div>
                <div className={styles.itemDesc}>{WH_TYPES.find(t => t.v === w.warehouse_type)?.l || w.warehouse_type}</div>
                {(w.suburb || w.state) && <div className={styles.itemMeta}>{[w.address_line1, w.suburb, w.state].filter(Boolean).join(', ')}</div>}
                <div className={styles.itemMeta}>
                  {w.bin_count || 0} bins configured
                  {w.inventory_account_code && (
                    <span style={{marginLeft:12}}>
                      Inventory account: <strong>{w.inventory_account_code}</strong> {w.inventory_account_name}
                      {w.use_separate_account && <span className="pill pill-blue" style={{marginLeft:6}}>Separate account</span>}
                    </span>
                  )}
                </div>
              </div>
              <div className={styles.itemActions}>
                <button className="btn btn-outline btn-sm" onClick={() => editing === w.id ? setEditing(null) : startEdit(w)}>
                  {editing === w.id ? 'Cancel' : 'Edit'}
                </button>
              </div>
            </div>

            {editing === w.id && (
              <WarehouseForm form={form} set={set} accounts={accounts} error={error} saving={saving} onSave={handleSave} onCancel={() => setEditing(null)} isNew={false} />
            )}
          </div>
        ))}

        {editing === 'new' && (
          <WarehouseForm form={form} set={set} accounts={accounts} error={error} saving={saving} onSave={handleSave} onCancel={() => setEditing(null)} isNew={true} />
        )}

        {editing !== 'new' && (
          <button className={styles.addBtn} onClick={() => { setForm(EMPTY); setEditing('new'); setError(''); }}>
            <PlusIcon /> Add Warehouse
          </button>
        )}
      </div>
    </div>
  );
}

function WarehouseForm({ form, set, accounts, error, saving, onSave, onCancel, isNew }) {
  return (
    <form className={styles.editForm} onSubmit={onSave}>
      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.editFormRow}>
        <div className="form-group" style={{flex:1}}>
          <label className="form-label">Code * (e.g. MAIN)</label>
          <input className="form-input" value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} placeholder="MAIN" maxLength={20} disabled={!isNew} />
        </div>
        <div className="form-group" style={{flex:2}}>
          <label className="form-label">Name *</label>
          <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Main Warehouse" />
        </div>
        <div className="form-group" style={{flex:1}}>
          <label className="form-label">Type</label>
          <select className="form-input" value={form.warehouse_type} onChange={e => set('warehouse_type', e.target.value)}>
            {WH_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </div>
      </div>

      <div className={styles.editFormRow}>
        <div className="form-group" style={{flex:2}}>
          <label className="form-label">Address</label>
          <input className="form-input" value={form.address_line1} onChange={e => set('address_line1', e.target.value)} placeholder="123 Industrial Ave" />
        </div>
        <div className="form-group" style={{flex:1}}>
          <label className="form-label">Suburb</label>
          <input className="form-input" value={form.suburb} onChange={e => set('suburb', e.target.value)} placeholder="Acacia Ridge" />
        </div>
        <div className="form-group" style={{flex:1}}>
          <label className="form-label">State</label>
          <select className="form-input" value={form.state} onChange={e => set('state', e.target.value)}>
            <option value="">Select...</option>
            {AU_STATES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group" style={{flex:1}}>
          <label className="form-label">Postcode</label>
          <input className="form-input" value={form.postcode} onChange={e => set('postcode', e.target.value)} maxLength={10} />
        </div>
      </div>

      <div className={styles.editFormRow}>
        <div className="form-group" style={{flex:2}}>
          <label className="form-label">Inventory Account</label>
          <select className="form-input" value={form.inventory_account_id} onChange={e => set('inventory_account_id', e.target.value)}>
            <option value="">— Not linked —</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>
            ))}
          </select>
          <div style={{fontSize:11, color:'var(--text-muted)', marginTop:3}}>
            Stock value movements will post to this account. Set once in Chart of Accounts under Assets.
          </div>
        </div>
        <div className="form-group" style={{flex:1, justifyContent:'flex-end'}}>
          <label className="form-label" style={{opacity:0}}>toggle</label>
          <label style={{display:'flex',alignItems:'center',gap:6,fontSize:13,cursor:'pointer',marginTop:4}}>
            <input type="checkbox" checked={!!form.use_separate_account} onChange={e => set('use_separate_account', e.target.checked)} style={{accentColor:'var(--accent)'}} />
            Use separate account per warehouse
          </label>
          <div style={{fontSize:11, color:'var(--text-muted)', marginTop:3}}>
            When enabled, this warehouse's inventory posts separately from the default account.
          </div>
        </div>
      </div>

      <div className={styles.editFormRow} style={{gap:20, alignItems:'center'}}>
        <label style={{display:'flex',alignItems:'center',gap:6,fontSize:13,cursor:'pointer'}}>
          <input type="checkbox" checked={!!form.dealer_visible} onChange={e => set('dealer_visible', e.target.checked)} style={{accentColor:'var(--accent)'}} />
          Visible in dealer portal
        </label>
        {form.dealer_visible && (
          <div className="form-group" style={{flex:0}}>
            <label className="form-label">Dealer buffer qty</label>
            <input className="form-input" type="number" min={0} value={form.dealer_buffer_qty} onChange={e => set('dealer_buffer_qty', e.target.value)} style={{width:80}} />
          </div>
        )}
      </div>

      <div className={styles.editFormActions}>
        <button type="button" className="btn btn-outline btn-sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
          {saving ? 'Saving...' : isNew ? 'Create warehouse' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

function PlusIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
