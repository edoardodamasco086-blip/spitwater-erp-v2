import React, { useState, useEffect, useCallback } from 'react';
import { wmsInboundApi } from '../../api/wmsInbound';
import { settingsApi }   from '../../api/settings';
import { contactsApi }   from '../../api/contacts';
import { productsApi }   from '../../api/products';

// ── Formatters ────────────────────────────────────────────────
const AUD = v => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v ?? 0);
const dt  = v => v ? new Date(v).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const STATUS = {
  draft:       { label: 'Draft',       color: '#8A95A3' },
  open:        { label: 'Open',        color: '#2F7FE8' },
  in_progress: { label: 'In Progress', color: '#F5A623' },
  posted:      { label: 'Posted',      color: '#2ECC8A' },
  cancelled:   { label: 'Cancelled',   color: '#E05252' },
};

const HU_TYPES = ['pallet', 'carton', 'box', 'item'];

// ── Shared styles ──────────────────────────────────────────────
const card  = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 };
const th    = { padding: '9px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)', textAlign: 'left', whiteSpace: 'nowrap' };
const td    = { padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, verticalAlign: 'middle' };
const inp   = { padding: '7px 10px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--input)', color: 'var(--text)', boxSizing: 'border-box', width: '100%' };
const label = { fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 };
const fg    = { marginBottom: 12 };

function StatusPill({ status }) {
  const s = STATUS[status] || { label: status, color: '#8A95A3' };
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

// ── Overlay modal wrapper ──────────────────────────────────────
function Modal({ onClose, children, width = 820 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '32px 16px' }}
      onClick={onClose}>
      <div style={{ background: 'var(--card)', borderRadius: 10, width, maxWidth: '100%', boxShadow: '0 24px 64px rgba(0,0,0,0.5)', position: 'relative' }}
        onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// ── CREATE DELIVERY MODAL ─────────────────────────────────────
function CreateModal({ onClose, onCreated }) {
  const [warehouses, setWarehouses] = useState([]);
  const [suppliers,  setSuppliers]  = useState([]);
  const [form, setForm] = useState({ warehouse_id: '', supplier_id: '', supplier_ref: '', expected_date: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  useEffect(() => {
    settingsApi.listWarehouses().then(r => setWarehouses(r.data.data || []));
    contactsApi.list({ limit: 200 }).then(r => setSuppliers((r.data.data || []).filter(c => c.contact_type === 'supplier' || !c.contact_type)));
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!form.warehouse_id) { setErr('Warehouse is required.'); return; }
    setSaving(true); setErr('');
    try {
      const r = await wmsInboundApi.create({ ...form, warehouse_id: Number(form.warehouse_id), supplier_id: form.supplier_id ? Number(form.supplier_id) : null });
      onCreated(r.data.data);
    } catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
    finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} width={480}>
      <div style={{ padding: '24px 28px' }}>
        <h3 style={{ margin: '0 0 20px', fontSize: 16 }}>New Inbound Delivery</h3>
        <Err msg={err} />
        <form onSubmit={submit}>
          <div style={fg}>
            <label style={label}>Warehouse *</label>
            <select style={inp} value={form.warehouse_id} onChange={e => setForm(f => ({ ...f, warehouse_id: e.target.value }))}>
              <option value="">Select…</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div style={fg}>
            <label style={label}>Supplier</label>
            <select style={inp} value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}>
              <option value="">None</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.full_name || s.company_name}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={label}>Supplier Ref / PO#</label>
              <input style={inp} value={form.supplier_ref} onChange={e => setForm(f => ({ ...f, supplier_ref: e.target.value }))} placeholder="PO-12345" />
            </div>
            <div>
              <label style={label}>Expected Date</label>
              <input style={inp} type="date" value={form.expected_date} onChange={e => setForm(f => ({ ...f, expected_date: e.target.value }))} />
            </div>
          </div>
          <div style={fg}>
            <label style={label}>Notes</label>
            <textarea style={{ ...inp, height: 60, resize: 'vertical' }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Creating…' : 'Create Delivery'}</button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

// ── ADD ITEM MODAL ────────────────────────────────────────────
function AddItemModal({ deliveryId, onClose, onAdded }) {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ product_id: '', expected_qty: '', unit_cost: '', lot_number: '' });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  useEffect(() => {
    productsApi.list({ limit: 500 }).then(r => setProducts(r.data.data || []));
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!form.product_id) { setErr('Product is required.'); return; }
    setSaving(true); setErr('');
    try {
      await wmsInboundApi.addItem(deliveryId, {
        product_id:   Number(form.product_id),
        expected_qty: Number(form.expected_qty || 0),
        unit_cost:    Number(form.unit_cost    || 0),
        lot_number:   form.lot_number || null,
      });
      onAdded();
    } catch (ex) { setErr(ex.response?.data?.error || 'Failed.'); }
    finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} width={420}>
      <div style={{ padding: '24px 28px' }}>
        <h3 style={{ margin: '0 0 20px', fontSize: 16 }}>Add Expected Item</h3>
        <Err msg={err} />
        <form onSubmit={submit}>
          <div style={fg}>
            <label style={label}>Product *</label>
            <select style={inp} value={form.product_id} onChange={e => setForm(f => ({ ...f, product_id: e.target.value }))}>
              <option value="">Select…</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.product_code})</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={label}>Expected Qty</label>
              <input style={inp} type="number" min="0" step="0.0001" value={form.expected_qty} onChange={e => setForm(f => ({ ...f, expected_qty: e.target.value }))} />
            </div>
            <div>
              <label style={label}>Unit Cost (AUD)</label>
              <input style={inp} type="number" min="0" step="0.01" value={form.unit_cost} onChange={e => setForm(f => ({ ...f, unit_cost: e.target.value }))} />
            </div>
          </div>
          <div style={fg}>
            <label style={label}>Lot / Batch Number</label>
            <input style={inp} value={form.lot_number} onChange={e => setForm(f => ({ ...f, lot_number: e.target.value }))} placeholder="LOT-001" />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Adding…' : 'Add Item'}</button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

