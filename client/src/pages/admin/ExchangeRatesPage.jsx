import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

const API = (path, opts = {}) =>
  fetch(`/api/currency${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
    ...opts,
  }).then(r => r.json());

const BASE = 'AUD';

export default function ExchangeRatesPage() {
  const { isAdmin } = useAuth();
  const [currencies,   setCurrencies]   = useState([]);
  const [rates,        setRates]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [fxUpdated,    setFxUpdated]    = useState(null);
  const [editRow,      setEditRow]      = useState(null); // currency code being edited
  const [editRate,     setEditRate]     = useState('');
  const [editDate,     setEditDate]     = useState(new Date().toISOString().split('T')[0]);
  const [saving,       setSaving]       = useState(false);
  const [history,      setHistory]      = useState(null); // { code, rows }
  const [histLoading,  setHistLoading]  = useState(false);
  const [error,        setError]        = useState('');
  const [success,      setSuccess]      = useState('');

  async function load() {
    setLoading(true);
    try {
      const { data, meta } = await API('/');
      // data.data = currencies with rate_to_base
      setCurrencies((data.data || data || []).filter(c => !c.is_base));
      setFxUpdated(meta?.fx_last_updated || data.meta?.fx_last_updated);

      // Also fetch all rates for today
      const allCurrencies = (data.data || data || []);
      setRates(allCurrencies.filter(c => !c.is_base && c.is_active));
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleRefresh() {
    setRefreshing(true); setError(''); setSuccess('');
    try {
      const res = await API('/refresh', { method: 'POST' });
      setSuccess(res.success
        ? `Rates updated — ${res.data?.stored || 0} pairs fetched from exchangerate.host`
        : (res.error || 'Refresh failed'));
      setTimeout(() => setSuccess(''), 5000);
      await load();
    } catch (e) { setError('Refresh failed. Check network or API key.'); }
    finally { setRefreshing(false); }
  }

  async function handleSaveRate() {
    if (!editRow || !editRate) return;
    setSaving(true); setError('');
    try {
      const res = await API('/rate/manual', {
        method: 'POST',
        body: JSON.stringify({
          from_currency: BASE,
          to_currency:   editRow,
          rate:          parseFloat(editRate),
          rate_date:     editDate,
        }),
      });
      if (!res.success) throw new Error(res.error);
      setSuccess(`Rate ${BASE}/${editRow} saved manually for ${editDate}.`);
      setTimeout(() => setSuccess(''), 4000);
      setEditRow(null); setEditRate('');
      await load();
    } catch (e) {
      setError(e.message || 'Save failed.');
    } finally { setSaving(false); }
  }

  async function showHistory(code) {
    if (history?.code === code) { setHistory(null); return; }
    setHistLoading(true);
    try {
      const res = await API(`/history/${BASE}/${code}`);
      setHistory({ code, rows: res.data || [] });
    } finally { setHistLoading(false); }
  }

  const today = new Date().toISOString().split('T')[0];

  if (!isAdmin) return <div style={{ padding: 32, color: 'var(--text-sub)' }}>Access denied.</div>;

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.3 }}>Exchange Rates</h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-sub)', marginTop: 4 }}>
            Rates are fetched daily from exchangerate.host (base: {BASE}).
            You can override any rate manually for any date.
          </p>
        </div>
        <button className="btn btn-primary" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <><span className="spinner" /> Fetching...</> : 'Refresh from API now'}
        </button>
      </div>

      {error   && <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(224,82,82,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red)' }}>{error}</div>}
      {success && <div style={{ background: 'var(--green-dim)', border: '1px solid rgba(46,204,138,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#1EA870' }}>{success}</div>}

      {/* Last updated */}
      {fxUpdated && (
        <div style={{ fontSize: 13, color: 'var(--text-sub)', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px' }}>
          Last automatic fetch: <strong>{new Date(fxUpdated).toLocaleString('en-AU')}</strong>
          {' · '}Next auto-fetch: midnight AEST
        </div>
      )}

      {/* Rates table */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'rgba(240,244,249,0.5)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'DM Mono', fontWeight: 700, background: 'var(--accent-dim)', color: 'var(--accent)', padding: '2px 10px', borderRadius: 4 }}>{BASE}</span>
          <span style={{ fontSize: 13.5, color: 'var(--text-sub)' }}>Base currency — rates shown as 1 {BASE} = X foreign currency</span>
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-sub)' }}>
            <div className="spinner-dark" style={{ display: 'inline-block', marginRight: 8 }} />Loading...
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(240,244,249,0.4)' }}>
                {['Currency','Name','Rate (1 AUD =)','Rate date','Source','Actions'].map(h => (
                  <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rates.map(c => {
                const isEditing   = editRow === c.code;
                const isToday     = c.rate_date?.slice(0, 10) === today;
                const isManual    = false; // would need source field
                const rateDisplay = c.rate_to_base
                  ? (1 / parseFloat(c.rate_to_base)).toFixed(6)
                  : null;

                return (
                  <React.Fragment key={c.code}>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ fontFamily: 'DM Mono', fontWeight: 700, background: 'var(--accent-dim)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
                          {c.code}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 500 }}>{c.name}</td>
                      <td style={{ padding: '10px 14px' }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <input
                              style={{ width: 130, fontFamily: 'DM Mono', background: 'var(--bg)', border: '1px solid var(--accent)', borderRadius: 5, padding: '4px 8px', fontSize: 13 }}
                              type="number" step="0.000001" min="0.000001"
                              value={editRate}
                              onChange={e => setEditRate(e.target.value)}
                              autoFocus
                              placeholder="e.g. 0.634"
                            />
                            <input
                              type="date"
                              style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px', fontSize: 12 }}
                              value={editDate}
                              onChange={e => setEditDate(e.target.value)}
                            />
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontFamily: 'DM Mono', fontWeight: 600, fontSize: 14 }}>
                              {rateDisplay ?? <span style={{ color: 'var(--orange)' }}>No rate</span>}
                            </span>
                            {rateDisplay && (
                              <span style={{ fontSize: 11, color: 'var(--text-sub)' }}>{c.code}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12 }}>
                        <span style={{ color: isToday ? '#1EA870' : 'var(--orange)', fontWeight: isToday ? 500 : 400 }}>
                          {c.rate_date ? new Date(c.rate_date).toLocaleDateString('en-AU') : '—'}
                          {!isToday && c.rate_date && ' (outdated)'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text-sub)' }}>
                        {c.source || 'auto'}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {isEditing ? (
                            <>
                              <button className="btn btn-primary btn-sm" disabled={saving || !editRate} onClick={handleSaveRate}>
                                {saving ? '...' : 'Save'}
                              </button>
                              <button className="btn btn-outline btn-sm" onClick={() => { setEditRow(null); setEditRate(''); }}>
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button className="btn btn-outline btn-sm"
                                onClick={() => {
                                  setEditRow(c.code);
                                  setEditRate(rateDisplay || '');
                                  setEditDate(today);
                                  setHistory(null);
                                }}>
                                Override
                              </button>
                              <button className="btn btn-outline btn-sm"
                                onClick={() => showHistory(c.code)}>
                                {history?.code === c.code ? 'Hide' : 'History'}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* History rows */}
                    {history?.code === c.code && (
                      <tr>
                        <td colSpan={6} style={{ padding: '0 14px 12px', background: 'rgba(240,244,249,0.4)' }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', margin: '10px 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Rate history — {BASE}/{c.code} (last 30 days)
                          </div>
                          {histLoading ? (
                            <div style={{ color: 'var(--text-sub)', padding: '8px 0' }}>Loading...</div>
                          ) : history.rows.length === 0 ? (
                            <div style={{ color: 'var(--text-sub)', padding: '8px 0', fontSize: 12 }}>No history available.</div>
                          ) : (
                            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                              <thead>
                                <tr>
                                  {['Date', '1 AUD =', 'Source', 'Fetched'].map(h => (
                                    <th key={h} style={{ padding: '4px 10px', textAlign: 'left', color: 'var(--text-sub)', fontWeight: 500, borderBottom: '1px solid var(--border)' }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {history.rows.map((row, i) => {
                                  const fwd = (1 / parseFloat(row.rate)).toFixed(6);
                                  const isCurrentDay = row.rate_date?.slice(0,10) === today;
                                  return (
                                    <tr key={i} style={{ background: isCurrentDay ? 'rgba(47,127,232,0.06)' : 'transparent' }}>
                                      <td style={{ padding: '4px 10px', fontFamily: 'DM Mono' }}>
                                        {new Date(row.rate_date).toLocaleDateString('en-AU')}
                                        {isCurrentDay && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--accent)', fontWeight: 700 }}>TODAY</span>}
                                      </td>
                                      <td style={{ padding: '4px 10px', fontFamily: 'DM Mono', fontWeight: 600 }}>{fwd} {c.code}</td>
                                      <td style={{ padding: '4px 10px', color: row.source === 'manual' ? 'var(--orange)' : 'var(--text-sub)' }}>
                                        {row.source === 'manual' ? 'Manual override' : 'Auto (API)'}
                                      </td>
                                      <td style={{ padding: '4px 10px', color: 'var(--text-sub)' }}>
                                        {new Date(row.fetched_at).toLocaleString('en-AU')}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
        Rates are stored per-day — one rate per currency pair per date. Manual overrides replace the API rate for that specific date.
        Historical rates on closed documents are never changed — they are stored at the time of document creation.
      </div>
    </div>
  );
}
