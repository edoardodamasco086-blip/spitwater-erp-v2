import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { warehouseApi } from '../../api/warehouse';
import { settingsApi }  from '../../api/settings';
import { productsApi }  from '../../api/products';
import { contactsApi }  from '../../api/contacts';
import styles from './WarehousePage.module.css';

function fmt(v, d = 4) {
  if (v == null) return '0';
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: d }).format(v);
}

const PREF_KEY = 'inv-levels-prefs';

const ALL_COLS = [
  { key: 'product',   label: 'Product',   align: 'left',  sortField: 'product_name',  required: true },
  { key: 'category',  label: 'Category',  align: 'left',  sortField: 'category_name' },
  { key: 'location',  label: 'Location',  align: 'left',  sortField: 'warehouse_name' },
  { key: 'on_hand',   label: 'On Hand',   align: 'right', sortField: 'qty_on_hand' },
  { key: 'reserved',  label: 'Reserved',  align: 'right', sortField: 'qty_reserved' },
  { key: 'available', label: 'Available', align: 'right', sortField: 'qty_available' },
  { key: 'on_order',  label: 'On Order',  align: 'right', sortField: 'qty_on_order' },
  { key: 'min_stock', label: 'Min Stock', align: 'right', sortField: 'min_stock_level' },
  { key: 'supplier',  label: 'Supplier',  align: 'left',  sortField: 'supplier_name' },
];

