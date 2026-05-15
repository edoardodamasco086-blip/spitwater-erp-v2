import React, { useState, useEffect, useCallback } from 'react';
import { getAccessToken } from '../../api/client';

// ── Icons ─────────────────────────────────────────────────────────────────────
function SvgIcon({ children, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
function PlusIcon()  { return <SvgIcon size={13}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></SvgIcon>; }
function TrashIcon() { return <SvgIcon size={12}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></SvgIcon>; }
function ChevronRight() { return <SvgIcon size={13}><polyline points="9 18 15 12 9 6"/></SvgIcon>; }
function ChevronDown()  { return <SvgIcon size={13}><polyline points="6 9 12 15 18 9"/></SvgIcon>; }

// ── Helpers ───────────────────────────────────────────────────────────────────
const authH = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${getAccessToken()}` });

async function apiFetch(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { ...authH(), ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.message || `HTTP ${res.status}`);
  return body;
}

const S = {
  input: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius, 5px)',
    padding: '4px 8px',
    fontSize: 12,
    color: 'var(--text)',
    width: '100%',
    boxSizing: 'border-box',
  },
  label: { fontSize: 11, color: 'var(--text-sub)', marginBottom: 3, display: 'block', fontWeight: 500 },
  card: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius, 8px)',
    padding: '14px 16px',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 10, letterSpacing: 0.2 },
  btn: (variant = 'outline') => ({
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: 'var(--radius, 5px)',
    border: variant === 'primary' ? 'none' : '1px solid var(--border)',
    background: variant === 'primary' ? 'var(--accent)' : variant === 'danger' ? 'var(--red-dim, #ffeaea)' : 'var(--card)',
    color: variant === 'primary' ? '#fff' : variant === 'danger' ? 'var(--red, #c0392b)' : 'var(--text)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    lineHeight: 1.4,
  }),
};

// ── Scale sub-row ─────────────────────────────────────────────────────────────
function ScalesTable({ pirId, condId, scales, onReload }) {
  const [newScale, setNewScale] = useState({ min_qty: '', max_qty: '', unit_price: '' });
  const [adding, setAdding] = useState(false);

  async function addScale() {
    if (!newScale.min_qty || !newScale.unit_price) return;
    setAdding(true);
    try {
      await apiFetch(`/pir/${pirId}/conditions/${condId}/scales`, {
        method: 'POST',
        body: JSON.stringify({
          min_qty: parseFloat(newScale.min_qty),
          max_qty: newScale.max_qty !== '' ? parseFloat(newScale.max_qty) : null,
          unit_price: parseFloat(newScale.unit_price),
        }),
      });
      setNewScale({ min_qty: '', max_qty: '', unit_price: '' });
      onReload();
    } catch (e) { alert(e.message); }
    finally { setAdding(false); }
  }

  async function delScale(sid) {
    if (!confirm('Delete this scale?')) return;
    try {
      await apiFetch(`/pir/${pirId}/conditions/${condId}/scales/${sid}`, { method: 'DELETE' });
      onReload();
    } catch (e) { alert(e.message); }
  }

  async function updateScale(sid, field, value) {
    try {
      await apiFetch(`/pir/${pirId}/conditions/${condId}/scales/${sid}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value === '' ? null : parseFloat(value) }),
      });
      onReload();
    } catch (e) { alert(e.message); }
  }

  const cellS = { padding: '4px 6px', fontSize: 12, border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 4, width: '100%', color: 'var(--text)', boxSizing: 'border-box' };

  return (
    <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ color: 'var(--text-sub)' }}>
            <th style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 500, width: '28%' }}>Min Qty</th>
            <th style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 500, width: '28%' }}>Max Qty</th>
            <th style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 500, width: '28%' }}>Unit Price</th>
            <th style={{ width: 28 }}></th>
          </tr>
        </thead>
        <tbody>
          {scales.map(sc => (
            <tr key={sc.id}>
              <td style={{ padding: '3px 6px' }}>
                <input style={cellS} type="number" defaultValue={sc.min_qty} onBlur={e => updateScale(sc.id, 'min_qty', e.target.value)} />
              </td>
              <td style={{ padding: '3px 6px' }}>
                <input style={cellS} type="number" defaultValue={sc.max_qty ?? ''} onBlur={e => updateScale(sc.id, 'max_qty', e.target.value)} placeholder="∞" />
              </td>
              <td style={{ padding: '3px 6px' }}>
                <input style={cellS} type="number" step="0.0001" defaultValue={sc.unit_price} onBlur={e => updateScale(sc.id, 'unit_price', e.target.value)} />
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                <button type="button" style={{ ...S.btn('danger'), padding: '2px 5px' }} onClick={() => delScale(sc.id)}><TrashIcon /></button>
              </td>
            </tr>
          ))}
          {/* Add scale row */}
          <tr>
            <td style={{ padding: '3px 6px' }}>
              <input style={cellS} type="number" placeholder="Min qty" value={newScale.min_qty}
                onChange={e => setNewScale(s => ({ ...s, min_qty: e.target.value }))} />
            </td>
            <td style={{ padding: '3px 6px' }}>
              <input style={cellS} type="number" placeholder="Max (opt)" value={newScale.max_qty}
                onChange={e => setNewScale(s => ({ ...s, max_qty: e.target.value }))} />
            </td>
            <td style={{ padding: '3px 6px' }}>
              <input style={cellS} type="number" step="0.0001" placeholder="Unit price" value={newScale.unit_price}
                onChange={e => setNewScale(s => ({ ...s, unit_price: e.target.value }))} />
            </td>
            <td style={{ padding: '3px 6px', textAlign: 'center' }}>
              <button type="button" style={{ ...S.btn('primary'), padding: '2px 5px' }} disabled={adding || !newScale.min_qty || !newScale.unit_price} onClick={addScale}>
                <PlusIcon />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Conditions section ────────────────────────────────────────────────────────