// ── SCAN & CONFIRM PANEL ──────────────────────────────────────
function ScanPanel({ delivery, items, hus, bins, onConfirmed }) {
  const [barcode,     setBarcode]     = useState('');
  const [scanning,    setScanning]    = useState(false);
  const [scanResult,  setScanResult]  = useState(null);
  const [scanErr,     setScanErr]     = useState('');
  const [form,        setForm]        = useState({ hu_id: '', bin_id: '', qty: '1', serial_number: '', lot_number: '' });
  const [confirming,  setConfirming]  = useState(false);
  const [confirmMsg,  setConfirmMsg]  = useState('');
  const [confirmErr,  setConfirmErr]  = useState('');

  const canReceive = ['open', 'in_progress'].includes(delivery.status);

  async function doScan(e) {
    e.preventDefault();
    if (!barcode.trim()) return;
    setScanning(true); setScanResult(null); setScanErr(''); setConfirmMsg(''); setConfirmErr('');
    try {
      const r = await wmsInboundApi.scan(delivery.id, { barcode: barcode.trim() });
      const d = r.data.data;
      setScanResult(d);
      setForm(f => ({
        ...f,
        qty:        String(d.quantity || 1),
        lot_number: d.lot || d.delivery_item?.lot_number || '',
        serial_number: d.serial || '',
        bin_id:     d.suggested_bin?.bin_id ? String(d.suggested_bin.bin_id) : f.bin_id,
        hu_id:      hus.length === 1 ? String(hus[0].id) : f.hu_id,
      }));
    } catch (ex) {
      setScanErr(ex.response?.data?.error || 'Scan failed.');
    } finally {
      setScanning(false);
    }
  }

  async function doConfirm() {
    if (!scanResult) return;
    if (!form.hu_id)  { setConfirmErr('Select a Handling Unit.'); return; }
    if (!form.bin_id) { setConfirmErr('Select a destination bin.'); return; }
    setConfirming(true); setConfirmErr(''); setConfirmMsg('');
    try {
      await wmsInboundApi.confirm(delivery.id, {
        delivery_item_id: scanResult.delivery_item?.id || null,
        hu_id:            Number(form.hu_id),
        bin_id:           Number(form.bin_id),
        product_id:       scanResult.product.id,
        qty:              Number(form.qty),
        lot_number:       form.lot_number || null,
        serial_number:    form.serial_number || null,
        raw_barcode:      barcode,
      });
      setConfirmMsg(`✓ ${form.qty}× ${scanResult.product.name} confirmed to ${bins.find(b => b.id === Number(form.bin_id))?.bin_code || 'bin'}`);
      setScanResult(null);
      setBarcode('');
      onConfirmed();
    } catch (ex) {
      setConfirmErr(ex.response?.data?.error || 'Confirm failed.');
    } finally {
      setConfirming(false);
    }
  }

  if (!canReceive) {
    return (
      <div style={{ padding: 24, color: 'var(--text-sub)', fontSize: 13, textAlign: 'center' }}>
        Delivery must be <strong>open</strong> or <strong>in progress</strong> to scan.
      </div>
    );
  }

  return (
    <div style={{ padding: 4 }}>
      {/* Barcode input */}
      <form onSubmit={doScan} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          style={{ ...inp, flex: 1, fontFamily: 'DM Mono', fontSize: 13 }}
          value={barcode}
          onChange={e => setBarcode(e.target.value)}
          placeholder="Scan or type barcode / product code / GS1…"
          autoFocus
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={scanning || !barcode.trim()}>
          {scanning ? '…' : 'Scan'}
        </button>
      </form>

      {scanErr && <Err msg={scanErr} />}

      {/* Scan result */}
      {scanResult && (
        <div style={{ ...card, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{scanResult.product.name}</div>
              <div style={{ fontSize: 12, fontFamily: 'DM Mono', color: 'var(--text-sub)' }}>{scanResult.product.product_code}</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 12 }}>
              {scanResult.delivery_item
                ? <span style={{ color: '#2ECC8A' }}>✓ On delivery</span>
                : <span style={{ color: '#F5A623' }}>⚠ Not on delivery</span>}
              {scanResult.serial_required && <div style={{ color: '#F5A623', marginTop: 2 }}>Serial required</div>}
            </div>
          </div>

          {scanResult.suggested_bin && (
            <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 12, padding: '6px 10px', background: 'var(--bg)', borderRadius: 6 }}>
              Suggested bin: <strong style={{ color: 'var(--text)' }}>{scanResult.suggested_bin.bin_code}</strong>
              <span style={{ marginLeft: 8 }}>({scanResult.suggested_bin.strategy})</span>
            </div>
          )}

          {/* Parsed data */}
          {(scanResult.lot || scanResult.serial) && (
            <div style={{ fontSize: 12, fontFamily: 'DM Mono', color: 'var(--text-sub)', marginBottom: 12 }}>
              {scanResult.lot    && <span style={{ marginRight: 12 }}>Lot: {scanResult.lot}</span>}
              {scanResult.serial && <span>Serial: {scanResult.serial}</span>}
            </div>
          )}

          {/* Confirm form */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={label}>Handling Unit *</label>
              <select style={inp} value={form.hu_id} onChange={e => setForm(f => ({ ...f, hu_id: e.target.value }))}>
                <option value="">Select HU…</option>
                {hus.filter(h => h.status !== 'closed').map(h => (
                  <option key={h.id} value={h.id}>{h.hu_number} ({h.hu_type})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={label}>Destination Bin *</label>
              <select style={inp} value={form.bin_id} onChange={e => setForm(f => ({ ...f, bin_id: e.target.value }))}>
                <option value="">Select bin…</option>
                {bins.map(b => <option key={b.id} value={b.id}>{b.bin_code}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Quantity</label>
              <input style={inp} type="number" min="0.0001" step="0.0001" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
            </div>
            <div>
              <label style={label}>Lot / Batch</label>
              <input style={inp} value={form.lot_number} onChange={e => setForm(f => ({ ...f, lot_number: e.target.value }))} placeholder="LOT-001" />
            </div>
            {scanResult.serial_required && (
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ ...label, color: '#F5A623' }}>Serial Number *</label>
                <input style={{ ...inp, border: '1px solid #F5A623' }} value={form.serial_number} onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))} placeholder="SN-0001" />
              </div>
            )}
          </div>

          {confirmErr && <Err msg={confirmErr} />}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setScanResult(null)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={doConfirm} disabled={confirming}>
              {confirming ? 'Confirming…' : 'Confirm Putaway'}
            </button>
          </div>
        </div>
      )}

      {confirmMsg && (
        <div style={{ padding: '10px 14px', background: '#2ECC8A22', border: '1px solid #2ECC8A44', borderRadius: 6, color: '#2ECC8A', fontSize: 13 }}>
          {confirmMsg}
        </div>
      )}
    </div>
  );
}

