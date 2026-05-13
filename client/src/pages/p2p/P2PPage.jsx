import React, { useState, useEffect, useCallback } from 'react';
import * as p2pApi from '../../api/p2p';
import { contactsApi }  from '../../api/contacts';
import { productsApi }  from '../../api/products';
import { settingsApi }  from '../../api/settings';
import { permissionsApi } from '../../api/permissions';

// ── Formatters ────────────────────────────────────────────────
const AUD = v => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v ?? 0);
const dt  = v => v ? new Date(v).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const PR_STATUS = {
  draft:     { label: 'Draft',     color: '#8A95A3' },
  submitted: { label: 'Submitted', color: '#2F7FE8' },
  approved:  { label: 'Approved',  color: '#2ECC8A' },
  rejected:  { label: 'Rejected',  color: '#E05252' },
  converted: { label: 'Converted', color: '#9366E8' },
  cancelled: { label: 'Cancelled', color: '#8A95A3' },
};

const RFQ_STATUS = {
  draft:     { label: 'Draft',     color: '#8A95A3' },
  sent:      { label: 'Sent',      color: '#2F7FE8' },
  awarded:   { label: 'Awarded',   color: '#2ECC8A' },
  cancelled: { label: 'Cancelled', color: '#8A95A3' },
};

const PO_STATUS = {
  draft:               { label: 'Draft',             color: '#8A95A3' },
  pending_approval:    { label: 'Pending Approval',  color: '#F5A623' },
  approved:            { label: 'Approved',           color: '#2ECC8A' },
  sent:                { label: 'Sent',               color: '#2F7FE8' },
  partially_received:  { label: 'Partial',            color: '#F5A623' },
  fully_received:      { label: 'Received',           color: '#2ECC8A' },
  closed:              { label: 'Closed',             color: '#9366E8' },
  cancelled:           { label: 'Cancelled',          color: '#8A95A3' },
  rejected:            { label: 'Rejected',           color: '#E05252' },
};

const MATCH_STATUS = {
  matched:              { label: 'Matched',              color: '#2ECC8A' },
  received_not_invoiced:{ label: 'Rcv Not Inv',         color: '#F5A623' },
  partially_received:   { label: 'Partial',              color: '#F5A623' },
  pending:              { label: 'Pending',              color: '#8A95A3' },
};

// ── Shared styles ──────────────────────────────────────────────
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