function ConditionsSection({ pirId }) {
  const [conditions, setConditions] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [expanded, setExpanded]     = useState({});
  const [newCond, setNewCond]       = useState({ valid_from: '', valid_to: '', base_price: '', currency_code: 'AUD' });
  const [adding, setAdding]         = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/pir/${pirId}/conditions`);
      setConditions(data.data || data || []);
    } catch { setConditions([]); }
    finally { setLoading(false); }
  }, [pirId]);

  useEffect(() => { load(); }, [load]);

  async function addCondition() {
    if (!newCond.base_price) return;
    setAdding(true);
    try {
      await apiFetch(`/pir/${pirId}/conditions`, {
        method: 'POST',
        body: JSON.stringify({
          valid_from: newCond.valid_from || null,
          valid_to: newCond.valid_to || null,
          base_price: parseFloat(newCond.base_price),
          currency_code: newCond.currency_code,
        }),
      });
      setNewCond({ valid_from: '', valid_to: '', base_price: '', currency_code: 'AUD' });
      load();
    } catch (e) { alert(e.message); }
    finally { setAdding(false); }
  }

  async function deleteCondition(cid) {
    if (!confirm('Delete this condition and all its scales?')) return;
    try {
      await apiFetch(`/pir/${pirId}/conditions/${cid}`, { method: 'DELETE' });
      load();
    } catch (e) { alert(e.message); }
  }

  const colH = { padding: '4px 8px', fontSize: 11, color: 'var(--text-sub)', fontWeight: 500, borderBottom: '1px solid var(--border)' };
  const col  = { padding: '6px 8px', fontSize: 12.5, borderBottom: '1px solid var(--border)' };
  const inS  = { ...S.input, padding: '3px 7px', fontSize: 12 };

  return (
    <div>
      <div style={S.sectionTitle}>Pricing Conditions</div>
      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>Loading...</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10 }}>
          <thead>
            <tr>
              <th style={{ ...colH, width: 24 }}></th>
              <th style={colH}>Valid From</th>
              <th style={colH}>Valid To</th>
              <th style={colH}>Base Price</th>
              <th style={colH}>Currency</th>
              <th style={{ ...colH, width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {conditions.length === 0 && (
              <tr><td colSpan={6} style={{ ...col, textAlign: 'center', color: 'var(--text-sub)' }}>No conditions yet.</td></tr>
            )}
            {conditions.map(c => (
              <React.Fragment key={c.id}>
                <tr style={{ background: expanded[c.id] ? 'var(--accent-dim, rgba(47,127,232,0.04))' : 'transparent' }}>
                  <td style={{ ...col, textAlign: 'center', paddingLeft: 6, cursor: 'pointer' }}
                    onClick={() => setExpanded(e => ({ ...e, [c.id]: !e[c.id] }))}>
                    {expanded[c.id] ? <ChevronDown /> : <ChevronRight />}
                  </td>
                  <td style={col}>{c.valid_from ? new Date(c.valid_from).toLocaleDateString('en-AU') : '—'}</td>
                  <td style={col}>{c.valid_to   ? new Date(c.valid_to).toLocaleDateString('en-AU')   : '—'}</td>
                  <td style={{ ...col, fontFamily: 'DM Mono, monospace' }}>{parseFloat(c.base_price).toFixed(4)}</td>
                  <td style={col}>{c.currency_code}</td>
                  <td style={{ ...col, textAlign: 'right' }}>
                    <button type="button" style={{ ...S.btn('danger'), padding: '2px 5px' }} onClick={() => deleteCondition(c.id)}><TrashIcon /></button>
                  </td>
                </tr>
                {expanded[c.id] && (
                  <tr>
                    <td colSpan={6} style={{ padding: '6px 12px 10px', background: 'var(--bg)' }}>
                      <ScalesTable pirId={pirId} condId={c.id} scales={c.scales || []} onReload={load} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {/* Add row */}
            <tr>
              <td style={col}></td>
              <td style={col}>
                <input style={inS} type="date" value={newCond.valid_from}
                  onChange={e => setNewCond(n => ({ ...n, valid_from: e.target.value }))} />
              </td>
              <td style={col}>
                <input style={inS} type="date" value={newCond.valid_to}
                  onChange={e => setNewCond(n => ({ ...n, valid_to: e.target.value }))} />
              </td>
              <td style={col}>
                <input style={inS} type="number" step="0.0001" placeholder="0.0000" value={newCond.base_price}
                  onChange={e => setNewCond(n => ({ ...n, base_price: e.target.value }))} />
              </td>
              <td style={col}>
                <select style={inS} value={newCond.currency_code}
                  onChange={e => setNewCond(n => ({ ...n, currency_code: e.target.value }))}>
                  {['AUD','USD','EUR','GBP'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </td>
              <td style={col}>
                <button type="button" style={S.btn('primary')} disabled={adding || !newCond.base_price} onClick={addCondition}>
                  <PlusIcon /> Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── PIR form ──────────────────────────────────────────────────────────────────
function PirSection({ productId, vendorId }) {
  const [pir, setPir]         = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm]       = useState({});
  const [saving, setSaving]   = useState(false);
  const [creating, setCreating] = useState(false);
  const [dirty, setDirty]     = useState(false);

  const loadPir = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/pir?product_id=${productId}`);
      const list = data.data || data || [];
      const found = list.find(p => p.vendor_id === vendorId) || null;
      setPir(found);
      if (found) {
        setForm({
          vendor_material_number: found.vendor_material_number || '',
          vendor_description:     found.vendor_description     || '',
          vendor_lead_time_days:  String(found.vendor_lead_time_days ?? ''),
          vendor_moq:             String(found.vendor_moq  ?? ''),
          order_multiple:         String(found.order_multiple ?? ''),
          notes:                  found.notes || '',
        });
      }
      setDirty(false);
    } catch { setPir(null); }
    finally { setLoading(false); }
  }, [productId, vendorId]);

  useEffect(() => { loadPir(); }, [loadPir]);

  function setF(field, val) {
    setForm(f => ({ ...f, [field]: val }));
    setDirty(true);
  }

  async function savePir() {
    setSaving(true);
    try {
      await apiFetch(`/pir/${pir.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          vendor_material_number: form.vendor_material_number || null,
          vendor_description:     form.vendor_description     || null,
          vendor_lead_time_days:  form.vendor_lead_time_days !== '' ? parseInt(form.vendor_lead_time_days) : null,
          vendor_moq:             form.vendor_moq  !== '' ? parseFloat(form.vendor_moq)  : null,
          order_multiple:         form.order_multiple !== '' ? parseFloat(form.order_multiple) : null,
          notes:                  form.notes || null,
        }),
      });
      setDirty(false);
      await loadPir();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function createPir() {
    setCreating(true);
    try {
      await apiFetch('/pir', {
        method: 'POST',
        body: JSON.stringify({ product_id: productId, vendor_id: vendorId }),
      });
      await loadPir();
    } catch (e) { alert(e.message); }
    finally { setCreating(false); }
  }

  const inS = { ...S.input };
  const row2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 };
  const row3 = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 };

  if (loading) return <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>Loading PIR...</div>;

  if (!pir) {
    return (
      <div>
        <div style={S.sectionTitle}>Purchasing Info Record</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-sub)', marginBottom: 10 }}>
          No PIR exists for this vendor and product.
        </div>
        <button type="button" style={S.btn('primary')} disabled={creating} onClick={createPir}>
          <PlusIcon /> {creating ? 'Creating…' : 'Create PIR'}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={S.sectionTitle}>Purchasing Info Record</div>
      <div style={{ fontSize: 11, color: 'var(--text-sub)', background: 'var(--bg)',
        border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', marginBottom: 8 }}>
        ℹ️ Price conditions below are used for automatic PO pricing when this vendor is selected.
      </div>
      <div style={row2}>
        <div>
          <label style={S.label}>Vendor Part Number</label>
          <input style={inS} value={form.vendor_material_number}
            onChange={e => setF('vendor_material_number', e.target.value)} placeholder="Vendor's part number" />
        </div>
        <div>
          <label style={S.label}>Vendor Description</label>
          <input style={inS} value={form.vendor_description}
            onChange={e => setF('vendor_description', e.target.value)} placeholder="Vendor's product name" />
        </div>
      </div>
      <div style={row3}>
        <div>
          <label style={S.label}>Lead Time (days)</label>
          <input style={inS} type="number" min="0" value={form.vendor_lead_time_days}
            onChange={e => setF('vendor_lead_time_days', e.target.value)} />
        </div>
        <div>
          <label style={S.label}>MOQ</label>
          <input style={inS} type="number" step="0.0001" min="0" value={form.vendor_moq}
            onChange={e => setF('vendor_moq', e.target.value)} />
        </div>
        <div>
          <label style={S.label}>Order Multiple</label>
          <input style={inS} type="number" step="0.0001" min="0" value={form.order_multiple}
            onChange={e => setF('order_multiple', e.target.value)} />
        </div>
      </div>
      {pir.purchase_uom_code && (
        <div style={{ marginBottom: 10 }}>
          <span style={S.label}>Purchasing UOM</span>
          <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'monospace' }}>{pir.purchase_uom_code}</span>
        </div>
      )}
      <div style={{ marginBottom: 10 }}>
        <label style={S.label}>Notes</label>
        <textarea style={{ ...inS, minHeight: 54, resize: 'vertical' }} value={form.notes}
          onChange={e => setF('notes', e.target.value)} placeholder="Internal notes…" />
      </div>
      <button type="button" style={S.btn('primary')} disabled={saving || !dirty} onClick={savePir}>
        {saving ? 'Saving…' : 'Save PIR'}
      </button>

      {/* Conditions always shown below the PIR form */}
      <div style={{ marginTop: 20 }}>
        <ConditionsSection pirId={pir.id} />
      </div>
    </div>
  );
}

// ── Right panel ───────────────────────────────────────────────────────────────
function RightPanel({ entry, productId, vendors, onReload, onDeselect }) {
  const [toggling, setToggling] = useState(false);
  const [removing, setRemoving] = useState(false);

  if (!entry) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-sub)', fontSize: 13 }}>
        Select a vendor from the source list to see details.
      </div>
    );
  }

  async function toggleField(field) {
    setToggling(true);
    try {
      await apiFetch(`/pir/source-list/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: !entry[field] }),
      });
      onReload();
    } catch (e) { alert(e.message); }
    finally { setToggling(false); }
  }

  async function removeEntry() {
    if (!confirm(`Remove ${entry.vendor_name} from the source list?`)) return;
    setRemoving(true);
    try {
      await apiFetch(`/pir/source-list/${entry.id}`, { method: 'DELETE' });
      onDeselect();
      onReload();
    } catch (e) { alert(e.message); }
    finally { setRemoving(false); }
  }

  const activePill = (active, label) => (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 20,
      background: active ? 'var(--green-dim, #e6f9f0)' : 'var(--bg)',
      color: active ? 'var(--green, #1a8754)' : 'var(--text-sub)',
      border: `1px solid ${active ? 'var(--green, #1a8754)' : 'var(--border)'}`,
      fontWeight: 500,
    }}>{label}</span>
  );

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 16px 0' }}>
      {/* Section 1: Vendor Info */}
      <div style={S.card}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{entry.vendor_name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>Rank #{entry.rank}</div>
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {activePill(entry.is_preferred, entry.is_preferred ? '★ Preferred' : 'Set preferred')}
            {entry.is_blocked && activePill(false, '🚫 Blocked')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={S.btn(entry.is_preferred ? 'outline' : 'primary')}
            disabled={toggling} onClick={() => toggleField('is_preferred')}>
            {entry.is_preferred ? 'Unset preferred' : '★ Set as preferred'}
          </button>
          <button type="button" style={S.btn(entry.is_blocked ? 'primary' : 'outline')}
            disabled={toggling} onClick={() => toggleField('is_blocked')}>
            {entry.is_blocked ? 'Unblock' : '🚫 Block'}
          </button>
          <button type="button" style={S.btn('danger')} disabled={removing} onClick={removeEntry}>
            Remove from source list
          </button>
        </div>
      </div>

      {/* Section 2 & 3: PIR + Conditions */}
      <div style={S.card}>
        <PirSection productId={productId} vendorId={entry.vendor_id} />
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function SourcingTab({ productId, vendors }) {
  const [sourceList, setSourceList] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState(null); // entry id
  const [showAdd, setShowAdd]       = useState(false);
  const [newEntry, setNewEntry]     = useState({ vendor_id: '', rank: '1', is_preferred: false });
  const [addErr, setAddErr]         = useState('');
  const [addSaving, setAddSaving]   = useState(false);
  const [priceCheck, setPriceCheck] = useState(null);
  const [priceChecking, setPriceChecking] = useState(false);

  // If vendors prop is empty, load them ourselves
  const [localVendors, setLocalVendors] = useState([]);
  useEffect(() => {
    if (!vendors || vendors.length === 0) {
      apiFetch('/contacts?type=supplier&limit=500')
        .then(d => setLocalVendors(d.data || []))
        .catch(() => {});
    }
  }, [vendors]);

  const allVendors = (vendors && vendors.length > 0) ? vendors : localVendors;

  const loadSourceList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/pir/source-list?product_id=${productId}`);
      const list = (data.data || data || []).sort((a, b) => a.rank - b.rank);
      setSourceList(list);
    } catch { setSourceList([]); }
    finally { setLoading(false); }
  }, [productId]);

  useEffect(() => { loadSourceList(); }, [loadSourceList]);

  const selectedEntry = sourceList.find(e => e.id === selected) || null;

  // Auto-select first entry when list loads or changes
  useEffect(() => {
    if (sourceList.length > 0 && !selected) {
      setSelected(sourceList[0].id);
    }
    if (selected && !sourceList.find(e => e.id === selected)) {
      setSelected(sourceList[0]?.id || null);
    }
  }, [sourceList]); // eslint-disable-line

  async function addToSourceList() {
    if (!newEntry.vendor_id) { setAddErr('Please select a vendor.'); return; }
    setAddSaving(true); setAddErr('');
    try {
      await apiFetch('/pir/source-list', {
        method: 'POST',
        body: JSON.stringify({
          product_id:   productId,
          vendor_id:    parseInt(newEntry.vendor_id),
          pir_id:       null,
          rank:         parseInt(newEntry.rank) || 1,
          is_preferred: newEntry.is_preferred,
        }),
      });
      setNewEntry({ vendor_id: '', rank: '1', is_preferred: false });
      setShowAdd(false);
      await loadSourceList();
    } catch (e) { setAddErr(e.message); }
    finally { setAddSaving(false); }
  }

  async function runPriceCheck() {
    setPriceChecking(true); setPriceCheck(null);
    try {
      const data = await apiFetch('/pir/determine-price', {
        method: 'POST',
        body: JSON.stringify({ product_id: productId, qty: 1 }),
      });
      setPriceCheck(data);
    } catch (e) { setPriceCheck({ error: e.message }); }
    finally { setPriceChecking(false); }
  }

  const linkedIds = new Set(sourceList.map(e => e.vendor_id));
  const availableVendors = allVendors.filter(v => !linkedIds.has(v.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Top bar: Price Check */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button type="button" style={S.btn('primary')} disabled={priceChecking} onClick={runPriceCheck}>
          {priceChecking ? 'Checking…' : 'Price Check'}
        </button>
        {priceCheck && !priceCheck.error && (
          <div style={{
            fontSize: 12.5, padding: '6px 12px',
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius, 6px)', display: 'flex', gap: 10, alignItems: 'center',
          }}>
            <span style={{ color: 'var(--text-sub)' }}>Best price:</span>
            <span style={{ fontWeight: 700, fontFamily: 'DM Mono, monospace' }}>
              {priceCheck.currency_code || 'AUD'} {parseFloat(priceCheck.unit_price ?? priceCheck.price ?? 0).toFixed(4)}
            </span>
            {priceCheck.vendor_name && (
              <span style={{ color: 'var(--text-sub)' }}>via {priceCheck.vendor_name}</span>
            )}
            {priceCheck.condition_id && (
              <span style={{ fontSize: 11, color: 'var(--text-sub)' }}>Cond #{priceCheck.condition_id}</span>
            )}
          </div>
        )}
        {priceCheck?.error && (
          <div style={{ fontSize: 12, color: 'var(--red, #c0392b)', padding: '4px 10px', background: 'var(--red-dim, #ffeaea)', borderRadius: 5 }}>
            {priceCheck.error}
          </div>
        )}
      </div>

      {/* Two-panel layout */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', minHeight: 400 }}>

        {/* Left: Source List */}
        <div style={{
          width: 240, flexShrink: 0,
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius, 8px)', overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Source List</span>
            <button type="button" style={{ ...S.btn('outline'), padding: '2px 8px', fontSize: 11 }}
              onClick={() => { setShowAdd(v => !v); setAddErr(''); }}>
              <PlusIcon /> Add vendor
            </button>
          </div>

          {/* Add inline form */}
          {showAdd && (
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
              {addErr && <div style={{ fontSize: 11, color: 'var(--red, #c0392b)', marginBottom: 6 }}>{addErr}</div>}
              <div style={{ marginBottom: 7 }}>
                <label style={S.label}>Vendor *</label>
                <select style={{ ...S.input, fontSize: 12 }} value={newEntry.vendor_id}
                  onChange={e => setNewEntry(n => ({ ...n, vendor_id: e.target.value }))}>
                  <option value="">Select vendor…</option>
                  {availableVendors.map(v => (
                    <option key={v.id} value={v.id}>{v.full_name || v.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 7, marginBottom: 7 }}>
                <div style={{ flex: 1 }}>
                  <label style={S.label}>Rank</label>
                  <input style={S.input} type="number" min="1" value={newEntry.rank}
                    onChange={e => setNewEntry(n => ({ ...n, rank: e.target.value }))} />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2, gap: 5 }}>
                  <input type="checkbox" id="sl-preferred" checked={newEntry.is_preferred}
                    onChange={e => setNewEntry(n => ({ ...n, is_preferred: e.target.checked }))}
                    style={{ accentColor: 'var(--accent)' }} />
                  <label htmlFor="sl-preferred" style={{ fontSize: 11, cursor: 'pointer', color: 'var(--text)' }}>Preferred</label>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" style={{ ...S.btn('primary'), fontSize: 11 }} disabled={addSaving} onClick={addToSourceList}>
                  {addSaving ? '…' : 'Add'}
                </button>
                <button type="button" style={{ ...S.btn('outline'), fontSize: 11 }} onClick={() => setShowAdd(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* List */}
          {loading ? (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--text-sub)' }}>Loading…</div>
          ) : sourceList.length === 0 ? (
            <div style={{ padding: '20px 12px', color: 'var(--text-sub)', fontSize: 12, textAlign: 'center' }}>
              No vendors in source list yet. Add a vendor below to begin.
            </div>
          ) : (
            <div>
              {sourceList.map(entry => (
                <div key={entry.id}
                  onClick={() => setSelected(entry.id)}
                  style={{
                    padding: '9px 12px',
                    cursor: 'pointer',
                    background: selected === entry.id ? 'var(--accent-dim, rgba(47,127,232,0.08))' : 'transparent',
                    borderLeft: selected === entry.id ? '3px solid var(--accent)' : '3px solid transparent',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    transition: 'background 0.1s',
                  }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '1px 6px',
                    borderRadius: 10, background: 'var(--bg)',
                    border: '1px solid var(--border)', color: 'var(--text-sub)',
                    minWidth: 22, textAlign: 'center', flexShrink: 0,
                  }}>#{entry.rank}</span>
                  <span style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.vendor_name}
                  </span>
                  <span style={{ flexShrink: 0, fontSize: 12 }}>
                    {entry.is_preferred && '★'}
                    {entry.is_blocked  && ' 🚫'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Detail */}
        <RightPanel
          entry={selectedEntry}
          productId={productId}
          vendors={allVendors}
          onReload={loadSourceList}
          onDeselect={() => setSelected(null)}
        />
      </div>
    </div>
  );
}
