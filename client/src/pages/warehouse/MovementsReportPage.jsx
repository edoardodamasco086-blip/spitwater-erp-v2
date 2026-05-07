import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { warehouseApi } from '../../api/warehouse';
import { settingsApi }  from '../../api/settings';
import MovementDetailModal from '../products/MovementDetailModal';
import styles from './WarehousePage.module.css';

function fmt(v, d = 4) {
  if (v == null) return '0';
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: d }).format(v);
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const MOVEMENT_META = {
  adjustment:         { label: 'Adjustment',       pill: 'pill-grey'   },
  receive:            { label: 'Received',          pill: 'pill-green'  },
  dispatch:           { label: 'Dispatched',        pill: 'pill-orange' },
  transfer_in:        { label: 'Transfer In',       pill: 'pill-blue'   },
  transfer_out:       { label: 'Transfer Out',      pill: 'pill-purple' },
  production_consume: { label: 'Production',        pill: 'pill-purple' },
  production_output:  { label: 'Production Output', pill: 'pill-green'  },
  service_consume:    { label: 'Service',           pill: 'pill-orange' },
  count_variance:     { label: 'Count Variance',    pill: 'pill-grey'   },
};

const TYPE_OPTIONS = [
  { value: '',                   label: 'All types' },
  { value: 'adjustment',         label: 'Adjustment' },
  { value: 'receive',            label: 'Received' },
  { value: 'dispatch',           label: 'Dispatched' },
  { value: 'transfer_in',        label: 'Transfer In' },
  { value: 'transfer_out',       label: 'Transfer Out' },
  { value: 'production_consume', label: 'Production Consume' },
  { value: 'production_output',  label: 'Production Output' },
  { value: 'service_consume',    label: 'Service Consume' },
  { value: 'count_variance',     label: 'Count Variance' },
];

