import React, { useState, useEffect, useCallback } from 'react';
import { productsApi } from '../../api/products';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

const ACTION_META = {
  'product.create': { label: 'Created',         color: 'var(--green)'  },
  'product.update': { label: 'Updated',         color: 'var(--accent)' },
  'product.void':   { label: 'Archived',        color: 'var(--red)'    },
};

function FieldChange({ field, oldValue, newValue, dataType }) {
  const label = field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  function render(v) {
    if (v == null || v === '') return <em style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>empty</em>;
    if (dataType === 'bool') return v === '1' || v === 'true' ? 'Yes' : 'No';
    if (dataType === 'decimal' || dataType === 'int') return v;
    // Truncate long text
    if (v.length > 120) return v.slice(0, 120) + '…';
    return v;
  }

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '140px 1fr 16px 1fr', gap: '6px 8px',
      alignItems: 'start', padding: '5px 0', borderBottom: '1px solid var(--border)',
      fontSize: 12,
    }}>
      <div style={{ fontWeight: 600, color: 'var(--text-sub)', paddingTop: 1 }}>{label}</div>
      <div style={{
        background: 'rgba(224,82,82,0.07)', border: '1px solid rgba(224,82,82,0.15)',
        borderRadius: 4, padding: '2px 8px', fontFamily: 'DM Mono',
        color: 'var(--red)', textDecoration: 'line-through', wordBreak: 'break-word',
      }}>
        {render(oldValue)}
      </div>
      <div style={{ color: 'var(--text-sub)', textAlign: 'center', paddingTop: 2 }}>→</div>
      <div style={{
        background: 'rgba(46,204,138,0.07)', border: '1px solid rgba(46,204,138,0.15)',
        borderRadius: 4, padding: '2px 8px', fontFamily: 'DM Mono',
        color: 'var(--green)', wordBreak: 'break-word',
      }}>
        {render(newValue)}
      </div>
    </div>
  );
}

function EventRow({ event }) {
  const [open, setOpen] = useState(false);
  const meta = ACTION_META[event.action_type] || { label: event.action_type, color: 'var(--text-sub)' };
  const hasChanges = event.changes?.length > 0;

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 8,
      background: 'var(--card)', overflow: 'hidden',
    }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px', cursor: hasChanges ? 'pointer' : 'default',
        }}
        onClick={() => hasChanges && setOpen(o => !o)}
      >
        {/* Avatar */}
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'var(--accent)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, flexShrink: 0,
        }}>
          {initials(event.user_name)}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
              textTransform: 'uppercase', color: meta.color,
              border: `1px solid ${meta.color}`, borderRadius: 4,
              padding: '1px 6px',
            }}>
              {meta.label}
            </span>
            <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>
              {event.user_name || event.user_email}
            </span>
            {hasChanges && (
              <span style={{ fontSize: 11, background: 'var(--accent-dim)', color: 'var(--accent)', padding: '1px 7px', borderRadius: 10 }}>
                {event.changes.length} field{event.changes.length > 1 ? 's' : ''} changed
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 2 }}>
            {event.description}
          </div>
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-sub)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {fmtDate(event.occurred_at)}
        </div>

        {hasChanges && (
          <div style={{ color: 'var(--text-sub)', fontSize: 14, flexShrink: 0 }}>
            {open ? '▲' : '▼'}
          </div>
        )}
      </div>

      {open && hasChanges && (
        <div style={{ padding: '0 16px 12px', borderTop: '1px solid var(--border)' }}>
          <div style={{ paddingTop: 8 }}>
            {event.changes.map((c, i) => (
              <FieldChange
                key={i}
                field={c.field}
                oldValue={c.old_value}
                newValue={c.new_value}
                dataType={c.data_type}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProductHistoryTab({ productId }) {
  const [events,  setEvents]  = useState([]);
  const [meta,    setMeta]    = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [page,    setPage]    = useState(1);

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const { data } = await productsApi.getHistory(productId, { page: p, limit: 30 });
      setEvents(data.data);
      setMeta(data.meta);
      setPage(p);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { load(1); }, [load]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0', color: 'var(--text-sub)', fontSize: 14 }}>
      <div className="spinner-dark" /> Loading history...
    </div>
  );

  if (events.length === 0) return (
    <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-sub)', fontSize: 14 }}>
      No history recorded for this product yet. Changes will appear here after the product is edited.
    </div>
  );

  const eventsWithChanges = events.filter(e => e.changes?.length > 0).length;

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-sub)', marginBottom: 16 }}>
        {meta.total} event{meta.total !== 1 ? 's' : ''}
        {eventsWithChanges > 0
          ? ` — click a row with field changes to expand the before/after diff.`
          : ` — field-level tracking is active for new changes. Older events were recorded before this feature was enabled.`}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {events.map(event => (
          <EventRow key={event.id} event={event} />
        ))}
      </div>

      {meta.pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>
            Page {meta.page} of {meta.pages}
          </span>
          <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => load(page - 1)}>
            ← Prev
          </button>
          <button className="btn btn-outline btn-sm" disabled={page >= meta.pages} onClick={() => load(page + 1)}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
