import React, { useState, useEffect, useCallback } from 'react';
import { warehouseApi } from '../../api/warehouse';
import { settingsApi }  from '../../api/settings';
import styles from './WarehousePage.module.css';

function fmt(v, decimals = 2) {
  if (v == null) return '0';
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: decimals }).format(v);
}
function fmtCurrency(v) {
  if (v == null) return '$0.00';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v);
}

// ── KPI Card ──────────────────────────────────────────────────
function KpiCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '16px 20px', flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-sub)', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'DM Mono', color: accent || 'var(--text)', lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

// ── Tab button ────────────────────────────────────────────────
function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 18px', fontSize: 13, fontWeight: active ? 600 : 400,
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? '#fff' : 'var(--text-sub)',
        border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
        borderRadius: 6, cursor: 'pointer', transition: 'all 0.12s',
      }}
    >
      {children}
    </button>
  );
}

// ── Stock Value tab (by product) ─────────────────────────────
function StockValueTab({ warehouses }) {
  const [rows,      setRows]      = useState([]);
  const [meta,      setMeta]      = useState({ total_value: 0, count: 0 });
  const [loading,   setLoading]   = useState(true);
  const [whFilter,  setWhFilter]  = useState('');
  const [search,    setSearch]    = useState('');
  const [searchQ,   setSearchQ]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (whFilter) params.warehouse_id = whFilter;
      if (searchQ)  params.search = searchQ;
      const { data } = await warehouseApi.reportStockValue(params);
      setRows(data.data);
      setMeta(data.meta);
    } finally {
      setLoading(false);
    }
  }, [whFilter, searchQ]);

  useEffect(() => { load(); }, [load]);

  function handleSearch(e) {
    e.preventDefault();
    setSearchQ(search);
  }

  const totalQty = rows.reduce((s, r) => s + parseFloat(r.qty_on_hand || 0), 0);

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <select
          className="form-input" style={{ width: 200 }}
          value={whFilter} onChange={e => setWhFilter(e.target.value)}
        >
          <option value="">All Warehouses</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
        </select>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
          <input
            className="form-input" style={{ width: 220 }}
            placeholder="Search product..."
            value={search} onChange={e => setSearch(e.target.value)}
          />
          <button type="submit" className="btn btn-outline btn-sm">Search</button>
        </form>
        <button className="btn btn-outline btn-sm" onClick={load}>↺ Refresh</button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <KpiCard label="Total Stock Value" value={fmtCurrency(meta.total_value)} sub="FIFO weighted average cost" accent="var(--accent)" />
        <KpiCard label="Products with Stock" value={fmt(meta.count, 0)} sub="Distinct SKUs on hand" />
        <KpiCard label="Total Units on Hand" value={fmt(totalQty)} sub="All warehouses combined" />
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-sub)', fontSize: 13 }}>
          <div className="spinner-dark" /> Loading...
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-sub)', fontSize: 14 }}>
          No stock with FIFO cost layers found. Add stock via the product page to create cost layers.
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {[
                  ['Product', 'left'],
                  ['Code', 'left'],
                  ['On Hand', 'right'],
                  ['Avg Unit Cost', 'right'],
                  ['Stock Value', 'right'],
                  ['Warehouses', 'right'],
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
              {rows.map(r => (
                <tr key={r.product_id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '11px 14px', fontWeight: 500 }}>{r.product_name}</td>
                  <td style={{ padding: '11px 14px', fontFamily: 'DM Mono', fontSize: 12, color: 'var(--text-sub)' }}>{r.product_code}</td>
                  <td style={{ padding: '11px 14px', textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 600 }}>{fmt(r.qty_on_hand, 4)}</td>
                  <td style={{ padding: '11px 14px', textAlign: 'right', fontFamily: 'DM Mono', color: 'var(--text-sub)' }}>{fmtCurrency(r.avg_unit_cost)}</td>
                  <td style={{ padding: '11px 14px', textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 700, color: 'var(--accent)' }}>
                    {fmtCurrency(r.stock_value)}
                  </td>
                  <td style={{ padding: '11px 14px', textAlign: 'right', color: 'var(--text-sub)' }}>{r.warehouse_count}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--bg)' }}>
                <td colSpan={4} style={{ padding: '11px 14px', fontWeight: 600, fontSize: 12, color: 'var(--text-sub)' }}>
                  Total ({rows.length} products)
                </td>
                <td style={{ padding: '11px 14px', textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 700, fontSize: 14, color: 'var(--accent)' }}>
                  {fmtCurrency(meta.total_value)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ── By Location tab ───────────────────────────────────────────
function ByLocationTab({ warehouses }) {
  const [rows,     setRows]    = useState([]);
  const [loading,  setLoading] = useState(true);
  const [whFilter, setWhFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (whFilter) params.warehouse_id = whFilter;
      const { data } = await warehouseApi.reportByLocation(params);
      setRows(data.data);
    } finally {
      setLoading(false);
    }
  }, [whFilter]);

  useEffect(() => { load(); }, [load]);

  // Group rows by warehouse → zone → bin
  const grouped = rows.reduce((acc, r) => {
    const whKey = r.warehouse_id;
    if (!acc[whKey]) acc[whKey] = { name: r.warehouse_name, code: r.warehouse_code, zones: {}, total_value: 0, total_qty: 0 };
    acc[whKey].total_value += parseFloat(r.fifo_value || 0);
    acc[whKey].total_qty   += parseFloat(r.qty_on_hand || 0);

    const zKey = r.zone_id || '__no_zone__';
    if (!acc[whKey].zones[zKey]) acc[whKey].zones[zKey] = { name: r.zone_name || 'No Zone', items: [] };
    acc[whKey].zones[zKey].items.push(r);
    return acc;
  }, {});

  const grandTotal = rows.reduce((s, r) => s + parseFloat(r.fifo_value || 0), 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <select
          className="form-input" style={{ width: 220 }}
          value={whFilter} onChange={e => setWhFilter(e.target.value)}
        >
          <option value="">All Warehouses</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
        </select>
        <button className="btn btn-outline btn-sm" onClick={load}>↺ Refresh</button>
      </div>

      {/* Grand total KPI */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <KpiCard label="Total Stock Value (All Locations)" value={fmtCurrency(grandTotal)} sub="FIFO cost across all warehouses" accent="var(--accent)" />
        <KpiCard label="Stock Lines" value={fmt(rows.length, 0)} sub="Product × location combinations" />
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-sub)', fontSize: 13 }}>
          <div className="spinner-dark" /> Loading...
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-sub)', fontSize: 14 }}>
          No stock found. Add stock via product adjustment to see location breakdown.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {Object.values(grouped).map(wh => (
            <div key={wh.code} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              {/* Warehouse header */}
              <div style={{
                background: 'var(--bg)', padding: '12px 16px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderBottom: '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'DM Mono', fontSize: 12, background: 'var(--accent-dim)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 4 }}>
                    {wh.code}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{wh.name}</span>
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 700, color: 'var(--accent)' }}>
                  {fmtCurrency(wh.total_value)}
                  <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-sub)' }}>
                    {fmt(wh.total_qty, 4)} units
                  </div>
                </div>
              </div>

              {/* Zone sub-tables */}
              {Object.values(wh.zones).map(zone => (
                <div key={zone.name}>
                  {zone.name !== 'No Zone' && (
                    <div style={{ padding: '8px 16px', background: 'var(--bg-sub, rgba(0,0,0,0.02))', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' }}>
                      Zone: {zone.name}
                    </div>
                  )}
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        {[['Product','left'],['Bin','left'],['On Hand','right'],['Available','right'],['FIFO Value','right']].map(([h, align]) => (
                          <th key={h} style={{ padding: '8px 16px', textAlign: align, fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {zone.items.map((item, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '10px 16px' }}>
                            <div style={{ fontWeight: 500 }}>{item.product_name}</div>
                            <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text-sub)' }}>{item.product_code}</div>
                          </td>
                          <td style={{ padding: '10px 16px', fontFamily: 'DM Mono', fontSize: 12, color: item.bin_code ? 'var(--text)' : 'var(--text-muted)' }}>
                            {item.bin_code || '—'}
                          </td>
                          <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 600 }}>
                            {fmt(item.qty_on_hand, 4)}
                          </td>
                          <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'DM Mono', color: item.qty_available > 0 ? 'var(--green)' : 'var(--red)' }}>
                            {fmt(item.qty_available, 4)}
                          </td>
                          <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'DM Mono', color: 'var(--accent)' }}>
                            {fmtCurrency(item.fifo_value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────
export default function StockReportsPage() {
  const [tab,        setTab]        = useState('value');
  const [warehouses, setWarehouses] = useState([]);
  const [whLoading,  setWhLoading]  = useState(true);

  useEffect(() => {
    settingsApi.listWarehouses()
      .then(({ data }) => setWarehouses(data.data))
      .finally(() => setWhLoading(false));
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Stock Reports</div>
          <div className={styles.sub}>FIFO-valued inventory — by product and by location</div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
        <Tab active={tab === 'value'}    onClick={() => setTab('value')}>Stock Value (by Product)</Tab>
        <Tab active={tab === 'location'} onClick={() => setTab('location')}>By Location</Tab>
      </div>

      {whLoading ? (
        <div className={styles.loading}><div className="spinner-dark" /> Loading...</div>
      ) : tab === 'value' ? (
        <StockValueTab warehouses={warehouses} />
      ) : (
        <ByLocationTab warehouses={warehouses} />
      )}
    </div>
  );
}