// ── DELIVERY DETAIL MODAL ─────────────────────────────────────
function DeliveryModal({ deliveryId, onClose, onChanged }) {
  const [delivery, setDelivery] = useState(null);
  const [hus,      setHus]      = useState([]);
  const [bins,     setBins]     = useState([]);
  const [tab,      setTab]      = useState('items');
  const [loading,  setLoading]  = useState(true);
  const [err,      setErr]      = useState('');
  const [acting,   setActing]   = useState('');
  const [actionErr,setActionErr]= useState('');
  const [showAddItem, setShowAddItem] = useState(false);
  const [showNewHu,   setShowNewHu]   = useState(false);
  const [newHuForm,   setNewHuForm]   = useState({ hu_type: 'carton', hu_number: '' });

  const load = useCallback(async () => {
    try {
      const [dRes, hRes] = await Promise.all([
        wmsInboundApi.get(deliveryId),
        wmsInboundApi.listHus(deliveryId),
      ]);
      const d = dRes.data.data;
      setDelivery(d);
      setHus(hRes.data.data || []);
      // Load bins for this warehouse
      if (d.warehouse_id) {
        const { warehouseApi } = await import('../../api/warehouse');
        const bRes = await warehouseApi.getBins({ warehouse_id: d.warehouse_id, limit: 200 });
        setBins(bRes.data.data || []);
      }
    } catch { setErr('Failed to load delivery.'); }
    finally  { setLoading(false); }
  }, [deliveryId]);

  useEffect(() => { load(); }, [load]);

  async function action(fn, label) {
    setActing(label); setActionErr('');
    try { await fn(); onChanged(); await load(); }
    catch (ex) { setActionErr(ex.response?.data?.error || `${label} failed.`); }
    finally    { setActing(''); }
  }

  async function createHu() {
    setActing('hu'); setActionErr('');
    try {
      await wmsInboundApi.createHu(deliveryId, {
        hu_type:   newHuForm.hu_type,
        hu_number: newHuForm.hu_number || undefined,
      });
      setShowNewHu(false); setNewHuForm({ hu_type: 'carton', hu_number: '' });
      await load(); onChanged();
    } catch (ex) { setActionErr(ex.response?.data?.error || 'Failed.'); }
    finally { setActing(''); }
  }

  async function removeItem(itemId) {
    if (!confirm('Remove this item?')) return;
    action(() => wmsInboundApi.removeItem(deliveryId, itemId), 'Remove');
  }

  if (loading) return (
    <Modal onClose={onClose}>
      <div style={{ padding: 48, textAlign: 'center' }}><div className="spinner-dark" /></div>
    </Modal>
  );

  if (err || !delivery) return (
    <Modal onClose={onClose}>
      <div style={{ padding: 32, color: '#E05252', textAlign: 'center' }}>{err || 'Not found.'}</div>
    </Modal>
  );

  const isDraft   = delivery.status === 'draft';
  const isOpen    = delivery.status === 'open';
  const isWip     = delivery.status === 'in_progress';
  const isPosted  = delivery.status === 'posted';
  const canEdit   = isDraft;
  const canReceive= isOpen || isWip;
  const canPost   = isOpen || isWip;
  const canCancel = !isPosted && delivery.status !== 'cancelled';

  return (
    <Modal onClose={onClose} width={900}>
      {/* Header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontFamily: 'DM Mono', fontWeight: 700, fontSize: 15 }}>{delivery.delivery_number}</span>
            <StatusPill status={delivery.status} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
            {delivery.warehouse_name} · {delivery.supplier_name || 'No supplier'} · Expected: {dt(delivery.expected_date)}
            {delivery.supplier_ref && <span style={{ marginLeft: 8 }}>Ref: {delivery.supplier_ref}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isDraft && (
            <button className="btn btn-outline btn-sm" onClick={() => action(() => wmsInboundApi.open(deliveryId), 'Open')} disabled={!!acting}>
              {acting === 'Open' ? '…' : 'Open for Receiving'}
            </button>
          )}
          {canPost && (
            <button className="btn btn-primary btn-sm" onClick={() => { if (confirm('Post this delivery? This will create stock movements and a GL journal entry.')) action(() => wmsInboundApi.post(deliveryId), 'Post'); }} disabled={!!acting}>
              {acting === 'Post' ? 'Posting…' : 'Post Delivery'}
            </button>
          )}
          {canCancel && (
            <button className="btn btn-outline btn-sm" style={{ color: '#E05252', borderColor: '#E05252' }} onClick={() => { if (confirm('Cancel this delivery?')) action(() => wmsInboundApi.cancel(deliveryId), 'Cancel'); }} disabled={!!acting}>
              Cancel
            </button>
          )}
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-sub)', padding: '0 4px' }} onClick={onClose}>✕</button>
        </div>
      </div>

      {actionErr && <div style={{ padding: '8px 24px', background: '#E0525215', color: '#E05252', fontSize: 13 }}>{actionErr}</div>}
      {isPosted  && delivery.gl_entry_id && (
        <div style={{ padding: '8px 24px', background: '#2ECC8A15', color: '#2ECC8A', fontSize: 13 }}>
          ✓ Posted — GL Entry #{delivery.gl_entry_id}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 24px' }}>
        {[['items', 'Items'], ['hu', 'Handling Units'], ['scan', 'Scan & Receive']].map(([key, lbl]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: '11px 16px', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer',
            color: tab === key ? 'var(--primary)' : 'var(--text-sub)',
            borderBottom: tab === key ? '2px solid var(--primary)' : '2px solid transparent',
            marginBottom: -1, fontWeight: tab === key ? 600 : 400,
          }}>{lbl}</button>
        ))}
      </div>

      {/* Body */}
      <div style={{ padding: 24, maxHeight: '60vh', overflowY: 'auto' }}>

        {/* ── ITEMS TAB ── */}
        {tab === 'items' && (
          <>
            {canEdit && (
              <button className="btn btn-outline btn-sm" style={{ marginBottom: 14 }} onClick={() => setShowAddItem(true)}>+ Add Item</button>
            )}
            {delivery.items?.length === 0
              ? <div style={{ color: 'var(--text-sub)', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>No items. Add expected goods before opening.</div>
              : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      {['Product', 'Lot', 'Expected', 'Received', 'Unit Cost', 'Scans', ''].map(h => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {delivery.items?.map(item => {
                      const pct = item.expected_qty > 0 ? Math.min(100, Math.round(item.received_qty / item.expected_qty * 100)) : null;
                      return (
                        <tr key={item.id} style={{ background: 'transparent' }}>
                          <td style={td}>
                            <div style={{ fontWeight: 500 }}>{item.product_name}</div>
                            <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text-sub)' }}>{item.product_code}</div>
                            {item.tracking_type !== 'none' && <div style={{ fontSize: 10, color: '#F5A623' }}>Serial tracked</div>}
                          </td>
                          <td style={td}><span style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{item.lot_number || '—'}</span></td>
                          <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono' }}>{item.expected_qty}</td>
                          <td style={td}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontFamily: 'DM Mono', minWidth: 32 }}>{Number(item.received_qty).toFixed(2)}</span>
                              {pct !== null && (
                                <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2 }}>
                                  <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#2ECC8A' : '#2F7FE8', borderRadius: 2 }} />
                                </div>
                              )}
                              {pct !== null && <span style={{ fontSize: 11, color: 'var(--text-sub)', minWidth: 30 }}>{pct}%</span>}
                            </div>
                          </td>
                          <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono' }}>{AUD(item.unit_cost)}</td>
                          <td style={{ ...td, textAlign: 'center' }}>
                            <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>{item.scan_count ?? 0}</span>
                          </td>
                          <td style={td}>
                            {canEdit && (
                              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E05252', fontSize: 13 }} onClick={() => removeItem(item.id)}>✕</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            }
          </>
        )}

        {/* ── HANDLING UNITS TAB ── */}
        {tab === 'hu' && (
          <>
            {canReceive && (
              <div style={{ marginBottom: 14 }}>
                {!showNewHu
                  ? <button className="btn btn-outline btn-sm" onClick={() => setShowNewHu(true)}>+ New Handling Unit</button>
                  : (
                    <div style={{ ...card, padding: 16, marginBottom: 12 }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                        <div>
                          <label style={label}>Type</label>
                          <select style={{ ...inp, width: 120 }} value={newHuForm.hu_type} onChange={e => setNewHuForm(f => ({ ...f, hu_type: e.target.value }))}>
                            {HU_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div style={{ flex: 1 }}>
                          <label style={label}>LPN / HU Number (optional)</label>
                          <input style={inp} value={newHuForm.hu_number} onChange={e => setNewHuForm(f => ({ ...f, hu_number: e.target.value }))} placeholder="Auto-generated if blank" />
                        </div>
                        <button className="btn btn-primary btn-sm" onClick={createHu} disabled={acting === 'hu'}>
                          {acting === 'hu' ? '…' : 'Create HU'}
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={() => setShowNewHu(false)}>Cancel</button>
                      </div>
                    </div>
                  )
                }
              </div>
            )}
            {hus.length === 0
              ? <div style={{ color: 'var(--text-sub)', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>No handling units. Create one to start receiving.</div>
              : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {hus.map(hu => (
                    <div key={hu.id} style={{ ...card, padding: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: hu.contents?.length ? 10 : 0 }}>
                        <div>
                          <span style={{ fontFamily: 'DM Mono', fontWeight: 600, fontSize: 13 }}>{hu.hu_number}</span>
                          <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-sub)', textTransform: 'capitalize' }}>{hu.hu_type}</span>
                          {hu.parent_hu_id && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-sub)' }}>nested</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {hu.bin_code && <span style={{ fontSize: 12, fontFamily: 'DM Mono', color: 'var(--text-sub)' }}>→ {hu.bin_code}</span>}
                          <StatusPill status={hu.status} />
                        </div>
                      </div>
                      {hu.contents?.length > 0 && (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead><tr>
                            <th style={{ ...th, padding: '6px 8px' }}>Product</th>
                            <th style={{ ...th, padding: '6px 8px' }}>Lot</th>
                            <th style={{ ...th, padding: '6px 8px', textAlign: 'right' }}>Qty</th>
                          </tr></thead>
                          <tbody>
                            {hu.contents.map((c, i) => (
                              <tr key={i}>
                                <td style={{ ...td, padding: '5px 8px' }}>{c.product_name} <span style={{ fontFamily: 'DM Mono', color: 'var(--text-sub)', fontSize: 11 }}>({c.product_code})</span></td>
                                <td style={{ ...td, padding: '5px 8px', fontFamily: 'DM Mono', fontSize: 11 }}>{c.lot_number || '—'}</td>
                                <td style={{ ...td, padding: '5px 8px', textAlign: 'right', fontFamily: 'DM Mono' }}>{c.qty}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ))}
                </div>
              )
            }
          </>
        )}

        {/* ── SCAN & RECEIVE TAB ── */}
        {tab === 'scan' && (
          <ScanPanel
            delivery={delivery}
            items={delivery.items || []}
            hus={hus}
            bins={bins}
            onConfirmed={() => { load(); onChanged(); }}
          />
        )}
      </div>

      {/* Add item modal */}
      {showAddItem && (
        <AddItemModal deliveryId={deliveryId} onClose={() => setShowAddItem(false)} onAdded={() => { setShowAddItem(false); load(); onChanged(); }} />
      )}
    </Modal>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────
export default function WmsInboundPage() {
  const [deliveries,   setDeliveries]   = useState([]);
  const [meta,         setMeta]         = useState({ total: 0 });
  const [loading,      setLoading]      = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [offset,       setOffset]       = useState(0);
  const [showCreate,   setShowCreate]   = useState(false);
  const [selectedId,   setSelectedId]   = useState(null);
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: LIMIT, offset };
      if (statusFilter) params.status = statusFilter;
      const r = await wmsInboundApi.list(params);
      setDeliveries(r.data.data || []);
      setMeta(r.data.meta || {});
    } finally { setLoading(false); }
  }, [statusFilter, offset]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOffset(0); }, [statusFilter]);

  const totalValue = deliveries.reduce((s, d) => s + (Number(d.total_value) || 0), 0);

  return (
    <div style={{ padding: '28px 32px', background: 'var(--bg)', minHeight: '100%' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>WMS Inbound Deliveries</div>
          <div style={{ fontSize: 13, color: 'var(--text-sub)' }}>SAP EWM-style goods receipt — scan, putaway, and post to GL</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Delivery</button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
        {Object.entries(STATUS).map(([key, s]) => {
          const count = deliveries.filter(d => d.status === key).length;
          return (
            <div key={key} style={{ ...card, padding: '14px 16px', cursor: 'pointer', border: statusFilter === key ? `1px solid ${s.color}` : '1px solid var(--border)' }}
              onClick={() => setStatusFilter(f => f === key ? '' : key)}>
              <div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{count}</div>
            </div>
          );
        })}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <button className={`btn btn-sm ${!statusFilter ? 'btn-primary' : 'btn-outline'}`} onClick={() => setStatusFilter('')}>All</button>
        {Object.entries(STATUS).map(([key, s]) => (
          <button key={key} className={`btn btn-sm ${statusFilter === key ? 'btn-primary' : 'btn-outline'}`} onClick={() => setStatusFilter(f => f === key ? '' : key)}>
            {s.label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-sub)' }}>
          {loading ? 'Loading…' : `${meta.total ?? deliveries.length} deliveries`}
        </span>
      </div>

      {/* Table */}
      <div style={{ ...card, overflow: 'hidden', marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Delivery #', 'Date', 'Warehouse', 'Supplier', 'Items', 'Total Value', 'Status', ''].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} style={{ ...td, textAlign: 'center', padding: 32 }}><div className="spinner-dark" style={{ margin: '0 auto' }} /></td></tr>
            )}
            {!loading && deliveries.length === 0 && (
              <tr><td colSpan={8} style={{ ...td, textAlign: 'center', padding: 32, color: 'var(--text-sub)' }}>
                No deliveries{statusFilter ? ` with status "${statusFilter}"` : ''}. Click <strong>+ New Delivery</strong> to start.
              </td></tr>
            )}
            {deliveries.map(d => (
              <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(d.id)}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--hover, rgba(255,255,255,0.03)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}>
                <td style={td}><span style={{ fontFamily: 'DM Mono', fontWeight: 600, color: 'var(--primary)', fontSize: 12 }}>{d.delivery_number}</span></td>
                <td style={{ ...td, color: 'var(--text-sub)', fontSize: 12 }}>{dt(d.created_at)}</td>
                <td style={td}>{d.warehouse_name}</td>
                <td style={{ ...td, color: 'var(--text-sub)' }}>{d.supplier_name || '—'}</td>
                <td style={{ ...td, textAlign: 'center', fontFamily: 'DM Mono' }}>{d.item_count}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono' }}>{AUD(d.total_value)}</td>
                <td style={td}><StatusPill status={d.status} /></td>
                <td style={{ ...td, width: 32, color: 'var(--text-sub)' }}>›</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {meta.total > LIMIT && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: 'var(--text-sub)' }}>
            Showing {offset + 1}–{Math.min(offset + LIMIT, meta.total)} of {meta.total}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - LIMIT))}>← Prev</button>
            <button className="btn btn-outline btn-sm" disabled={offset + LIMIT >= meta.total} onClick={() => setOffset(o => o + LIMIT)}>Next →</button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreated={d => { setShowCreate(false); setSelectedId(d.id); load(); }} />
      )}
      {selectedId && (
        <DeliveryModal deliveryId={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />
      )}
    </div>
  );
}
