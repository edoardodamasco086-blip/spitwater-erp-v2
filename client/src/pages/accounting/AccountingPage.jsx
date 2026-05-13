import React, { useState, useEffect, useCallback } from 'react';
import { accountingApi } from '../../api/accounting';

// ── Shared helpers ─────────────────────────────────────────────
const AUD = (v) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v ?? 0);
const dt  = (v) => v ? new Date(v).toLocaleDateString('en-AU') : '—';

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'];

const TYPE_COLOR = {
  asset:     '#2F7FE8',
  liability: '#E05252',
  equity:    '#9366E8',
  revenue:   '#2ECC8A',
  cogs:      '#E89B2F',
  expense:   '#E05252',
};

function Tab({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '8px 18px', fontSize: 13, fontWeight: active ? 600 : 400,
      background: active ? 'var(--accent)' : 'transparent',
      color: active ? '#fff' : 'var(--text-sub)',
      border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
      borderRadius: 6, cursor: 'pointer', transition: 'all 0.12s',
    }}>
      {children}
    </button>
  );
}

function TypeBadge({ type }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
      background: (TYPE_COLOR[type] || '#7B93B0') + '22',
      color: TYPE_COLOR[type] || '#7B93B0',
    }}>{type}</span>
  );
}

const page      = { padding: '28px 32px', background: 'var(--bg)', minHeight: '100%' };
const card      = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const tableWrap = { overflowX: 'auto' };
const table     = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th        = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const td        = { padding: '11px 14px', borderBottom: '1px solid var(--border-subtle, var(--border))', color: 'var(--text)', verticalAlign: 'middle' };
const inp       = { width: '100%', padding: '7px 10px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--input)', color: 'var(--text)', boxSizing: 'border-box' };

