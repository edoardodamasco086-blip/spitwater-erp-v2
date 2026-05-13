import React, { useState, useEffect, useCallback } from 'react';
import * as o2cApi from '../../api/o2c';
import { contactsApi }    from '../../api/contacts';
import { productsApi }    from '../../api/products';
import { permissionsApi } from '../../api/permissions';
import { dashboardApi }   from '../../api/dashboard';

// ── Formatters ────────────────────────────────────────────────
const AUD  = v => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v ?? 0);
const PCT  = v => v != null ? `${Number(v).toFixed(1)}%` : '—';
const dt   = v => v ? new Date(v).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const dtTs = v => v ? new Date(v).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

// ── Status maps ───────────────────────────────────────────────
const QT_STATUS = {
  draft:     { label: 'Draft',     color: '#8A95A3' },
  sent:      { label: 'Sent',      color: '#2F7FE8' },
  accepted:  { label: 'Accepted',  color: '#2ECC8A' },
  rejected:  { label: 'Rejected',  color: '#E05252' },
  converted: { label: 'Converted', color: '#9366E8' },
  cancelled: { label: 'Cancelled', color: '#8A95A3' },
  expired:   { label: 'Expired',   color: '#F5A623' },
};

const SO_STATUS = {
  draft:            { label: 'Draft',          color: '#8A95A3' },
  confirmed:        { label: 'Confirmed',      color: '#2ECC8A' },
  credit_hold:      { label: 'Credit Hold',   color: '#E05252' },
  partially_shipped:{ label: 'Partial Ship',  color: '#F5A623' },
  shipped:          { label: 'Shipped',        color: '#2ECC8A' },
  cancelled:        { label: 'Cancelled',      color: '#8A95A3' },
};

const CREDIT_STATUS = {
  ok:           { label: 'OK',         color: '#2ECC8A' },
  credit_hold:  { label: 'Hold',       color: '#E05252' },
  overdue_hold: { label: 'Overdue',    color: '#F5A623' },
};

const OD_STATUS = {
  open:       { label: 'Open',       color: '#8A95A3' },
  picking:    { label: 'Picking',    color: '#2F7FE8' },
  picked:     { label: 'Picked',     color: '#F5A623' },
  shipped:    { label: 'Shipped',    color: '#2ECC8A' },
  cancelled:  { label: 'Cancelled',  color: '#8A95A3' },
};

const ATP_STATUS = {
  full:       { label: 'Full',       color: '#2ECC8A' },
  partial:    { label: 'Partial',    color: '#F5A623' },
  no_stock:   { label: 'No Stock',   color: '#E05252' },
};

const COND_TYPES = [
  { value: 'customer_discount', label: 'Customer Discount' },
  { value: 'volume_break',      label: 'Volume Break' },
  { value: 'gst',               label: 'GST' },
];

// ── Shared UI helpers ─────────────────────────────────────────
const card  = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 };
const th    = { padding: '9px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)', textAlign: 'left', whiteSpace: 'nowrap' };
const td    = { padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, verticalAlign: 'middle' };
const inp   = { padding: '7px 10px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--input)', color: 'var(--text)', boxSizing: 'border-box', width: '100%' };
const label = { fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 };
const fg    = { marginBottom: 12 };

function Pill({ status, map }) {
  const s = map[status] || { label: status, color: '#8A95A3' };
  return (
    <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: s.color + '22', color: s.color }}>
      {s.label}
    </span>
  );
}

function Err({ msg }) {
  if (!msg) return null;
  return <div style={{ color: '#E05252', fontSize: 13, padding: '8px 12px', background: '#E0525215', borderRadius: 6, marginBottom: 12 }}>{msg}</div>;
}

function Info({ msg }) {
  if (!msg) return null;
  return <div style={{ color: '#2F7FE8', fontSize: 13, padding: '8px 12px', background: '#2F7FE815', borderRadius: 6, marginBottom: 12 }}>{msg}</div>;
}

function Btn({ children, onClick, variant = 'primary', size = 'sm', disabled, type = 'button' }) {
  const bg     = variant === 'primary' ? 'var(--accent)' : variant === 'danger' ? '#E05252' : variant === 'success' ? '#2ECC8A' : variant === 'warning' ? '#F5A623' : 'var(--bg)';
  const color  = variant === 'ghost' ? 'var(--text)' : '#fff';
  const border = variant === 'ghost' ? '1px solid var(--border)' : 'none';
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      style={{ padding: size === 'sm' ? '6px 14px' : '8px 18px', fontSize: 13, fontWeight: 600, borderRadius: 6, background: bg, color, border, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      {children}
    </button>
  );
}

function Modal({ onClose, children, width = 900 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '32px 16px' }}
      onClick={onClose}>
      <div style={{ background: 'var(--card)', borderRadius: 10, width, maxWidth: '98%', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ title, onClose }) {
  return (
    <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontWeight: 700, fontSize: 16 }}>{title}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-sub)', lineHeight: 1 }}>×</button>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-sub)', marginBottom: 10, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function Grid({ cols = 2, children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '12px 16px' }}>{children}</div>;
}

function KV({ k, v }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-sub)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 2 }}>{k}</div>
      <div style={{ fontSize: 13 }}>{v || '—'}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// QUOTES TAB
// ══════════════════════════════════════════════════════════════
function QuotesTab({ onConvertedToSO }) {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [detail,     setDetail]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const r = await o2cApi.listQuotes(); setRows(r.data.data || []); }
    catch (ex) { setErr(ex.response?.data?.error || 'Load failed.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Customer Quotes</span>
        <Btn onClick={() => setShowCreate(true)}>+ New Quote</Btn>
      </div>
      <Err msg={err} />
      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Quote #', 'Customer', 'Items', 'Total', 'Status', 'Expiry', ''].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</td></tr>}
              {!loading && !rows.length && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No quotes yet.</td></tr>}
              {rows.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(r.id)}>
                  <td style={td}><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.quote_number}</span></td>
                  <td style={td}>{r.customer_name || r.customer_id}</td>
                  <td style={td}>{r.item_count ?? 0}</td>
                  <td style={td}>{AUD(r.total_value)}</td>
                  <td style={td}><Pill status={r.status} map={QT_STATUS} /></td>
                  <td style={td}>{dt(r.validity_date)}</td>
                  <td style={td}><span style={{ color: 'var(--accent)', fontSize: 12 }}>Open →</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <QuoteCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
      {detail && (
        <QuoteDetailModal
          id={detail}
          onClose={() => { setDetail(null); load(); }}
          onConverted={() => { setDetail(null); load(); onConvertedToSO(); }}
        />
      )}
    </div>
  );
}

