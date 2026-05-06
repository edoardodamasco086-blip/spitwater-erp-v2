import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import styles from './CustomerTiersPage.module.css'; // reuse same layout styles

const API = (path, opts = {}) =>
  fetch(`/api/price-lists${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
    ...opts,
  }).then(r => r.json());

const TYPE_LABELS = { retail: 'Retail', wholesale: 'Wholesale', dealer: 'Dealer', trade: 'Trade', cost: 'Cost', special: 'Special' };
const TYPE_COLORS = { retail: 'pill-blue', wholesale: 'pill-green', dealer: 'pill-purple', trade: 'pill-orange', cost: 'pill-grey', special: 'pill-red' };
const CURRENCIES  = ['AUD','USD','EUR','GBP','JPY','CNY','NZD','SGD'];
const TYPES       = Object.keys(TYPE_LABELS);

const EMPTY = { name: '', price_list_type: 'retail', currency_code: 'AUD', is_default: false, is_tax_inclusive: false, description: '', valid_from: '', valid_to: '' };

function initials(name) { return (name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function avatarColor(name) { const c=['#2F7FE8','#2ECC8A','#E89B2F','#9366E8','#E05252']; return c[(name||'').charCodeAt(0)%c.length]; }

export default function PriceListsPage() {
  const { isAdmin } = useAuth();
  const [lists,     setLists]     = useState([]);
  const [contacts,  setContacts]  = useState([]);
  const [selected,  setSelected]  = useState(null);
  const [members,   setMembers]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [editId,    setEditId]    = useState(null);
  const [form,      setForm]      = useState(EMPTY);
  const [saving,    setSaving]    = useState(false);
  const [addCid,    setAddCid]    = useState('');
  const [activeTab, setActiveTab] = useState('info'); // info | contacts
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');

  async function loadLists() {
    setLoading(true);
    try { const { data } = await API('/'); setLists(data || []); }
    finally { setLoading(false); }
  }

  async function loadContacts() {
    const r = await fetch('/api/contacts?limit=500', { headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` } });
    const d = await r.json();
    setContacts(d.data || []);
  }

  useEffect(() => { loadLists(); loadContacts(); }, []);

  async function selectList(pl) {
    setSelected(pl); setActiveTab('info'); setAddCid(''); setError('');
    const { data } = await API(`/${pl.id}/contacts`);
    setMembers(data || []);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form, valid_from: form.valid_from || null, valid_to: form.valid_to || null };
      if (editId) {
        await API(`/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        setSuccess('Price list updated.');
      } else {
        await API('/', { method: 'POST', body: JSON.stringify(payload) });
        setSuccess('Price list created.');
      }
      setShowForm(false); setEditId(null); setForm(EMPTY);
      setTimeout(() => setSuccess(''), 3000);
      await loadLists();
    } catch (err) { setError('Save failed.'); }
    finally { setSaving(false); }
  }

  async function handleDelete(pl) {
    if (!confirm(`Deactivate price list "${pl.name}"?`)) return;
    const res = await API(`/${pl.id}`, { method: 'DELETE' });
    if (!res.success) { alert(res.error); return; }
    if (selected?.id === pl.id) { setSelected(null); setMembers([]); }
    await loadLists();
  }

  async function handleAssign() {
    if (!addCid || !selected) return;
    await API(`/${selected.id}/contacts`, { method: 'POST', body: JSON.stringify({ contactId: parseInt(addCid) }) });
    setAddCid('');
    const { data } = await API(`/${selected.id}/contacts`);
    setMembers(data || []);
    await loadLists();
  }

  async function handleRemoveContact(cid) {
    await API(`/${selected.id}/contacts/${cid}`, { method: 'DELETE' });
    const { data } = await API(`/${selected.id}/contacts`);
    setMembers(data || []);
    await loadLists();
  }

  function startEdit(pl) {
    setForm({
      name: pl.name, price_list_type: pl.price_list_type, currency_code: pl.currency_code,
      is_default: !!pl.is_default, is_tax_inclusive: !!pl.is_tax_inclusive,
      description: pl.description || '',
      valid_from: pl.valid_from ? pl.valid_from.slice(0,10) : '',
      valid_to:   pl.valid_to   ? pl.valid_to.slice(0,10)   : '',
    });
    setEditId(pl.id); setShowForm(true); setError('');
  }

  if (!isAdmin) return <div className={styles.page}><div className={styles.empty}>Access denied.</div></div>;

  const unassigned = contacts.filter(c => !members.find(m => m.id === c.id));
  const activeLists = lists.filter(l => l.is_active);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Price Lists</h1>
          <p className={styles.sub}>Define your price lists (Retail, Wholesale, Dealer…) and assign them to contacts. Product prices per list are set in the product Pricing tab.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setShowForm(true); setEditId(null); setForm(EMPTY); setError(''); }}>
          <PlusIcon /> New Price List
        </button>
      </div>

      {error   && <div className={styles.errorBox}>{error}</div>}
      {success && <div className={styles.successBox}>{success}</div>}

      {/* Create / Edit form */}
      {showForm && (
        <form className={styles.createCard} onSubmit={handleSave}>
          <div className={styles.createTitle}>{editId ? 'Edit Price List' : 'New Price List'}</div>
          <div className={styles.createRow}>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Name *</label>
              <input className="form-input" autoFocus value={form.name}
                onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="e.g. Retail AUD, Dealer AU" />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Type</label>
              <select className="form-input" value={form.price_list_type}
                onChange={e => setForm(f => ({...f, price_list_type: e.target.value}))}>
                {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Currency</label>
              <select className="form-input" value={form.currency_code}
                onChange={e => setForm(f => ({...f, currency_code: e.target.value}))}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className={styles.createRow}>
            <div className="form-group" style={{ flex: 3 }}>
              <label className="form-label">Description</label>
              <input className="form-input" value={form.description}
                onChange={e => setForm(f => ({...f, description: e.target.value}))} placeholder="Optional notes" />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Valid from</label>
              <input className="form-input" type="date" value={form.valid_from}
                onChange={e => setForm(f => ({...f, valid_from: e.target.value}))} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Valid to</label>
              <input className="form-input" type="date" value={form.valid_to}
                onChange={e => setForm(f => ({...f, valid_to: e.target.value}))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 20, marginBottom: 14 }}>
            {[['is_default','Set as default price list'],['is_tax_inclusive','Prices are tax inclusive (GST)']].map(([field, label]) => (
              <label key={field} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!form[field]} onChange={e => setForm(f => ({...f, [field]: e.target.checked}))}
                  style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />
                {label}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { setShowForm(false); setEditId(null); }}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !form.name.trim()}>
              {saving ? 'Saving...' : editId ? 'Save changes' : 'Create price list'}
            </button>
          </div>
        </form>
      )}

      <div className={styles.body}>
        {/* Price list sidebar */}
        <div className={styles.tierList}>
          <div className={styles.tierListTitle}>Price Lists ({activeLists.length})</div>
          {loading ? (
            <div style={{ padding: 20, color: 'var(--text-sub)' }}>Loading...</div>
          ) : activeLists.length === 0 ? (
            <div className={styles.empty}>No price lists yet.</div>
          ) : activeLists.map(pl => (
            <div key={pl.id}
              className={[styles.tierItem, selected?.id === pl.id ? styles.tierSelected : ''].join(' ')}
              onClick={() => selectList(pl)}>
              <div>
                <div className={styles.tierName}>
                  {pl.name}
                  {pl.is_default && <span className="pill pill-blue" style={{ marginLeft: 6, fontSize: 9 }}>DEFAULT</span>}
                </div>
                <div className={styles.tierMeta}>
                  <span className={`pill ${TYPE_COLORS[pl.price_list_type] || 'pill-grey'}`} style={{ fontSize: 10, padding: '1px 6px' }}>
                    {TYPE_LABELS[pl.price_list_type]}
                  </span>
                  {' '}{pl.currency_code}
                  {' · '}{pl.product_count || 0} products
                  {' · '}{pl.contact_count || 0} contacts
                </div>
              </div>
              <div className={styles.tierActions} onClick={e => e.stopPropagation()}>
                <button className="btn btn-outline btn-sm" onClick={() => startEdit(pl)}>Edit</button>
                {!pl.is_default && (
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(pl)}>Del</button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Right panel */}
        {selected ? (
          <div className={styles.rightPanel}>
            <div className={styles.panelHeader}>
              <div>
                <div className={styles.panelTitle}>{selected.name}</div>
                <div className={styles.panelDesc}>
                  <span className={`pill ${TYPE_COLORS[selected.price_list_type] || 'pill-grey'}`}>{TYPE_LABELS[selected.price_list_type]}</span>
                  {' '}{selected.currency_code}
                  {selected.is_tax_inclusive && ' · Tax inclusive'}
                  {selected.description && ` · ${selected.description}`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-sub)' }}>
                  <div>{selected.product_count || 0} products</div>
                  <div>{members.length} contacts</div>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 16px', flexShrink: 0 }}>
              {[['info','Details'],['contacts','Contacts']].map(([key, label]) => (
                <button key={key}
                  style={{ padding: '10px 16px', background: 'none', border: 'none', borderBottom: activeTab===key ? '2px solid var(--accent)' : '2px solid transparent', color: activeTab===key ? 'var(--accent)' : 'var(--text-sub)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, marginBottom: -1, fontWeight: activeTab===key ? 500 : 400 }}
                  onClick={() => setActiveTab(key)}>
                  {label}
                </button>
              ))}
            </div>

            <div className={styles.panelBody}>
              {activeTab === 'info' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  {[
                    ['Type',        TYPE_LABELS[selected.price_list_type]],
                    ['Currency',    selected.currency_code],
                    ['Tax incl.',   selected.is_tax_inclusive ? 'Yes' : 'No'],
                    ['Default',     selected.is_default ? 'Yes' : 'No'],
                    ['Valid from',  selected.valid_from ? new Date(selected.valid_from).toLocaleDateString('en-AU') : '—'],
                    ['Valid to',    selected.valid_to   ? new Date(selected.valid_to).toLocaleDateString('en-AU')   : '—'],
                    ['Products',    selected.product_count || 0],
                    ['Contacts',    members.length],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', marginBottom: 3 }}>{label}</div>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{val}</div>
                    </div>
                  ))}
                  {selected.description && (
                    <div style={{ gridColumn: '1/-1' }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', marginBottom: 3 }}>Description</div>
                      <div style={{ fontSize: 13.5 }}>{selected.description}</div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'contacts' && (
                <>
                  <div className={styles.addRow}>
                    <select className="form-input" style={{ flex: 1 }} value={addCid} onChange={e => setAddCid(e.target.value)}>
                      <option value="">Assign a contact to this price list...</option>
                      {unassigned.map(c => <option key={c.id} value={c.id}>{c.full_name} {c.email ? `(${c.email})` : ''}</option>)}
                    </select>
                    <button className="btn btn-primary btn-sm" disabled={!addCid} onClick={handleAssign}>Assign</button>
                  </div>
                  {members.length === 0 ? (
                    <div className={styles.empty} style={{ padding: '32px 20px' }}>No contacts assigned yet.</div>
                  ) : (
                    <div className={styles.memberList}>
                      {members.map(m => (
                        <div key={m.id} className={styles.memberRow}>
                          <div className={styles.memberAvatar} style={{ background: avatarColor(m.full_name) }}>{initials(m.full_name)}</div>
                          <div className={styles.memberInfo}>
                            <div className={styles.memberName}>{m.full_name}</div>
                            <div className={styles.memberSub}>{m.email || m.contact_type || ''}</div>
                          </div>
                          <button className="btn btn-outline btn-sm" onClick={() => handleRemoveContact(m.id)}>Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.noSelection}>
            <ListIcon />
            <p>Select a price list to view details and manage contacts.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ic(p) { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p}</svg>; }
function PlusIcon() { return ic(<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>); }
function ListIcon() { return ic(<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>); }
