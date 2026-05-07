import React, { useState, useEffect } from 'react';
import { productsApi } from '../../api/products';
import styles from './ProductDetailPage.module.css';

export default function AiMarketTab({ productId }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
  }, [productId]);

  async function loadData() {
    try {
      setLoading(true);
      const res = await productsApi.getMarketData(productId);
      setData(res.data.data || []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load market data.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    try {
      setRefreshing(true);
      const res = await productsApi.refreshMarketData(productId);
      setData(res.data.data || []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to refresh market data.');
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return <div className={styles.loadingRow}><div className="spinner-dark"/> Loading AI Market Data...</div>;
  }

  return (
    <div className={styles.tabContent}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>AI Market Analysis</h2>
          <p style={{ color: 'var(--text-sub)', fontSize: '0.9rem', margin: 0 }}>
            Automated competitor pricing and placement tracked daily.
          </p>
        </div>
        <button className="btn btn-outline" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <><span className="spinner-dark"/> Searching web...</> : 'Force Scrape Now'}
        </button>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-sub)', background: 'var(--surface-50)', borderRadius: 8 }}>
          No market data found for this product yet. Click "Force Scrape Now" to fetch data.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Search Query</th>
                <th>Website Source</th>
                <th>Price</th>
                <th>Description</th>
                <th>Accuracy Score</th>
                <th>Date</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {data.map(row => {
                let badgeClass = 'pill-grey';
                if (row.accuracy_score >= 85) badgeClass = 'pill-green';
                else if (row.accuracy_score >= 50) badgeClass = 'pill-orange';
                else badgeClass = 'pill-red';

                return (
                  <tr key={row.id}>
                    <td>
                      <span className="pill pill-grey" style={{ fontFamily: 'DM Mono', fontSize: '0.8rem' }}>
                        {row.search_query}
                      </span>
                    </td>
                    <td style={{ fontWeight: 500 }}>{row.website_source}</td>
                    <td>
                      {row.price != null ? (
                        new Intl.NumberFormat('en-AU', { style: 'currency', currency: row.currency || 'AUD' }).format(row.price)
                      ) : (
                        <span style={{ color: 'var(--text-sub)' }}>N/A</span>
                      )}
                    </td>
                    <td style={{ maxWidth: 300, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={row.description}>
                      {row.description || <span style={{ color: 'var(--text-sub)' }}>N/A</span>}
                    </td>
                    <td>
                      <span className={`pill ${badgeClass}`}>
                        {row.accuracy_score}%
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-sub)' }}>
                      {new Date(row.scraped_at).toLocaleDateString()}
                    </td>
                    <td>
                      <a href={row.url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
                        View ↗
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