function loadPrefs() {
  try { const s = localStorage.getItem(PREF_KEY); return s ? JSON.parse(s) : null; }
  catch { return null; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch {}
}

function csvCell(val) {
  const s = String(val ?? '');
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

export default function InventoryLevelsPage() {
  const navigate = useNavigate();

  const [rows,       setRows]       = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [warehouses, setWarehouses] = useState([]);
  const [zones,      setZones]      = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers,  setSuppliers]  = useState([]);

  // filters
  const [search,        setSearch]        = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [categoryId,    setCategoryId]    = useState('');
  const [warehouseId,   setWarehouseId]   = useState('');
  const [zoneId,        setZoneId]        = useState('');
  const [supplierId,    setSupplierId]    = useState('');
  const [committedOnly, setCommittedOnly] = useState(false);
  const [onOrderOnly,   setOnOrderOnly]   = useState(false);
  const [lowStock,      setLowStock]      = useState(false);

  // sort
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  // inline edit
  const [editMode, setEditMode] = useState(false);
  const [edits,    setEdits]    = useState({}); // { [product_id]: { min_stock_level } }
  const [saving,   setSaving]   = useState(false);

  // column visibility (persisted to localStorage)
  const [visibleCols, setVisibleCols] = useState(() => {
    const saved = loadPrefs();
    return saved?.visibleCols ?? ALL_COLS.map(c => c.key);
  });
  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef(null);

  useEffect(() => { savePrefs({ visibleCols }); }, [visibleCols]);

  // close col picker on outside click
  useEffect(() => {
    function onDown(e) {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target))
        setShowColPicker(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // reference data
  useEffect(() => {
    settingsApi.listWarehouses().then(({ data }) => setWarehouses(data.data || []));
    productsApi.categories().then(({ data }) => setCategories(data.data || []));
    contactsApi.list({ type: 'supplier', limit: 100 }).then(({ data }) => setSuppliers(data.data || []));
  }, []);

  useEffect(() => {
    setZoneId('');
    if (!warehouseId) { setZones([]); return; }
    warehouseApi.listZones(warehouseId).then(({ data }) => setZones(data.data || []));
  }, [warehouseId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (searchApplied) params.search        = searchApplied;
      if (categoryId)    params.category_id   = categoryId;
      if (warehouseId)   params.warehouse_id  = warehouseId;
      if (zoneId)        params.zone_id       = zoneId;
      if (supplierId)    params.supplier_id   = supplierId;
      if (committedOnly) params.committed_only = '1';
      if (onOrderOnly)   params.on_order_only  = '1';
      if (lowStock)      params.low_stock      = '1';
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

  function toggleEditMode() {
    if (editMode) { setEdits({}); }
    setEditMode(v => !v);
  }

  async function saveEdits() {
    const changed = Object.entries(edits);
    if (!changed.length) return;
    setSaving(true);
    try {
      await Promise.all(
        changed.map(([productId, changes]) =>
          productsApi.update(parseInt(productId), changes)
        )
      );
      setRows(prev => prev.map(r => {
        const change = edits[r.product_id];
        return change ? { ...r, ...change } : r;
      }));
      setEdits({});
      setEditMode(false);
    } catch (err) {
      alert('Save failed: ' + (err?.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  }

  function setMinStock(productId, value) {
    setEdits(prev => ({ ...prev, [productId]: { ...prev[productId], min_stock_level: value } }));
  }

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function toggleCol(key) {
    setVisibleCols(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  // client-side sort
  const sortedRows = [...rows].sort((a, b) => {
    if (!sortKey) return 0;
    const col = ALL_COLS.find(c => c.key === sortKey);
    if (!col) return 0;
    let av = a[col.sortField], bv = b[col.sortField];
    if (av == null) av = ''; if (bv == null) bv = '';
    const an = parseFloat(av), bn = parseFloat(bv);
    if (!isNaN(an) && !isNaN(bn)) return sortDir === 'asc' ? an - bn : bn - an;
    const as = String(av).toLowerCase(), bs = String(bv).toLowerCase();
    if (as < bs) return sortDir === 'asc' ? -1 : 1;
    if (as > bs) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  function exportCsv() {
    const cols = ALL_COLS.filter(c => visibleCols.includes(c.key));
    const header = cols.map(c => csvCell(c.label)).join(',');
    const body = sortedRows.map(r => {
      const available = parseFloat(r.qty_available);
      const loc = [r.warehouse_name, r.zone_name, r.bin_code].filter(Boolean).join(' > ');
      return cols.map(c => {
        switch (c.key) {
          case 'product':   return csvCell(`${r.product_name} (${r.product_code})`);
          case 'category':  return csvCell(r.category_name || '');
          case 'location':  return csvCell(loc);
          case 'on_hand':   return r.qty_on_hand ?? 0;
          case 'reserved':  return r.qty_reserved ?? 0;
          case 'available': return available;
          case 'on_order':  return r.qty_on_order ?? 0;
          case 'min_stock': return r.min_stock_level ?? 0;
          case 'supplier':  return csvCell(r.supplier_name || '');
          default:          return '';
        }
      }).join(',');
    });
    const blob = new Blob([[header, ...body].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `inventory-levels-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const hasFilters  = searchApplied || categoryId || warehouseId || zoneId || supplierId || committedOnly || onOrderOnly || lowStock;
  const activeCols  = ALL_COLS.filter(c => visibleCols.includes(c.key));

  const sortArrow = (key) => {
    if (sortKey !== key) return <span style={{ opacity: 0.25, marginLeft: 3, fontSize: 10 }}>↕</span>;
    return <span style={{ marginLeft: 3, fontSize: 10 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const FLAG_CHECKS = [
    ['committed_only', 'Has committed', committedOnly, setCommittedOnly,
      'Items with qty reserved > 0 (committed to orders)'],
    ['on_order',       'On order',       onOrderOnly,   setOnOrderOnly,
      'Items with outstanding purchase orders'],
    ['low_stock',      'Low stock',      lowStock,      setLowStock,
      'Available qty below minimum stock level'],
  ];

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

          {/* Flag toggles — apply immediately on change */}
          <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-end', paddingBottom: 2, flexWrap: 'wrap' }}>
            {FLAG_CHECKS.map(([key, label, val, setter, tip]) => (
              <label
                key={key}
                title={tip}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
                  cursor: 'pointer', userSelect: 'none',
                  padding: '5px 12px', borderRadius: 20,
                  border: val ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                  background: val ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                  color: val ? 'var(--accent)' : 'var(--text-sub)',
                  fontWeight: val ? 600 : 400,
                  transition: 'all 0.15s',
                }}
              >
                <input
                  type="checkbox"
                  checked={val}
                  onChange={e => setter(e.target.checked)}
                  style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
                />
                {label}
                {val && (
                  <span style={{ fontSize: 10, opacity: 0.7 }}>✓</span>
                )}
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

      {/* ── Toolbar ── */}
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, fontSize: 13, color: 'var(--text-sub)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {loading ? 'Loading…' : `${rows.length} stock line${rows.length !== 1 ? 's' : ''}${hasFilters ? ' (filtered)' : ''}`}
          {!loading && rows.length > 0 && (() => {
            const n = rows.filter(r => r.min_stock_level > 0 && parseFloat(r.qty_available) < parseFloat(r.min_stock_level)).length;
            return n > 0 ? (
              <span style={{ fontSize: 12, background: 'var(--red-dim, rgba(239,68,68,0.12))', color: 'var(--red)', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>
                {n} below minimum
              </span>
            ) : null;
          })()}
          {(committedOnly || onOrderOnly || lowStock) && (
            <span style={{ fontSize: 12, color: 'var(--accent)', fontStyle: 'italic' }}>
              — flag filter active, empty result means no items match
            </span>
          )}
        </div>

        {/* Edit mode */}
        <button
          type="button"
          className={`btn btn-sm ${editMode ? 'btn-primary' : 'btn-outline'}`}
          onClick={toggleEditMode}
          style={{ display: 'flex', alignItems: 'center', gap: 5 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          {editMode ? 'Cancel' : 'Edit'}
        </button>

        {Object.keys(edits).length > 0 && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={saveEdits}
            disabled={saving}
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}
          >
            {saving ? 'Saving…' : `Save ${Object.keys(edits).length} change${Object.keys(edits).length !== 1 ? 's' : ''}`}
          </button>
        )}

        {/* Column picker */}
        <div style={{ position: 'relative' }} ref={colPickerRef}>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setShowColPicker(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
              <circle cx="3" cy="6" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="3" cy="18" r="1"/>
            </svg>
            Columns
            {visibleCols.length < ALL_COLS.length && (
              <span style={{ fontSize: 10, background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '0 5px', marginLeft: 2 }}>
                {visibleCols.length}/{ALL_COLS.length}
              </span>
            )}
          </button>
          {showColPicker && (
            <div style={{
              position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 50,
              background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '8px 0', boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
              minWidth: 170,
            }}>
              <div style={{ padding: '4px 14px 8px', fontSize: 11, color: 'var(--text-sub)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
                Show / hide columns
              </div>
              {ALL_COLS.map(col => (
                <label
                  key={col.key}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 14px', fontSize: 13,
                    cursor: col.required ? 'default' : 'pointer',
                    color: visibleCols.includes(col.key) ? 'var(--text)' : 'var(--text-sub)',
                    opacity: col.required ? 0.6 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={visibleCols.includes(col.key)}
                    onChange={() => !col.required && toggleCol(col.key)}
                    disabled={col.required}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  {col.label}
                  {col.required && <span style={{ fontSize: 10, color: 'var(--text-sub)', marginLeft: 'auto' }}>always</span>}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Export CSV */}
        {rows.length > 0 && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={exportCsv}
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export CSV
          </button>
        )}
      </div>

      {/* ── Edit mode banner ── */}
      {editMode && (
        <div style={{
          marginBottom: 10, padding: '8px 16px', borderRadius: 6,
          background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
          fontSize: 13, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Edit mode — click the <strong>Min Stock</strong> fields to change reorder levels. Row clicks are disabled while editing.
          {Object.keys(edits).length > 0 && (
            <span style={{ marginLeft: 4, fontWeight: 600 }}>{Object.keys(edits).length} unsaved change{Object.keys(edits).length !== 1 ? 's' : ''}.</span>
          )}
        </div>
      )}

      {/* ── Table ── */}
      {loading ? (
        <div className={styles.loading}><div className="spinner-dark" /> Loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-sub)', fontSize: 14 }}>
          No stock found{hasFilters ? ' for the current filters.' : '.'}
          {(committedOnly || onOrderOnly || lowStock) && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-sub)' }}>
              {committedOnly && <div>Has committed: no items currently have reserved quantities (qty_reserved is updated when sales orders are confirmed).</div>}
              {onOrderOnly   && <div>On order: no items have outstanding purchase orders (qty_on_order is updated when purchase orders are raised).</div>}
              {lowStock      && <div>Low stock: no items are below their minimum stock level — set Min Stock levels via the Edit button.</div>}
            </div>
          )}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {activeCols.map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    style={{
                      padding: '10px 14px', textAlign: col.align,
                      fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
                      textTransform: 'uppercase', color: sortKey === col.key ? 'var(--accent)' : 'var(--text-sub)',
                      borderBottom: '1px solid var(--border)', background: 'var(--bg)',
                      cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                    }}
                  >
                    {col.label}{sortArrow(col.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(r => {
                const available     = parseFloat(r.qty_available);
                const belowMin      = r.min_stock_level > 0 && available < parseFloat(r.min_stock_level);
                const locationParts = [r.warehouse_name, r.zone_name, r.bin_code].filter(Boolean);

                return (
                  <tr
                    key={r.stock_id}
                    onClick={editMode ? undefined : () => navigate(`/products/${r.product_id}`)}
                    style={{ borderBottom: '1px solid var(--border)', cursor: editMode ? 'default' : 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                  >
                    {activeCols.map(col => {
                      switch (col.key) {
                        case 'product':
                          return (
                            <td key="product" style={{ padding: '10px 14px' }}>
                              <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                                  {r.product_name}
                                </span>
                                {belowMin && (
                                  <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--red-dim, rgba(239,68,68,0.12))', color: 'var(--red)', padding: '1px 6px', borderRadius: 10, letterSpacing: '0.05em' }}>
                                    LOW
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text-sub)' }}>{r.product_code}</div>
                            </td>
                          );
                        case 'category':
                          return <td key="category" style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-sub)' }}>{r.category_name || '—'}</td>;
                        case 'location':
                          return (
                            <td key="location" style={{ padding: '10px 14px' }}>
                              <div style={{ fontSize: 12 }}>{r.warehouse_name}</div>
                              {locationParts.length > 1 && (
                                <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text-sub)' }}>
                                  {locationParts.slice(1).join(' › ')}
                                </div>
                              )}
                            </td>
                          );
                        case 'on_hand':
                          return (
                            <td key="on_hand" style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 600 }}>
                              {fmt(r.qty_on_hand)}<span style={{ fontSize: 10, color: 'var(--text-sub)', marginLeft: 3 }}>{r.uom_code}</span>
                            </td>
                          );
                        case 'reserved':
                          return (
                            <td key="reserved" style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'DM Mono', color: parseFloat(r.qty_reserved) > 0 ? 'var(--orange, #f97316)' : 'var(--text-sub)' }}>
                              {fmt(r.qty_reserved)}<span style={{ fontSize: 10, color: 'var(--text-sub)', marginLeft: 3 }}>{r.uom_code}</span>
                            </td>
                          );
                        case 'available':
                          return (
                            <td key="available" style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 600, color: belowMin ? 'var(--red)' : available > 0 ? 'var(--green)' : 'var(--text-sub)' }}>
                              {fmt(r.qty_available)}<span style={{ fontSize: 10, color: 'var(--text-sub)', marginLeft: 3 }}>{r.uom_code}</span>
                            </td>
                          );
                        case 'on_order':
                          return (
                            <td key="on_order" style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'DM Mono', color: parseFloat(r.qty_on_order) > 0 ? 'var(--accent)' : 'var(--text-sub)' }}>
                              {fmt(r.qty_on_order)}<span style={{ fontSize: 10, color: 'var(--text-sub)', marginLeft: 3 }}>{r.uom_code}</span>
                            </td>
                          );
                        case 'min_stock': {
                          const currentVal = edits[r.product_id]?.min_stock_level ?? r.min_stock_level ?? 0;
                          const isDirty    = edits[r.product_id]?.min_stock_level !== undefined;
                          return (
                            <td
                              key="min_stock"
                              style={{ padding: '6px 14px', textAlign: 'right' }}
                              onClick={e => e.stopPropagation()}
                            >
                              {editMode ? (
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={currentVal}
                                  onChange={e => setMinStock(r.product_id, parseFloat(e.target.value) || 0)}
                                  style={{
                                    width: 80, textAlign: 'right', padding: '3px 6px',
                                    border: `1px solid ${isDirty ? 'var(--accent)' : 'var(--border)'}`,
                                    borderRadius: 4, fontSize: 13, fontFamily: 'DM Mono',
                                    background: isDirty ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'var(--bg)',
                                    color: 'var(--text)', outline: 'none',
                                  }}
                                />
                              ) : (
                                <span style={{ fontFamily: 'DM Mono', fontSize: 13, color: parseFloat(r.min_stock_level) > 0 ? 'var(--text)' : 'var(--text-sub)' }}>
                                  {parseFloat(r.min_stock_level) > 0 ? fmt(r.min_stock_level) : '—'}
                                  <span style={{ fontSize: 10, color: 'var(--text-sub)', marginLeft: 3 }}>{r.uom_code}</span>
                                </span>
                              )}
                            </td>
                          );
                        }
                        case 'supplier':
                          return <td key="supplier" style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-sub)' }}>{r.supplier_name || '—'}</td>;
                        default:
                          return null;
                      }
                    })}
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
