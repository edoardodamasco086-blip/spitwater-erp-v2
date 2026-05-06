import React, { useEffect, useState } from 'react';
import { productUomApi } from '../../api/productUom';
import { useAuth } from '../../context/AuthContext';
import styles from './CustomerTiersPage.module.css';

const TIER_COLORS = ['#2F7FE8','#2ECC8A','#E89B2F','#9366E8','#E05252','#3BBCD4','#E84F8C','#9EA0A5'];

function initials(name) { return (name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function avatarColor(name) { const colors=['#2F7FE8','#2ECC8A','#E89B2F','#9366E8','#E05252']; return colors[(name||'').charCodeAt(0)%colors.length]; }

export default function CustomerTiersPage() {
  const { isAdmin } = useAuth();
  const [tiers,      setTiers]      = useState([]);
  const [contacts,   setContacts]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState(null);
  const [members,    setMembers]    = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editId,     setEditId]     = useState(null);
  const [form,       setForm]       = useState({ name: '', description: '', color: TIER_COLORS[0], discount_pct: 0 });
  const [saving,     setSaving]     = useState(false);
  const [addContactId, setAddContactId] = useState('');
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState('');

  async function loadTiers() {
    const { data } = await productUomApi.listTiers();
    setTiers(data.data || []);
    setLoading(false);
  }

  async function loadContacts() {
    const r = await fetch('/api/contacts?limit=500', { headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` } });
    const d = await r.json();
    setContacts(d.data || []);
  }

  useEffect(() => { loadTiers(); loadContacts(); }, []);

  async function selectTier(tier) {
    setSelected(tier);
    setAddContactId('');
    setError('');
    const { data } = await productUomApi.getTierContacts(tier.id);
    setMembers(data.data || []);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');
    try {
      if (editId) {
        await productUomApi.updateTier(editId, form);
        setSuccess('Tier updated.');
      } else {
        await productUomApi.createTier(form);
        setSuccess('Tier created.');
      }
      setShowCreate(false); setEditId(null);
      setForm({ name: '', description: '', color: TIER_COLORS[0], discount_pct: 0 });
      setTimeout(() => setSuccess(''), 3000);
      await loadTiers();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed.');
    } finally { setSaving(false); }
  }

  async function handleDelete(tier) {
    if (!confirm(`Delete tier "${tier.name}"?`)) return;
    try {
      await productUomApi.deleteTier(tier.id);
      if (selected?.id === tier.id) { setSelected(null); setMembers([]); }
      await loadTiers();
    } catch (err) { alert(err.response?.data?.error || 'Cannot delete.'); }
  }

  async function handleAssign() {
    if (!addContactId || !selected) return;
    try {
      await productUomApi.assignContact(selected.id, parseInt(addContactId));
      setAddContactId('');
      const { data } = await productUomApi.getTierContacts(selected.id);
      setMembers(data.data || []);
      await loadTiers();
    } catch (err) { alert(err.response?.data?.error || 'Failed to assign.'); }
  }

  async function handleRemoveContact(contactId) {
    try {
      await productUomApi.removeContact(selected.id, contactId);
      const { data } = await productUomApi.getTierContacts(selected.id);
      setMembers(data.data || []);
      await loadTiers();
    } catch (err) { alert(err.response?.data?.error || 'Failed to remove.'); }
  }

  function startEdit(tier) {
    setForm({ name: tier.name, description: tier.description || '', color: tier.color || TIER_COLORS[0], discount_pct: tier.discount_pct || 0 });
    setEditId(tier.id);
    setShowCreate(true);
    setError('');
  }

  if (!isAdmin) return <div className={styles.page}><div className={styles.empty}>Access denied.</div></div>;

  const unassigned = contacts.filter(c => !members.find(m => m.id === c.id));

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Customer Tiers</h1>
          <p className={styles.sub}>Group contacts into pricing tiers. Tiers drive the CPQ discount matrix — Gold customers get better prices than Standard.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setShowCreate(true); setEditId(null); setForm({ name:'', description:'', color: TIER_COLORS[0], discount_pct: 0 }); setError(''); }}>
          <PlusIcon /> New Tier
        </button>
      </div>

      {error   && <div className={styles.errorBox}>{error}</div>}
      {success && <div className={styles.successBox}>{success}</div>}

      {/* Create / Edit form */}
      {showCreate && (
        <form className={styles.createCard} onSubmit={handleSave}>
          <div className={styles.createTitle}>{editId ? 'Edit Tier' : 'New Tier'}</div>
          <div className={styles.createRow}>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Tier name *</label>
              <input className="form-input" autoFocus value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="e.g. Gold, Dealer, Platinum" />
            </div>
            <div className="form-group" style={{ flex: 3 }}>
              <label className="form-label">Description</label>
              <input className="form-input" value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} placeholder="When is this tier applied?" />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Base discount %</label>
              <input className="form-input" type="number" step="0.01" min="0" max="100" value={form.discount_pct} onChange={e => setForm(f => ({...f, discount_pct: e.target.value}))} placeholder="0" />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className="form-label" style={{ marginBottom: 8 }}>Colour</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {TIER_COLORS.map(col => (
                <button key={col} type="button"
                  style={{ width: 28, height: 28, borderRadius: '50%', background: col, border: form.color === col ? '3px solid var(--text)' : '2px solid transparent', cursor: 'pointer', flexShrink: 0 }}
                  onClick={() => setForm(f => ({...f, color: col}))} />
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { setShowCreate(false); setEditId(null); }}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !form.name.trim()}>
              {saving ? 'Saving...' : editId ? 'Save changes' : 'Create tier'}
            </button>
          </div>
        </form>
      )}

      <div className={styles.body}>
        {/* Tier list */}
        <div className={styles.tierList}>
          <div className={styles.tierListTitle}>Tiers ({tiers.length})</div>
          {loading ? (
            <div style={{ padding: 20, color: 'var(--text-sub)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <div className="spinner-dark" /> Loading...
            </div>
          ) : tiers.length === 0 ? (
            <div className={styles.empty}>No tiers yet. Create one to start organising your customers.</div>
          ) : (
            tiers.map(tier => (
              <div key={tier.id}
                className={[styles.tierItem, selected?.id === tier.id ? styles.tierSelected : ''].join(' ')}
                onClick={() => selectTier(tier)}>
                <div className={styles.tierDot} style={{ background: tier.color || '#2F7FE8' }} />
                <div className={styles.tierInfo}>
                  <div className={styles.tierName}>{tier.name}</div>
                  <div className={styles.tierMeta}>
                    {tier.contact_count || 0} contact{tier.contact_count !== 1 ? 's' : ''}
                    {tier.discount_pct > 0 && ` · ${tier.discount_pct}% base discount`}
                  </div>
                </div>
                <div className={styles.tierActions} onClick={e => e.stopPropagation()}>
                  <button className="btn btn-outline btn-sm" onClick={() => startEdit(tier)}>Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(tier)}>Delete</button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Right panel — contacts in tier */}
        {selected ? (
          <div className={styles.rightPanel}>
            <div className={styles.panelHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: selected.color }} />
                <div>
                  <div className={styles.panelTitle}>{selected.name}</div>
                  {selected.description && <div className={styles.panelDesc}>{selected.description}</div>}
                </div>
              </div>
              {selected.discount_pct > 0 && (
                <span className="pill pill-green">{selected.discount_pct}% base discount</span>
              )}
            </div>

            <div className={styles.panelBody}>
              {/* Add contact */}
              <div className={styles.addRow}>
                <select className="form-input" style={{ flex: 1 }} value={addContactId} onChange={e => setAddContactId(e.target.value)}>
                  <option value="">Assign a contact to this tier...</option>
                  {unassigned.map(c => (
                    <option key={c.id} value={c.id}>{c.full_name} {c.email ? `(${c.email})` : ''}</option>
                  ))}
                </select>
                <button className="btn btn-primary btn-sm" disabled={!addContactId} onClick={handleAssign}>
                  Assign
                </button>
              </div>

              {/* Members list */}
              {members.length === 0 ? (
                <div className={styles.empty} style={{ padding: '32px 20px' }}>
                  No contacts assigned to this tier yet.
                </div>
              ) : (
                <div className={styles.memberList}>
                  {members.map(m => (
                    <div key={m.id} className={styles.memberRow}>
                      <div className={styles.memberAvatar} style={{ background: avatarColor(m.full_name) }}>
                        {initials(m.full_name)}
                      </div>
                      <div className={styles.memberInfo}>
                        <div className={styles.memberName}>{m.full_name}</div>
                        <div className={styles.memberSub}>{m.email || m.contact_type || ''}</div>
                      </div>
                      <button className="btn btn-outline btn-sm" onClick={() => handleRemoveContact(m.id)}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.noSelection}>
            <TierIcon />
            <p>Select a tier to manage its contacts.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ic(p) { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p}</svg>; }
function PlusIcon() { return ic(<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>); }
function TierIcon() { return ic(<><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></>); }