export default function MovementsReportPage() {
  const [searchParams]           = useSearchParams();

  const [rows,       setRows]       = useState([]);
  const [meta,       setMeta]       = useState({ total: 0, page: 1, pages: 1 });
  const [warehouses, setWarehouses] = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [selectedMov, setSelectedMov] = useState(null);
  const [page,       setPage]       = useState(1);

  // Filter state
  const [search,       setSearch]       = useState('');
  const [searchApplied,setSearchApplied]= useState(searchParams.get('search') || '');
  const [movType,      setMovType]      = useState('');
  const [warehouseId,  setWarehouseId]  = useState('');
  const [fromDate,     setFromDate]     = useState('');
  const [toDate,       setToDate]       = useState('');
  const productId = searchParams.get('product_id') || '';

  // Show the product_id filter label if pre-filtered from product page
  const [productName, setProductName] = useState(searchParams.get('product_name') || '');

  useEffect(() => {
    settingsApi.listWarehouses().then(({ data }) => setWarehouses(data.data));
  }, []);

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = { page: p, limit: 50 };
      if (productId)     params.product_id    = productId;
      if (movType)       params.movement_type = movType;
      if (warehouseId)   params.warehouse_id  = warehouseId;
      if (searchApplied) params.search        = searchApplied;
      if (fromDate)      params.from_date     = fromDate;
      if (toDate)        params.to_date       = toDate;

      const { data } = await warehouseApi.getMovements(params);
      setRows(data.data);
      setMeta(data.meta);
      setPage(p);
    } finally {
      setLoading(false);
    }
  }, [productId, movType, warehouseId, searchApplied, fromDate, toDate]);

  useEffect(() => { load(1); }, [load]);

  function handleSearch(e) {
    e.preventDefault();
    setSearchApplied(search);
  }

  function clearFilters() {
    setSearch(''); setSearchApplied('');
    setMovType(''); setWarehouseId('');
    setFromDate(''); setToDate('');
  }

  const hasFilters = searchApplied || movType || warehouseId || fromDate || toDate;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Movement History</div>
          <div className={styles.sub}>
            Full audit trail of all stock movements
            {productName && <span style={{ marginLeft: 8 }}>— filtered to <strong>{productName}</strong></span>}
            {productId && !productName && <span style={{ marginLeft: 8 }}>— filtered to product #{productId}</span>}
          </div>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px 20px', marginBottom: 20 }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: '2 1 200px', margin: 0 }}>
            <label className="form-label">Product search</label>
            <input
              className="form-input"
              placeholder="Name or code…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="form-group" style={{ flex: '1 1 160px', margin: 0 }}>
            <label className="form-label">Movement type</label>
            <select className="form-input" value={movType} onChange={e => setMovType(e.target.value)}>
              {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="form-group" style={{ flex: '1 1 160px', margin: 0 }}>
            <label className="form-label">Warehouse</label>
            <select className="form-input" value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
              <option value="">All warehouses</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
            </select>
          </div>

          <div className="form-group" style={{ flex: '0 0 140px', margin: 0 }}>
            <label className="form-label">From date</label>
            <input className="form-input" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>

          <div className="form-group" style={{ flex: '0 0 140px', margin: 0 }}>
            <label className="form-label">To date</label>
            <input className="form-input" type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>

          <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-end' }}>
            <button type="submit" className="btn btn-primary btn-sm">Search</button>
            {hasFilters && (
              <button type="button" className="btn btn-outline btn-sm" onClick={clearFilters}>Clear</button>
            )}
          </div>
        </form>
      </div>

      {/* ── Results ── */}
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, color: 'var(--text-sub)' }}>
          {loading ? 'Loading…' : `${meta.total} movement${meta.total !== 1 ? 's' : ''}${hasFilters ? ' (filtered)' : ''}`}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
          Click any row to see full details
        </div>
      </div>

      {loading ? (
        <div className={styles.loading}><div className="spinner-dark" /> Loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-sub)', fontSize: 14 }}>
          No movements found{hasFilters ? ' for the current filters.' : '.'}
        </div>
      ) : (
        <>
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {[
                    ['Date',      'left'],
                    ['Type',      'left'],
                    ['Product',   'left'],
                    ['Qty',       'right'],
                    ['Warehouse', 'left'],
                    ['Reference', 'left'],
                    ['Notes',     'left'],
                    ['By',        'left'],
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
                {rows.map(m => {
                  const meta_ = MOVEMENT_META[m.movement_type] || { label: m.movement_type, pill: 'pill-grey' };
                  const pos   = parseFloat(m.qty) >= 0;
                  return (
                    <tr
                      key={m.id}
                      style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                      onClick={() => setSelectedMov(m)}
                    >
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-sub)' }}>
                        {fmtDate(m.moved_at)}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span className={`pill ${meta_.pill}`}>{meta_.label}</span>
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontWeight: 500 }}>{m.product_name}</div>
                        <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text-sub)' }}>{m.product_code}</div>
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 600, color: pos ? 'var(--green)' : 'var(--red)' }}>
                        {pos ? '+' : ''}{fmt(m.qty)}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <div>{m.warehouse_name}</div>
                        {m.bin_code && <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text-sub)' }}>{m.bin_code}</div>}
                        {m.from_warehouse_name && <div style={{ fontSize: 11, color: 'var(--text-sub)' }}>← {m.from_warehouse_name}</div>}
                      </td>
                      <td style={{ padding: '10px 14px', fontFamily: 'DM Mono', fontSize: 12, color: 'var(--text-sub)' }}>
                        {m.reference_type
                          ? (m.reference_id ? `${m.reference_type} #${m.reference_id}` : m.reference_type)
                          : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-sub)', maxWidth: 200 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.notes}>
                          {m.notes || '—'}
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-sub)' }}>
                        {m.moved_by_name || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {meta.pages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
              <span style={{ fontSize: 13, color: 'var(--text-sub)' }}>
                Page {meta.page} of {meta.pages} ({meta.total} total)
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => load(page - 1)}>← Prev</button>
                {/* Page numbers (show up to 7 around current) */}
                {Array.from({ length: Math.min(7, meta.pages) }, (_, i) => {
                  const start = Math.max(1, Math.min(page - 3, meta.pages - 6));
                  const p = start + i;
                  if (p > meta.pages) return null;
                  return (
                    <button
                      key={p}
                      className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => load(p)}
                    >{p}</button>
                  );
                })}
                <button className="btn btn-outline btn-sm" disabled={page >= meta.pages} onClick={() => load(page + 1)}>Next →</button>
              </div>
            </div>
          )}
        </>
      )}

      {selectedMov && (
        <MovementDetailModal movement={selectedMov} onClose={() => setSelectedMov(null)} />
      )}
    </div>
  );
}