// ══════════════════════════════════════════════════════════════
// COA TAB
// ══════════════════════════════════════════════════════════════
function CoaTab() {
  const [accounts,    setAccounts]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [typeFilter,  setTypeFilter]  = useState('');
  const [search,      setSearch]      = useState('');
  const [showInactive,setShowInactive]= useState(false);
  const [showForm,    setShowForm]    = useState(false);
  const [editAcct,    setEditAcct]    = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [formError,   setFormError]   = useState('');

  const emptyForm = { account_code: '', account_name: '', account_type: 'asset', account_subtype: '', description: '', bas_field: '', is_bank_account: false, is_gst_account: false, allow_manual_journal: true };
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await accountingApi.listAccounts({ active: showInactive ? undefined : 'true' });
      setAccounts(res.data.data || []);
    } catch { setError('Failed to load chart of accounts.'); }
    finally { setLoading(false); }
  }, [showInactive]);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditAcct(null); setForm(emptyForm); setFormError(''); setShowForm(true); }
  function openEdit(a) {
    setEditAcct(a);
    setForm({ account_code: a.account_code, account_name: a.account_name, account_type: a.account_type, account_subtype: a.account_subtype || '', description: a.description || '', bas_field: a.bas_field || '', is_bank_account: !!a.is_bank_account, is_gst_account: !!a.is_gst_account, allow_manual_journal: !!a.allow_manual_journal });
    setFormError('');
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault(); setSaving(true); setFormError('');
    try {
      editAcct ? await accountingApi.updateAccount(editAcct.id, form) : await accountingApi.createAccount(form);
      setShowForm(false); load();
    } catch (err) { setFormError(err.response?.data?.error || 'Save failed.'); }
    finally { setSaving(false); }
  }

  async function handleDeactivate(a) {
    if (!confirm(`Deactivate "${a.account_name}"?`)) return;
    try { await accountingApi.deleteAccount(a.id); load(); }
    catch (err) { alert(err.response?.data?.error || 'Failed to deactivate.'); }
  }

  const filtered = accounts.filter(a => {
    if (typeFilter && a.account_type !== typeFilter) return false;
    if (search) { const q = search.toLowerCase(); return a.account_code.toLowerCase().includes(q) || a.account_name.toLowerCase().includes(q); }
    return true;
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input placeholder="Search accounts…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, width: 220 }} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ ...inp, width: 'auto' }}>
          <option value="">All types</option>
          {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-sub)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive
        </label>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={openCreate}>+ New Account</button>
      </div>

      {error && <div style={{ color: '#E05252', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      <div style={card}>
        <div style={tableWrap}>
          <table style={table}>
            <thead><tr>
              <th style={th}>Code</th><th style={th}>Name</th><th style={th}>Type</th>
              <th style={th}>Normal</th><th style={th}>BAS</th><th style={th}>ATO Category</th>
              <th style={th}>Flags</th><th style={th}>Active</th><th style={th} />
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No accounts found.</td></tr>
              : filtered.map(a => (
                <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => openEdit(a)}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--hover, rgba(255,255,255,0.03))'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <td style={{ ...td, fontFamily: 'DM Mono', fontSize: 12 }}>{a.account_code}</td>
                  <td style={{ ...td, fontWeight: 500 }}>{a.account_name}</td>
                  <td style={td}><TypeBadge type={a.account_type} /></td>
                  <td style={{ ...td, fontSize: 12, color: 'var(--text-sub)' }}>{a.normal_balance}</td>
                  <td style={{ ...td, fontSize: 12 }}>{a.bas_field || a.ato_report_category || '—'}</td>
                  <td style={{ ...td, fontSize: 11, color: 'var(--text-sub)' }}>{a.gst_treatment || '—'}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {a.is_bank_account && <span className="pill pill-blue"  style={{ fontSize: 10, padding: '1px 6px' }}>Bank</span>}
                      {a.is_gst_account  && <span className="pill pill-green" style={{ fontSize: 10, padding: '1px 6px' }}>GST</span>}
                      {a.is_ar_account   && <span className="pill pill-blue"  style={{ fontSize: 10, padding: '1px 6px' }}>AR</span>}
                      {a.is_ap_account   && <span className="pill pill-blue"  style={{ fontSize: 10, padding: '1px 6px' }}>AP</span>}
                      {a.is_system       && <span className="pill pill-gray"  style={{ fontSize: 10, padding: '1px 6px' }}>System</span>}
                    </div>
                  </td>
                  <td style={td}>
                    <span style={{ color: a.is_active ? '#2ECC8A' : '#E05252', fontSize: 12, fontWeight: 600 }}>
                      {a.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                    {!a.is_system && a.is_active && (
                      <button className="btn btn-sm" style={{ color: '#E05252', borderColor: '#E05252', fontSize: 11 }} onClick={() => handleDeactivate(a)}>Deactivate</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowForm(false)}>
          <div style={{ background: 'var(--card)', borderRadius: 10, padding: 28, width: 480, maxWidth: '95vw', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 20px', fontSize: 16 }}>{editAcct ? 'Edit Account' : 'New Account'}</h3>
            {formError && <div style={{ color: '#E05252', fontSize: 13, marginBottom: 12 }}>{formError}</div>}
            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 }}>Code *</label>
                  <input required value={form.account_code} onChange={e => setForm(p => ({ ...p, account_code: e.target.value }))} disabled={!!editAcct} style={inp} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 }}>Type *</label>
                  <select value={form.account_type} onChange={e => setForm(p => ({ ...p, account_type: e.target.value }))} disabled={!!editAcct} style={inp}>
                    {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label style={{ fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 }}>Name *</label>
                <input required value={form.account_name} onChange={e => setForm(p => ({ ...p, account_name: e.target.value }))} style={inp} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 }}>Subtype</label>
                  <input value={form.account_subtype} onChange={e => setForm(p => ({ ...p, account_subtype: e.target.value }))} placeholder="e.g. current_asset" style={inp} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 }}>BAS Field</label>
                  <input value={form.bas_field} onChange={e => setForm(p => ({ ...p, bas_field: e.target.value }))} placeholder="e.g. G11" style={inp} />
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label style={{ fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 }}>Description</label>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} style={{ ...inp, resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
                {[['is_bank_account','Bank Account'],['is_gst_account','GST Account'],['allow_manual_journal','Allow Manual Journals']].map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.checked }))} /> {label}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save Account'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// JOURNALS TAB
