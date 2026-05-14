import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getAccessToken } from '../../api/client';

const h = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${getAccessToken()}` });
const AUD = v => (v != null ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 4 }).format(v) : '—');

export default function RetailPricesPage() {
  const { isAdmin } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [saving,   setSaving]   = useState({});
  const [edits,    setEdits]    = useState({});
  const [success,  setSuccess]  = useState('');
  const [error,    setError]    = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/products?limit=500&offset=0`, { headers: h() });
      const d = await r.json();
      setProducts(d.data || []);
    } catch { setError('Failed to load products.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function startEdit(product) {
    setEdits(prev => ({ ...prev, [product.id]: String(product.retail_price ?? '') }));
  }

  function cancelEdit(id) {
    setEdits(prev => { const n = {...prev}; delete n[id]; return n; });
  }

  async function savePrice(product) {
    const raw = edits[product.id];
    const price = raw === '' ? null : Number(raw);
    if (raw !== '' && isNaN(price)) { setError('Enter a valid price.'); return; }
    setSaving(prev => ({ ...prev, [product.id]: true }));
    setError('');
    try {
      const r = await fetch(`/api/products/${product.id}`, {
        method: 'PATCH',
        headers: h(),
        body: JSON.stringify({ retail_price: price }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Save failed.');
      setSuccess(`Saved retail price for ${product.name}.`);
      setTimeout(() => setSuccess(''), 3000);
      cancelEdit(product.id);
      await load();
    } catch (err) { setError(err.message); }
    finally { setSaving(prev => ({ ...prev, [product.id]: false })); }
  }

  const filtered = products.filter(p =>
    !search || p.name?.toLowerCase().includes(search.toLowerCase()) ||
    p.product_code?.toLowerCase().includes(search.toLowerCase())
  );

  const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' };
  const th   = { padding: '10px 14px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', textAlign: 'left', borderBottom: '1px solid var(--border)', background: 'var(--bg)' };
  const td   = { padding: '10px 14px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'middle' };

  if (!isAdmin) return <div style={{ padding: 40, color: 'var(--text-sub)' }}>Access denied.</div>;

  return (
    <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.3px' }}>Retail Prices</h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-sub)', marginTop: 4, maxWidth: 560 }}>
            Set the base retail price (RRP) for each product. This is used as the base price in the O2C pricing engine when no price list entry is found.
          </p>
        </div>
      </div>

      {error   && <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(224,82,82,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red)' }}>{error}</div>}
      {success && <div style={{ background: 'var(--green-dim)', border: '1px solid rgba(46,204,138,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#1EA870' }}>{success}</div>}

      <div style={{ display: 'flex', gap: 10 }}>
        <input
          style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 13, width: 280 }}
          placeholder="Search products..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span style={{ fontSize: 13, color: 'var(--text-sub)', alignSelf: 'center' }}>
          {filtered.length} product{filtered.length !== 1 ? 's' : ''}
          {filtered.filter(p => p.retail_price != null).length > 0 &&
            ` · ${filtered.filter(p => p.retail_price != null).length} with retail price`}
        </span>
      </div>

      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Product Code', 'Name', 'Category', 'Default Sales Price', 'Retail Price (RRP)', ''].map(h2 => (
                  <th key={h2} style={th}>{h2}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No products found.</td></tr>
              )}
              {filtered.map(p => {
                const editing = p.id in edits;
                const isSaving = saving[p.id];
                return (
                  <tr key={p.id} style={{ transition: 'background 0.1s' }}>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{p.product_code || '—'}</td>
                    <td style={{ ...td, fontWeight: 500 }}>{p.name}</td>
                    <td style={{ ...td, color: 'var(--text-sub)' }}>{p.category_name || '—'}</td>
                    <td style={td}>{AUD(p.default_sales_price)}</td>
                    <td style={td}>
                      {editing ? (
                        <input
                          autoFocus
                          type="number"
                          min="0"
                          step="0.01"
                          style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--card)', color: 'var(--text)', fontSize: 13, width: 120 }}
                          value={edits[p.id]}
                          onChange={e => setEdits(prev => ({ ...prev, [p.id]: e.target.value }))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') savePrice(p);
                            if (e.key === 'Escape') cancelEdit(p.id);
                          }}
                        />
                      ) : (
                        <span style={{ fontWeight: p.retail_price != null ? 600 : 400, color: p.retail_price != null ? 'var(--text)' : 'var(--text-sub)' }}>
                          {AUD(p.retail_price)}
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {editing ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-primary btn-sm" disabled={isSaving} onClick={() => savePrice(p)}>
                            {isSaving ? 'Saving…' : 'Save'}
                          </button>
                          <button className="btn btn-outline btn-sm" onClick={() => cancelEdit(p.id)}>Cancel</button>
                        </div>
                      ) : (
                        <button className="btn btn-outline btn-sm" onClick={() => startEdit(p)}>
                          {p.retail_price != null ? 'Edit' : 'Set price'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
