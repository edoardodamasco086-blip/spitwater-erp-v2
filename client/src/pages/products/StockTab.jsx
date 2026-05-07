import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate }  from 'react-router-dom';
import { productsApi }  from '../../api/products';
import { warehouseApi } from '../../api/warehouse';
import { settingsApi }  from '../../api/settings';
import { useAuth }      from '../../context/AuthContext';
import MovementDetailModal from './MovementDetailModal';

function fmt(v, decimals = 4) {
  if (v == null) return '0';
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: decimals }).format(v);
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const MOVEMENT_META = {
  adjustment:          { label: 'Adjustment',       pill: 'pill-grey',   sign: 'neutral' },
  receive:             { label: 'Received',          pill: 'pill-green',  sign: 'in'      },
  dispatch:            { label: 'Dispatched',        pill: 'pill-orange', sign: 'out'     },
  transfer_in:         { label: 'Transfer In',       pill: 'pill-blue',   sign: 'in'      },
  transfer_out:        { label: 'Transfer Out',      pill: 'pill-purple', sign: 'out'     },
  production_consume:  { label: 'Production',        pill: 'pill-purple', sign: 'out'     },
  production_output:   { label: 'Production Output', pill: 'pill-green',  sign: 'in'      },
  service_consume:     { label: 'Service',           pill: 'pill-orange', sign: 'out'     },
  count_variance:      { label: 'Count Variance',    pill: 'pill-grey',   sign: 'neutral' },
};

const ADJUST_REASONS = [
  'Initial stock entry',
  'Stocktake variance',
  'Damaged / write-off',
  'Found stock',
  'Data correction',
  'Other',
];

