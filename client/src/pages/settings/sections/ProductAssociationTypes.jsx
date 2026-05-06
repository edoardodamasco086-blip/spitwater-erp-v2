import React, { useState, useEffect } from 'react';
import client from '../../../api/client';
import styles from '../SettingsPage.module.css';

function PlusIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
function TrashIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>; }
function EditIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }

export default function ProductAssociationTypes() {
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ label: '', reverse_label: '', is_bidirectional: false, type_key: '', sort_order: 0 });

  useEffect(() => {
    loadTypes();
  }, []);

  async function loadTypes() {
    try {
      const res = await client.get('/product-association-types');
      setTypes(res.data.data || []);
      setError(null);
    } catch(err) {
      setError('Failed to load association types.');
    } finally {
      setLoading(false);
    }
  }

  function handleAdd() {
    setForm({ label: '', reverse_label: '', is_bidirectional: false, type_key: '', sort_order: 0 });
    setEditId(null);
    setShowAdd(true);
  }

  function handleEdit(t) {
    setForm({ 
      label: t.label || '', 
      reverse_label: t.reverse_label || '', 
      is_bidirectional: t.is_bidirectional || false, 
      type_key: t.type_key || '', 
      sort_order: t.sort_order || 0 
    });
    setEditId(t.id);
    setShowAdd(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    try {
      if (editId) {
        await client.patch(`/product-association-types/${editId}`, form);
      } else {
        await client.post('/product-association-types', form);
      }
      setShowAdd(false);
      await loadTypes();
    } catch(err) {
      alert(err.response?.data?.error || 'Failed to save type.');
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this relationship type?')) return;
    try {
      await client.delete(`/product-association-types/${id}`);
      await loadTypes();
    } catch(err) {
      alert(err.response?.data?.error || 'Failed to delete type.');
    }
  }

  if (loading) return <div>Loading...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && <div style={{ color: 'var(--red)' }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ color: 'var(--text-sub)' }}>Define the types of relationships between products (e.g., Accessories, Alternatives).</p>
        <button className="btn btn-primary btn-sm" onClick={handleAdd}><PlusIcon /> Add Type</button>
      </div>

      {showAdd && (
        <form onSubmit={handleSave} className={styles.card} style={{ border: '1px solid var(--accent)', background: 'var(--accent-dim)' }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>{editId ? 'Edit Relationship' : 'Add Relationship'}</div>
          
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            <div className="form-group" style={{ flex: '1 1 200px', marginBottom: 0 }}>
              <label className="form-label">Name (e.g. "Accessories") *</label>
              <input className="form-input" value={form.label} onChange={e => setForm({...form, label: e.target.value})} required autoFocus />
            </div>
            <div className="form-group" style={{ flex: '1 1 200px', marginBottom: 0 }}>
              <label className="form-label">Reverse Name (e.g. "Main Product")</label>
              <input className="form-input" value={form.reverse_label} onChange={e => setForm({...form, reverse_label: e.target.value})} />
            </div>
          </div>
          
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div className="form-group" style={{ flex: '1 1 150px', marginBottom: 0 }}>
              <label className="form-label">Type Key (unique id)</label>
              <input className="form-input" value={form.type_key} onChange={e => setForm({...form, type_key: e.target.value})} placeholder="auto-generated if empty" />
            </div>
            <div className="form-group" style={{ flex: '1 1 100px', marginBottom: 0 }}>
              <label className="form-label">Sort Order</label>
              <input type="number" className="form-input" value={form.sort_order} onChange={e => setForm({...form, sort_order: parseInt(e.target.value) || 0})} />
            </div>
            <label className="checkbox-label" style={{ marginTop: 24, flex: '1 1 150px' }}>
              <input type="checkbox" checked={form.is_bidirectional} onChange={e => setForm({...form, is_bidirectional: e.target.checked})} />
              Bi-directional
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm">Save</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </form>
      )}

      {types.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-sub)', border: '1px dashed var(--border)', borderRadius: 8 }}>
          No relationship types defined.
        </div>
      ) : (
        <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>Order</th>
                <th>Name</th>
                <th>Reverse Name</th>
                <th>Type</th>
                <th style={{ width: 80, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {types.map(t => (
                <tr key={t.id}>
                  <td style={{ color: 'var(--text-sub)', fontFamily: 'DM Mono' }}>{t.sort_order}</td>
                  <td style={{ fontWeight: 500 }}>{t.label}</td>
                  <td style={{ color: 'var(--text-sub)' }}>{t.reverse_label || '—'}</td>
                  <td>{t.is_bidirectional ? <span className="pill pill-green">Bi-directional</span> : <span className="pill pill-grey">One-way</span>}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn-icon" onClick={() => handleEdit(t)}><EditIcon /></button>
                    <button className="btn-icon text-red" onClick={() => handleDelete(t.id)}><TrashIcon /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