// ══════════════════════════════════════════════════════════════
function JournalsTab() {
  const [rows,         setRows]         = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate,     setFromDate]     = useState('');
  const [toDate,       setToDate]       = useState('');
  const [detail,       setDetail]       = useState(null);
  const [detailLoading,setDetailLoading]= useState(false);
  const [showPostForm, setShowPostForm] = useState(false);
  const [reversing,    setReversing]    = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await accountingApi.listJournals({ status: statusFilter || undefined, from: fromDate || undefined, to: toDate || undefined, limit: 100 });
      setRows(res.data.data || []);
    } catch { setError('Failed to load journal entries.'); }
    finally { setLoading(false); }
  }, [statusFilter, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  async function openDetail(id) {
    setDetailLoading(true);
    try {
      const res = await accountingApi.getJournal(id);
      setDetail(res.data.data);
    } catch { setDetail(null); }
    finally { setDetailLoading(false); }
  }

  async function handleReverse(id) {
    const reason = prompt('Reason for reversing this entry?');
    if (reason === null) return;
    const reverseDateRaw = prompt('Reversal date (YYYY-MM-DD), or leave blank for today:');
    if (reverseDateRaw === null) return;
    setReversing(true);
    try {
      const res = await accountingApi.reverseJournal(id, { reason, reverse_date: reverseDateRaw || undefined });
      alert(`Reversal posted: ${res.data.data.reversalNumber}`);
      setDetail(null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Reversal failed.');
    } finally { setReversing(false); }
  }

  const statusColor = { posted: '#2ECC8A', reversed: '#E89B2F', reversal: '#7B93B0', draft: '#7B93B0' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '7px 12px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--input)', color: 'var(--text)' }}>
          <option value="">All statuses</option>
          <option value="posted">Posted</option>
          <option value="reversed">Reversed</option>
          <option value="reversal">Reversals</option>
        </select>
        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ padding: '7px 10px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--input)', color: 'var(--text)' }} />
        <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>to</span>
        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ padding: '7px 10px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--input)', color: 'var(--text)' }} />
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => setShowPostForm(true)}>+ Manual Journal</button>
      </div>

      {error && <div style={{ color: '#E05252', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      <div style={card}>
        <div style={tableWrap}>
          <table style={table}>
            <thead><tr>
              <th style={th}>Number</th><th style={th}>Date</th><th style={th}>Type</th>
              <th style={th}>Description</th>
              <th style={{ ...th, textAlign: 'right' }}>Debit</th>
              <th style={{ ...th, textAlign: 'right' }}>Credit</th>
              <th style={th}>Status</th><th style={th}>Links</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No journal entries found.</td></tr>
              : rows.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer', opacity: r.status === 'reversed' ? 0.65 : 1 }}
                  onClick={() => openDetail(r.id)}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--hover, rgba(255,255,255,0.03))'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <td style={{ ...td, fontFamily: 'DM Mono', fontSize: 12, color: 'var(--accent)' }}>{r.journal_number}</td>
                  <td style={{ ...td, fontSize: 12 }}>{dt(r.entry_date)}</td>
                  <td style={{ ...td, fontSize: 12 }}>{r.journal_type}</td>
                  <td style={td}>{r.description || '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontSize: 12 }}>{AUD(r.total_debit)}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontSize: 12 }}>{AUD(r.total_credit)}</td>
                  <td style={td}>
                    <span style={{ color: statusColor[r.status] || '#7B93B0', fontWeight: 600, fontSize: 12 }}>
                      {r.is_reversal ? 'reversal' : r.status}
                    </span>
                  </td>
                  <td style={{ ...td, fontSize: 11, color: 'var(--text-sub)' }}>
                    {r.reversal_of_number  && <div>↩ {r.reversal_of_number}</div>}
                    {r.reversed_by_number  && <div>↪ {r.reversed_by_number}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail modal */}
      {detailLoading && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--card)', borderRadius: 10, padding: 40, color: 'var(--text-sub)' }}>Loading…</div>
        </div>
      )}

      {detail && !detailLoading && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setDetail(null)}>
          <div style={{ background: 'var(--card)', borderRadius: 10, padding: 28, width: 720, maxWidth: '95vw', maxHeight: '85vh', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'DM Mono', fontSize: 15, color: 'var(--accent)', fontWeight: 700 }}>{detail.journal_number}</span>
                  {detail.is_reversal && <span style={{ fontSize: 11, background: '#E89B2F22', color: '#E89B2F', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>REVERSAL</span>}
                  {detail.status === 'reversed' && <span style={{ fontSize: 11, background: '#E0525222', color: '#E05252', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>REVERSED</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 4 }}>{dt(detail.entry_date)} · {detail.journal_type} · {detail.currency_code}</div>
                {detail.description && <div style={{ fontSize: 13, marginTop: 6 }}>{detail.description}</div>}

                {/* Reversal chain links */}
                {detail.reversal_of_number && (
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-sub)' }}>
                    ↩ Reverses <span style={{ fontFamily: 'DM Mono', color: 'var(--accent)' }}>{detail.reversal_of_number}</span>
                  </div>
                )}
                {detail.reversed_by_number && (
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-sub)' }}>
                    ↪ Reversed by <span style={{ fontFamily: 'DM Mono', color: '#E89B2F' }}>{detail.reversed_by_number}</span>
                    {detail.reversed_at && <span> on {dt(detail.reversed_at)}</span>}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {detail.status === 'posted' && !detail.is_reversal && (
                  <button className="btn btn-sm" style={{ color: '#E89B2F', borderColor: '#E89B2F' }} onClick={() => handleReverse(detail.id)} disabled={reversing}>
                    {reversing ? 'Reversing…' : 'Reverse'}
                  </button>
                )}
                <button className="btn btn-sm" onClick={() => setDetail(null)}>Close</button>
              </div>
            </div>

            <table style={{ ...table, marginTop: 4 }}>
              <thead><tr>
                <th style={th}>Account</th>
                <th style={{ ...th, textAlign: 'right' }}>Debit</th>
                <th style={{ ...th, textAlign: 'right' }}>Credit</th>
                <th style={th}>Description</th>
              </tr></thead>
              <tbody>
                {(detail.lines || []).map(l => (
                  <tr key={l.id}>
                    <td style={td}>
                      <span style={{ fontFamily: 'DM Mono', fontSize: 11, color: 'var(--text-sub)', marginRight: 6 }}>{l.account_code}</span>
                      {l.account_name}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontSize: 12 }}>{Number(l.debit)  > 0 ? AUD(l.debit)  : ''}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontSize: 12 }}>{Number(l.credit) > 0 ? AUD(l.credit) : ''}</td>
                    <td style={{ ...td, fontSize: 12, color: 'var(--text-sub)' }}>{l.description || ''}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...td, fontWeight: 700 }}>Total</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 700 }}>{AUD(detail.total_debit)}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 700 }}>{AUD(detail.total_credit)}</td>
                  <td style={td} />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showPostForm && <ManualJournalForm onClose={() => setShowPostForm(false)} onSaved={() => { setShowPostForm(false); load(); }} />}
    </div>
  );
}

