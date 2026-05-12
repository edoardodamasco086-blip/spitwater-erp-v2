import React, { useState, useEffect, useCallback } from 'react';
import { receivingApi } from '../../api/receiving';
import { warehouseApi  } from '../../api/warehouse';
import { productsApi   } from '../../api/products';
import { contactsApi   } from '../../api/contacts';

const AUD = (v) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v ?? 0);
const dt  = (v) => v ? new Date(v).toLocaleDateString('en-AU') : '—';

const STATUS_COLOR = {
  open:     '#2F7FE8',
  complete: '#2ECC8A',
  voided:   '#E05252',
};

// ── Shared styles ──────────────────────────────────────────────
const page    = { padding: '28px 32px', background: 'var(--bg)', minHeight: '100%' };
const card    = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' };
const tWrap   = { overflowX: 'auto' };
const tbl     = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th      = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const td      = { padding: '11px 14px', borderBottom: '1px solid var(--border-subtle, var(--border))', color: 'var(--text)', verticalAlign: 'middle' };
const inputSt = { padding: '7px 10px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--input)', color: 'var(--text)', boxSizing: 'border-box' };

// ── Create session modal ───────────────────────────────────────
function CreateSessionModal({ onClose, onCreated }) {
  const [warehouses,  setWarehouses]  = useState([]);
  const [suppliers,   setSuppliers]   = useState([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [supplierId,  setSupplierId]  = useState('');
  const [docket,      setDocket]      = useState('');
  const [notes,       setNotes]       = useState('');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');

  useEffect(() => {
    warehouseApi.listWarehouses()
      .then(r => setWarehouses(r.data.data || []))
      .catch(() => {});
    contactsApi.list({ limit: 200 })
      .then(r => setSuppliers(r.data.data || []))
      .catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!warehouseId) { setError('Please select a warehouse.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await receivingApi.create({
        warehouse_id:    Number(warehouseId),
        supplier_id:     supplierId ? Number(supplierId) : null,
        supplier_docket: docket || null,
        notes:           notes  || null,
      });
      onCreated(res.data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create session.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: 'var(--card)', borderRadius: 10, padding: 28, width: 460, maxWidth: '95vw', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 20px', fontSize: 16 }}>New Receiving Session</h3>
        {error && <div style={{ color: '#E05252', fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 }}>Warehouse *</label>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} style={{ ...inputSt, width: '100%' }}>
              <option value="">Select warehouse…</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 }}>Supplier</label>
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)} style={{ ...inputSt, width: '100%' }}>
              <option value="">None / walk-in</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 }}>Supplier Docket / Ref</label>
            <input value={docket} onChange={e => setDocket(e.target.value)} placeholder="e.g. PO12345" style={{ ...inputSt, width: '100%' }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 }}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              style={{ ...inputSt, width: '100%', resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
            <button type="button" className="btn btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Creating…' : 'Create Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Session detail modal ───────────────────────────────────────
function SessionDetail({ sessionId, onClose, onRefresh }) {
  const [session,  setSession]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [addForm,  setAddForm]  = useState(null);
  const [products, setProducts] = useState([]);
  const [saving,   setSaving]   = useState(false);
  const [saveErr,  setSaveErr]  = useState('');
  const [completing, setCompleting] = useState(false);

  const [newLine, setNewLine] = useState({
    product_id: '', expected_qty: '', received_qty: '',
    unit_cost: '', landed_cost_per_unit: '', put_away_bin_id: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await receivingApi.get(sessionId);
      setSession(res.data.data);
    } catch {
      setError('Failed to load session.');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    productsApi.list({ limit: 500 })
      .then(r => setProducts(r.data.data || []))
      .catch(() => {});
  }, []);

  async function handleAddLine(e) {
    e.preventDefault();
    setSaveErr('');
    setSaving(true);
    try {
      await receivingApi.addLine(sessionId, {
        product_id:          Number(newLine.product_id),
        expected_qty:        Number(newLine.expected_qty  || 0),
        received_qty:        Number(newLine.received_qty  || 0),
        unit_cost:           Number(newLine.unit_cost     || 0),
        landed_cost_per_unit:Number(newLine.landed_cost_per_unit || 0),
        put_away_bin_id:     newLine.put_away_bin_id ? Number(newLine.put_away_bin_id) : null,
      });
      setNewLine({ product_id: '', expected_qty: '', received_qty: '', unit_cost: '', landed_cost_per_unit: '', put_away_bin_id: '' });
      setAddForm(false);
      load();
    } catch (err) {
      setSaveErr(err.response?.data?.error || 'Failed to add line.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveLine(lineId) {
    if (!confirm('Remove this line?')) return;
    try {
      await receivingApi.removeLine(sessionId, lineId);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove line.');
    }
  }

  async function handleComplete() {
    if (!confirm('Complete this session? Stock levels, FIFO layers, and a GL journal entry will be created.')) return;
    setCompleting(true);
    try {
      const res = await receivingApi.complete(sessionId);
      const d   = res.data.data;
      alert(`Session completed.\nJournal: ${d.journal_number}\nTotal value: ${AUD(d.total_value)}`);
      onRefresh();
      onClose();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to complete session.');
    } finally {
      setCompleting(false);
    }
  }

  async function handleVoid() {
    if (!confirm('Void this session? It cannot be undone.')) return;
    try {
      await receivingApi.void(sessionId);
      onRefresh();
      onClose();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to void session.');
    }
  }

  const isOpen      = session?.status === 'open';
  const isComplete  = session?.status === 'complete';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: 'var(--card)', borderRadius: 10, padding: 28, width: 820, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-sub)', padding: 40 }}>Loading…</div>
        ) : error ? (
          <div style={{ textAlign: 'center', color: '#E05252', padding: 40 }}>{error}</div>
        ) : session ? (
          <>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: 'DM Mono', fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>{session.session_number}</div>
                <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 2 }}>
                  {dt(session.started_at)} · {session.warehouse_name}
                  {session.supplier_name && ` · ${session.supplier_name}`}
                  {session.supplier_docket && ` · Ref: ${session.supplier_docket}`}
                </div>
                <span style={{ display: 'inline-block', marginTop: 6, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: (STATUS_COLOR[session.status] || '#7B93B0') + '22', color: STATUS_COLOR[session.status] || '#7B93B0' }}>
                  {session.status}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {isOpen && session.lines?.length > 0 && (
                  <button className="btn btn-primary btn-sm" onClick={handleComplete} disabled={completing}>
                    {completing ? 'Completing…' : 'Complete & Post GL'}
                  </button>
                )}
                {isOpen && <button className="btn btn-sm" style={{ color: '#E05252', borderColor: '#E05252' }} onClick={handleVoid}>Void</button>}
                <button className="btn btn-sm" onClick={onClose}>Close</button>
              </div>
            </div>

            {/* Lines table */}
            <div style={card}>
              <div style={tWrap}>
                <table style={tbl}>
                  <thead>
                    <tr>
                      <th style={th}>Product</th>
                      <th style={{ ...th, textAlign: 'right' }}>Expected</th>
                      <th style={{ ...th, textAlign: 'right' }}>Received</th>
                      <th style={{ ...th, textAlign: 'right' }}>Unit Cost</th>
                      <th style={{ ...th, textAlign: 'right' }}>Landed CPU</th>
                      <th style={{ ...th, textAlign: 'right' }}>Line Total</th>
                      {isOpen && <th style={th} />}
                    </tr>
                  </thead>
                  <tbody>
                    {(!session.lines || session.lines.length === 0) ? (
                      <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No lines yet. Add products below.</td></tr>
                    ) : session.lines.map(l => (
                      <tr key={l.id}>
                        <td style={td}>
                          <div style={{ fontWeight: 500 }}>{l.product_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-sub)', fontFamily: 'DM Mono' }}>{l.product_sku}</div>
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontSize: 12 }}>{Number(l.expected_qty) || '—'}</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontSize: 12, fontWeight: 600 }}>{Number(l.received_qty)}</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontSize: 12 }}>{AUD(l.unit_cost)}</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontSize: 12 }}>{Number(l.landed_cost_per_unit) ? AUD(l.landed_cost_per_unit) : '—'}</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontSize: 12, fontWeight: 600 }}>{AUD(l.line_total)}</td>
                        {isOpen && (
                          <td style={td}>
                            <button className="btn btn-sm" style={{ color: '#E05252', borderColor: '#E05252', fontSize: 11 }} onClick={() => handleRemoveLine(l.id)}>Remove</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  {session.lines?.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={isOpen ? 5 : 5} style={{ ...td, fontWeight: 700 }}>Total</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 700 }}>
                          {AUD(session.lines.reduce((s, l) => s + Number(l.line_total), 0))}
                        </td>
                        {isOpen && <td style={td} />}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* Add line form */}
            {isOpen && (
              <div style={{ marginTop: 16 }}>
                {!addForm ? (
                  <button className="btn btn-sm" onClick={() => setAddForm(true)}>+ Add Line</button>
                ) : (
                  <div style={{ ...card, padding: 16, marginTop: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Add Product</div>
                    {saveErr && <div style={{ color: '#E05252', fontSize: 12, marginBottom: 8 }}>{saveErr}</div>}
                    <form onSubmit={handleAddLine}>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 10 }}>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-sub)', display: 'block', marginBottom: 3 }}>Product *</label>
                          <select value={newLine.product_id} onChange={e => setNewLine(p => ({ ...p, product_id: e.target.value }))} required style={{ ...inputSt, width: '100%' }}>
                            <option value="">Select product…</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                          </select>
                        </div>
                        {[
                          ['received_qty',        'Qty Received *', '1'],
                          ['unit_cost',            'Unit Cost *',    '0.01'],
                          ['landed_cost_per_unit', 'Landed CPU',     '0.01'],
                          ['expected_qty',         'Qty Expected',   '1'],
                        ].map(([key, label, step]) => (
                          <div key={key}>
                            <label style={{ fontSize: 11, color: 'var(--text-sub)', display: 'block', marginBottom: 3 }}>{label}</label>
                            <input type="number" min="0" step={step} value={newLine[key]}
                              onChange={e => setNewLine(p => ({ ...p, [key]: e.target.value }))}
                              style={{ ...inputSt, width: '100%', textAlign: 'right' }} />
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Adding…' : 'Add Line'}</button>
                        <button type="button" className="btn btn-sm" onClick={() => { setAddForm(false); setSaveErr(''); }}>Cancel</button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            )}

            {/* GL entry info for complete sessions */}
            {isComplete && session.gl_entry_id && (
              <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(46,204,138,0.08)', border: '1px solid rgba(46,204,138,0.3)', borderRadius: 6, fontSize: 13, color: '#2ECC8A' }}>
                GL journal entry posted · Completed {dt(session.completed_at)}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════
export default function ReceivingPage() {
  const [sessions,     setSessions]     = useState([]);
  const [meta,         setMeta]         = useState({ total: 0 });
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate,   setShowCreate]   = useState(false);
  const [detailId,     setDetailId]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await receivingApi.list({
        status: statusFilter || undefined,
        limit:  100,
      });
      setSessions(res.data.data || []);
      setMeta(res.data.meta || { total: 0 });
    } catch {
      setError('Failed to load receiving sessions.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  function handleCreated(data) {
    setShowCreate(false);
    setDetailId(data.id);
    load();
  }

  return (
    <div style={page}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Goods Receiving</h1>
          <p style={{ fontSize: 13, color: 'var(--text-sub)', margin: 0 }}>Receive goods from suppliers — creates stock movements, FIFO layers, and GL entries.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Session</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        {['', 'open', 'complete', 'voided'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            style={{
              padding: '6px 14px', fontSize: 12, borderRadius: 6, cursor: 'pointer', fontWeight: statusFilter === s ? 600 : 400,
              background: statusFilter === s ? 'var(--accent)' : 'transparent',
              color: statusFilter === s ? '#fff' : 'var(--text-sub)',
              border: '1px solid ' + (statusFilter === s ? 'var(--accent)' : 'var(--border)'),
            }}>
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-sub)', alignSelf: 'center' }}>
          {meta.total} session{meta.total !== 1 ? 's' : ''}
        </div>
      </div>

      {error && <div style={{ color: '#E05252', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      <div style={card}>
        <div style={tWrap}>
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>Session #</th>
                <th style={th}>Date</th>
                <th style={th}>Warehouse</th>
                <th style={th}>Supplier</th>
                <th style={{ ...th, textAlign: 'right' }}>Lines</th>
                <th style={{ ...th, textAlign: 'right' }}>Total Value</th>
                <th style={th}>Status</th>
                <th style={th}>Completed</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</td></tr>
              ) : sessions.length === 0 ? (
                <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>
                  {statusFilter ? `No ${statusFilter} sessions.` : 'No receiving sessions yet. Create one to start receiving goods.'}
                </td></tr>
              ) : sessions.map(s => (
                <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setDetailId(s.id)}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--hover, rgba(255,255,255,0.03))'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <td style={{ ...td, fontFamily: 'DM Mono', fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>{s.session_number}</td>
                  <td style={{ ...td, fontSize: 12 }}>{dt(s.started_at)}</td>
                  <td style={td}>{s.warehouse_name}</td>
                  <td style={{ ...td, color: 'var(--text-sub)', fontSize: 12 }}>{s.supplier_name || '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontSize: 12 }}>{s.line_count}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontSize: 12, fontWeight: 600 }}>{AUD(s.total_value)}</td>
                  <td style={td}>
                    <span style={{ color: STATUS_COLOR[s.status] || '#7B93B0', fontWeight: 600, fontSize: 12 }}>{s.status}</span>
                  </td>
                  <td style={{ ...td, fontSize: 12, color: 'var(--text-sub)' }}>{dt(s.completed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <CreateSessionModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      )}
      {detailId && (
        <SessionDetail
          sessionId={detailId}
          onClose={() => setDetailId(null)}
          onRefresh={load}
        />
      )}
    </div>
  );
}
