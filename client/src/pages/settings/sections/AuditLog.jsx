import React, { useEffect, useState, useCallback } from 'react';
import { settingsApi } from '../../../api/settings';
import styles from './Section.module.css';

function timeAgo(dateStr) {
  if (!dateStr) return '-';
  const s = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (s < 60)   return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return new Date(dateStr).toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' });
}

const ACTION_COLORS = {
  'auth':     '#2F7FE8',
  'contact':  '#2ECC8A',
  'invoice':  '#2F7FE8',
  'payment':  '#2ECC8A',
  'service':  '#E89B2F',
  'purchase': '#9366E8',
  'stock':    '#E05252',
  'user':     '#3BBCD4',
  'settings': '#7B93B0',
};

function actionColor(type) {
  if (!type) return '#7B93B0';
  const prefix = type.split('.')[0];
  return ACTION_COLORS[prefix] || '#7B93B0';
}

export default function AuditLog() {
  const [entries,  setEntries]  = useState([]);
  const [meta,     setMeta]     = useState({ total:0, page:1, pages:1 });
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [action,   setAction]   = useState('');
  const [page,     setPage]     = useState(1);

  const load = useCallback(async (p = page, s = search, a = action) => {
    setLoading(true);
    try {
      const { data } = await settingsApi.getAudit({ page: p, limit: 50, search: s, action: a });
      setEntries(data.data);
      setMeta(data.meta);
    } finally {
      setLoading(false);
    }
  }, [page, search, action]);

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); load(1, search, action); }, 350);
    return () => clearTimeout(t);
  }, [search, action]); // eslint-disable-line

  useEffect(() => { load(page, search, action); }, [page]); // eslint-disable-line

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display:'flex', gap:10, marginBottom:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 12px', flex:1 }}>
          <SearchIcon />
          <input
            style={{ background:'none', border:'none', outline:'none', fontSize:13, color:'var(--text)', width:'100%' }}
            placeholder="Search by user, description, reference..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <input
          className="form-input"
          style={{ width:180 }}
          placeholder="Filter by action (e.g. auth)"
          value={action}
          onChange={e => setAction(e.target.value)}
        />
        <button className="btn btn-outline btn-sm" onClick={() => load(page, search, action)}>Refresh</button>
      </div>

      {/* Stats */}
      <div style={{ fontSize:13, color:'var(--text-sub)', marginBottom:12 }}>
        {meta.total.toLocaleString()} audit entries total
      </div>

      {/* Table */}
      {loading ? (
        <div className={styles.loading}><div className="spinner-dark" /> Loading...</div>
      ) : entries.length === 0 ? (
        <div className={styles.empty}>No audit entries found.</div>
      ) : (
        <div className="table-wrap" style={{ border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
          <table className={styles.auditTable}>
            <thead>
              <tr>
                <th>Action</th>
                <th>Description</th>
                <th>User</th>
                <th>Reference</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id}>
                  <td>
                    <span className={styles.actionType} style={{ background: actionColor(e.action_type) + '22', color: actionColor(e.action_type) }}>
                      {e.action_type}
                    </span>
                  </td>
                  <td className={styles.auditDesc}>{e.description}</td>
                  <td className={styles.auditMeta}>
                    <div>{e.user_name || '-'}</div>
                    <div style={{fontSize:11}}>{e.user_email}</div>
                  </td>
                  <td className={styles.auditMeta}>{e.entity_ref || '-'}</td>
                  <td className={styles.auditTime} title={new Date(e.occurred_at).toLocaleString('en-AU')}>
                    {timeAgo(e.occurred_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {meta.pages > 1 && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:12, padding:'16px 0' }}>
          <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(p => p-1)}>Previous</button>
          <span style={{ fontSize:13, color:'var(--text-sub)' }}>Page {page} of {meta.pages}</span>
          <button className="btn btn-outline btn-sm" disabled={page >= meta.pages} onClick={() => setPage(p => p+1)}>Next</button>
        </div>
      )}
    </div>
  );
}

function SearchIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>; }