function QuoteCreateModal({ onClose, onCreated }) {
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ customer_id: '', validity_date: '', notes: '', payment_terms: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    contactsApi.list({ type: 'customer', limit: 500 }).then(r => setCustomers(r.data.data || [])).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!form.customer_id) { setErr('Select a customer.'); return; }
    setSaving(true); setErr('');
    try { await o2cApi.createQuote({ ...form, customer_id: Number(form.customer_id) }); onCreated(); }
    catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
    finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} width={580}>
      <ModalHeader title="New Customer Quote" onClose={onClose} />
      <form onSubmit={submit} style={{ padding: 24 }}>
        <Err msg={err} />
        <div style={fg}>
          <label style={label}>Customer *</label>
          <select style={inp} value={form.customer_id} onChange={set('customer_id')}>
            <option value="">— select —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.full_name || c.name}</option>)}
          </select>
        </div>
        <Grid cols={2}>
          <div style={fg}><label style={label}>Expiry Date</label><input style={inp} type="date" value={form.validity_date} onChange={set('validity_date')} /></div>
          <div style={fg}><label style={label}>Payment Terms</label><input style={inp} placeholder="e.g. Net 30" value={form.payment_terms} onChange={set('payment_terms')} /></div>
        </Grid>
        <div style={fg}><label style={label}>Notes</label><textarea style={{ ...inp, height: 72, resize: 'vertical' }} value={form.notes} onChange={set('notes')} /></div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create Quote'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function QuoteDetailModal({ id, onClose, onConverted }) {
  const [qt,      setQt]      = useState(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [products, setProducts] = useState([]);
  const [priceLists, setPriceLists] = useState([]);
  const [newItem, setNewItem] = useState({ product_id: '', qty: 1, price_list_id: '' });
  const [addingItem, setAddingItem] = useState(false);
  const [converting, setConverting] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [canUpdate, setCanUpdate] = useState(false);

  const load = useCallback(async () => {
    try { const r = await o2cApi.getQuote(id); setQt(r.data.data); }
    catch (ex) { setErr(ex.response?.data?.error || 'Load failed.'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    load();
    productsApi.list({ limit: 500 }).then(r => setProducts(r.data.data || [])).catch(() => {});
    permissionsApi.getMyPerms().then(r => {
      const p = r.data.data?.customer_quotes;
      setCanWrite(!!p?.can_write);
      setCanUpdate(!!p?.can_update);
    }).catch(() => {});
  }, [load]);

  async function act(fn, ...args) {
    setErr('');
    try { await fn(...args); await load(); }
    catch (ex) { setErr(ex.response?.data?.error || 'Action failed.'); }
  }

  async function addItem(e) {
    e.preventDefault();
    if (!newItem.product_id) { setErr('Select a product.'); return; }
    setAddingItem(true); setErr('');
    try {
      await o2cApi.addQuoteItem(id, {
        product_id:    Number(newItem.product_id),
        qty_requested: Number(newItem.qty) || 1,
        price_list_id: newItem.price_list_id ? Number(newItem.price_list_id) : null,
      });
      setNewItem({ product_id: '', qty: 1, price_list_id: '' });
      await load();
    } catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
    finally { setAddingItem(false); }
  }

  async function handleConvert() {
    if (!window.confirm('Convert this quote to a Sales Order?')) return;
    setConverting(true); setErr('');
    try { await o2cApi.convertQuote(id, {}); onConverted(); }
    catch (ex) { setErr(ex.response?.data?.error || 'Conversion failed.'); setConverting(false); }
  }

  if (loading) return <Modal onClose={onClose}><div style={{ padding: 48, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</div></Modal>;

  const isDraft  = qt?.status === 'draft';
  const isSent   = qt?.status === 'sent';
  const isActive = isDraft || isSent;

  return (
    <Modal onClose={onClose} width={980}>
      <ModalHeader title={`Quote ${qt?.quote_number || ''}`} onClose={onClose} />
      <div style={{ padding: 24 }}>
        <Err msg={err} />

        {/* Header */}
        <Section title="Quote Details">
          <Grid cols={4}>
            <KV k="Customer"    v={qt?.customer_name} />
            <KV k="Status"      v={<Pill status={qt?.status} map={QT_STATUS} />} />
            <KV k="Expiry"      v={dt(qt?.validity_date)} />
            <KV k="Payment"     v={qt?.payment_terms} />
            <KV k="Created"     v={dt(qt?.created_at)} />
            <KV k="Total"       v={<strong>{AUD(qt?.total_value)}</strong>} />
          </Grid>
          {qt?.notes && <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-sub)', fontStyle: 'italic' }}>{qt.notes}</div>}
        </Section>

        {/* Line Items */}
        <Section title={`Line Items (${qt?.items?.length ?? 0})`}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Product', 'Qty', 'Base Price', 'Cust. Disc.', 'Vol. Disc.', 'Unit Price', 'GST', 'Line Total', 'ATP', ''].map(h => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {(!qt?.items || !qt.items.length) && (
                  <tr><td colSpan={10} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No items added yet.</td></tr>
                )}
                {qt?.items?.map(item => (
                  <tr key={item.id}>
                    <td style={td}>{item.product_name || item.product_id}</td>
                    <td style={td}>{item.qty_requested}</td>
                    <td style={td}>{AUD(item.base_price)}</td>
                    <td style={td}>{PCT(item.customer_discount_pct)}</td>
                    <td style={td}>{PCT(item.volume_discount_pct)}</td>
                    <td style={td}>{AUD(item.unit_price)}</td>
                    <td style={td}>{AUD(item.tax_amount)}</td>
                    <td style={td}><strong>{AUD(item.line_total)}</strong></td>
                    <td style={td}>{item.atp_status ? <Pill status={item.atp_status} map={ATP_STATUS} /> : '—'}</td>
                    <td style={td}>
                      {isActive && canWrite && (
                        <button onClick={() => act(o2cApi.deleteQuoteItem, id, item.id)}
                          style={{ background: 'none', border: 'none', color: '#E05252', cursor: 'pointer', fontSize: 13 }}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {qt?.items?.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={7} style={{ ...td, textAlign: 'right', fontWeight: 600, color: 'var(--text-sub)', fontSize: 12 }}>TOTAL</td>
                    <td style={{ ...td, fontWeight: 700 }}>{AUD(qt?.total_value)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Add item form */}
          {isDraft && canWrite && (
            <form onSubmit={addItem} style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: '2 1 200px' }}>
                <label style={label}>Product</label>
                <select style={inp} value={newItem.product_id} onChange={e => setNewItem(n => ({ ...n, product_id: e.target.value }))}>
                  <option value="">— select product —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.product_code})</option>)}
                </select>
              </div>
              <div style={{ flex: '0 0 90px' }}>
                <label style={label}>Qty</label>
                <input style={inp} type="number" min="0.01" step="0.01" value={newItem.qty} onChange={e => setNewItem(n => ({ ...n, qty: e.target.value }))} />
              </div>
              <div>
                <label style={{ ...label, visibility: 'hidden' }}>.</label>
                <Btn type="submit" disabled={addingItem}>{addingItem ? 'Adding…' : '+ Add Item'}</Btn>
              </div>
            </form>
          )}
        </Section>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          {isDraft && canUpdate && <Btn onClick={() => act(o2cApi.sendQuote, id)}>Send to Customer</Btn>}
          {isSent  && canUpdate && <Btn variant="success" onClick={() => act(o2cApi.acceptQuote, id)}>Mark Accepted</Btn>}
          {isSent  && canUpdate && <Btn variant="danger"  onClick={() => act(o2cApi.rejectQuote, id)}>Mark Rejected</Btn>}
          {(qt?.status === 'accepted') && canUpdate && (
            <Btn variant="success" onClick={handleConvert} disabled={converting}>
              {converting ? 'Converting…' : 'Convert to Sales Order'}
            </Btn>
          )}
          {isDraft && canUpdate && <Btn variant="ghost" onClick={() => act(o2cApi.cancelQuote, id)}>Cancel</Btn>}
          <div style={{ flex: 1 }} />
          <Btn variant="ghost" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════
// SALES ORDERS TAB
// ══════════════════════════════════════════════════════════════
function SOsTab({ drillId, onDrillClear }) {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [detail,     setDetail]     = useState(drillId || null);

  useEffect(() => { if (drillId) setDetail(drillId); }, [drillId]);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const r = await o2cApi.listSOs(); setRows(r.data.data || []); }
    catch (ex) { setErr(ex.response?.data?.error || 'Load failed.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Sales Orders</span>
        <Btn onClick={() => setShowCreate(true)}>+ New SO</Btn>
      </div>
      <Err msg={err} />
      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['SO #', 'Customer', 'Items', 'Total', 'Status', 'Credit', 'Date', ''].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</td></tr>}
              {!loading && !rows.length && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No sales orders yet.</td></tr>}
              {rows.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(r.id)}>
                  <td style={td}><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.so_number}</span></td>
                  <td style={td}>{r.customer_name || r.customer_id}</td>
                  <td style={td}>{r.line_count ?? 0}</td>
                  <td style={td}>{AUD(r.total_value)}</td>
                  <td style={td}><Pill status={r.status} map={SO_STATUS} /></td>
                  <td style={td}>{r.credit_status ? <Pill status={r.credit_status} map={CREDIT_STATUS} /> : '—'}</td>
                  <td style={td}>{dt(r.created_at)}</td>
                  <td style={td}><span style={{ color: 'var(--accent)', fontSize: 12 }}>Open →</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <SOCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
      {detail && (
        <SODetailModal
          id={detail}
          onClose={() => { setDetail(null); load(); if (onDrillClear) onDrillClear(); }}
        />
      )}
    </div>
  );
}

function SOCreateModal({ onClose, onCreated }) {
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ customer_id: '', requested_delivery_date: '', payment_terms: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    contactsApi.list({ type: 'customer', limit: 500 }).then(r => setCustomers(r.data.data || [])).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!form.customer_id) { setErr('Select a customer.'); return; }
    setSaving(true); setErr('');
    try { await o2cApi.createSO({ ...form, customer_id: Number(form.customer_id) }); onCreated(); }
    catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
    finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} width={580}>
      <ModalHeader title="New Sales Order" onClose={onClose} />
      <form onSubmit={submit} style={{ padding: 24 }}>
        <Err msg={err} />
        <div style={fg}>
          <label style={label}>Customer *</label>
          <select style={inp} value={form.customer_id} onChange={set('customer_id')}>
            <option value="">— select —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.full_name || c.name}</option>)}
          </select>
        </div>
        <Grid cols={2}>
          <div style={fg}><label style={label}>Requested Delivery</label><input style={inp} type="date" value={form.requested_delivery_date} onChange={set('requested_delivery_date')} /></div>
          <div style={fg}><label style={label}>Payment Terms</label><input style={inp} placeholder="e.g. Net 30" value={form.payment_terms} onChange={set('payment_terms')} /></div>
        </Grid>
        <div style={fg}><label style={label}>Notes</label><textarea style={{ ...inp, height: 72, resize: 'vertical' }} value={form.notes} onChange={set('notes')} /></div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create SO'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function SODetailModal({ id, onClose }) {
  const [so,      setSo]      = useState(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [products, setProducts] = useState([]);
  const [newItem, setNewItem] = useState({ product_id: '', qty: 1, price_list_id: '' });
  const [addingItem, setAddingItem] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState(null);
  const [canWrite, setCanWrite] = useState(false);
  const [canUpdate, setCanUpdate] = useState(false);

  const load = useCallback(async () => {
    try { const r = await o2cApi.getSO(id); setSo(r.data.data); }
    catch (ex) { setErr(ex.response?.data?.error || 'Load failed.'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    load();
    productsApi.list({ limit: 500 }).then(r => setProducts(r.data.data || [])).catch(() => {});
    permissionsApi.getMyPerms().then(r => {
      const p = r.data.data?.sales_orders;
      setCanWrite(!!p?.can_write);
      setCanUpdate(!!p?.can_update);
    }).catch(() => {});
  }, [load]);

  async function act(fn, ...args) {
    setErr(''); setConfirmResult(null);
    try { await fn(...args); await load(); }
    catch (ex) { setErr(ex.response?.data?.error || 'Action failed.'); }
  }

  async function handleConfirm() {
    setConfirming(true); setErr(''); setConfirmResult(null);
    try {
      const r = await o2cApi.confirmSO(id);
      setConfirmResult(r.data);
      await load();
    } catch (ex) {
      setErr(ex.response?.data?.error || 'Confirm failed.');
    } finally { setConfirming(false); }
  }

  async function addItem(e) {
    e.preventDefault();
    if (!newItem.product_id) { setErr('Select a product.'); return; }
    setAddingItem(true); setErr('');
    try {
      await o2cApi.addSOItem(id, {
        product_id:   Number(newItem.product_id),
        qty:          Number(newItem.qty) || 1,
        price_list_id: newItem.price_list_id ? Number(newItem.price_list_id) : null,
      });
      setNewItem({ product_id: '', qty: 1, price_list_id: '' });
      await load();
    } catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
    finally { setAddingItem(false); }
  }

  if (loading) return <Modal onClose={onClose}><div style={{ padding: 48, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</div></Modal>;

  const isDraft  = so?.status === 'draft';
  const isHold   = so?.status === 'credit_hold';

  return (
    <Modal onClose={onClose} width={1040}>
      <ModalHeader title={`Sales Order ${so?.so_number || ''}`} onClose={onClose} />
      <div style={{ padding: 24 }}>
        <Err msg={err} />

        {/* Credit hold warning */}
        {isHold && (
          <div style={{ background: '#E0525218', border: '1px solid #E05252', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#E05252', fontWeight: 600 }}>
            ⚠ This order is on Credit Hold. Resolve the credit issue and release the hold before shipping.
          </div>
        )}

        {/* Confirm result */}
        {confirmResult && (
          <div style={{ background: '#2ECC8A18', border: '1px solid #2ECC8A', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
            <strong style={{ color: '#2ECC8A' }}>Order Confirmed</strong>
            {confirmResult.delivery_number && <span> · Delivery {confirmResult.delivery_number} created</span>}
            {confirmResult.schedule_lines && (
              <div style={{ marginTop: 6, color: 'var(--text-sub)' }}>
                {confirmResult.schedule_lines.filter(l => l.atp_category === 'available').length} line(s) available now ·{' '}
                {confirmResult.schedule_lines.filter(l => l.atp_category === 'backorder').length} line(s) on backorder
              </div>
            )}
          </div>
        )}

        {/* Header */}
        <Section title="Order Details">
          <Grid cols={4}>
            <KV k="Customer"    v={so?.customer_name} />
            <KV k="Status"      v={<Pill status={so?.status} map={SO_STATUS} />} />
            <KV k="Credit"      v={so?.credit_status ? <Pill status={so.credit_status} map={CREDIT_STATUS} /> : '—'} />
            <KV k="Total"       v={<strong>{AUD(so?.total_value)}</strong>} />
            <KV k="Created"     v={dt(so?.created_at)} />
            <KV k="Confirmed"   v={dt(so?.confirmed_at)} />
            <KV k="Delivery Req." v={dt(so?.requested_delivery_date)} />
            <KV k="Payment"     v={so?.payment_terms} />
          </Grid>
        </Section>

        {/* Line Items + Schedule Lines */}
        <Section title={`Line Items & Schedule Lines (${so?.items?.length ?? so?.line_count ?? 0})`}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Product', 'Ordered', 'Shipped', 'Unit Price', 'Line Total', 'Schedule Lines', ''].map(h => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {(!so?.items || !so.items.length) && (
                  <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No items.</td></tr>
                )}
                {so?.items?.map(item => (
                  <tr key={item.id}>
                    <td style={td}>{item.product_name || item.product_id}</td>
                    <td style={td}>{item.qty_ordered}</td>
                    <td style={td}>{item.qty_shipped ?? 0}</td>
                    <td style={td}>{AUD(item.unit_price)}</td>
                    <td style={td}><strong>{AUD(item.line_total)}</strong></td>
                    <td style={td}>
                      {item.schedule_lines?.length ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {item.schedule_lines.map(sl => (
                            <div key={sl.id} style={{ fontSize: 11, display: 'flex', gap: 8, alignItems: 'center' }}>
                              <span style={{ fontFamily: 'monospace', color: 'var(--text-sub)' }}>#{sl.schedule_line_no}</span>
                              <span>Qty {sl.qty}</span>
                              <span style={{ color: 'var(--text-sub)' }}>{dt(sl.confirmed_date)}</span>
                              <Pill status={sl.atp_category || sl.status || 'pending'} map={{ available: { label: 'Available', color: '#2ECC8A' }, backorder: { label: 'Backorder', color: '#F5A623' }, shipped: { label: 'Shipped', color: '#9366E8' }, pending: { label: 'Pending', color: '#8A95A3' } }} />
                            </div>
                          ))}
                        </div>
                      ) : <span style={{ color: 'var(--text-sub)', fontSize: 12 }}>Confirm to generate</span>}
                    </td>
                    <td style={td}>
                      {isDraft && canWrite && (
                        <button onClick={() => act(o2cApi.deleteSOItem, id, item.id)}
                          style={{ background: 'none', border: 'none', color: '#E05252', cursor: 'pointer', fontSize: 13 }}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {so?.items?.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={4} style={{ ...td, textAlign: 'right', fontWeight: 600, color: 'var(--text-sub)', fontSize: 12 }}>TOTAL</td>
                    <td style={{ ...td, fontWeight: 700 }}>{AUD(so?.total_value)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {isDraft && canWrite && (
            <form onSubmit={addItem} style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: '2 1 200px' }}>
                <label style={label}>Product</label>
                <select style={inp} value={newItem.product_id} onChange={e => setNewItem(n => ({ ...n, product_id: e.target.value }))}>
                  <option value="">— select product —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.product_code})</option>)}
                </select>
              </div>
              <div style={{ flex: '0 0 90px' }}>
                <label style={label}>Qty</label>
                <input style={inp} type="number" min="0.01" step="0.01" value={newItem.qty} onChange={e => setNewItem(n => ({ ...n, qty: e.target.value }))} />
              </div>
              <div>
                <label style={{ ...label, visibility: 'hidden' }}>.</label>
                <Btn type="submit" disabled={addingItem}>{addingItem ? 'Adding…' : '+ Add Item'}</Btn>
              </div>
            </form>
          )}
        </Section>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          {isDraft && canUpdate && (
            <Btn onClick={handleConfirm} disabled={confirming}>
              {confirming ? 'Confirming…' : 'Confirm Order'}
            </Btn>
          )}
          {isHold && canUpdate && (
            <Btn variant="warning" onClick={() => act(o2cApi.releaseHold, id)}>Release Hold</Btn>
          )}
          {(isDraft || isHold) && canUpdate && (
            <Btn variant="ghost" onClick={() => { if (window.confirm('Cancel this order?')) act(o2cApi.cancelSO, id); }}>Cancel</Btn>
          )}
          <div style={{ flex: 1 }} />
          <Btn variant="ghost" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════
// OUTBOUND DELIVERIES TAB
// ══════════════════════════════════════════════════════════════
function OutboundTab() {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [detail,  setDetail]  = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const r = await o2cApi.listOutbound(); setRows(r.data.data || []); }
    catch (ex) { setErr(ex.response?.data?.error || 'Load failed.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Outbound Deliveries</span>
        <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-sub)' }}>Deliveries are created automatically when a Sales Order is confirmed.</span>
      </div>
      <Err msg={err} />
      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Delivery #', 'SO #', 'Customer', 'Items', 'Status', 'Created', ''].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</td></tr>}
              {!loading && !rows.length && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No outbound deliveries yet.</td></tr>}
              {rows.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(r.id)}>
                  <td style={td}><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.delivery_number}</span></td>
                  <td style={td}><span style={{ fontFamily: 'monospace' }}>{r.so_number}</span></td>
                  <td style={td}>{r.customer_name}</td>
                  <td style={td}>{r.item_count ?? 0}</td>
                  <td style={td}><Pill status={r.status} map={OD_STATUS} /></td>
                  <td style={td}>{dt(r.created_at)}</td>
                  <td style={td}><span style={{ color: 'var(--accent)', fontSize: 12 }}>Open →</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail && <OutboundDetailModal id={detail} onClose={() => { setDetail(null); load(); }} />}
    </div>
  );
}

function OutboundDetailModal({ id, onClose }) {
  const [od,      setOd]      = useState(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [canUpdate, setCanUpdate] = useState(false);
  const [pickQtys, setPickQtys]   = useState({});
  const [shipping,  setShipping]  = useState(false);
  const [shipForm, setShipForm]   = useState({ carrier: '', tracking_number: '', shipped_date: '', notes: '' });

  const load = useCallback(async () => {
    try { const r = await o2cApi.getOutbound(id); setOd(r.data.data); }
    catch (ex) { setErr(ex.response?.data?.error || 'Load failed.'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    load();
    permissionsApi.getMyPerms().then(r => {
      setCanUpdate(!!r.data.data?.sales_orders?.can_update);
    }).catch(() => {});
  }, [load]);

  async function act(fn, ...args) {
    setErr('');
    try { await fn(...args); await load(); }
    catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
  }

  async function handlePickItem(itemId) {
    const qty = Number(pickQtys[itemId]);
    if (!qty || qty <= 0) { setErr('Enter a valid pick quantity.'); return; }
    setErr('');
    try {
      await o2cApi.pickItem(id, itemId, { qty_picked: qty });
      setPickQtys(p => ({ ...p, [itemId]: '' }));
      await load();
    } catch (ex) { setErr(ex.response?.data?.error || 'Pick failed.'); }
  }

  async function handleShip(e) {
    e.preventDefault();
    setShipping(true); setErr('');
    try { await o2cApi.shipDelivery(id, shipForm); await load(); }
    catch (ex) { setErr(ex.response?.data?.error || 'Ship failed.'); }
    finally { setShipping(false); }
  }

  if (loading) return <Modal onClose={onClose}><div style={{ padding: 48, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</div></Modal>;

  const isPicking  = od?.status === 'picking' || od?.status === 'picked';
  const isOpen     = od?.status === 'open';
  const isShipped  = od?.status === 'shipped';

  return (
    <Modal onClose={onClose} width={960}>
      <ModalHeader title={`Delivery ${od?.delivery_number || ''}`} onClose={onClose} />
      <div style={{ padding: 24 }}>
        <Err msg={err} />

        <Section title="Delivery Details">
          <Grid cols={4}>
            <KV k="SO Number"    v={<span style={{ fontFamily: 'monospace' }}>{od?.so_number}</span>} />
            <KV k="Customer"     v={od?.customer_name} />
            <KV k="Status"       v={<Pill status={od?.status} map={OD_STATUS} />} />
            <KV k="Created"      v={dt(od?.created_at)} />
            {od?.carrier         && <KV k="Carrier"    v={od.carrier} />}
            {od?.tracking_number && <KV k="Tracking"   v={od.tracking_number} />}
            {od?.actual_ship_date && <KV k="Shipped"    v={dt(od.actual_ship_date)} />}
          </Grid>
        </Section>

        <Section title={`Pick Items (${od?.items?.length ?? 0})`}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Product', 'Qty to Ship', 'Qty Picked', 'Status', isPicking && canUpdate ? 'Pick Action' : ''].filter(Boolean).map(h => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {(!od?.items || !od.items.length) && (
                  <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No items.</td></tr>
                )}
                {od?.items?.map(item => (
                  <tr key={item.id}>
                    <td style={td}>{item.product_name || item.product_id}</td>
                    <td style={td}>{item.qty_to_ship}</td>
                    <td style={td}>{item.qty_picked ?? 0}</td>
                    <td style={td}>
                      <Pill status={item.status || 'open'} map={{
                        open:    { label: 'Open',    color: '#8A95A3' },
                        picking: { label: 'Picking', color: '#2F7FE8' },
                        picked:  { label: 'Picked',  color: '#2ECC8A' },
                        shipped: { label: 'Shipped', color: '#9366E8' },
                      }} />
                    </td>
                    {isPicking && canUpdate && (
                      <td style={td}>
                        {item.status !== 'picked' && item.status !== 'shipped' && (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <input
                              style={{ ...inp, width: 80 }}
                              type="number" min="0.01" step="0.01"
                              placeholder={String(item.qty_to_ship - (item.qty_picked ?? 0))}
                              value={pickQtys[item.id] || ''}
                              onChange={e => setPickQtys(p => ({ ...p, [item.id]: e.target.value }))}
                            />
                            <Btn size="xs" onClick={() => handlePickItem(item.id)}>Pick</Btn>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Ship form */}
        {(isPicking) && canUpdate && (
          <Section title="Ship Delivery">
            <form onSubmit={handleShip}>
              <Grid cols={2}>
                <div style={fg}><label style={label}>Carrier</label><input style={inp} placeholder="e.g. Australia Post" value={shipForm.carrier} onChange={e => setShipForm(f => ({ ...f, carrier: e.target.value }))} /></div>
                <div style={fg}><label style={label}>Tracking Number</label><input style={inp} value={shipForm.tracking_number} onChange={e => setShipForm(f => ({ ...f, tracking_number: e.target.value }))} /></div>
                <div style={fg}><label style={label}>Ship Date</label><input style={inp} type="date" value={shipForm.shipped_date} onChange={e => setShipForm(f => ({ ...f, shipped_date: e.target.value }))} /></div>
                <div style={fg}><label style={label}>Notes</label><input style={inp} value={shipForm.notes} onChange={e => setShipForm(f => ({ ...f, notes: e.target.value }))} /></div>
              </Grid>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn type="submit" variant="success" disabled={shipping}>{shipping ? 'Shipping…' : 'Confirm Shipment'}</Btn>
              </div>
            </form>
          </Section>
        )}

        <div style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          {isOpen && canUpdate && <Btn onClick={() => act(o2cApi.startPicking, id)}>Start Picking</Btn>}
          {!isShipped && canUpdate && (
            <Btn variant="ghost" onClick={() => { if (window.confirm('Cancel this delivery?')) act(o2cApi.cancelOutbound, id); }}>Cancel</Btn>
          )}
          <div style={{ flex: 1 }} />
          <Btn variant="ghost" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════
// PRICING CONDITIONS TAB
// ══════════════════════════════════════════════════════════════
function PricingTab() {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showSim,    setShowSim]    = useState(false);
  const [canWrite, setCanWrite] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const r = await o2cApi.listPricing(); setRows(r.data.data || []); }
    catch (ex) { setErr(ex.response?.data?.error || 'Load failed.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    permissionsApi.getMyPerms().then(r => setCanWrite(!!r.data.data?.price_lists?.can_write)).catch(() => {});
  }, [load]);

  async function del(id) {
    if (!window.confirm('Delete this pricing condition?')) return;
    try { await o2cApi.deletePricing(id); load(); }
    catch (ex) { setErr(ex.response?.data?.error || 'Delete failed.'); }
  }

  const condLabel = v => COND_TYPES.find(c => c.value === v)?.label || v;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Pricing Conditions</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" onClick={() => setShowSim(true)}>Simulate Price</Btn>
          {canWrite && <Btn onClick={() => setShowCreate(true)}>+ New Condition</Btn>}
        </div>
      </div>

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 12, color: 'var(--text-sub)' }}>
        Pricing hierarchy: <strong>Base Price</strong> (price list or product default) → <strong>Customer Discount</strong> → <strong>Volume Break</strong> → <strong>GST</strong>
      </div>

      <Err msg={err} />
      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Type', 'Customer', 'Product / Category', 'Min Qty', 'Max Qty', 'Discount / Rate', 'GST Rate', 'Priority', ''].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</td></tr>}
              {!loading && !rows.length && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No pricing conditions.</td></tr>}
              {rows.map(r => (
                <tr key={r.id}>
                  <td style={td}><span style={{ fontWeight: 600 }}>{condLabel(r.condition_type)}</span></td>
                  <td style={td}>{r.customer_name || (r.customer_id ? `#${r.customer_id}` : <span style={{ color: 'var(--text-sub)' }}>All</span>)}</td>
                  <td style={td}>
                    {r.product_name
                      ? <span>{r.product_name} <span style={{ color: 'var(--text-sub)', fontSize: 11 }}>{r.product_code}</span></span>
                      : r.category_name
                        ? <span style={{ color: '#9366E8' }}>cat: {r.category_name}</span>
                        : <span style={{ color: 'var(--text-sub)' }}>All</span>}
                  </td>
                  <td style={td}>{r.min_qty ?? '—'}</td>
                  <td style={td}>{r.max_qty ?? '—'}</td>
                  <td style={td}>{r.discount_value != null ? (r.discount_type === 'fixed' ? AUD(r.discount_value) : PCT(r.discount_value)) : '—'}</td>
                  <td style={td}>{r.tax_rate != null && r.condition_type === 'gst' ? PCT(r.tax_rate) : '—'}</td>
                  <td style={td}>{r.priority}</td>
                  <td style={td}>
                    {canWrite && (
                      <button onClick={() => del(r.id)}
                        style={{ background: 'none', border: 'none', color: '#E05252', cursor: 'pointer', fontSize: 13 }}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && <PricingCreateModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {showSim    && <PriceSimModal onClose={() => setShowSim(false)} />}
    </div>
  );
}

function PricingCreateModal({ onClose, onCreated }) {
  const [customers,   setCustomers]   = useState([]);
  const [products,    setProducts]    = useState([]);
  const [categories,  setCategories]  = useState([]);
  const [form, setForm] = useState({
    condition_type: 'customer_discount',
    customer_id: '', product_id: '', category_id: '',
    min_qty: '', max_qty: '',
    discount_value: '', discount_type: 'percent',
    tax_rate: '', priority: 10,
    valid_from: '', valid_to: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    contactsApi.list({ type: 'customer', limit: 500 }).then(r => setCustomers(r.data.data || [])).catch(() => {});
    productsApi.list({ limit: 500 }).then(r => setProducts(r.data.data || [])).catch(() => {});
    productsApi.categories().then(r => setCategories(r.data.data || [])).catch(() => {});
  }, []);

  // When condition type changes, clear fields irrelevant to the new type
  function setCondType(e) {
    const t = e.target.value;
    setForm(f => ({
      ...f,
      condition_type: t,
      // GST has no discounts; customer_discount has no qty range
      customer_id:   t === 'volume_break' || t === 'gst' ? '' : f.customer_id,
      min_qty:       t === 'customer_discount' || t === 'gst' ? '' : f.min_qty,
      max_qty:       t === 'customer_discount' || t === 'gst' ? '' : f.max_qty,
      discount_value: t === 'gst' ? '' : f.discount_value,
      tax_rate:      t !== 'gst' ? '' : f.tax_rate,
    }));
  }

  // Product and Category are mutually exclusive scope selectors
  function setProduct(e) {
    setForm(f => ({ ...f, product_id: e.target.value, category_id: '' }));
  }
  function setCategory(e) {
    setForm(f => ({ ...f, category_id: e.target.value, product_id: '' }));
  }

  const ct = form.condition_type;
  const isCustomerDiscount = ct === 'customer_discount';
  const isVolumeBreak      = ct === 'volume_break';
  const isGST              = ct === 'gst';
  const showProductScope   = isCustomerDiscount || isVolumeBreak;
  const showDiscount       = !isGST;
  const showQtyRange       = isVolumeBreak;
  const showCustomer       = isCustomerDiscount;

  async function submit(e) {
    e.preventDefault();
    if (isGST && !form.tax_rate) { setErr('Tax Rate is required for GST type.'); return; }
    if (showDiscount && !form.discount_value) { setErr('Discount Value is required.'); return; }
    setSaving(true); setErr('');
    try {
      await o2cApi.createPricing({
        condition_type: ct,
        customer_id:    showCustomer && form.customer_id  ? Number(form.customer_id)  : null,
        product_id:     showProductScope && form.product_id  ? Number(form.product_id)  : null,
        category_id:    showProductScope && form.category_id ? Number(form.category_id) : null,
        min_qty:        showQtyRange && form.min_qty ? Number(form.min_qty) : null,
        max_qty:        showQtyRange && form.max_qty ? Number(form.max_qty) : null,
        discount_value: showDiscount ? Number(form.discount_value) : 0,
        discount_type:  form.discount_type || 'percent',
        tax_rate:       isGST ? Number(form.tax_rate) : 0,
        priority:       Number(form.priority) || 10,
        valid_from:     form.valid_from || null,
        valid_to:       form.valid_to   || null,
        notes:          form.notes      || null,
      });
      onCreated();
    } catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
    finally { setSaving(false); }
  }

  const sectionStyle = { background: 'rgba(47,127,232,0.04)', border: '1px solid rgba(47,127,232,0.12)', borderRadius: 8, padding: '12px 16px', marginBottom: 14 };
  const sectionLabel = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-sub)', marginBottom: 8 };

  return (
    <Modal onClose={onClose} width={620}>
      <ModalHeader title="New Pricing Condition" onClose={onClose} />
      <form onSubmit={submit} style={{ padding: 24 }}>
        <Err msg={err} />

        {/* Condition type */}
        <div style={fg}>
          <label style={label}>Condition Type *</label>
          <select style={inp} value={ct} onChange={setCondType}>
            {COND_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <div style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 4 }}>
            {isCustomerDiscount && 'Applies a % or fixed discount to a specific customer (or all customers) for a product, category, or all products.'}
            {isVolumeBreak      && 'Applies a quantity-based discount when order qty falls within the Min–Max range.'}
            {isGST              && 'Defines the GST rate applied to taxable sales. Only one GST condition is needed per org.'}
          </div>
        </div>

        {/* WHO section — customer_discount only */}
        {showCustomer && (
          <div style={sectionStyle}>
            <div style={sectionLabel}>Who</div>
            <div style={fg}>
              <label style={label}>Customer (blank = all customers)</label>
              <select style={inp} value={form.customer_id} onChange={set('customer_id')}>
                <option value="">All Customers</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.full_name || c.name}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* WHAT section — product or category scope */}
        {showProductScope && (
          <div style={sectionStyle}>
            <div style={sectionLabel}>What (scope — pick one or leave both blank for all products)</div>
            <Grid cols={2}>
              <div style={fg}>
                <label style={label}>Specific Product</label>
                <select style={inp} value={form.product_id} onChange={setProduct}>
                  <option value="">— None —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div style={fg}>
                <label style={label}>OR Category</label>
                <select style={inp} value={form.category_id} onChange={setCategory} disabled={!!form.product_id}>
                  <option value="">— None —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </Grid>
          </div>
        )}

        {/* QTY RANGE section — volume_break only */}
        {showQtyRange && (
          <div style={sectionStyle}>
            <div style={sectionLabel}>Quantity Range</div>
            <Grid cols={2}>
              <div style={fg}><label style={label}>Min Qty</label><input style={inp} type="number" min="0" step="0.01" placeholder="0" value={form.min_qty} onChange={set('min_qty')} /></div>
              <div style={fg}><label style={label}>Max Qty (blank = unlimited)</label><input style={inp} type="number" min="0" step="0.01" placeholder="∞" value={form.max_qty} onChange={set('max_qty')} /></div>
            </Grid>
          </div>
        )}

        {/* DISCOUNT section */}
        {showDiscount && (
          <div style={sectionStyle}>
            <div style={sectionLabel}>Discount</div>
            <Grid cols={2}>
              <div style={fg}>
                <label style={label}>Discount Type</label>
                <select style={inp} value={form.discount_type} onChange={set('discount_type')}>
                  <option value="percent">Percentage (%)</option>
                  <option value="fixed">Fixed Amount (AUD)</option>
                </select>
              </div>
              <div style={fg}>
                <label style={label}>Discount Value *</label>
                <input style={inp} type="number" min="0" step="0.01" placeholder={form.discount_type === 'percent' ? 'e.g. 10' : 'e.g. 5.00'} value={form.discount_value} onChange={set('discount_value')} />
              </div>
            </Grid>
          </div>
        )}

        {/* TAX RATE section — GST only */}
        {isGST && (
          <div style={sectionStyle}>
            <div style={sectionLabel}>Tax Rate</div>
            <div style={{ ...fg, maxWidth: 180 }}>
              <label style={label}>Tax Rate % *</label>
              <input style={inp} type="number" min="0" max="100" step="0.01" placeholder="e.g. 10" value={form.tax_rate} onChange={set('tax_rate')} />
            </div>
          </div>
        )}

        {/* Settings row */}
        <Grid cols={3}>
          <div style={fg}><label style={label}>Priority</label><input style={inp} type="number" min="1" value={form.priority} onChange={set('priority')} /></div>
          <div style={fg}><label style={label}>Valid From</label><input style={inp} type="date" value={form.valid_from} onChange={set('valid_from')} /></div>
          <div style={fg}><label style={label}>Valid To</label><input style={inp} type="date" value={form.valid_to} onChange={set('valid_to')} /></div>
        </Grid>
        <div style={fg}><label style={label}>Notes</label><input style={inp} placeholder="Optional" value={form.notes} onChange={set('notes')} /></div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Condition'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function PriceSimModal({ onClose }) {
  const [customers, setCustomers] = useState([]);
  const [products,  setProducts]  = useState([]);
  const [form, setForm] = useState({ customer_id: '', product_id: '', qty: 1, price_list_id: '' });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    contactsApi.list({ type: 'customer', limit: 500 }).then(r => setCustomers(r.data.data || [])).catch(() => {});
    productsApi.list({ limit: 500 }).then(r => setProducts(r.data.data || [])).catch(() => {});
  }, []);

  async function simulate(e) {
    e.preventDefault();
    if (!form.product_id) { setErr('Select a product.'); return; }
    setLoading(true); setErr(''); setResult(null);
    try {
      const r = await o2cApi.simulatePrice({
        customer_id:  form.customer_id  ? Number(form.customer_id)  : null,
        product_id:   Number(form.product_id),
        qty:          Number(form.qty) || 1,
        price_list_id: form.price_list_id ? Number(form.price_list_id) : null,
      });
      setResult(r.data.data);
    } catch (ex) { setErr(ex.response?.data?.error || 'Simulation failed.'); }
    finally { setLoading(false); }
  }

  return (
    <Modal onClose={onClose} width={560}>
      <ModalHeader title="Simulate Price" onClose={onClose} />
      <form onSubmit={simulate} style={{ padding: 24 }}>
        <Err msg={err} />
        <Grid cols={2}>
          <div style={fg}>
            <label style={label}>Customer</label>
            <select style={inp} value={form.customer_id} onChange={set('customer_id')}>
              <option value="">Anonymous</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.full_name || c.name}</option>)}
            </select>
          </div>
          <div style={fg}>
            <label style={label}>Product *</label>
            <select style={inp} value={form.product_id} onChange={set('product_id')}>
              <option value="">— select —</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </Grid>
        <div style={{ ...fg, maxWidth: 140 }}>
          <label style={label}>Quantity</label>
          <input style={inp} type="number" min="0.01" step="0.01" value={form.qty} onChange={set('qty')} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: result ? 20 : 0 }}>
          <Btn type="submit" disabled={loading}>{loading ? 'Calculating…' : 'Simulate'}</Btn>
        </div>

        {result && (
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>Price Breakdown</div>
            <table style={{ width: '100%', fontSize: 13 }}>
              <tbody>
                {[
                  ['Base Price',        AUD(result.basePrice)],
                  ['Customer Discount', result.customerDiscountPct ? `−${PCT(result.customerDiscountPct)}` : '—'],
                  ['Volume Discount',   result.volumeDiscountPct   ? `−${PCT(result.volumeDiscountPct)}`   : '—'],
                  ['Unit Price (ex GST)', AUD(result.unitPrice)],
                  ['GST',               AUD(result.taxAmount)],
                  ['Line Total (inc GST)', AUD(result.lineTotal)],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ padding: '4px 0', color: 'var(--text-sub)' }}>{k}</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: k.includes('Total') ? 700 : 400 }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: result ? 16 : 8 }}>
          <Btn variant="ghost" onClick={onClose}>Close</Btn>
        </div>
      </form>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════
// REPORTS TAB
// ══════════════════════════════════════════════════════════════
function ReportsTab({ onOpenSO }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const r = await dashboardApi.o2cReports(); setData(r.data.data); }
    catch (ex) { setErr(ex.response?.data?.error || 'Load failed.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const ageColor = days => days > 30 ? '#E05252' : days > 14 ? '#F5A623' : 'var(--text)';

  if (loading) return <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-sub)' }}>Loading reports…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <Err msg={err} />

      {/* ── Backorders ────────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Backorder Lines</span>
            {data?.backorders?.length > 0 && (
              <span style={{ marginLeft: 8, background: '#F5A62322', color: '#F5A623', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99 }}>
                {data.backorders.length}
              </span>
            )}
          </div>
          <Btn variant="ghost" size="sm" onClick={load}>Refresh</Btn>
        </div>
        <div style={card}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>{['SO #', 'Customer', 'Product', 'Backorder Qty', 'Expected Date', 'Source', 'SO Age', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {!data?.backorders?.length && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No open backorders.</td></tr>}
                {data?.backorders?.map(b => (
                  <tr key={b.id}>
                    <td style={td}><span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--accent)', cursor: 'pointer' }} onClick={() => onOpenSO(b.so_id)}>{b.so_number}</span></td>
                    <td style={td}>{b.customer_name}</td>
                    <td style={td}>{b.product_name} <span style={{ color: 'var(--text-sub)', fontSize: 11 }}>({b.product_code})</span></td>
                    <td style={td}><strong>{b.qty}</strong></td>
                    <td style={td}>{dt(b.confirmed_date)}</td>
                    <td style={td}>{b.source_type === 'purchase_order' ? `PO #${b.source_po_id}` : 'Stock'}</td>
                    <td style={td}><span style={{ color: ageColor(b.age_days), fontWeight: 600 }}>{b.age_days}d</span></td>
                    <td style={td}><span style={{ color: 'var(--accent)', fontSize: 12, cursor: 'pointer' }} onClick={() => onOpenSO(b.so_id)}>View SO →</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Late Deliveries ───────────────────────────────────── */}
      <div>
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Late Deliveries</span>
          {data?.lateDeliveries?.length > 0 && (
            <span style={{ marginLeft: 8, background: '#E0525222', color: '#E05252', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99 }}>
              {data.lateDeliveries.length}
            </span>
          )}
          <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-sub)' }}>Deliveries with a planned ship date in the past that haven't been shipped.</span>
        </div>
        <div style={card}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>{['Delivery #', 'SO #', 'Customer', 'Items', 'Planned Date', 'Days Late', 'Status', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {!data?.lateDeliveries?.length && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No late deliveries.</td></tr>}
                {data?.lateDeliveries?.map(d => (
                  <tr key={d.id}>
                    <td style={td}><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{d.delivery_number}</span></td>
                    <td style={td}><span style={{ fontFamily: 'monospace' }}>{d.so_number}</span></td>
                    <td style={td}>{d.customer_name}</td>
                    <td style={td}>{d.item_count}</td>
                    <td style={td}>{dt(d.planned_ship_date)}</td>
                    <td style={td}><span style={{ color: '#E05252', fontWeight: 700 }}>{d.days_late}d overdue</span></td>
                    <td style={td}><Pill status={d.status} map={OD_STATUS} /></td>
                    <td style={td}><span style={{ color: 'var(--accent)', fontSize: 12, cursor: 'pointer' }} onClick={() => onOpenSO(d.so_id)}>View SO →</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Stale Open Orders ─────────────────────────────────── */}
      <div>
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Stale Open Orders</span>
          {data?.staleOrders?.length > 0 && (
            <span style={{ marginLeft: 8, background: '#E0525222', color: '#E05252', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99 }}>
              {data.staleOrders.length}
            </span>
          )}
          <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-sub)' }}>Draft or credit-hold orders older than 7 days.</span>
        </div>
        <div style={card}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>{['SO #', 'Customer', 'Items', 'Value', 'Status', 'Created', 'Age', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {!data?.staleOrders?.length && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No stale orders.</td></tr>}
                {data?.staleOrders?.map(s => (
                  <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => onOpenSO(s.id)}>
                    <td style={td}><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{s.so_number}</span></td>
                    <td style={td}>{s.customer_name}</td>
                    <td style={td}>{s.item_count}</td>
                    <td style={td}>{AUD(s.total_value)}</td>
                    <td style={td}><Pill status={s.status} map={SO_STATUS} /></td>
                    <td style={td}>{dt(s.created_at)}</td>
                    <td style={td}><span style={{ color: ageColor(s.age_days), fontWeight: 600 }}>{s.age_days}d old</span></td>
                    <td style={td}><span style={{ color: 'var(--accent)', fontSize: 12 }}>Open →</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════
const TABS = [
  { id: 'quotes',   label: 'Quotes' },
  { id: 'so',       label: 'Sales Orders' },
  { id: 'outbound', label: 'Outbound Deliveries' },
  { id: 'pricing',  label: 'Pricing Conditions' },
  { id: 'reports',  label: 'Reports' },
];

export default function O2CPage() {
  const [tab,        setTab]        = useState('quotes');
  const [drillSOId,  setDrillSOId]  = useState(null);

  function openSOFromReport(soId) {
    setDrillSOId(soId);
    setTab('so');
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Order-to-Cash</h1>
        <p style={{ fontSize: 13, color: 'var(--text-sub)', margin: '4px 0 0' }}>
          Customer Quotes · Sales Orders · Outbound Deliveries · Pricing · Reports
        </p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '9px 20px', fontSize: 13, fontWeight: tab === t.id ? 700 : 400,
              background: 'none', border: 'none', cursor: 'pointer',
              color: tab === t.id ? 'var(--accent)' : 'var(--text-sub)',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1, borderRadius: '4px 4px 0 0',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'quotes'   && <QuotesTab  onConvertedToSO={() => setTab('so')} />}
      {tab === 'so'       && <SOsTab     drillId={drillSOId} onDrillClear={() => setDrillSOId(null)} />}
      {tab === 'outbound' && <OutboundTab />}
      {tab === 'pricing'  && <PricingTab />}
      {tab === 'reports'  && <ReportsTab onOpenSO={openSOFromReport} />}
    </div>
  );
}