function Btn({ children, onClick, variant = 'primary', size = 'sm', disabled }) {
  const bg = variant === 'primary' ? 'var(--accent)' : variant === 'danger' ? '#E05252' : variant === 'success' ? '#2ECC8A' : 'var(--bg)';
  const color = variant === 'ghost' ? 'var(--text)' : '#fff';
  const border = variant === 'ghost' ? '1px solid var(--border)' : 'none';
  return (
    <button onClick={onClick} disabled={disabled} style={{ padding: size === 'sm' ? '6px 14px' : '8px 18px', fontSize: 13, fontWeight: 600, borderRadius: 6, background: bg, color, border, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      {children}
    </button>
  );
}

function Modal({ onClose, children, width = 860 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '32px 16px' }}
      onClick={onClose}>
      <div style={{ background: 'var(--card)', borderRadius: 10, width, maxWidth: '100%', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
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

// ══════════════════════════════════════════════════════════════
// PURCHASE REQUISITIONS TAB
// ══════════════════════════════════════════════════════════════
function PRTab() {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [detail,     setDetail]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const r = await p2pApi.getPRs(); setRows(r.data.data || []); }
    catch (ex) { setErr(ex.response?.data?.error || 'Load failed.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Purchase Requisitions</span>
        <Btn onClick={() => setShowCreate(true)}>+ New PR</Btn>
      </div>
      <Err msg={err} />
      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['PR #','Department','Items','Total Est.','Status','Date',''].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</td></tr>}
              {!loading && !rows.length && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No requisitions yet.</td></tr>}
              {rows.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(r.id)}>
                  <td style={td}><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.pr_number}</span></td>
                  <td style={td}>{r.department || '—'}</td>
                  <td style={td}>{r.item_count ?? 0}</td>
                  <td style={td}>{AUD(r.total_est)}</td>
                  <td style={td}><Pill status={r.status} map={PR_STATUS} /></td>
                  <td style={td}>{dt(r.created_at)}</td>
                  <td style={td}><span style={{ color: 'var(--accent)', fontSize: 12 }}>Open →</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && <PRCreateModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {detail     && <PRDetailModal id={detail} onClose={() => { setDetail(null); load(); }} />}
    </div>
  );
}

function PRCreateModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ department: '', cost_center: '', required_date: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    try { await p2pApi.createPR(form); onCreated(); }
    catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
    finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} width={560}>
      <ModalHeader title="New Purchase Requisition" onClose={onClose} />
      <form onSubmit={submit} style={{ padding: 24 }}>
        <Err msg={err} />
        <div style={fg}><label style={label}>Department</label><input style={inp} value={form.department} onChange={set('department')} /></div>
        <Grid cols={2}>
          <div style={fg}><label style={label}>Cost Center</label><input style={inp} value={form.cost_center} onChange={set('cost_center')} /></div>
          <div style={fg}><label style={label}>Required By</label><input style={inp} type="date" value={form.required_date} onChange={set('required_date')} /></div>
        </Grid>
        <div style={fg}><label style={label}>Notes</label><textarea style={{ ...inp, height: 80, resize: 'vertical' }} value={form.notes} onChange={set('notes')} /></div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn disabled={saving} onClick={submit}>{saving ? 'Saving…' : 'Create'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function PRDetailModal({ id, onClose }) {
  const [pr,      setPr]      = useState(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [newItem, setNewItem] = useState({ product_id: '', qty_requested: 1, unit_cost_est: '', uom_id: '', warehouse_id: '', notes: '' });
  const [addingItem, setAddingItem] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [canApprove, setCanApprove] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await p2pApi.getPR(id);
      setPr(r.data.data);
    } catch (ex) { setErr(ex.response?.data?.error || 'Load failed.'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    load();
    productsApi.list({ limit: 500 }).then(r => setProducts(r.data.data || []));
    settingsApi.listWarehouses().then(r => setWarehouses(r.data.data || []));
    permissionsApi.getMyPerms().then(r => setCanApprove(!!r.data.data?.purchase_requisitions?.can_update)).catch(() => {});
  }, [load]);

  async function action(fn, ...args) {
    setErr('');
    try { await fn(...args); await load(); }
    catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
  }

  async function addItem(e) {
    e.preventDefault();
    if (!newItem.product_id) { setErr('Select a product.'); return; }
    setAddingItem(true);
    try {
      await p2pApi.addPRItem(id, { ...newItem, product_id: Number(newItem.product_id), qty_requested: Number(newItem.qty_requested), unit_cost_est: newItem.unit_cost_est ? Number(newItem.unit_cost_est) : null, uom_id: newItem.uom_id ? Number(newItem.uom_id) : null, warehouse_id: newItem.warehouse_id ? Number(newItem.warehouse_id) : null });
      setNewItem({ product_id: '', qty_requested: 1, unit_cost_est: '', uom_id: '', warehouse_id: '', notes: '' });
      await load();
    } catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
    finally { setAddingItem(false); }
  }

  if (loading) return <Modal onClose={onClose}><div style={{ padding: 40, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</div></Modal>;
  if (!pr)     return <Modal onClose={onClose}><div style={{ padding: 40, textAlign: 'center', color: '#E05252' }}>{err || 'Not found.'}</div></Modal>;

  const isDraft     = pr.status === 'draft';
  const isSubmitted = pr.status === 'submitted';

  return (
    <Modal onClose={onClose} width={920}>
      <ModalHeader title={`PR ${pr.pr_number}${pr.department ? ` — ${pr.department}` : ''}`} onClose={onClose} />
      <div style={{ padding: 24 }}>
        <Err msg={err} />

        {/* Header */}
        <div style={{ display: 'flex', gap: 32, marginBottom: 20, flexWrap: 'wrap' }}>
          <div><div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>STATUS</div><Pill status={pr.status} map={PR_STATUS} /></div>
          <div><div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>DEPARTMENT</div><span style={{ fontSize: 14 }}>{pr.department || '—'}</span></div>
          <div><div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>TOTAL EST.</div><span style={{ fontSize: 14, fontWeight: 700 }}>{AUD(pr.total_est)}</span></div>
          <div><div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>CREATED</div><span style={{ fontSize: 14 }}>{dt(pr.created_at)}</span></div>
          {pr.notes && <div style={{ flexBasis: '100%' }}><div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>NOTES</div><span style={{ fontSize: 13 }}>{pr.notes}</span></div>}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {isDraft     && <Btn onClick={() => action(p2pApi.submitPR, id)}>Submit for Approval</Btn>}
          {isSubmitted && canApprove && <Btn variant="success" onClick={() => action(p2pApi.approvePR, id)}>Approve</Btn>}
          {isSubmitted && canApprove && <Btn variant="danger"  onClick={() => setShowReject(true)}>Reject</Btn>}
          {['draft','submitted'].includes(pr.status) && <Btn variant="ghost" onClick={() => action(p2pApi.cancelPR, id)}>Cancel</Btn>}
        </div>

        {showReject && (
          <div style={{ ...card, padding: 16, marginBottom: 16 }}>
            <div style={fg}><label style={label}>Rejection Reason</label><textarea style={{ ...inp, height: 60 }} value={rejectReason} onChange={e => setRejectReason(e.target.value)} /></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="danger" onClick={() => { action(p2pApi.rejectPR, id, { reason: rejectReason }); setShowReject(false); }}>Confirm Reject</Btn>
              <Btn variant="ghost" onClick={() => setShowReject(false)}>Cancel</Btn>
            </div>
          </div>
        )}

        {/* Line Items */}
        <Section title="Line Items">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 12 }}>
            <thead>
              <tr>{['Product','Qty','UoM','Est. Unit Cost','Est. Total','Warehouse',''].map(h => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {(pr.items || []).map(item => (
                <tr key={item.id}>
                  <td style={td}>
                    <div>{item.product_name}</div>
                    {item.product_code && <div style={{ fontSize: 11, color: 'var(--text-sub)', fontFamily: 'monospace' }}>{item.product_code}</div>}
                  </td>
                  <td style={td}>{item.qty_requested}</td>
                  <td style={td}>{item.uom_code || '—'}</td>
                  <td style={td}>{item.unit_cost_est ? AUD(item.unit_cost_est) : '—'}</td>
                  <td style={td}>{AUD(item.total_est)}</td>
                  <td style={td}>{item.warehouse_name || '—'}</td>
                  <td style={td}>
                    {isDraft && (
                      <button onClick={() => action(p2pApi.deletePRItem, id, item.id)} style={{ background: 'none', border: 'none', color: '#E05252', cursor: 'pointer', fontSize: 12 }}>Remove</button>
                    )}
                  </td>
                </tr>
              ))}
              {!(pr.items || []).length && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No items yet.</td></tr>}
            </tbody>
          </table>

          {isDraft && (
            <form onSubmit={addItem} style={{ ...card, padding: 14, background: 'var(--bg)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: 'var(--text-sub)' }}>ADD ITEM</div>
              <Grid cols={3}>
                <div>
                  <label style={label}>Product *</label>
                  <select style={inp} value={newItem.product_id} onChange={e => setNewItem(f => ({ ...f, product_id: e.target.value }))}>
                    <option value="">— select —</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>Qty</label>
                  <input style={inp} type="number" min={0.01} step="any" value={newItem.qty_requested} onChange={e => setNewItem(f => ({ ...f, qty_requested: e.target.value }))} />
                </div>
                <div>
                  <label style={label}>Est. Unit Cost</label>
                  <input style={inp} type="number" min={0} step="any" value={newItem.unit_cost_est} onChange={e => setNewItem(f => ({ ...f, unit_cost_est: e.target.value }))} placeholder="0.00" />
                </div>
                <div>
                  <label style={label}>Warehouse</label>
                  <select style={inp} value={newItem.warehouse_id} onChange={e => setNewItem(f => ({ ...f, warehouse_id: e.target.value }))}>
                    <option value="">— any —</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>Notes</label>
                  <input style={inp} value={newItem.notes} onChange={e => setNewItem(f => ({ ...f, notes: e.target.value }))} />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <Btn disabled={addingItem}>{addingItem ? 'Adding…' : 'Add Item'}</Btn>
                </div>
              </Grid>
            </form>
          )}
        </Section>
      </div>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════
// RFQ TAB
// ══════════════════════════════════════════════════════════════
function RFQTab() {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [detail,     setDetail]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const r = await p2pApi.getRFQs(); setRows(r.data.data || []); }
    catch (ex) { setErr(ex.response?.data?.error || 'Load failed.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Request for Quotations</span>
        <Btn onClick={() => setShowCreate(true)}>+ New RFQ</Btn>
      </div>
      <Err msg={err} />
      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>{['RFQ #','Title','Linked PR','Items','Responses','Status','Date',''].map(h => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</td></tr>}
              {!loading && !rows.length && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No RFQs yet.</td></tr>}
              {rows.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(r.id)}>
                  <td style={td}><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.rfq_number}</span></td>
                  <td style={td}>{r.title}</td>
                  <td style={td}>{r.pr_number || '—'}</td>
                  <td style={td}>{r.item_count ?? 0}</td>
                  <td style={td}>{r.response_count ?? 0}</td>
                  <td style={td}><Pill status={r.status} map={RFQ_STATUS} /></td>
                  <td style={td}>{dt(r.created_at)}</td>
                  <td style={td}><span style={{ color: 'var(--accent)', fontSize: 12 }}>Open →</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && <RFQCreateModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {detail     && <RFQDetailModal id={detail} onClose={() => { setDetail(null); load(); }} />}
    </div>
  );
}

function RFQCreateModal({ onClose, onCreated }) {
  const [prs,  setPrs]  = useState([]);
  const [form, setForm] = useState({ title: '', pr_id: '', copy_pr_items: false, notes: '' });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  useEffect(() => { p2pApi.getPRs({ status: 'approved' }).then(r => setPrs(r.data.data || [])); }, []);

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setErr('Title is required.'); return; }
    setSaving(true); setErr('');
    try {
      await p2pApi.createRFQ({ ...form, pr_id: form.pr_id ? Number(form.pr_id) : null });
      onCreated();
    } catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
    finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} width={560}>
      <ModalHeader title="New RFQ" onClose={onClose} />
      <form onSubmit={submit} style={{ padding: 24 }}>
        <Err msg={err} />
        <div style={fg}><label style={label}>Title *</label><input style={inp} value={form.title} onChange={set('title')} /></div>
        <div style={fg}>
          <label style={label}>Link to Approved PR (optional)</label>
          <select style={inp} value={form.pr_id} onChange={set('pr_id')}>
            <option value="">— none —</option>
            {prs.map(p => <option key={p.id} value={p.id}>{p.pr_number}{p.department ? ` — ${p.department}` : ''}</option>)}
          </select>
        </div>
        {form.pr_id && (
          <div style={{ ...fg, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" id="cpi" checked={form.copy_pr_items} onChange={set('copy_pr_items')} />
            <label htmlFor="cpi" style={{ fontSize: 13, cursor: 'pointer' }}>Copy items from PR</label>
          </div>
        )}
        <div style={fg}><label style={label}>Notes</label><textarea style={{ ...inp, height: 80, resize: 'vertical' }} value={form.notes} onChange={set('notes')} /></div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn disabled={saving}>{saving ? 'Saving…' : 'Create'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function RFQDetailModal({ id, onClose }) {
  const [rfq,     setRfq]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [products,  setProducts]  = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [newItem,   setNewItem]   = useState({ product_id: '', description: '', qty_requested: 1 });
  const [addingItem, setAddingItem] = useState(false);
  const [newResp,    setNewResp]   = useState({ supplier_id: '', response_date: '', valid_until: '' });
  const [addingResp, setAddingResp] = useState(false);
  const [showRespForm, setShowRespForm] = useState(false);
  const [showItemForm, setShowItemForm] = useState(false);
  const [pricingRespId, setPricingRespId] = useState(null);
  const [priceInputs,   setPriceInputs]   = useState({});
  const [savingPrices,  setSavingPrices]  = useState(false);

  const load = useCallback(async () => {
    try { const r = await p2pApi.getRFQ(id); setRfq(r.data.data); }
    catch (ex) { setErr(ex.response?.data?.error || 'Load failed.'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    load();
    productsApi.list({ limit: 500 }).then(r => setProducts(r.data.data || []));
    contactsApi.list({ limit: 200 }).then(r => setSuppliers((r.data.data || []).filter(c => c.contact_type === 'supplier' || !c.contact_type)));
  }, [load]);

  async function action(fn, ...args) {
    setErr('');
    try { await fn(...args); await load(); }
    catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
  }

  async function addItem(e) {
    e.preventDefault();
    if (!newItem.product_id) { setErr('Select a product.'); return; }
    setAddingItem(true);
    try {
      await p2pApi.manageRFQItems(id, { product_id: Number(newItem.product_id), description: newItem.description || null, qty_requested: Number(newItem.qty_requested) });
      setNewItem({ product_id: '', description: '', qty_requested: 1 });
      setShowItemForm(false);
      await load();
    } catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
    finally { setAddingItem(false); }
  }

  async function addResponse(e) {
    e.preventDefault();
    if (!newResp.supplier_id || !newResp.response_date) { setErr('Supplier and response date required.'); return; }
    setAddingResp(true);
    try {
      await p2pApi.addRFQResponse(id, { supplier_id: Number(newResp.supplier_id), response_date: newResp.response_date, valid_until: newResp.valid_until || null });
      setNewResp({ supplier_id: '', response_date: '', valid_until: '' });
      setShowRespForm(false);
      await load();
    } catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
    finally { setAddingResp(false); }
  }

  function startPricing(respId) {
    const inputs = {};
    const existingItems = (rfq.responses || []).find(r => r.id === respId)?.items || [];
    (rfq.items || []).forEach(item => {
      const ex = existingItems.find(i => i.rfq_item_id === item.id);
      inputs[item.id] = { unit_price: ex ? ex.unit_price : '', delivery_days: ex ? (ex.delivery_days ?? '') : '' };
    });
    setPricingRespId(respId);
    setPriceInputs(inputs);
  }

  async function savePrices(e) {
    e.preventDefault();
    const items = Object.entries(priceInputs)
      .filter(([, v]) => v.unit_price !== '' && v.unit_price != null)
      .map(([rfq_item_id, v]) => ({ rfq_item_id: Number(rfq_item_id), unit_price: Number(v.unit_price), delivery_days: v.delivery_days !== '' ? Number(v.delivery_days) : null }));
    if (!items.length) { setErr('Enter at least one unit price.'); return; }
    setSavingPrices(true); setErr('');
    try {
      await p2pApi.addRFQResponseItems(id, pricingRespId, { items });
      setPricingRespId(null); setPriceInputs({});
      await load();
    } catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
    finally { setSavingPrices(false); }
  }

  if (loading) return <Modal onClose={onClose}><div style={{ padding: 40, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</div></Modal>;
  if (!rfq)    return <Modal onClose={onClose}><div style={{ padding: 40, textAlign: 'center', color: '#E05252' }}>{err}</div></Modal>;

  const isDraft = rfq.status === 'draft';
  const isSent  = rfq.status === 'sent';

  return (
    <Modal onClose={onClose} width={980}>
      <ModalHeader title={`RFQ ${rfq.rfq_number} — ${rfq.title}`} onClose={onClose} />
      <div style={{ padding: 24 }}>
        <Err msg={err} />

        <div style={{ display: 'flex', gap: 28, marginBottom: 20, flexWrap: 'wrap' }}>
          <div><div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>STATUS</div><Pill status={rfq.status} map={RFQ_STATUS} /></div>
          {rfq.pr_number && <div><div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>LINKED PR</div><span style={{ fontFamily: 'monospace', fontSize: 14 }}>{rfq.pr_number}</span></div>}
          <div><div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>CREATED</div><span style={{ fontSize: 14 }}>{dt(rfq.created_at)}</span></div>
          {rfq.notes && <div style={{ flexBasis: '100%' }}><div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>NOTES</div><span style={{ fontSize: 13 }}>{rfq.notes}</span></div>}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {isDraft && <Btn onClick={() => action(p2pApi.sendRFQ, id)}>Send to Vendors</Btn>}
          {isSent  && <Btn onClick={() => setShowRespForm(v => !v)}>+ Record Response</Btn>}
          {isDraft && <Btn variant="ghost" onClick={() => setShowItemForm(v => !v)}>+ Add Item</Btn>}
          {['draft','sent'].includes(rfq.status) && <Btn variant="ghost" onClick={() => action(p2pApi.cancelRFQ, id)}>Cancel</Btn>}
        </div>

        {/* Add item form */}
        {showItemForm && isDraft && (
          <form onSubmit={addItem} style={{ ...card, padding: 14, marginBottom: 16, background: 'var(--bg)' }}>
            <Grid cols={3}>
              <div>
                <label style={label}>Product *</label>
                <select style={inp} value={newItem.product_id} onChange={e => setNewItem(f => ({ ...f, product_id: e.target.value }))}>
                  <option value="">— select —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label style={label}>Description</label>
                <input style={inp} value={newItem.description} onChange={e => setNewItem(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div>
                <label style={label}>Qty</label>
                <input style={inp} type="number" min={0.01} step="any" value={newItem.qty_requested} onChange={e => setNewItem(f => ({ ...f, qty_requested: e.target.value }))} />
              </div>
            </Grid>
            <div style={{ marginTop: 10 }}><Btn disabled={addingItem}>{addingItem ? 'Adding…' : 'Add Item'}</Btn></div>
          </form>
        )}

        {/* Add response form */}
        {showRespForm && isSent && (
          <form onSubmit={addResponse} style={{ ...card, padding: 14, marginBottom: 16, background: 'var(--bg)' }}>
            <Grid cols={3}>
              <div>
                <label style={label}>Supplier *</label>
                <select style={inp} value={newResp.supplier_id} onChange={e => setNewResp(f => ({ ...f, supplier_id: e.target.value }))}>
                  <option value="">— select —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              <div>
                <label style={label}>Response Date *</label>
                <input style={inp} type="date" value={newResp.response_date} onChange={e => setNewResp(f => ({ ...f, response_date: e.target.value }))} />
              </div>
              <div>
                <label style={label}>Valid Until</label>
                <input style={inp} type="date" value={newResp.valid_until} onChange={e => setNewResp(f => ({ ...f, valid_until: e.target.value }))} />
              </div>
            </Grid>
            <div style={{ marginTop: 10 }}><Btn disabled={addingResp}>{addingResp ? 'Saving…' : 'Record Response'}</Btn></div>
          </form>
        )}

        {/* Items */}
        <Section title="RFQ Items">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['Product','Description','Qty'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {(rfq.items || []).map(item => (
                <tr key={item.id}>
                  <td style={td}>{item.product_name}</td>
                  <td style={td}>{item.description || '—'}</td>
                  <td style={td}>{item.qty_requested}</td>
                </tr>
              ))}
              {!(rfq.items || []).length && <tr><td colSpan={3} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No items.</td></tr>}
            </tbody>
          </table>
        </Section>

        {/* Vendor Responses */}
        <Section title="Vendor Responses">
          {(rfq.responses || []).map(resp => (
            <div key={resp.id} style={{ ...card, marginBottom: 12, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 20 }}>
                  <div><span style={{ fontSize: 11, color: 'var(--text-sub)' }}>SUPPLIER</span><div style={{ fontWeight: 600, fontSize: 14 }}>{resp.supplier_name}</div></div>
                  <div><span style={{ fontSize: 11, color: 'var(--text-sub)' }}>DATE</span><div style={{ fontSize: 14 }}>{dt(resp.response_date)}</div></div>
                  <div><span style={{ fontSize: 11, color: 'var(--text-sub)' }}>VALID UNTIL</span><div style={{ fontSize: 14 }}>{dt(resp.valid_until)}</div></div>
                  <div><span style={{ fontSize: 11, color: 'var(--text-sub)' }}>STATUS</span><div><Pill status={resp.status} map={{ pending: { label: 'Pending', color: '#8A95A3' }, received: { label: 'Received', color: '#2F7FE8' }, awarded: { label: 'Awarded', color: '#2ECC8A' }, not_awarded: { label: 'Not Awarded', color: '#8A95A3' } }} /></div></div>
                  <div><span style={{ fontSize: 11, color: 'var(--text-sub)' }}>TOTAL</span><div style={{ fontWeight: 700 }}>{AUD(resp.total_price)}</div></div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['received', 'pending'].includes(resp.status) && !['awarded'].includes(rfq.status) && (
                    <Btn variant="ghost" size="sm" onClick={() => pricingRespId === resp.id ? setPricingRespId(null) : startPricing(resp.id)}>
                      {pricingRespId === resp.id ? 'Cancel' : (resp.items || []).length ? 'Edit Prices' : 'Enter Prices'}
                    </Btn>
                  )}
                  {isSent && resp.status === 'received' && (resp.items || []).length > 0 && (
                    <Btn variant="success" onClick={() => action(p2pApi.awardRFQ, id, resp.id)}>Award → Create PO</Btn>
                  )}
                </div>
              </div>

              {(resp.items || []).length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr>{['Product','Unit Price','Delivery Days','Line Total'].map(h => <th key={h} style={{ ...th, fontSize: 10 }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {resp.items.map(ri => (
                      <tr key={ri.id}>
                        <td style={{ ...td, fontSize: 12 }}>{ri.product_name}</td>
                        <td style={{ ...td, fontSize: 12 }}>{AUD(ri.unit_price)}</td>
                        <td style={{ ...td, fontSize: 12 }}>{ri.delivery_days ?? '—'}</td>
                        <td style={{ ...td, fontSize: 12 }}>{AUD(ri.total_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {(resp.items || []).length === 0 && pricingRespId !== resp.id && (
                <p style={{ fontSize: 12, color: 'var(--text-sub)', margin: '4px 0 0' }}>No prices entered yet.</p>
              )}

              {pricingRespId === resp.id && (
                <form onSubmit={savePrices} style={{ marginTop: 12, padding: 12, background: 'var(--bg)', borderRadius: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-sub)', marginBottom: 8 }}>Enter Unit Prices</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 120px 120px', gap: '4px 8px', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-sub)', textTransform: 'uppercase' }}>Product</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-sub)', textTransform: 'uppercase' }}>Unit Price *</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-sub)', textTransform: 'uppercase' }}>Lead Days</span>
                  </div>
                  {(rfq.items || []).map(item => (
                    <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '2fr 120px 120px', gap: '4px 8px', marginBottom: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 12 }}>{item.product_name} <span style={{ color: 'var(--text-sub)' }}>× {item.qty_requested}</span></span>
                      <input style={{ ...inp, padding: '5px 8px' }} type="number" min={0} step="any" placeholder="0.00"
                        value={priceInputs[item.id]?.unit_price ?? ''}
                        onChange={e => setPriceInputs(f => ({ ...f, [item.id]: { ...f[item.id], unit_price: e.target.value } }))} />
                      <input style={{ ...inp, padding: '5px 8px' }} type="number" min={1} step={1} placeholder="—"
                        value={priceInputs[item.id]?.delivery_days ?? ''}
                        onChange={e => setPriceInputs(f => ({ ...f, [item.id]: { ...f[item.id], delivery_days: e.target.value } }))} />
                    </div>
                  ))}
                  <div style={{ marginTop: 8 }}><Btn disabled={savingPrices}>{savingPrices ? 'Saving…' : 'Save Prices'}</Btn></div>
                </form>
              )}
            </div>
          ))}
          {!(rfq.responses || []).length && <p style={{ color: 'var(--text-sub)', fontSize: 13 }}>No responses recorded yet.</p>}
        </Section>
      </div>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════
// PURCHASE ORDERS TAB
// ══════════════════════════════════════════════════════════════
function POTab() {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [detail,     setDetail]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const r = await p2pApi.getPOs(); setRows(r.data.data || []); }
    catch (ex) { setErr(ex.response?.data?.error || 'Load failed.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Purchase Orders</span>
        <Btn onClick={() => setShowCreate(true)}>+ New PO</Btn>
      </div>
      <Err msg={err} />
      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>{['PO #','Supplier','Total Value','Received','Status','Date',''].map(h => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</td></tr>}
              {!loading && !rows.length && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No purchase orders yet.</td></tr>}
              {rows.map(r => {
                const rcvPct = r.total_qty_ordered > 0 ? Math.round(r.total_qty_received / r.total_qty_ordered * 100) : 0;
                return (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(r.id)}>
                    <td style={td}><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.po_number}</span></td>
                    <td style={td}>{r.supplier_name || '—'}</td>
                    <td style={td}>{AUD(r.total_value)}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 60, height: 6, background: 'var(--border)', borderRadius: 3 }}>
                          <div style={{ width: `${rcvPct}%`, height: 6, background: rcvPct >= 100 ? '#2ECC8A' : '#F5A623', borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-sub)' }}>{rcvPct}%</span>
                      </div>
                    </td>
                    <td style={td}><Pill status={r.status} map={PO_STATUS} /></td>
                    <td style={td}>{dt(r.created_at)}</td>
                    <td style={td}><span style={{ color: 'var(--accent)', fontSize: 12 }}>Open →</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && <POCreateModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {detail     && <PODetailModal id={detail} onClose={() => { setDetail(null); load(); }} />}
    </div>
  );
}

function POCreateModal({ onClose, onCreated }) {
  const [suppliers,  setSuppliers]  = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [form, setForm] = useState({ supplier_id: '', warehouse_id: '', expected_delivery_date: '', payment_terms: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    contactsApi.list({ limit: 200 }).then(r => setSuppliers((r.data.data || []).filter(c => c.contact_type === 'supplier' || !c.contact_type)));
    settingsApi.listWarehouses().then(r => setWarehouses(r.data.data || []));
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!form.supplier_id) { setErr('Supplier is required.'); return; }
    setSaving(true); setErr('');
    try {
      await p2pApi.createPO({ ...form, supplier_id: Number(form.supplier_id), warehouse_id: form.warehouse_id ? Number(form.warehouse_id) : null });
      onCreated();
    } catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
    finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} width={620}>
      <ModalHeader title="New Purchase Order" onClose={onClose} />
      <form onSubmit={submit} style={{ padding: 24 }}>
        <Err msg={err} />
        <Grid cols={2}>
          <div style={fg}>
            <label style={label}>Supplier *</label>
            <select style={inp} value={form.supplier_id} onChange={set('supplier_id')}>
              <option value="">— select —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
          <div style={fg}>
            <label style={label}>Deliver to Warehouse</label>
            <select style={inp} value={form.warehouse_id} onChange={set('warehouse_id')}>
              <option value="">— any —</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div style={fg}>
            <label style={label}>Expected Delivery</label>
            <input style={inp} type="date" value={form.expected_delivery_date} onChange={set('expected_delivery_date')} />
          </div>
          <div style={fg}>
            <label style={label}>Payment Terms</label>
            <input style={inp} value={form.payment_terms} onChange={set('payment_terms')} placeholder="e.g. Net 30" />
          </div>
        </Grid>
        <div style={fg}><label style={label}>Notes</label><textarea style={{ ...inp, height: 70, resize: 'vertical' }} value={form.notes} onChange={set('notes')} /></div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn disabled={saving}>{saving ? 'Saving…' : 'Create PO'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function PODetailModal({ id, onClose }) {
  const [po,      setPo]      = useState(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [products, setProducts] = useState([]);
  const [newItem, setNewItem] = useState({ product_id: '', qty_ordered: 1, unit_price: '', notes: '' });
  const [addingItem, setAddingItem] = useState(false);
  const [comments, setComments] = useState('');
  const [showApproveForm, setShowApproveForm] = useState(false);
  const [showRejectForm,  setShowRejectForm]  = useState(false);
  const [canApprove, setCanApprove] = useState(false);

  const load = useCallback(async () => {
    try { const r = await p2pApi.getPO(id); setPo(r.data.data); }
    catch (ex) { setErr(ex.response?.data?.error || 'Load failed.'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    load();
    productsApi.list({ limit: 500 }).then(r => setProducts(r.data.data || []));
    permissionsApi.getMyPerms().then(r => setCanApprove(!!r.data.data?.purchase_orders?.can_update)).catch(() => {});
  }, [load]);

  async function action(fn, ...args) {
    setErr('');
    try { await fn(...args); await load(); }
    catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
  }

  async function addItem(e) {
    e.preventDefault();
    if (!newItem.product_id) { setErr('Select a product.'); return; }
    setAddingItem(true);
    try {
      await p2pApi.addPOItem(id, { product_id: Number(newItem.product_id), qty_ordered: Number(newItem.qty_ordered), unit_price: Number(newItem.unit_price), notes: newItem.notes });
      setNewItem({ product_id: '', qty_ordered: 1, unit_price: '', notes: '' });
      await load();
    } catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
    finally { setAddingItem(false); }
  }

  if (loading) return <Modal onClose={onClose}><div style={{ padding: 40, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</div></Modal>;
  if (!po)     return <Modal onClose={onClose}><div style={{ padding: 40, textAlign: 'center', color: '#E05252' }}>{err}</div></Modal>;

  const isDraft = po.status === 'draft';
  const isPendingApproval = po.status === 'pending_approval';
  const isApproved = po.status === 'approved';

  return (
    <Modal onClose={onClose} width={1020}>
      <ModalHeader title={`PO ${po.po_number}`} onClose={onClose} />
      <div style={{ padding: 24 }}>
        <Err msg={err} />

        {/* Header grid */}
        <div style={{ display: 'flex', gap: 28, marginBottom: 20, flexWrap: 'wrap' }}>
          <div><div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>STATUS</div><Pill status={po.status} map={PO_STATUS} /></div>
          <div><div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>SUPPLIER</div><span style={{ fontSize: 14, fontWeight: 600 }}>{po.supplier_name || '—'}</span></div>
          <div><div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>TOTAL VALUE</div><span style={{ fontSize: 16, fontWeight: 700 }}>{AUD(po.total_value)}</span></div>
          <div><div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>WAREHOUSE</div><span style={{ fontSize: 14 }}>{po.warehouse_name || '—'}</span></div>
          <div><div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>EXP. DELIVERY</div><span style={{ fontSize: 14 }}>{dt(po.expected_delivery_date)}</span></div>
          <div><div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>PAYMENT TERMS</div><span style={{ fontSize: 14 }}>{po.payment_terms || '—'}</span></div>
          {po.rfq_number && <div><div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>FROM RFQ</div><span style={{ fontFamily: 'monospace', fontSize: 14 }}>{po.rfq_number}</span></div>}
          {po.pr_number  && <div><div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>FROM PR</div><span style={{ fontFamily: 'monospace', fontSize: 14 }}>{po.pr_number}</span></div>}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {isDraft           && <Btn onClick={() => action(p2pApi.submitPO, id)}>Submit for Approval</Btn>}
          {isPendingApproval && canApprove && <Btn variant="success" onClick={() => setShowApproveForm(v => !v)}>Approve</Btn>}
          {isPendingApproval && canApprove && <Btn variant="danger"  onClick={() => setShowRejectForm(v => !v)}>Reject</Btn>}
          {isApproved     && <Btn onClick={() => action(p2pApi.sendPO, id)}>Mark as Sent</Btn>}
          {['draft','pending_approval','approved','sent'].includes(po.status) && (
            <Btn variant="ghost" onClick={() => action(p2pApi.cancelPO, id)}>Cancel</Btn>
          )}
        </div>

        {showApproveForm && (
          <div style={{ ...card, padding: 14, marginBottom: 16, background: 'var(--bg)' }}>
            <div style={fg}><label style={label}>Comments (optional)</label><textarea style={{ ...inp, height: 60 }} value={comments} onChange={e => setComments(e.target.value)} /></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="success" onClick={() => { action(p2pApi.approvePO, id, { comments }); setShowApproveForm(false); setComments(''); }}>Confirm Approve</Btn>
              <Btn variant="ghost" onClick={() => setShowApproveForm(false)}>Cancel</Btn>
            </div>
          </div>
        )}

        {showRejectForm && (
          <div style={{ ...card, padding: 14, marginBottom: 16, background: 'var(--bg)' }}>
            <div style={fg}><label style={label}>Rejection Reason</label><textarea style={{ ...inp, height: 60 }} value={comments} onChange={e => setComments(e.target.value)} /></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="danger" onClick={() => { action(p2pApi.rejectPO, id, { comments }); setShowRejectForm(false); setComments(''); }}>Confirm Reject</Btn>
              <Btn variant="ghost" onClick={() => setShowRejectForm(false)}>Cancel</Btn>
            </div>
          </div>
        )}

        {/* Line Items — 3-way match */}
        <Section title="Line Items — 3-Way Match">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>{['Product','Ordered','Received','Invoiced','Unit Price','Total','Match',''].map(h => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {(po.items || []).map(item => (
                <tr key={item.id}>
                  <td style={td}>
                    <div>{item.product_name}</div>
                    {item.product_code && <div style={{ fontSize: 11, color: 'var(--text-sub)', fontFamily: 'monospace' }}>{item.product_code}</div>}
                  </td>
                  <td style={td}>{item.qty_ordered}</td>
                  <td style={td} title={`${item.qty_received} / ${item.qty_ordered}`}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {item.qty_received}
                      {item.qty_ordered > 0 && (
                        <div style={{ width: 40, height: 4, background: 'var(--border)', borderRadius: 2 }}>
                          <div style={{ width: `${Math.min(100, item.qty_received / item.qty_ordered * 100)}%`, height: 4, background: '#2F7FE8', borderRadius: 2 }} />
                        </div>
                      )}
                    </div>
                  </td>
                  <td style={td}>{item.qty_invoiced}</td>
                  <td style={td}>{AUD(item.unit_price)}</td>
                  <td style={td}>{AUD(item.total_price)}</td>
                  <td style={td}><Pill status={item.match_status} map={MATCH_STATUS} /></td>
                  <td style={td}>
                    {isDraft && <button onClick={() => action(p2pApi.deletePOItem, id, item.id)} style={{ background: 'none', border: 'none', color: '#E05252', cursor: 'pointer', fontSize: 12 }}>Remove</button>}
                  </td>
                </tr>
              ))}
              {!(po.items || []).length && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No items.</td></tr>}
            </tbody>
          </table>

          {isDraft && (
            <form onSubmit={addItem} style={{ ...card, padding: 14, marginTop: 12, background: 'var(--bg)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: 'var(--text-sub)' }}>ADD ITEM</div>
              <Grid cols={4}>
                <div>
                  <label style={label}>Product *</label>
                  <select style={inp} value={newItem.product_id} onChange={e => setNewItem(f => ({ ...f, product_id: e.target.value }))}>
                    <option value="">— select —</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>Qty Ordered</label>
                  <input style={inp} type="number" min={0.01} step="any" value={newItem.qty_ordered} onChange={e => setNewItem(f => ({ ...f, qty_ordered: e.target.value }))} />
                </div>
                <div>
                  <label style={label}>Unit Price</label>
                  <input style={inp} type="number" min={0} step="any" value={newItem.unit_price} onChange={e => setNewItem(f => ({ ...f, unit_price: e.target.value }))} placeholder="0.00" />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <Btn disabled={addingItem}>{addingItem ? 'Adding…' : 'Add'}</Btn>
                </div>
              </Grid>
            </form>
          )}
        </Section>

        {/* Approval History */}
        {(po.approvals || []).length > 0 && (
          <Section title="Approval History">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{['Level','Level Name','Status','Requested','Actioned By','Date','Comments'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {po.approvals.map(a => (
                  <tr key={a.id}>
                    <td style={td}>{a.approval_level}</td>
                    <td style={td}>{a.level_name}</td>
                    <td style={td}>
                      <Pill status={a.status} map={{ pending: { label: 'Pending', color: '#F5A623' }, approved: { label: 'Approved', color: '#2ECC8A' }, rejected: { label: 'Rejected', color: '#E05252' } }} />
                    </td>
                    <td style={td}>{dt(a.requested_at)}</td>
                    <td style={td}>{a.actioned_by_name || '—'}</td>
                    <td style={td}>{dt(a.actioned_at)}</td>
                    <td style={td}>{a.comments || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* Linked GR */}
        {(po.receipts || []).length > 0 && (
          <Section title="Goods Receipts">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{['Delivery #','Status','Posted'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {po.receipts.map(r => (
                  <tr key={r.id}>
                    <td style={td}><span style={{ fontFamily: 'monospace' }}>{r.delivery_number}</span></td>
                    <td style={td}>{r.status}</td>
                    <td style={td}>{dt(r.posted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}
      </div>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════
// APPROVAL LEVELS TAB
// ══════════════════════════════════════════════════════════════
function ApprovalLevelsTab() {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [form,    setForm]    = useState({ level: '', level_name: '', min_amount: '', max_amount: '', approver_role: 'admin' });
  const [saving,  setSaving]  = useState(false);
  const [editing, setEditing] = useState(null);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await p2pApi.getApprovalLevels(); setRows(r.data.data || []); }
    catch (ex) { setErr(ex.response?.data?.error || 'Load failed.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(e) {
    e.preventDefault();
    if (!form.level || !form.level_name || form.min_amount === '') { setErr('Level, name, and min amount are required.'); return; }
    setSaving(true); setErr('');
    try {
      if (editing) {
        await p2pApi.updateApprovalLevel(editing, { level_name: form.level_name, min_amount: Number(form.min_amount), max_amount: form.max_amount ? Number(form.max_amount) : null, approver_role: form.approver_role });
      } else {
        await p2pApi.createApprovalLevel({ level: Number(form.level), level_name: form.level_name, min_amount: Number(form.min_amount), max_amount: form.max_amount ? Number(form.max_amount) : null, approver_role: form.approver_role });
      }
      setForm({ level: '', level_name: '', min_amount: '', max_amount: '', approver_role: 'admin' });
      setEditing(null);
      await load();
    } catch (ex) { setErr(ex.response?.data?.error || 'Save failed.'); }
    finally { setSaving(false); }
  }

  async function remove(id) {
    setErr('');
    try { await p2pApi.deleteApprovalLevel(id); await load(); }
    catch (ex) { setErr(ex.response?.data?.error || 'Delete failed.'); }
  }

  function startEdit(row) {
    setEditing(row.id);
    setForm({ level: row.level, level_name: row.level_name, min_amount: row.min_amount, max_amount: row.max_amount ?? '', approver_role: row.approver_role });
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>Approval Level Configuration</div>
      <p style={{ fontSize: 13, color: 'var(--text-sub)', marginBottom: 20 }}>
        A PO requires approval from all active levels where the PO total value ≥ that level's minimum amount. Levels are processed sequentially.
      </p>
      <Err msg={err} />

      {/* Form */}
      <div style={{ ...card, padding: 20, marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>{editing ? 'Edit Level' : 'Add Level'}</div>
        <form onSubmit={save}>
          <Grid cols={5}>
            <div>
              <label style={label}>Level # *</label>
              <input style={inp} type="number" min={1} step={1} value={form.level} onChange={set('level')} disabled={!!editing} />
            </div>
            <div>
              <label style={label}>Level Name *</label>
              <input style={inp} value={form.level_name} onChange={set('level_name')} placeholder="e.g. Manager" />
            </div>
            <div>
              <label style={label}>Min Amount ($) *</label>
              <input style={inp} type="number" min={0} step="any" value={form.min_amount} onChange={set('min_amount')} />
            </div>
            <div>
              <label style={label}>Max Amount ($)</label>
              <input style={inp} type="number" min={0} step="any" value={form.max_amount} onChange={set('max_amount')} placeholder="no limit" />
            </div>
            <div>
              <label style={label}>Approver Role</label>
              <select style={inp} value={form.approver_role} onChange={set('approver_role')}>
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="director">Director</option>
              </select>
            </div>
          </Grid>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <Btn disabled={saving}>{saving ? 'Saving…' : editing ? 'Update Level' : 'Add Level'}</Btn>
            {editing && <Btn variant="ghost" onClick={() => { setEditing(null); setForm({ level: '', level_name: '', min_amount: '', max_amount: '', approver_role: 'admin' }); }}>Cancel</Btn>}
          </div>
        </form>
      </div>

      {/* List */}
      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>{['Level','Name','Min Amount','Max Amount','Role','Active',''].map(h => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</td></tr>}
              {!loading && !rows.length && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No levels configured. Add one above.</td></tr>}
              {rows.map(r => (
                <tr key={r.id}>
                  <td style={td}><strong>{r.level}</strong></td>
                  <td style={td}>{r.level_name}</td>
                  <td style={td}>{AUD(r.min_amount)}</td>
                  <td style={td}>{r.max_amount != null ? AUD(r.max_amount) : 'No limit'}</td>
                  <td style={td}>{r.approver_role}</td>
                  <td style={td}>{r.is_active ? '✓' : '—'}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => startEdit(r)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }}>Edit</button>
                      <button onClick={() => remove(r.id)} style={{ background: 'none', border: 'none', color: '#E05252', cursor: 'pointer', fontSize: 12 }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// REPORTS TAB
// ══════════════════════════════════════════════════════════════
function ReportsTab() {
  const [activeReport, setActiveReport] = useState('backorders');
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate,   setToDate]   = useState('');

  const REPORTS = [
    { id: 'backorders',       label: 'Backorders' },
    { id: 'spend-by-supplier', label: 'Spend by Supplier' },
    { id: 'pending-approvals', label: 'Pending Approvals' },
  ];

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      let r;
      if (activeReport === 'backorders')        r = await p2pApi.getBackorders();
      else if (activeReport === 'spend-by-supplier') r = await p2pApi.getSpendBySupplier({ from_date: fromDate || undefined, to_date: toDate || undefined });
      else if (activeReport === 'pending-approvals') r = await p2pApi.getPendingApprovals();
      setData(r.data.data || []);
    } catch (ex) { setErr(ex.response?.data?.error || 'Load failed.'); }
    finally { setLoading(false); }
  }, [activeReport, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>P2P Reports</div>

      {/* Report selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        {REPORTS.map(r => (
          <button key={r.id} onClick={() => setActiveReport(r.id)} style={{
            padding: '6px 14px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
            background: activeReport === r.id ? 'var(--accent)' : 'var(--bg)',
            color: activeReport === r.id ? '#fff' : 'var(--text)',
            border: activeReport === r.id ? 'none' : '1px solid var(--border)',
            fontWeight: activeReport === r.id ? 600 : 400,
          }}>{r.label}</button>
        ))}
        {activeReport === 'spend-by-supplier' && (
          <>
            <input style={{ ...inp, width: 140 }} type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} placeholder="From" />
            <input style={{ ...inp, width: 140 }} type="date" value={toDate}   onChange={e => setToDate(e.target.value)}   placeholder="To" />
            <Btn variant="ghost" onClick={load}>Refresh</Btn>
          </>
        )}
      </div>

      <Err msg={err} />

      {/* Backorders */}
      {activeReport === 'backorders' && (
        <div style={card}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>{['PO #','Supplier','Product','Ordered','Received','Outstanding','Unit Price','Outstanding Value','Exp. Delivery'].map(h => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</td></tr>}
                {!loading && !data.length && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No backorders. All PO lines are fully received.</td></tr>}
                {data.map((row, i) => (
                  <tr key={i}>
                    <td style={td}><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{row.po_number}</span></td>
                    <td style={td}>{row.supplier_name}</td>
                    <td style={td}>
                      <div>{row.product_name}</div>
                      {row.product_code && <div style={{ fontSize: 11, color: 'var(--text-sub)', fontFamily: 'monospace' }}>{row.product_code}</div>}
                    </td>
                    <td style={td}>{row.qty_ordered}</td>
                    <td style={td}>{row.qty_received}</td>
                    <td style={{ ...td, fontWeight: 700, color: '#E05252' }}>{row.qty_outstanding}</td>
                    <td style={td}>{AUD(row.unit_price)}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{AUD(row.outstanding_value)}</td>
                    <td style={td}>{dt(row.expected_delivery_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Spend by Supplier */}
      {activeReport === 'spend-by-supplier' && (
        <div style={card}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>{['Supplier','PO Count','Total Spend','First PO','Last PO'].map(h => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</td></tr>}
                {!loading && !data.length && <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No spend data found.</td></tr>}
                {data.map((row, i) => (
                  <tr key={i}>
                    <td style={td}><span style={{ fontWeight: 600 }}>{row.supplier_name}</span></td>
                    <td style={td}>{row.po_count}</td>
                    <td style={{ ...td, fontWeight: 700, fontSize: 14 }}>{AUD(row.total_spend)}</td>
                    <td style={td}>{dt(row.first_po_date)}</td>
                    <td style={td}>{dt(row.last_po_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pending Approvals */}
      {activeReport === 'pending-approvals' && (
        <div style={card}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>{['PO #','Supplier','PO Value','Approval Level','Level Name','Requested'].map(h => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</td></tr>}
                {!loading && !data.length && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No pending approvals.</td></tr>}
                {data.map((row, i) => (
                  <tr key={i}>
                    <td style={td}><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{row.po_number}</span></td>
                    <td style={td}>{row.supplier_name}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{AUD(row.total_value)}</td>
                    <td style={td}>{row.approval_level}</td>
                    <td style={td}>{row.level_name || '—'}</td>
                    <td style={td}>{dt(row.requested_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PAGE ROOT
// ══════════════════════════════════════════════════════════════
const TABS = [
  { id: 'pr',      label: 'Purchase Requisitions' },
  { id: 'rfq',     label: 'RFQ' },
  { id: 'po',      label: 'Purchase Orders' },
  { id: 'levels',  label: 'Approval Levels' },
  { id: 'reports', label: 'Reports' },
];

export default function P2PPage() {
  const [tab, setTab] = useState('pr');

  return (
    <div style={{ padding: '28px 32px', background: 'var(--bg)', minHeight: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4 }}>Procure-to-Pay</div>
        <div style={{ fontSize: 13, color: 'var(--text-sub)' }}>Manage requisitions, RFQs, purchase orders, and approval workflows.</div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 18px', fontSize: 13, fontWeight: tab === t.id ? 700 : 400,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: tab === t.id ? 'var(--accent)' : 'var(--text-sub)',
            borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: -1,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'pr'      && <PRTab />}
      {tab === 'rfq'     && <RFQTab />}
      {tab === 'po'      && <POTab />}
      {tab === 'levels'  && <ApprovalLevelsTab />}
      {tab === 'reports' && <ReportsTab />}
    </div>
  );
}
