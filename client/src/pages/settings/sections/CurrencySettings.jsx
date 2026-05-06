import React, { useEffect, useState } from 'react';
import { currencyApi } from '../../../api/productUom';
import styles from './Section.module.css';

export default function CurrencySettings() {
  const [currencies,   setCurrencies]   = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [baseCurrency, setBaseCurrency] = useState('AUD');
  const [fxUpdated,    setFxUpdated]    = useState(null);
  const [error,        setError]        = useState('');
  const [success,      setSuccess]      = useState('');

  async function load() {
    setLoading(true);
    try {
      const { data } = await currencyApi.list();
      setCurrencies(data.data || []);
      setBaseCurrency(data.meta?.base_currency || 'AUD');
      setFxUpdated(data.meta?.fx_last_updated);
    } catch (e) {
      setError('Failed to load currencies.');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleRefresh() {
    setRefreshing(true); setError(''); setSuccess('');
    try {
      const { data } = await currencyApi.refresh();
      setSuccess(`Rates updated: ${data.stored} currency pairs fetched.`);
      setTimeout(() => setSuccess(''), 5000);
      await load();
    } catch (e) {
      setError('Rate refresh failed. Check server logs.');
    } finally { setRefreshing(false); }
  }

  async function handleToggle(code, isActive) {
    try {
      await currencyApi.update(code, { is_active: !isActive });
      await load();
    } catch (e) { setError('Failed to update currency.'); }
  }

  const activeCurrencies   = currencies.filter(c => c.is_active);
  const inactiveCurrencies = currencies.filter(c => !c.is_active);

  if (loading) return <div className={styles.loading}><div className="spinner-dark" /> Loading...</div>;

  return (
    <div>
      {error   && <div className={styles.errorBox}>{error}</div>}
      {success && <div className={styles.successBox}>{success}</div>}

      {/* Status bar */}
      <div className={styles.infoBox} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <strong>Base currency: {baseCurrency}</strong>
          {' · '}
          {fxUpdated
            ? `Rates last updated: ${new Date(fxUpdated).toLocaleString('en-AU')}`
            : 'Rates not yet fetched'}
          {' · '}
          {activeCurrencies.length} active currencies
        </div>
        <button className="btn btn-outline btn-sm" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <><span className="spinner-dark" style={{width:12,height:12}} /> Fetching...</> : 'Refresh rates now'}
        </button>
      </div>

      {/* Active currencies with rates */}
      <div style={{ marginTop: 16 }}>
        <div className={styles.sectionLabel}>Active currencies</div>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(240,244,249,0.6)' }}>
                {['Code','Name','Symbol','Rate to AUD','Rate date','Base',''].map(h => (
                  <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeCurrencies.map(c => (
                <tr key={c.code} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontFamily: 'DM Mono', fontWeight: 700, background: 'var(--accent-dim)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
                      {c.code}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', fontWeight: 500 }}>{c.name}</td>
                  <td style={{ padding: '10px 14px', fontFamily: 'DM Mono', fontSize: 16 }}>{c.symbol}</td>
                  <td style={{ padding: '10px 14px', fontFamily: 'DM Mono', fontWeight: 600 }}>
                    {c.is_base
                      ? <span style={{ color: 'var(--text-sub)' }}>Base</span>
                      : c.rate_to_base
                        ? <span style={{ color: 'var(--accent)' }}>{parseFloat(c.rate_to_base).toFixed(6)}</span>
                        : <span style={{ color: 'var(--orange)' }}>No rate</span>
                    }
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-sub)' }}>
                    {c.rate_date ? new Date(c.rate_date).toLocaleDateString('en-AU') : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                    {c.is_base ? <span className="pill pill-blue">Base</span> : null}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    {!c.is_base && (
                      <button className="btn btn-outline btn-sm" onClick={() => handleToggle(c.code, c.is_active)}>
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inactive */}
      {inactiveCurrencies.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div className={styles.sectionLabel}>Inactive currencies</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {inactiveCurrencies.map(c => (
              <div key={c.code} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
                <span style={{ fontFamily: 'DM Mono', fontSize: 13, fontWeight: 600, color: 'var(--text-sub)' }}>{c.code}</span>
                <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>{c.name}</span>
                <button className="btn btn-outline btn-sm" onClick={() => handleToggle(c.code, c.is_active)}>
                  Activate
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-sub)' }}>
        Rates are fetched automatically daily at midnight from exchangerate.host (base: {baseCurrency}). The server also fetches on startup if today's rates are missing.
      </div>
    </div>
  );
}