// ── Manual journal form ────────────────────────────────────────
function ManualJournalForm({ onClose, onSaved }) {
  const [accounts,    setAccounts]    = useState([]);
  const [entryDate,   setEntryDate]   = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState([
    { account_id: '', debit: '', credit: '', description: '' },
    { account_id: '', debit: '', credit: '', description: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  useEffect(() => {
    accountingApi.listAccounts({ active: 'true' })
      .then(r => setAccounts((r.data.data || []).filter(a => a.allow_manual_journal && a.account_subtype !== 'header')))
      .catch(() => {});
  }, []);

  const setLine = (i, field, val) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l));

  const totalDebit  = lines.reduce((s, l) => s + (Number(l.debit)  || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced    = Math.abs(totalDebit - totalCredit) < 0.01;

  async function handleSubmit(e) {
    e.preventDefault(); setError(''); setSaving(true);
    try {
      const res = await accountingApi.postJournal({ entry_date: entryDate, description: description || null, lines: lines.map(l => ({ account_id: Number(l.account_id), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, description: l.description || null })) });
      onSaved(res.data.data);
    } catch (err) { setError(err.response?.data?.error || 'Failed to post journal entry.'); }
    finally { setSaving(false); }
  }

  const lineInp = { width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 5, background: 'var(--input)', color: 'var(--text)' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--card)', borderRadius: 10, padding: 28, width: 720, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 20px', fontSize: 16 }}>Post Manual Journal Entry</h3>
        {error && <div style={{ color: '#E05252', fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 }}>Entry Date *</label>
              <input type="date" required value={entryDate} onChange={e => setEntryDate(e.target.value)} style={inp} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 }}>Description</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Memo…" style={inp} />
            </div>
          </div>
          <table style={{ ...table, marginBottom: 8 }}>
            <thead><tr>
              <th style={th}>Account</th>
              <th style={{ ...th, textAlign: 'right', width: 110 }}>Debit</th>
              <th style={{ ...th, textAlign: 'right', width: 110 }}>Credit</th>
              <th style={th}>Line Memo</th>
              <th style={{ ...th, width: 36 }} />
            </tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td style={td}>
                    <select value={l.account_id} onChange={e => setLine(i, 'account_id', e.target.value)} required style={lineInp}>
                      <option value="">Select account…</option>
                      {ACCOUNT_TYPES.map(type => {
                        const group = accounts.filter(a => a.account_type === type);
                        if (!group.length) return null;
                        return <optgroup key={type} label={type.charAt(0).toUpperCase() + type.slice(1)}>{group.map(a => <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>)}</optgroup>;
                      })}
                    </select>
                  </td>
                  <td style={td}>
                    <input type="number" min="0" step="0.01" value={l.debit} onChange={e => setLine(i, 'debit', e.target.value)} style={{ ...lineInp, textAlign: 'right' }} />
                  </td>
                  <td style={td}>
                    <input type="number" min="0" step="0.01" value={l.credit} onChange={e => setLine(i, 'credit', e.target.value)} style={{ ...lineInp, textAlign: 'right' }} />
                  </td>
                  <td style={td}>
                    <input value={l.description} onChange={e => setLine(i, 'description', e.target.value)} placeholder="Optional…" style={lineInp} />
                  </td>
                  <td style={td}>
                    <button type="button" onClick={() => lines.length > 2 && setLines(p => p.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', color: '#E05252', cursor: 'pointer', fontSize: 16 }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...td, fontWeight: 600 }}>Total</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 700, color: balanced ? 'var(--text)' : '#E05252' }}>{AUD(totalDebit)}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 700, color: balanced ? 'var(--text)' : '#E05252' }}>{AUD(totalCredit)}</td>
                <td colSpan={2} style={{ ...td, fontSize: 12, color: balanced ? '#2ECC8A' : '#E05252', fontWeight: 600 }}>
                  {balanced ? 'Balanced ✓' : `Out of balance by ${AUD(Math.abs(totalDebit - totalCredit))}`}
                </td>
              </tr>
            </tfoot>
          </table>
          <button type="button" className="btn btn-sm" onClick={() => setLines(p => [...p, { account_id: '', debit: '', credit: '', description: '' }])} style={{ marginBottom: 16 }}>+ Add Line</button>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <button type="button" className="btn btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !balanced}>{saving ? 'Posting…' : 'Post Journal Entry'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TRIAL BALANCE TAB
// ══════════════════════════════════════════════════════════════
function TrialBalanceTab() {
  const [asOf,    setAsOf]    = useState(new Date().toISOString().slice(0, 10));
  const [rows,    setRows]    = useState([]);
  const [meta,    setMeta]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    if (!asOf) return;
    setLoading(true); setError('');
    try {
      const res = await accountingApi.trialBalance({ as_of: asOf });
      setRows(res.data.data || []); setMeta(res.data.meta || null);
    } catch { setError('Failed to load trial balance.'); }
    finally { setLoading(false); }
  }, [asOf]);

  useEffect(() => { load(); }, [load]);

  const groups = {};
  for (const r of rows) { if (!groups[r.account_type]) groups[r.account_type] = []; groups[r.account_type].push(r); }
  const typeOrder = ['asset','liability','equity','revenue','cogs','expense'];

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <label style={{ fontSize: 13, color: 'var(--text-sub)' }}>As at:</label>
        <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} style={{ padding: '7px 10px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--input)', color: 'var(--text)' }} />
        {meta && <span style={{ fontSize: 12, color: meta.balanced ? '#2ECC8A' : '#E05252', fontWeight: 600 }}>{meta.balanced ? '✓ Balanced' : `Out of balance: DR ${AUD(meta.grand_debit)} / CR ${AUD(meta.grand_credit)}`}</span>}
      </div>
      {error && <div style={{ color: '#E05252', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      <div style={card}>
        <div style={tableWrap}>
          <table style={table}>
            <thead><tr>
              <th style={th}>Code</th><th style={th}>Account Name</th><th style={th}>ATO</th>
              <th style={{ ...th, textAlign: 'right' }}>Debit</th>
              <th style={{ ...th, textAlign: 'right' }}>Credit</th>
              <th style={{ ...th, textAlign: 'right' }}>Balance</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</td></tr>
              : typeOrder.map(type => {
                const group = groups[type];
                if (!group?.length) return null;
                const gD = group.reduce((s, r) => s + Number(r.total_debit), 0);
                const gC = group.reduce((s, r) => s + Number(r.total_credit), 0);
                const gB = group.reduce((s, r) => s + Number(r.balance), 0);
                return (
                  <React.Fragment key={type}>
                    <tr>
                      <td colSpan={6} style={{ ...td, background: 'var(--bg)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: TYPE_COLOR[type] || 'var(--text-sub)', padding: '8px 14px' }}>
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </td>
                    </tr>
                    {group.map(r => (
                      <tr key={r.account_id}>
                        <td style={{ ...td, fontFamily: 'DM Mono', fontSize: 12, paddingLeft: 24 }}>{r.account_code}</td>
                        <td style={td}>{r.account_name}</td>
                        <td style={{ ...td, fontSize: 11, color: 'var(--text-sub)' }}>{r.ato_report_category || '—'}</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontSize: 12 }}>{Number(r.total_debit)  > 0 ? AUD(r.total_debit)  : ''}</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontSize: 12 }}>{Number(r.total_credit) > 0 ? AUD(r.total_credit) : ''}</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontSize: 12, fontWeight: 500 }}>{Number(r.balance) !== 0 ? AUD(r.balance) : '—'}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={3} style={{ ...td, fontWeight: 600, paddingLeft: 24, fontSize: 12, color: 'var(--text-sub)' }}>Subtotal — {type}</td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 700, fontSize: 12 }}>{AUD(gD)}</td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 700, fontSize: 12 }}>{AUD(gC)}</td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 700, fontSize: 12 }}>{AUD(gB)}</td>
                    </tr>
                  </React.Fragment>
                );
              })}
              {meta && (
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td colSpan={3} style={{ ...td, fontWeight: 700 }}>Grand Total</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 700, color: meta.balanced ? 'var(--text)' : '#E05252' }}>{AUD(meta.grand_debit)}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'DM Mono', fontWeight: 700, color: meta.balanced ? 'var(--text)' : '#E05252' }}>{AUD(meta.grand_credit)}</td>
                  <td style={td} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ACCOUNT DETERMINATION TAB (OBYC matrix)
