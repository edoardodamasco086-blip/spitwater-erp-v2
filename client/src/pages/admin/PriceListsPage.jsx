import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '../../context/AuthContext';
import { getAccessToken } from '../../api/client';
import styles from './CustomerTiersPage.module.css';

const API = (path, opts = {}) =>
  fetch(`/api/price-lists${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAccessToken()}` },
    ...opts,
  }).then(r => r.json());

const TYPE_LABELS = { retail: 'Retail', wholesale: 'Wholesale', dealer: 'Dealer', trade: 'Trade', cost: 'Cost', special: 'Special' };
const TYPE_COLORS = { retail: 'pill-blue', wholesale: 'pill-green', dealer: 'pill-purple', trade: 'pill-orange', cost: 'pill-grey', special: 'pill-red' };
const CURRENCIES  = ['AUD','USD','EUR','GBP','JPY','CNY','NZD','SGD'];
const TYPES       = Object.keys(TYPE_LABELS);
const EMPTY = { name: '', price_list_type: 'retail', currency_code: 'AUD', is_default: false, is_tax_inclusive: false, description: '', valid_from: '', valid_to: '' };

const AUD = (v, cur = 'AUD') => v == null ? '—' :
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(v);

function initials(name) { return (name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function avatarColor(name) { const c=['#2F7FE8','#2ECC8A','#E89B2F','#9366E8','#E05252']; return c[(name||'').charCodeAt(0)%c.length]; }

export default function PriceListsPage() {
  const { isAdmin } = useAuth();
  const fileRef = useRef();

  const [lists,      setLists]      = useState([]);
  const [contacts,   setContacts]   = useState([]);
  const [selected,   setSelected]   = useState(null);
  const [members,    setMembers]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [editId,     setEditId]     = useState(null);
  const [form,       setForm]       = useState(EMPTY);
  const [saving,     setSaving]     = useState(false);
  const [addCid,     setAddCid]     = useState('');
  const [activeTab,  setActiveTab]  = useState('info');
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState('');

  // Items tab state
  const [items,        setItems]        = useState([]);
  const [pending,      setPending]      = useState({});   // { productId: { unit_price, min_qty } }
  const [itemSearch,   setItemSearch]   = useState('');
  const [showAdjust,   setShowAdjust]   = useState(false);
  const [adjustMode,   setAdjustMode]   = useState('increase');
  const [adjustPct,    setAdjustPct]    = useState('');
  const [savingItems,  setSavingItems]  = useState(false);
  const [importMsg,    setImportMsg]    = useState('');
  const [itemsLoaded,  setItemsLoaded]  = useState(null); // plId of loaded items

  async function loadLists() {
    setLoading(true);
    try { const { data } = await API('/'); setLists(data || []); }
    finally { setLoading(false); }
  }

  async function loadContacts() {
    const r = await fetch('/api/contacts?limit=500', { headers: { Authorization: `Bearer ${getAccessToken()}` } });
    const d = await r.json();
    setContacts(d.data || []);
  }

  useEffect(() => { loadLists(); loadContacts(); }, []);

  async function selectList(pl) {
    setSelected(pl); setActiveTab('info'); setAddCid(''); setError('');
    setItems([]); setPending({}); setItemsLoaded(null); setImportMsg(''); setItemSearch('');
    const { data } = await API(`/${pl.id}/contacts`);
    setMembers(data || []);
  }

  async function loadItems(plId) {
    if (itemsLoaded === plId) return;
    const { data } = await API(`/${plId}/items`);
    setItems(data || []);
    setItemsLoaded(plId);
  }

  function switchTab(tab) {
    setActiveTab(tab);
    if (tab === 'items' && selected) loadItems(selected.id);
  }

  // ── Save / Edit price list ──
  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form, valid_from: form.valid_from || null, valid_to: form.valid_to || null };
      if (editId) await API(`/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else        await API('/',          { method: 'POST',  body: JSON.stringify(payload) });
      setSuccess(editId ? 'Price list updated.' : 'Price list created.');
      setShowForm(false); setEditId(null); setForm(EMPTY);
      setTimeout(() => setSuccess(''), 3000);
      await loadLists();
    } catch { setError('Save failed.'); }
    finally { setSaving(false); }
  }

  async function handleDelete(pl) {
    if (!confirm(`Deactivate price list "${pl.name}"?`)) return;
    const res = await API(`/${pl.id}`, { method: 'DELETE' });
    if (!res.success) { alert(res.error); return; }
    if (selected?.id === pl.id) { setSelected(null); setMembers([]); }
    await loadLists();
  }

  async function handleAssign() {
    if (!addCid || !selected) return;
    await API(`/${selected.id}/contacts`, { method: 'POST', body: JSON.stringify({ contactId: parseInt(addCid) }) });
    setAddCid('');
    const { data } = await API(`/${selected.id}/contacts`);
    setMembers(data || []);
    await loadLists();
  }

  async function handleRemoveContact(cid) {
    await API(`/${selected.id}/contacts/${cid}`, { method: 'DELETE' });
    const { data } = await API(`/${selected.id}/contacts`);
    setMembers(data || []);
    await loadLists();
  }

  function startEdit(pl) {
    setForm({
      name: pl.name, price_list_type: pl.price_list_type, currency_code: pl.currency_code,
      is_default: !!pl.is_default, is_tax_inclusive: !!pl.is_tax_inclusive,
      description: pl.description || '',
      valid_from: pl.valid_from ? pl.valid_from.slice(0,10) : '',
      valid_to:   pl.valid_to   ? pl.valid_to.slice(0,10)   : '',
    });
    setEditId(pl.id); setShowForm(true); setError('');
  }

  // ── Items tab ──────────────────────────────────────────────
  function effectivePrice(item) {
    const p = pending[item.id];
    return p !== undefined ? p.unit_price : item.unit_price;
  }

  function effectiveMinQty(item) {
    const p = pending[item.id];
    return p !== undefined ? (p.min_qty ?? 1) : (item.min_qty ?? 1);
  }

  function setItemPrice(productId, unit_price) {
    setPending(p => ({ ...p, [productId]: { ...(p[productId] || {}), unit_price: unit_price === '' ? null : unit_price } }));
  }

  function setItemMinQty(productId, min_qty) {
    setPending(p => ({ ...p, [productId]: { ...(p[productId] || {}), min_qty: min_qty } }));
  }

  function applyAdjustment() {
    if (!adjustPct) return;
    const pct = parseFloat(adjustPct);
    if (isNaN(pct)) return;
    const next = { ...pending };
    items.forEach(item => {
      const cur = effectivePrice(item);
      if (cur == null) return; // only adjust items that have a price
      let newPrice;
      if (adjustMode === 'increase') newPrice = parseFloat((Number(cur) * (1 + pct / 100)).toFixed(4));
      else                           newPrice = parseFloat((Number(cur) * (1 - pct / 100)).toFixed(4));
      if (newPrice < 0) newPrice = 0;
      next[item.id] = { ...(next[item.id] || {}), unit_price: newPrice };
    });
    setPending(next);
    setShowAdjust(false); setAdjustPct('');
  }

  async function saveBulk() {
    if (!selected) return;
    const changed = Object.entries(pending);
    if (changed.length === 0) { setSuccess('No changes to save.'); setTimeout(() => setSuccess(''), 2000); return; }
    setSavingItems(true);
    try {
      const prices = changed.map(([productId, vals]) => ({
        product_id: parseInt(productId),
        unit_price: vals.unit_price != null ? parseFloat(vals.unit_price) : null,
        min_qty:    parseFloat(vals.min_qty) || 1,
      }));
      const res = await API(`/${selected.id}/items/bulk`, { method: 'POST', body: JSON.stringify({ prices }) });
      if (!res.success) throw new Error(res.error);
      setSuccess(`${changed.length} item${changed.length > 1 ? 's' : ''} saved.`);
      setTimeout(() => setSuccess(''), 3000);
      // Reload items to reflect saved state
      setItemsLoaded(null);
      const { data } = await API(`/${selected.id}/items`);
      setItems(data || []); setItemsLoaded(selected.id);
      setPending({});
      await loadLists(); // refresh product_count
    } catch (err) { setError(err.message || 'Save failed.'); }
    finally { setSavingItems(false); }
  }

  function importXLS(file) {
    if (!file) return;
    setImportMsg('');
    const reader = new FileReader();
    reader.onload = e => {
      const wb  = XLSX.read(e.target.result, { type: 'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      let matched = 0;
      const next = { ...pending };
      rows.forEach(row => {
        // Accept SKU, Code, product_code columns (case-insensitive)
        const sku   = (row.SKU || row.Code || row.code || row.product_code || '').toString().trim();
        const price = parseFloat(row.Price || row.price || row.unit_price || row['Unit Price'] || 0);
        if (!sku || isNaN(price)) return;
        const item = items.find(i => (i.product_code || '').toLowerCase() === sku.toLowerCase());
        if (!item) return;
        next[item.id] = { ...(next[item.id] || {}), unit_price: price };
        matched++;
      });
      setPending(next);
      setImportMsg(`Matched ${matched} of ${rows.length} rows. Review and save.`);
    };
    reader.readAsArrayBuffer(file);
    fileRef.current.value = '';
  }

  function exportTemplate() {
    const rows = [['SKU', 'Product', 'Category', 'Price', 'Min Qty']];
    items.forEach(item => {
      rows.push([
        item.product_code || '',
        item.name,
        item.category_name || '',
        effectivePrice(item) ?? '',
        effectiveMinQty(item),
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 14 }, { wch: 36 }, { wch: 20 }, { wch: 12 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Prices');
    XLSX.writeFile(wb, `price-list-${selected?.name || 'export'}.xlsx`);
  }

  if (!isAdmin) return <div className={styles.page}><div className={styles.empty}>Access denied.</div></div>;

  const unassigned   = contacts.filter(c => !members.find(m => m.id === c.id));
  const activeLists  = lists.filter(l => l.is_active);
  const pendingCount = Object.keys(pending).length;

  const filteredItems = items.filter(item =>
    !itemSearch ||
    (item.name || '').toLowerCase().includes(itemSearch.toLowerCase()) ||
    (item.product_code || '').toLowerCase().includes(itemSearch.toLowerCase()) ||
    (item.category_name || '').toLowerCase().includes(itemSearch.toLowerCase())
  );
  const pricedCount = items.filter(item => effectivePrice(item) != null).length;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Price Lists</h1>
          <p className={styles.sub}>Define your price lists (Retail, Wholesale, Dealer…) and assign them to contacts. Product prices per list are set in the product Pricing tab.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setShowForm(true); setEditId(null); setForm(EMPTY); setError(''); }}>
          <PlusIcon /> New Price List
        </button>
      </div>

      {error   && <div className={styles.errorBox}>{error}</div>}
      {success && <div className={styles.successBox}>{success}</div>}

      {/* Create / Edit form */}
      {showForm && (
        <form className={styles.createCard} onSubmit={handleSave}>
          <div className={styles.createTitle}>{editId ? 'Edit Price List' : 'New Price List'}</div>
          <div className={styles.createRow}>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Name *</label>
              <input className="form-input" autoFocus value={form.name}
                onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="e.g. Retail AUD, Dealer AU" />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Type</label>
              <select className="form-input" value={form.price_list_type}
                onChange={e => setForm(f => ({...f, price_list_type: e.target.value}))}>
                {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Currency</label>
              <select className="form-input" value={form.currency_code}
                onChange={e => setForm(f => ({...f, currency_code: e.target.value}))}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className={styles.createRow}>
            <div className="form-group" style={{ flex: 3 }}>
              <label className="form-label">Description</label>
              <input className="form-input" value={form.description}
                onChange={e => setForm(f => ({...f, description: e.target.value}))} placeholder="Optional notes" />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Valid from</label>
              <input className="form-input" type="date" value={form.valid_from}
                onChange={e => setForm(f => ({...f, valid_from: e.target.value}))} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Valid to</label>
              <input className="form-input" type="date" value={form.valid_to}
                onChange={e => setForm(f => ({...f, valid_to: e.target.value}))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 20, marginBottom: 14 }}>
            {[['is_default','Set as default price list'],['is_tax_inclusive','Prices are tax inclusive (GST)']].map(([field, label]) => (
              <label key={field} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!form[field]} onChange={e => setForm(f => ({...f, [field]: e.target.checked}))}
                  style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />
                {label}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { setShowForm(false); setEditId(null); }}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !form.name.trim()}>
              {saving ? 'Saving...' : editId ? 'Save changes' : 'Create price list'}
            </button>
          </div>
        </form>
      )}

      <div className={styles.body}>
        {/* Price list sidebar */}
        <div className={styles.tierList}>
          <div className={styles.tierListTitle}>Price Lists ({activeLists.length})</div>
          {loading ? (
            <div style={{ padding: 20, color: 'var(--text-sub)' }}>Loading...</div>
          ) : activeLists.length === 0 ? (
            <div className={styles.empty}>No price lists yet.</div>
          ) : activeLists.map(pl => (
            <div key={pl.id}
              className={[styles.tierItem, selected?.id === pl.id ? styles.tierSelected : ''].join(' ')}
              onClick={() => selectList(pl)}>
              <div>
                <div className={styles.tierName}>
                  {pl.name}
                  {pl.is_base    && <span className="pill pill-green" style={{ marginLeft: 6, fontSize: 9 }}>BASE (RRP)</span>}
                  {pl.is_default && <span className="pill pill-blue"  style={{ marginLeft: 6, fontSize: 9 }}>DEFAULT</span>}
                </div>
                <div className={styles.tierMeta}>
                  <span className={`pill ${TYPE_COLORS[pl.price_list_type] || 'pill-grey'}`} style={{ fontSize: 10, padding: '1px 6px' }}>
                    {TYPE_LABELS[pl.price_list_type]}
                  </span>
                  {' '}{pl.currency_code}
                  {' · '}{pl.product_count || 0} products
                  {' · '}{pl.contact_count || 0} contacts
                </div>
              </div>
              <div className={styles.tierActions} onClick={e => e.stopPropagation()}>
                <button className="btn btn-outline btn-sm" onClick={() => startEdit(pl)}>Edit</button>
                {!pl.is_default && !pl.is_base && (
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(pl)}>Del</button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Right panel */}
        {selected ? (
          <div className={styles.rightPanel}>
            <div className={styles.panelHeader}>
              <div>
                <div className={styles.panelTitle}>{selected.name}</div>
                <div className={styles.panelDesc}>
                  <span className={`pill ${TYPE_COLORS[selected.price_list_type] || 'pill-grey'}`}>{TYPE_LABELS[selected.price_list_type]}</span>
                  {' '}{selected.currency_code}
                  {selected.is_tax_inclusive && ' · Tax inclusive'}
                  {selected.description && ` · ${selected.description}`}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-sub)' }}>
                <div>{selected.product_count || 0} products</div>
                <div>{members.length} contacts</div>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 16px', flexShrink: 0 }}>
              {[['info','Details'],['items', `Items${activeTab==='items'&&items.length ? ` (${pricedCount}/${items.length})` : ''}`],['contacts','Contacts']].map(([key, label]) => (
                <button key={key}
                  style={{ padding: '10px 16px', background: 'none', border: 'none',
                    borderBottom: activeTab===key ? '2px solid var(--accent)' : '2px solid transparent',
                    color: activeTab===key ? 'var(--accent)' : 'var(--text-sub)',
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, marginBottom: -1,
                    fontWeight: activeTab===key ? 500 : 400 }}
                  onClick={() => switchTab(key)}>
                  {label}
                </button>
              ))}
            </div>

            <div className={styles.panelBody}>

              {/* ── Details tab ── */}
              {activeTab === 'info' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  {[
                    ['Type',        TYPE_LABELS[selected.price_list_type]],
                    ['Currency',    selected.currency_code],
                    ['Tax incl.',   selected.is_tax_inclusive ? 'Yes' : 'No'],
                    ['Base (RRP)',  selected.is_base    ? 'Yes — non-deletable' : 'No'],
                    ['Default',     selected.is_default ? 'Yes' : 'No'],
                    ['Valid from',  selected.valid_from ? new Date(selected.valid_from).toLocaleDateString('en-AU') : '—'],
                    ['Valid to',    selected.valid_to   ? new Date(selected.valid_to).toLocaleDateString('en-AU')   : '—'],
                    ['Products',    selected.product_count || 0],
                    ['Contacts',    members.length],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', marginBottom: 3 }}>{label}</div>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{val}</div>
                    </div>
                  ))}
                  {selected.description && (
                    <div style={{ gridColumn: '1/-1' }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', marginBottom: 3 }}>Description</div>
                      <div style={{ fontSize: 13.5 }}>{selected.description}</div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Items tab ── */}
              {activeTab === 'items' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                  {/* Toolbar */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      className="form-input"
                      style={{ flex: '1 1 160px', minWidth: 160, fontSize: 13 }}
                      placeholder="Search products…"
                      value={itemSearch}
                      onChange={e => setItemSearch(e.target.value)}
                    />
                    <button className="btn btn-outline btn-sm" onClick={() => { setShowAdjust(v => !v); setAdjustPct(''); }}>
                      % Adjust
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={exportTemplate} title="Download XLS with current prices — fill in and re-upload">
                      ⬇ Template
                    </button>
                    <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer', marginBottom: 0 }}>
                      ⬆ Import XLS
                      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => importXLS(e.target.files[0])} />
                    </label>
                    <button
                      className={`btn btn-sm ${pendingCount > 0 ? 'btn-primary' : 'btn-outline'}`}
                      onClick={saveBulk}
                      disabled={savingItems}
                    >
                      {savingItems ? 'Saving…' : `Save${pendingCount > 0 ? ` (${pendingCount})` : ''}`}
                    </button>
                  </div>

                  {/* Adjust panel */}
                  {showAdjust && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(47,127,232,0.06)', border: '1px solid rgba(47,127,232,0.2)', borderRadius: 8, padding: '10px 14px', flexWrap: 'wrap' }}>
                      <select className="form-input" style={{ width: 'auto', fontSize: 13 }} value={adjustMode} onChange={e => setAdjustMode(e.target.value)}>
                        <option value="increase">Increase by</option>
                        <option value="decrease">Decrease by</option>
                      </select>
                      <input className="form-input" type="number" min="0" max="100" step="0.1" style={{ width: 80, fontSize: 13 }}
                        placeholder="%" value={adjustPct} onChange={e => setAdjustPct(e.target.value)} />
                      <span style={{ fontSize: 13, color: 'var(--text-sub)' }}>% — applies to all priced items</span>
                      <button className="btn btn-primary btn-sm" onClick={applyAdjustment} disabled={!adjustPct}>Apply</button>
                      <button className="btn btn-outline btn-sm" onClick={() => setShowAdjust(false)}>Cancel</button>
                    </div>
                  )}

                  {importMsg && (
                    <div style={{ fontSize: 12, color: '#2ECC8A', background: 'rgba(46,204,138,0.08)', border: '1px solid rgba(46,204,138,0.3)', borderRadius: 6, padding: '6px 12px' }}>
                      {importMsg}
                    </div>
                  )}

                  {/* Summary */}
                  <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
                    {pricedCount} of {items.length} products have prices set
                    {pendingCount > 0 && <span style={{ color: 'var(--accent)', marginLeft: 8, fontWeight: 600 }}> · {pendingCount} unsaved changes</span>}
                  </div>

                  {/* Items table */}
                  <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: 'rgba(240,244,249,0.8)', borderBottom: '1px solid var(--border)' }}>
                          {['Code','Product','Category','Price','Min Qty'].map(h => (
                            <th key={h} style={{ padding: '8px 12px', textAlign: h === 'Price' || h === 'Min Qty' ? 'right' : 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredItems.length === 0 && (
                          <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--text-sub)' }}>
                            {items.length === 0 ? 'Loading…' : 'No products match.'}
                          </td></tr>
                        )}
                        {filteredItems.map(item => {
                          const ep = effectivePrice(item);
                          const changed = pending[item.id] !== undefined;
                          return (
                            <tr key={item.id} style={{ borderBottom: '1px solid var(--border)', background: changed ? 'rgba(47,127,232,0.04)' : 'var(--card)' }}>
                              <td style={{ padding: '6px 12px', fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--text-sub)', whiteSpace: 'nowrap' }}>
                                {item.product_code || '—'}
                              </td>
                              <td style={{ padding: '6px 12px', fontWeight: 500 }}>{item.name}</td>
                              <td style={{ padding: '6px 12px', color: 'var(--text-sub)', fontSize: 12 }}>{item.category_name || '—'}</td>
                              <td style={{ padding: '4px 12px', textAlign: 'right' }}>
                                <input
                                  type="number" step="0.0001" min="0"
                                  placeholder="Not set"
                                  value={ep ?? ''}
                                  onChange={e => setItemPrice(item.id, e.target.value === '' ? null : e.target.value)}
                                  style={{ width: 100, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 13, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 7px' }}
                                />
                              </td>
                              <td style={{ padding: '4px 12px', textAlign: 'right' }}>
                                <input
                                  type="number" step="1" min="1"
                                  value={effectiveMinQty(item)}
                                  onChange={e => setItemMinQty(item.id, e.target.value)}
                                  style={{ width: 60, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 13, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 7px' }}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── Contacts tab ── */}
              {activeTab === 'contacts' && (
                <>
                  <div className={styles.addRow}>
                    <select className="form-input" style={{ flex: 1 }} value={addCid} onChange={e => setAddCid(e.target.value)}>
                      <option value="">Assign a contact to this price list...</option>
                      {unassigned.map(c => <option key={c.id} value={c.id}>{c.full_name} {c.email ? `(${c.email})` : ''}</option>)}
                    </select>
                    <button className="btn btn-primary btn-sm" disabled={!addCid} onClick={handleAssign}>Assign</button>
                  </div>
                  {members.length === 0 ? (
                    <div className={styles.empty} style={{ padding: '32px 20px' }}>No contacts assigned yet.</div>
                  ) : (
                    <div className={styles.memberList}>
                      {members.map(m => (
                        <div key={m.id} className={styles.memberRow}>
                          <div className={styles.memberAvatar} style={{ background: avatarColor(m.full_name) }}>{initials(m.full_name)}</div>
                          <div className={styles.memberInfo}>
                            <div className={styles.memberName}>{m.full_name}</div>
                            <div className={styles.memberSub}>{m.email || m.contact_type || ''}</div>
                          </div>
                          <button className="btn btn-outline btn-sm" onClick={() => handleRemoveContact(m.id)}>Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

            </div>
          </div>
        ) : (
          <div className={styles.noSelection}>
            <ListIcon />
            <p>Select a price list to view details and manage contacts.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ic(p) { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p}</svg>; }
function PlusIcon() { return ic(<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>); }
function ListIcon() { return ic(<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>); }