// ── KPI Card ──────────────────────────────────────────────────
function KpiCard({ label, value, unit, color, sub }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '16px 20px', flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-sub)', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'DM Mono', color: color || 'var(--text)', lineHeight: 1 }}>
        {value}
        {unit && <span style={{ fontSize: 13, fontWeight: 400, marginLeft: 6, color: 'var(--text-sub)' }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

// ── Adjust Modal ──────────────────────────────────────────────
function AdjustModal({ productId, warehouses, onClose, onDone }) {
  const [form,   setForm]   = useState({ warehouse_id: warehouses[0]?.id || '', adjust_type: 'add', qty: '', unit_cost: '', reason: ADJUST_REASONS[0], reason_other: '', notes: '' });
  const [error,  setError]  = useState('');
  const [saving, setSaving] = useState(false);

  function set(f, v) { setForm(p => ({ ...p, [f]: v })); }

  const needsCost = form.adjust_type === 'add' || form.adjust_type === 'set';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const reason = form.reason === 'Other' ? form.reason_other.trim() : form.reason;
    if (!reason) { setError('Please specify a reason.'); return; }
    if (!form.qty || parseFloat(form.qty) <= 0) { setError('Quantity must be greater than 0.'); return; }
    setSaving(true);
    try {
      await warehouseApi.adjust({
        product_id:   productId,
        warehouse_id: parseInt(form.warehouse_id),
        adjust_type:  form.adjust_type,
        qty:          parseFloat(form.qty),
        unit_cost:    needsCost ? (parseFloat(form.unit_cost) || 0) : undefined,
        reason,
        notes: form.notes.trim() || undefined,
      });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Adjustment failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(10,20,40,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'var(--card)', borderRadius: 'var(--radius-lg)',
        padding: '28px 32px', width: '100%', maxWidth: 500,
        boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Adjust Stock</div>

        {error && (
          <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(224,82,82,0.2)', borderRadius: 6, padding: '10px 14px', fontSize: 13, color: 'var(--red)', marginBottom: 16 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">Warehouse</label>
            <select className="form-input" value={form.warehouse_id} onChange={e => set('warehouse_id', e.target.value)} required>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="form-group">
              <label className="form-label">Adjustment Type</label>
              <select className="form-input" value={form.adjust_type} onChange={e => set('adjust_type', e.target.value)}>
                <option value="add">Add stock</option>
                <option value="remove">Remove stock</option>
                <option value="set">Set to exact qty</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">
                {form.adjust_type === 'set' ? 'New Quantity' : 'Quantity'}
              </label>
              <input
                className="form-input" type="number" min="0" step="0.0001"
                value={form.qty} onChange={e => set('qty', e.target.value)}
                placeholder="0" required
              />
            </div>
          </div>

          {needsCost && (
            <div className="form-group">
              <label className="form-label">
                Unit Cost
                <span style={{ fontWeight: 400, color: 'var(--text-sub)', marginLeft: 4 }}>(creates FIFO cost layer)</span>
              </label>
              <input
                className="form-input" type="number" min="0" step="0.0001"
                value={form.unit_cost} onChange={e => set('unit_cost', e.target.value)}
                placeholder="0.00"
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Reason *</label>
            <select className="form-input" value={form.reason} onChange={e => set('reason', e.target.value)}>
              {ADJUST_REASONS.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>

          {form.reason === 'Other' && (
            <div className="form-group">
              <label className="form-label">Specify reason *</label>
              <input className="form-input" value={form.reason_other} onChange={e => set('reason_other', e.target.value)} placeholder="Describe the reason..." required />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Notes <span style={{ fontWeight: 400, color: 'var(--text-sub)' }}>(optional)</span></label>
            <input className="form-input" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Additional details..." />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Apply Adjustment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main StockTab export ───────────────────────────────────────
export default function StockTab({ productId, product }) {
  const { isAdmin }  = useAuth();
  const navigate     = useNavigate();

  const [stockData,    setStockData]    = useState([]);
  const [movements,    setMovements]    = useState([]);
  const [movTotal,     setMovTotal]     = useState(0);
  const [warehouses,   setWarehouses]   = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [loadingMov,   setLoadingMov]   = useState(true);
  const [showAdjust,   setShowAdjust]   = useState(false);
  const [selectedMov,  setSelectedMov]  = useState(null);

  const loadStock = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await productsApi.getStock(productId);
      setStockData(data.data);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  const loadMovements = useCallback(async () => {
    setLoadingMov(true);
    try {
      const { data } = await warehouseApi.getMovements({ product_id: productId, page: 1, limit: 10 });
      setMovements(data.data);
      setMovTotal(data.meta.total);
    } finally {
      setLoadingMov(false);
    }
  }, [productId]);

  useEffect(() => {
    Promise.all([
      loadStock(),
      loadMovements(),
      settingsApi.listWarehouses().then(({ data }) => setWarehouses(data.data)),
    ]);
  }, [loadStock, loadMovements]);

  // Computed totals
  const totalOnHand   = stockData.reduce((s, r) => s + (r.qty_on_hand   || 0), 0);
  const totalAvail    = stockData.reduce((s, r) => s + (r.qty_available  || 0), 0);
  const totalReserved = stockData.reduce((s, r) => s + (r.qty_reserved   || 0), 0);
  const totalOnOrder  = stockData.reduce((s, r) => s + (r.qty_on_order   || 0), 0);

  const minStock = product?.min_stock_level || 0;
  const availColor = totalAvail <= 0
    ? 'var(--red)'
    : minStock > 0 && totalAvail <= minStock
      ? 'var(--orange)'
      : 'var(--green)';

  function handleAdjustDone() {
    setShowAdjust(false);
    loadStock();
    loadMovements(1);
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0', color: 'var(--text-sub)', fontSize: 14 }}>
      <div className="spinner-dark" /> Loading stock levels...
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── KPI row ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12 }}>
        <KpiCard
          label="On Hand"
          value={fmt(totalOnHand)}
          unit={product?.uom_code}
          color="var(--text)"
          sub="Total physical stock"
        />
        <KpiCard
          label="Available"
          value={fmt(totalAvail)}
          unit={product?.uom_code}
          color={availColor}
          sub={minStock > 0 ? `Min level: ${fmt(minStock)} ${product?.uom_code || ''}`.trim() : 'On hand minus committed'}
        />
        <KpiCard
          label="Committed"
          value={fmt(totalReserved)}
          unit={product?.uom_code}
          color={totalReserved > 0 ? 'var(--orange)' : 'var(--text-sub)'}
          sub="Reserved for sales, services & production"
        />
        <KpiCard
          label="On Order"
          value={fmt(totalOnOrder)}
          unit={product?.uom_code}
          color="var(--accent)"
          sub="Incoming from suppliers"
        />
      </div>

      {/* ── Per-warehouse table ───────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            Stock by Warehouse
            {product?.uom_code && (
              <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 8, color: 'var(--text-sub)', fontFamily: 'DM Mono' }}>
                all quantities in {product.uom_code}{product.uom_name ? ` (${product.uom_name})` : ''}
              </span>
            )}
          </div>
          {isAdmin && warehouses.length > 0 && (
            <button className="btn btn-outline btn-sm" onClick={() => setShowAdjust(true)}>
              Adjust Stock
            </button>
          )}
        </div>

        {stockData.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-sub)', fontSize: 14 }}>
            No stock levels recorded yet. Stock is updated when goods receipts are posted.
          </div>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Warehouse', 'On Hand', 'Reserved', 'Available', 'On Order', 'Health', 'Updated'].map(h => (
                    <th key={h} style={{ padding: '9px 14px', textAlign: h === 'Warehouse' ? 'left' : 'right', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stockData.map(s => {
                  const avail = s.qty_available ?? (s.qty_on_hand - s.qty_reserved);
                  const health = avail <= 0 ? 'red' : minStock > 0 && avail <= minStock ? 'orange' : 'green';
                  return (
                    <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '11px 14px' }}>
                        <div style={{ fontWeight: 500 }}>{s.warehouse_name}</div>
                        <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text-sub)' }}>{s.warehouse_code}</div>
                      </td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 600 }}>{fmt(s.qty_on_hand)}</td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', fontFamily: 'DM Mono', color: s.qty_reserved > 0 ? 'var(--orange)' : 'var(--text-sub)' }}>{fmt(s.qty_reserved)}</td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 600, color: avail > 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(avail)}</td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', fontFamily: 'DM Mono', color: 'var(--accent)' }}>{fmt(s.qty_on_order)}</td>
                      <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                        <span className={`pill pill-${health === 'green' ? 'green' : health === 'orange' ? 'orange' : 'red'}`}>
                          {health === 'green' ? 'OK' : health === 'orange' ? 'Low' : 'Out'}
                        </span>
                      </td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', fontSize: 12, color: 'var(--text-sub)' }}>
                        {new Date(s.updated_at).toLocaleDateString('en-AU')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Movement history ──────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            Recent Movements
            {movTotal > 0 && (
              <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: 'var(--text-sub)' }}>
                last 10 of {movTotal}
              </span>
            )}
          </div>
          {movTotal > 0 && (
            <button
              className="btn btn-outline btn-sm"
              onClick={() => navigate(`/movements?product_id=${productId}`)}
            >
              View all {movTotal} movements →
            </button>
          )}
        </div>

        {loadingMov ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-sub)', fontSize: 13 }}>
            <div className="spinner-dark" style={{ width: 16, height: 16 }} /> Loading...
          </div>
        ) : movements.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-sub)', fontSize: 13 }}>
            No movements recorded yet.
          </div>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Type', 'Qty', 'Warehouse', 'Reference', 'Notes', 'By', 'Date'].map(h => (
                    <th key={h} style={{ padding: '9px 14px', textAlign: h === 'Qty' ? 'right' : 'left', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movements.map(m => {
                  const meta  = MOVEMENT_META[m.movement_type] || { label: m.movement_type, pill: 'pill-grey', sign: 'neutral' };
                  const isIn  = meta.sign === 'in'  || (meta.sign === 'neutral' && m.qty > 0);
                  const isOut = meta.sign === 'out' || (meta.sign === 'neutral' && m.qty < 0);
                  const qtyColor  = isIn ? 'var(--green)' : isOut ? 'var(--red)' : 'var(--text-sub)';
                  const qtyPrefix = isIn ? '+' : '';
                  return (
                    <tr
                      key={m.id}
                      style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                      onClick={() => setSelectedMov(m)}
                      title="Click to view details"
                    >
                      <td style={{ padding: '10px 14px' }}>
                        <span className={`pill ${meta.pill}`}>{meta.label}</span>
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 600, color: qtyColor }}>
                        {qtyPrefix}{fmt(m.qty)}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontWeight: 500 }}>{m.warehouse_name}</div>
                        {m.bin_code && <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text-sub)' }}>{m.bin_code}</div>}
                        {m.from_warehouse_name && (
                          <div style={{ fontSize: 11, color: 'var(--text-sub)' }}>from {m.from_warehouse_name}</div>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', fontFamily: 'DM Mono', fontSize: 12, color: 'var(--text-sub)' }}>
                        {m.reference_type ? `${m.reference_type} #${m.reference_id}` : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-sub)', maxWidth: 180 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.notes}>
                          {m.notes || '—'}
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-sub)' }}>
                        {m.moved_by_name || '—'}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-sub)', whiteSpace: 'nowrap' }}>
                        {fmtDate(m.moved_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Adjust modal ─────────────────────────────────────── */}
      {showAdjust && (
        <AdjustModal
          productId={productId}
          warehouses={warehouses}
          onClose={() => setShowAdjust(false)}
          onDone={handleAdjustDone}
        />
      )}

      {/* ── Movement detail modal ─────────────────────────────── */}
      {selectedMov && (
        <MovementDetailModal movement={selectedMov} onClose={() => setSelectedMov(null)} />
      )}
    </div>
  );
}
