import React, { useState, useEffect, useCallback } from 'react';
import { warehouseApi } from '../../api/warehouse';
import { settingsApi }  from '../../api/settings';
import { productsApi }  from '../../api/products';
import { contactsApi }  from '../../api/contacts';
import styles from './WarehousePage.module.css';

function fmt(v, d = 4) {
  if (v == null) return '0';
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: d }).format(v);
}

export default function InventoryLevelsPage() {
  const [rows,       setRows]       = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [warehouses, setWarehouses] = useState([]);
  const [zones,      setZones]      = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers,  setSuppliers]  = useState([]);

  // filter state
  const [search,        setSearch]        = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [categoryId,    setCategoryId]    = useState('');
  const [warehouseId,   setWarehouseId]   = useState('');
  const [zoneId,        setZoneId]        = useState('');
  const [supplierId,    setSupplierId]    = useState('');
  const [committedOnly, setCommittedOnly] = useState(false);
  const [onOrderOnly,   setOnOrderOnly]   = useState(false);
  const [lowStock,      setLowStock]      = useState(false);

  // load reference data once
  useEffect(() => {
    settingsApi.listWarehouses().then(({ data }) => setWarehouses(data.data || []));
    productsApi.categories().then(({ data }) => setCategories(data.data || []));
    contactsApi.list({ type: 'supplier', limit: 100 }).then(({ data }) => setSuppliers(data.data || []));
  }, []);

  // reload zones when warehouse changes
  useEffect(() => {
    setZoneId('');
    if (!warehouseId) { setZones([]); return; }
    warehouseApi.listZones(warehouseId).then(({ data }) => setZones(data.data || []));
  }, [warehouseId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (searchApplied) params.search       = searchApplied;
      if (categoryId)    params.category_id  = categoryId;
      if (warehouseId)   params.warehouse_id = warehouseId;
      if (zoneId)        params.zone_id      = zoneId;
      if (supplierId)    params.supplier_id  = supplierId;
      if (committedOnly) params.committed_only = '1';
      if (onOrderOnly)   params.on_order_only  = '1';
      if (lowStock)      params.low_stock       = '1';
      const { data } = await warehouseApi.reportInventoryLevels(params);
      setRows(data.data || []);
    } finally {
      setLoading(false);
    }
  }, [searchApplied, categoryId, warehouseId, zoneId, supplierId, committedOnly, onOrderOnly, lowStock]);

  useEffect(() => { load(); }, [load]);

  function handleSearch(e) {
    e.preventDefault();
    setSearchApplied(search);
  }

  function clearFilters() {
    setSearch(''); setSearchApplied('');
    setCategoryId(''); setWarehouseId(''); setZoneId(''); setSupplierId('');
    setCommittedOnly(false); setOnOrderOnly(false); setLowStock(false);
  }

  const hasFilters = searchApplied || categoryId || warehouseId || zoneId || supplierId || committedOnly || onOrderOnly || lowStock;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Inventory Levels</div>
          <div className={styles.sub}>Current stock on hand across all locations — no cost data</div>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px 20px', marginBottom: 20 }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>

          <div className="form-group" style={{ flex: '2 1 200px', margin: 0 }}>
            <label className="form-label">Product search</label>
            <input
              className="form-input"
              placeholder="Name, code or barcode…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="form-group" style={{ flex: '1 1 160px', margin: 0 }}>
            <label className="form-label">Category</label>
            <select className="form-input" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              <option value="">All categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="form-group" style={{ flex: '1 1 160px', margin: 0 }}>
            <label className="form-label">Warehouse</label>
            <select className="form-input" value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
              <option value="">All warehouses</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
            </select>
          </div>

          {zones.length > 0 && (
            <div className="form-group" style={{ flex: '1 1 140px', margin: 0 }}>
              <label className="form-label">Zone</label>
              <select className="form-input" value={zoneId} onChange={e => setZoneId(e.target.value)}>
                <option value="">All zones</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.name} ({z.code})</option>)}
              </select>
            </div>
          )}

          <div className="form-group" style={{ flex: '1 1 160px', margin: 0 }}>
            <label className="form-label">Default supplier</label>
            <select className="form-input" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              <option value="">All suppliers</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.full_name || s.company_name}</option>)}
            </select>
          </div>

          {/* Checkbox toggles */}
          <div style={{ display: 'flex', gap: 14, alignSelf: 'flex-end', paddingBottom: 6 }}>
            {[
              ['committed_only', 'Has committed',  committedOnly, setCommittedOnly],
              ['on_order',       'On order',        onOrderOnly,   setOnOrderOnly],
              ['low_stock',      'Low stock',       lowStock,      setLowStock],
            ].map(([key, label, val, setter]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer', userSelect: 'none', color: val ? 'var(--accent)' : 'var(--text-sub)' }}>
                <input type="checkbox" checked={val} onChange={e => setter(e.target.checked)} style={{ cursor: 'pointer' }} />
                {label}
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-end' }}>
            <button type="submit" className="btn btn-primary btn-sm">Search</button>
            {hasFilters && (
              <button type="button" className="btn btn-outline btn-sm" onClick={clearFilters}>Clear</button>
            )}
          </div>
        </form>
      </div>

      {/* ── Summary bar ── */}
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--text-sub)' }}>
          {loading ? 'Loading…' : `${rows.length} stock line${rows.length !== 1 ? 's' : ''}${hasFilters ? ' (filtered)' : ''}`}
        </div>
        {!loading && rows.length > 0 && (() => {
          const lowCount = rows.filter(r => r.min_stock_level > 0 && parseFloat(r.qty_available) < parseFloat(r.min_stock_level)).length;
          return lowCount > 0 ? (
            <span style={{ fontSize: 12, background: 'var(--red-dim, rgba(239,68,68,0.12))', color: 'var(--red)', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>
              {lowCount} below minimum
            </span>
          ) : null;
        })()}
      </div>

      {/* ── Table ── */}
      {loading ? (
        <div className={styles.loading}><div className="spinner-dark" /> Loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-sub)', fontSize: 14 }}>
          No stock found{hasFilters ? ' for the current filters.' : '.'}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {[
                  ['Product',    'left'],
                  ['Category',   'left'],
                  ['Location',   'left'],
                  ['On Hand',    'right'],
                  ['Reserved',   'right'],
                  ['Available',  'right'],
                  ['On Order',   'right'],
                  ['Supplier',   'left'],
                ].map(([h, align]) => (
                  <th key={h} style={{
                    padding: '10px 14px', textAlign: align,
                    fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
                    textTransform: 'uppercase', color: 'var(--text-sub)',
                    borderBottom: '1px solid var(--border)', background: 'var(--bg)',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const available  = parseFloat(r.qty_available);
                const belowMin   = r.min_stock_level > 0 && available < parseFloat(r.min_stock_level);
                const uomSuffix  = r.uom_code ? ` ${r.uom_code}` : '';
                const locationParts = [r.warehouse_name, r.zone_name, r.bin_code].filter(Boolean);

                return (
                  <tr key={r.stock_id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {r.product_name}
                        {belowMin && (
                          <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--red-dim, rgba(239,68,68,0.12))', color: 'var(--red)', padding: '1px 6px', borderRadius: 10, letterSpacing: '0.05em' }}>
                            LOW
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text-sub)' }}>{r.product_code}</div>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-sub)' }}>
                      {r.category_name || '—'}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontSize: 12 }}>{r.warehouse_name}</div>
                      {locationParts.length > 1 && (
                        <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text-sub)' }}>
                          {locationParts.slice(1).join(' › ')}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 600 }}>
                      {fmt(r.qty_on_hand)}<span style={{ fontSize: 10, color: 'var(--text-sub)', marginLeft: 3 }}>{r.uom_code}</span>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'DM Mono', color: parseFloat(r.qty_reserved) > 0 ? 'var(--orange, #f97316)' : 'var(--text-sub)' }}>
                      {fmt(r.qty_reserved)}<span style={{ fontSize: 10, color: 'var(--text-sub)', marginLeft: 3 }}>{r.uom_code}</span>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 600, color: belowMin ? 'var(--red)' : available > 0 ? 'var(--green)' : 'var(--text-sub)' }}>
                      {fmt(r.qty_available)}<span style={{ fontSize: 10, color: 'var(--text-sub)', marginLeft: 3 }}>{r.uom_code}</span>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'DM Mono', color: parseFloat(r.qty_on_order) > 0 ? 'var(--accent)' : 'var(--text-sub)' }}>
                      {fmt(r.qty_on_order)}<span style={{ fontSize: 10, color: 'var(--text-sub)', marginLeft: 3 }}>{r.uom_code}</span>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-sub)' }}>
                      {r.supplier_name || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
