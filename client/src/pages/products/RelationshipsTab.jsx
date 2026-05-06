import React, { useState, useEffect } from 'react';
import { productsApi } from '../../api/products';
import client from '../../api/client';

function PlusSmIcon()  { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
function TrashSmIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>; }

export default function RelationshipsTab({ productId }) {
  const [associations, setAssociations] = useState([]);
  const [associationTypes, setAssociationTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  
  // For selecting a product
  const [products, setProducts] = useState([]);
  
  const [newRow, setNewRow] = useState({ association_type_id: '', to_product_id: '', sort_order: 0, notes: '' });

  useEffect(() => {
    loadData();
    // Load lightweight product list for dropdown
    productsApi.list({ limit: 1000 }).then(r => setProducts(r.data.data || []));
  }, [productId]);

  async function loadData() {
    try {
      const [assocRes, typesRes] = await Promise.all([
        productsApi.listAssociations(productId),
        client.get('/product-association-types')
      ]);
      setAssociations(assocRes.data.data || []);
      setAssociationTypes(typesRes.data.data || []);
    } catch(err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    try {
      await productsApi.addAssociation(productId, newRow);
      setShowAdd(false);
      setNewRow({ association_type_id: '', to_product_id: '', sort_order: 0, notes: '' });
      await loadData();
    } catch(err) {
      alert(err.response?.data?.error || 'Failed to add relationship.');
    }
  }

  async function handleRemove(assocId) {
    if (!confirm('Remove this relationship?')) return;
    try {
      await productsApi.removeAssociation(productId, assocId);
      await loadData();
    } catch(err) {
      alert('Failed to remove relationship.');
    }
  }

  if (loading) return <div style={{ padding: 20 }}>Loading...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Product Relationships</div>
          <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 2 }}>Define related products like Accessories or Alternatives.</div>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowAdd(v => !v)}>
          <PlusSmIcon /> Add relationship
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} style={{ padding: '16px 18px', background: 'var(--accent-dim)', border: '1px solid rgba(47,127,232,0.15)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 10 }}>Link another product</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
            <div className="form-group" style={{ flex: '1 1 150px', marginBottom: 0 }}>
              <label className="form-label">Relationship Type *</label>
              <select className="form-input" required value={newRow.association_type_id} onChange={e => setNewRow({...newRow, association_type_id: e.target.value})}>
                <option value="">Select type...</option>
                {associationTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: '2 1 200px', marginBottom: 0 }}>
              <label className="form-label">Product *</label>
              <select className="form-input" required value={newRow.to_product_id} onChange={e => setNewRow({...newRow, to_product_id: e.target.value})}>
                <option value="">Select product...</option>
                {products.filter(p => p.id !== parseInt(productId)).map(p => (
                  <option key={p.id} value={p.id}>{p.product_code} - {p.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ flex: '0 1 80px', marginBottom: 0 }}>
              <label className="form-label">Order</label>
              <input className="form-input" type="number" value={newRow.sort_order} onChange={e => setNewRow({...newRow, sort_order: parseInt(e.target.value)||0})} />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label className="form-label">Notes</label>
            <input className="form-input" value={newRow.notes} onChange={e => setNewRow({...newRow, notes: e.target.value})} placeholder="Optional notes" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm">Add</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </form>
      )}

      {associations.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-sub)', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}>
          No relationships found.
        </div>
      ) : (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(240,244,249,0.6)' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' }}>Type</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' }}>Product</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' }}>Notes</th>
                <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' }}>Order</th>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {associations.map(a => (
                <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px' }}>
                    <span className="pill pill-blue">{a.type_label}</span>
                    {a.direction === 'incoming' && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-sub)' }}>(incoming)</span>}
                  </td>
                  <td style={{ padding: '8px 12px', fontWeight: 500 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-sub)', fontFamily: 'DM Mono' }}>{a.to_product_code}</div>
                    <div>{a.to_name}</div>
                  </td>
                  <td style={{ padding: '8px 12px', color: 'var(--text-sub)' }}>{a.notes || '—'}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'DM Mono' }}>{a.sort_order}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                    <button type="button" className="btn-icon text-red" onClick={() => handleRemove(a.id)}>
                      <TrashSmIcon />
                    </button>
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
