import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getAccessToken } from '../../api/client';
import styles from './CustomerTiersPage.module.css';

const CAT_COLORS = ['#2F7FE8','#2ECC8A','#E89B2F','#9366E8','#E05252','#3BBCD4','#E84F8C','#9EA0A5'];

const api = {
  list:    () => fetch('/api/customer-categories',             { headers: h() }).then(r => r.json()),
  create:  (b) => fetch('/api/customer-categories',            { method: 'POST',   headers: h(), body: J(b) }).then(r => r.json()),
  update:  (id,b)=> fetch(`/api/customer-categories/${id}`,   { method: 'PATCH',  headers: h(), body: J(b) }).then(r => r.json()),
  del:     (id) => fetch(`/api/customer-categories/${id}`,    { method: 'DELETE', headers: h() }).then(r => r.json()),
  members: (id) => fetch(`/api/customer-categories/${id}/contacts`, { headers: h() }).then(r => r.json()),
  assign:  (id, bpId) => fetch(`/api/customer-categories/${id}/contacts`, { method: 'POST', headers: h(), body: J({ bp_id: bpId }) }).then(r => r.json()),
  remove:  (id, bpId) => fetch(`/api/customer-categories/${id}/contacts/${bpId}`, { method: 'DELETE', headers: h() }).then(r => r.json()),
};
const h = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${getAccessToken()}` });
const J = (b) => JSON.stringify(b);

function initials(name) { return (name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function avatarColor(name) { const colors=['#2F7FE8','#2ECC8A','#E89B2F','#9366E8','#E05252']; return colors[(name||'').charCodeAt(0)%colors.length]; }

export default function CustomerCategoriesPage() {
  const { isAdmin } = useAuth();
  const [cats,       setCats]       = useState([]);
  const [bps,        setBps]        = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState(null);
  const [members,    setMembers]    = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editId,     setEditId]     = useState(null);
  const [form,       setForm]       = useState({ name: '', description: '', color: CAT_COLORS[0] });
  const [saving,     setSaving]     = useState(false);
  const [addBpId,    setAddBpId]    = useState('');
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState('');

  async function load() {
    const d = await api.list();
    setCats(d.data || []);
    setLoading(false);
  }

  async function loadBps() {
    const r = await fetch('/api/business-partners?limit=500', { headers: { Authorization: `Bearer ${getAccessToken()}` } });
    const d = await r.json();
    setBps(d.data || []);
  }

  useEffect(() => { load(); loadBps(); }, []);

  async function selectCat(cat) {
    setSelected(cat);
    setAddBpId('');
    setError('');
    const d = await api.members(cat.id);
    setMembers(d.data || []);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');
    try {
      const res = editId ? await api.update(editId, form) : await api.create(form);
      if (!res.success) throw new Error(res.error || 'Save failed.');
      setSuccess(editId ? 'Category updated.' : 'Category created.');
      setShowCreate(false); setEditId(null);
      setForm({ name: '', description: '', color: CAT_COLORS[0] });
      setTimeout(() => setSuccess(''), 3000);
      await load();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(cat) {
    if (!window.confirm(`Delete category "${cat.name}"?`)) return;
    const res = await api.del(cat.id);
    if (!res.success) { alert(res.error || 'Cannot delete.'); return; }
    if (selected?.id === cat.id) { setSelected(null); setMembers([]); }
    await load();
  }

  async function handleAssign() {
    if (!addBpId || !selected) return;
    const res = await api.assign(selected.id, parseInt(addBpId));
    if (!res.success) { alert(res.error || 'Failed to assign.'); return; }
    setAddBpId('');
    const d = await api.members(selected.id);
    setMembers(d.data || []);
    await load();
  }

  async function handleRemoveMember(bpId) {
    await api.remove(selected.id, bpId);
    const d = await api.members(selected.id);
    setMembers(d.data || []);
    await load();
  }

  function startEdit(cat) {
    setForm({ name: cat.name, description: cat.description || '', color: cat.color || CAT_COLORS[0] });
    setEditId(cat.id);
    setShowCreate(true);
    setError('');
  }

  if (!isAdmin) return <div className={styles.page}><div className={styles.empty}>Access denied.</div></div>;

  const unassigned = bps.filter(b => !members.find(m => m.bp_id === b.id));

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Customer Categories</h1>
          <p className={styles.sub}>Group customers by segment (e.g. Retail, Wholesale, Government). Categories can be targeted by pricing conditions in the O2C condition matrix.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setShowCreate(true); setEditId(null); setForm({ name:'', description:'', color: CAT_COLORS[0] }); setError(''); }}>
          <PlusIcon /> New Category
        </button>
      </div>

      {error   && <div className={styles.errorBox}>{error}</div>}
      {success && <div className={styles.successBox}>{success}</div>}

      {showCreate && (
        <form className={styles.createCard} onSubmit={handleSave}>
          <div className={styles.createTitle}>{editId ? 'Edit Category' : 'New Category'}</div>
          <div className={styles.createRow}>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Category name *</label>
              <input className="form-input" autoFocus value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="e.g. Retail, Wholesale, Government" />
            </div>
            <div className="form-group" style={{ flex: 3 }}>
              <label className="form-label">Description</label>
              <input className="form-input" value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} placeholder="When is this category applied?" />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className="form-label" style={{ marginBottom: 8 }}>Colour</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {CAT_COLORS.map(col => (
                <button key={col} type="button"
                  style={{ width: 28, height: 28, borderRadius: '50%', background: col, border: form.color === col ? '3px solid var(--text)' : '2px solid transparent', cursor: 'pointer', flexShrink: 0 }}
                  onClick={() => setForm(f => ({...f, color: col}))} />
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { setShowCreate(false); setEditId(null); }}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !form.name.trim()}>
              {saving ? 'Saving...' : editId ? 'Save changes' : 'Create category'}
            </button>
          </div>
        </form>
      )}

      <div className={styles.body}>
        <div className={styles.tierList}>
          <div className={styles.tierListTitle}>Categories ({cats.length})</div>
          {loading ? (
            <div style={{ padding: 20, color: 'var(--text-sub)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <div className="spinner-dark" /> Loading...
            </div>
          ) : cats.length === 0 ? (
            <div className={styles.empty}>No categories yet.</div>
          ) : (
            cats.map(cat => (
              <div key={cat.id}
                className={[styles.tierItem, selected?.id === cat.id ? styles.tierSelected : ''].join(' ')}
                onClick={() => selectCat(cat)}>
                <div className={styles.tierDot} style={{ background: cat.color || '#2F7FE8' }} />
                <div className={styles.tierInfo}>
                  <div className={styles.tierName}>{cat.name}</div>
                  <div className={styles.tierMeta}>
                    {cat.contact_count || 0} contact{cat.contact_count !== 1 ? 's' : ''}
                    {cat.description && ` · ${cat.description}`}
                  </div>
                </div>
                <div className={styles.tierActions} onClick={e => e.stopPropagation()}>
                  <button className="btn btn-outline btn-sm" onClick={() => startEdit(cat)}>Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(cat)}>Delete</button>
                </div>
              </div>
            ))
          )}
        </div>

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
              <span className="pill">{selected.contact_count || 0} contact{selected.contact_count !== 1 ? 's' : ''}</span>
            </div>

            <div className={styles.panelBody}>
              <div className={styles.addRow}>
                <select className="form-input" style={{ flex: 1 }} value={addBpId} onChange={e => setAddBpId(e.target.value)}>
                  <option value="">— Select Business Partner —</option>
                  {unassigned.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.display_name} ({b.bp_type === 'organization' ? 'Org' : 'Person'})
                    </option>
                  ))}
                </select>
                <button className="btn btn-primary btn-sm" disabled={!addBpId} onClick={handleAssign}>
                  Assign
                </button>
              </div>

              {members.length === 0 ? (
                <div className={styles.empty} style={{ padding: '32px 20px' }}>No business partners assigned to this category yet.</div>
              ) : (
                <div className={styles.memberList}>
                  {members.map(m => (
                    <div key={m.bp_id} className={styles.memberRow}>
                      <div className={styles.memberAvatar} style={{ background: avatarColor(m.display_name) }}>
                        {initials(m.display_name)}
                      </div>
                      <div className={styles.memberInfo}>
                        <div className={styles.memberName} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {m.display_name}
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 20,
                            background: m.bp_type === 'organization' ? '#dbeafe' : '#ede9fe',
                            color: m.bp_type === 'organization' ? '#2F7FE8' : '#9366E8',
                          }}>
                            {m.bp_type === 'organization' ? 'Org' : 'Person'}
                          </span>
                          {m.bp_role && (
                            <span style={{
                              fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 20,
                              background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-sub)',
                            }}>
                              {m.bp_role}
                            </span>
                          )}
                        </div>
                        <div className={styles.memberSub}>{m.email || ''}</div>
                      </div>
                      <button className="btn btn-outline btn-sm" onClick={() => handleRemoveMember(m.bp_id)}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.noSelection}>
            <CatIcon />
            <p>Select a category to manage its contacts.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ic(p) { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p}</svg>; }
function PlusIcon() { return ic(<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>); }
function CatIcon()  { return ic(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>); }