// ══════════════════════════════════════════════════════════════
function DeterminationTab() {
  const [rows,    setRows]    = useState([]);
  const [accounts,setAccounts]= useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [showForm,setShowForm]= useState(false);
  const [editRow, setEditRow] = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [formErr, setFormErr] = useState('');

  const emptyForm = { transaction_key: '', valuation_class: '', warehouse_id: '', account_id: '', description: '' };
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [det, acct] = await Promise.all([
        accountingApi.listDetermination(),
        accountingApi.listAccounts({ active: 'true' }),
      ]);
      setRows(det.data.data || []);
      setAccounts(acct.data.data || []);
    } catch { setError('Failed to load account determination.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditRow(null); setForm(emptyForm); setFormErr(''); setShowForm(true); }
  function openEdit(r) { setEditRow(r); setForm({ transaction_key: r.transaction_key, valuation_class: r.valuation_class || '', warehouse_id: r.warehouse_id || '', account_id: r.account_id, description: r.description || '' }); setFormErr(''); setShowForm(true); }

  async function handleSave(e) {
    e.preventDefault(); setSaving(true); setFormErr('');
    try {
      const payload = { ...form, account_id: Number(form.account_id), valuation_class: form.valuation_class ? Number(form.valuation_class) : null, warehouse_id: form.warehouse_id ? Number(form.warehouse_id) : null };
      if (editRow) { await accountingApi.updateDetermination(editRow.id, { account_id: payload.account_id, description: payload.description }); }
      else { await accountingApi.createDetermination(payload); }
      setShowForm(false); load();
    } catch (err) { setFormErr(err.response?.data?.error || 'Save failed.'); }
    finally { setSaving(false); }
  }

  async function handleDelete(r) {
    if (!confirm(`Delete determination for "${r.transaction_key}"?`)) return;
    try { await accountingApi.deleteDetermination(r.id); load(); }
    catch (err) { alert(err.response?.data?.error || 'Delete failed.'); }
  }

  const txKeys = ['BSX','WRX','GBB_VBR','VKA','ARL','APL','VST_OUT','VST_IN','PRD','WGS','TAX','SUP','DEP'];
  const txDesc = { BSX:'Inventory Receipt',WRX:'GR/IR Clearing',GBB_VBR:'Cost of Goods Sold',VKA:'Revenue (Sales)',ARL:'Accounts Receivable',APL:'Accounts Payable',VST_OUT:'GST Collected',VST_IN:'GST Credits',PRD:'Price Difference',WGS:'Wages',TAX:'PAYG Withholding',SUP:'Superannuation',DEP:'Depreciation' };

  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-sub)' }}>
        Automated account determination matrix (SAP OBYC equivalent). Maps transaction keys to GL accounts.
        <br />NULL valuation class or warehouse means "any" — a more specific row takes priority.
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button className="btn btn-primary btn-sm" onClick={openCreate}>+ New Mapping</button>
      </div>
      {error && <div style={{ color: '#E05252', marginBottom: 12, fontSize: 13 }}>{error}</div>}
      <div style={card}>
        <div style={tableWrap}>
          <table style={table}>
            <thead><tr>
              <th style={th}>Transaction Key</th><th style={th}>Description</th>
              <th style={th}>Valuation Class</th><th style={th}>Warehouse</th>
              <th style={th}>GL Account</th><th style={th}>Note</th>
              <th style={th}>Active</th><th style={th} />
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-sub)' }}>No determination rows. Add at least BSX (inventory) and WRX (GR/IR) to enable inbound deliveries.</td></tr>
              : rows.map(r => (
                <tr key={r.id} onMouseEnter={e => e.currentTarget.style.background = 'var(--hover, rgba(255,255,255,0.03))'} onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <td style={{ ...td, fontFamily: 'DM Mono', fontWeight: 700, fontSize: 12, color: 'var(--accent)' }}>{r.transaction_key}</td>
                  <td style={{ ...td, fontSize: 12, color: 'var(--text-sub)' }}>{txDesc[r.transaction_key] || '—'}</td>
                  <td style={{ ...td, fontSize: 12 }}>{r.valuation_class_name || <span style={{ color: 'var(--text-sub)' }}>Any</span>}</td>
                  <td style={{ ...td, fontSize: 12 }}>{r.warehouse_name || <span style={{ color: 'var(--text-sub)' }}>Any</span>}</td>
                  <td style={td}>
                    <span style={{ fontFamily: 'DM Mono', fontSize: 11, color: 'var(--text-sub)', marginRight: 6 }}>{r.account_code}</span>
                    {r.account_name}
                  </td>
                  <td style={{ ...td, fontSize: 12, color: 'var(--text-sub)' }}>{r.description || '—'}</td>
                  <td style={td}>
                    <span style={{ color: r.is_active ? '#2ECC8A' : '#E05252', fontWeight: 600, fontSize: 12 }}>{r.is_active ? '✓' : '✗'}</span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => openEdit(r)}>Edit</button>
                      <button className="btn btn-sm" style={{ fontSize: 11, color: '#E05252', borderColor: '#E05252' }} onClick={() => handleDelete(r)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowForm(false)}>
          <div style={{ background: 'var(--card)', borderRadius: 10, padding: 28, width: 500, maxWidth: '95vw', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 20px', fontSize: 16 }}>{editRow ? 'Edit Determination Row' : 'New Determination Mapping'}</h3>
            {formErr && <div style={{ color: '#E05252', fontSize: 13, marginBottom: 12 }}>{formErr}</div>}
            <form onSubmit={handleSave}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 }}>Transaction Key *</label>
                <select value={form.transaction_key} onChange={e => setForm(p => ({ ...p, transaction_key: e.target.value }))} required disabled={!!editRow} style={inp}>
                  <option value="">Select key…</option>
                  {txKeys.map(k => <option key={k} value={k}>{k} — {txDesc[k] || k}</option>)}
                </select>
              </div>
              {!editRow && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 }}>Valuation Class</label>
                    <input type="number" value={form.valuation_class} onChange={e => setForm(p => ({ ...p, valuation_class: e.target.value }))} placeholder="Product category ID (blank = any)" style={inp} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 }}>Warehouse ID</label>
                    <input type="number" value={form.warehouse_id} onChange={e => setForm(p => ({ ...p, warehouse_id: e.target.value }))} placeholder="Warehouse ID (blank = any)" style={inp} />
                  </div>
                </div>
              )}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 }}>GL Account *</label>
                <select value={form.account_id} onChange={e => setForm(p => ({ ...p, account_id: e.target.value }))} required style={inp}>
                  <option value="">Select account…</option>
                  {ACCOUNT_TYPES.map(type => {
                    const group = accounts.filter(a => a.account_type === type);
                    if (!group.length) return null;
                    return <optgroup key={type} label={type.charAt(0).toUpperCase() + type.slice(1)}>{group.map(a => <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>)}</optgroup>;
                  })}
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 4 }}>Note</label>
                <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Optional note…" style={inp} />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save Mapping'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════
const TABS = [
  { key: 'coa',    label: 'Chart of Accounts' },
  { key: 'journals',label: 'Journal Entries' },
  { key: 'tb',    label: 'Trial Balance' },
  { key: 'obyc',  label: 'Account Determination' },
];

export default function AccountingPage() {
  const [tab, setTab] = useState('coa');
  return (
    <div style={page}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Accounting</h1>
        <p style={{ fontSize: 13, color: 'var(--text-sub)', margin: 0 }}>Immutable double-entry ledger · SAP FICO architecture · ATO-standard accounts</p>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {TABS.map(t => <Tab key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</Tab>)}
      </div>
      {tab === 'coa'     && <CoaTab />}
      {tab === 'journals'&& <JournalsTab />}
      {tab === 'tb'      && <TrialBalanceTab />}
      {tab === 'obyc'    && <DeterminationTab />}
    </div>
  );
}
