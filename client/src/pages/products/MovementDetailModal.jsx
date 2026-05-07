import React from 'react';

function fmt(v, decimals = 4) {
  if (v == null) return '0';
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: decimals }).format(v);
}
function fmtCurrency(v) {
  if (v == null || v === 0) return null;
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v);
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const MOVEMENT_META = {
  adjustment:         { label: 'Adjustment',       pill: 'pill-grey',   sign: 'neutral' },
  receive:            { label: 'Received',          pill: 'pill-green',  sign: 'in'      },
  dispatch:           { label: 'Dispatched',        pill: 'pill-orange', sign: 'out'     },
  transfer_in:        { label: 'Transfer In',       pill: 'pill-blue',   sign: 'in'      },
  transfer_out:       { label: 'Transfer Out',      pill: 'pill-purple', sign: 'out'     },
  production_consume: { label: 'Production',        pill: 'pill-purple', sign: 'out'     },
  production_output:  { label: 'Production Output', pill: 'pill-green',  sign: 'in'      },
  service_consume:    { label: 'Service',           pill: 'pill-orange', sign: 'out'     },
  count_variance:     { label: 'Count Variance',    pill: 'pill-grey',   sign: 'neutral' },
};

function Row({ label, value, mono, accent }) {
  if (value == null || value === '' || value === '—') return null;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8,
      padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13,
    }}>
      <div style={{ color: 'var(--text-sub)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', paddingTop: 2 }}>
        {label}
      </div>
      <div style={{ fontFamily: mono ? 'DM Mono' : undefined, color: accent || 'var(--text)', wordBreak: 'break-word' }}>
        {value}
      </div>
    </div>
  );
}

export default function MovementDetailModal({ movement: m, onClose }) {
  if (!m) return null;
  const meta    = MOVEMENT_META[m.movement_type] || { label: m.movement_type, pill: 'pill-grey', sign: 'neutral' };
  const isIn    = meta.sign === 'in'  || (meta.sign === 'neutral' && m.qty > 0);
  const isOut   = meta.sign === 'out' || (meta.sign === 'neutral' && m.qty < 0);
  const qtyColor = isIn ? 'var(--green)' : isOut ? 'var(--red)' : 'var(--text-sub)';
  const qtyPrefix = isIn ? '+' : '';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(10,20,40,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: 'var(--card)', borderRadius: 'var(--radius-lg)',
        padding: '28px 32px', width: '100%', maxWidth: 520,
        boxShadow: 'var(--shadow-lg)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className={`pill ${meta.pill}`}>{meta.label}</span>
            <span style={{ fontSize: 15, fontWeight: 600, fontFamily: 'DM Mono', color: qtyColor }}>
              {qtyPrefix}{fmt(m.qty)}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-sub)', fontSize: 18, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* Detail rows */}
        <div>
          <Row label="Product"        value={m.product_name ? `${m.product_name} (${m.product_code})` : m.product_code} />
          <Row label="Warehouse"      value={m.warehouse_name ? `${m.warehouse_name} (${m.warehouse_code})` : null} />
          <Row label="Bin"            value={m.bin_code} mono />
          <Row label="From Warehouse" value={m.from_warehouse_name} />
          <Row label="Unit Cost"      value={fmtCurrency(m.unit_cost)} mono accent="var(--accent)" />
          <Row label="Total Cost"     value={fmtCurrency(parseFloat(m.unit_cost || 0) * Math.abs(m.qty))} mono accent="var(--accent)" />
          <Row label="Reference"      value={m.reference_type ? `${m.reference_type} #${m.reference_id}` : null} mono />
          <Row label="Notes"          value={m.notes} />
          <Row label="Performed by"   value={m.moved_by_name || m.moved_by_email} />
          <Row label="Date"           value={fmtDate(m.moved_at)} mono />
          {m.id && <Row label="Movement ID" value={String(m.id)} mono />}
        </div>

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
