import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { dashboardApi } from '../../api/dashboard';
import styles from './HomePage.module.css';

/* ── Formatters ──────────────────────────────────────────────── */
function formatCurrency(val) {
  if (val === null || val === undefined) return '-';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD', maximumFractionDigits: 0,
  }).format(val);
}
function formatNumber(val) {
  if (val === null || val === undefined) return '-';
  return new Intl.NumberFormat('en-AU').format(val);
}
function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

const DOC_TYPE_LABELS = {
  invoice:        'Invoice',
  quote:          'Quote',
  credit_note:    'Credit Note',
  purchase_order: 'Purchase Order',
  goods_receipt:  'Goods Receipt',
  dealer_order:   'Dealer Order',
};

const STATUS_PILLS = {
  draft:    'pill-grey',
  sent:     'pill-orange',
  open:     'pill-blue',
  approved: 'pill-blue',
  posted:   'pill-green',
  paid:     'pill-green',
  received: 'pill-green',
  overdue:  'pill-red',
  void:     'pill-grey',
};

/* ── Component ───────────────────────────────────────────────── */
export default function HomePage() {
  const { user } = useAuth();

  const [kpis,      setKpis]      = useState(null);
  const [activity,  setActivity]  = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading,   setLoading]   = useState({ kpis: true, activity: true, docs: true });
  const [errors,    setErrors]    = useState({});

  const hour      = new Date().getHours();
  const greeting  = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.name?.split(' ')[0] || 'there';
  const today     = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const load = useCallback(() => {
    setLoading({ kpis: true, activity: true, docs: true });
    setErrors({});

    dashboardApi.kpis()
      .then(({ data }) => setKpis(data.data))
      .catch(() => setErrors(e => ({ ...e, kpis: true })))
      .finally(() => setLoading(l => ({ ...l, kpis: false })));

    dashboardApi.activity(8)
      .then(({ data }) => setActivity(data.data))
      .catch(() => setErrors(e => ({ ...e, activity: true })))
      .finally(() => setLoading(l => ({ ...l, activity: false })));

    dashboardApi.documents(8)
      .then(({ data }) => setDocuments(data.data))
      .catch(() => setErrors(e => ({ ...e, docs: true })))
      .finally(() => setLoading(l => ({ ...l, docs: false })));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className={styles.page}>

      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            {greeting}, {firstName}
          </h1>
          <p className={styles.sub}>Here's what's happening across the business today.</p>
        </div>
        <div className={styles.dateChip}>
          <CalendarIcon />
          {today}
        </div>
      </div>

      {/* KPI cards */}
      <div className={styles.kpiGrid}>
        {[
          { label: 'Revenue this month',      value: kpis ? formatCurrency(kpis.revenueThisMonth)      : null, color: 'blue',   Icon: DollarIcon  },
          { label: 'Outstanding receivables', value: kpis ? formatCurrency(kpis.outstandingReceivables) : null, color: 'orange', Icon: FileIcon    },
          { label: 'Units in stock',          value: kpis ? formatNumber(kpis.unitsInStock)             : null, color: 'green',  Icon: BoxIcon     },
          { label: 'Open service jobs',       value: kpis ? formatNumber(kpis.openServiceJobs)          : null, color: 'purple', Icon: WrenchIcon  },
        ].map(kpi => (
          <div key={kpi.label} className={[styles.kpiCard, 'fade-up'].join(' ')}>
            <div className={styles.kpiTop}>
              <div className={[styles.kpiIcon, styles[kpi.color]].join(' ')}>
                <kpi.Icon />
              </div>
            </div>
            {loading.kpis
              ? <div className={styles.kpiSkeleton} />
              : <div className={styles.kpiValue}>{kpi.value !== null ? kpi.value : '-'}</div>
            }
            <div className={styles.kpiLabel}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Split row: activity + quick actions */}
      <div className={styles.splitGrid}>

        {/* Recent activity */}
        <div className="card fade-up">
          <div className="card-head">
            <span className="card-title">Recent Activity</span>
            <button className="btn btn-outline btn-sm" onClick={load}>Refresh</button>
          </div>
          <div className={styles.activityList}>
            {loading.activity ? (
              <div className={styles.loadingBlock}>
                <div className="spinner-dark" />
                <span>Loading activity...</span>
              </div>
            ) : errors.activity ? (
              <div className={styles.emptyBlock}>Could not load activity.</div>
            ) : activity.length === 0 ? (
              <div className={styles.emptyBlock}>
                <EmptyIcon />
                <span>No activity yet. Actions you take will appear here.</span>
              </div>
            ) : activity.map(a => (
              <div key={a.id} className={styles.activityItem}>
                <div className={styles.actDot} style={{ background: a.color }} />
                <div className={styles.actBody}>
                  <div className={styles.actTitle}>{a.description}</div>
                  {a.entityRef && <div className={styles.actMeta}>{a.entityRef}</div>}
                </div>
                <div className={styles.actTime}>{a.timeAgo}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick actions */}
        <div className="card fade-up">
          <div className="card-head">
            <span className="card-title">Quick Actions</span>
          </div>
          <div className={styles.qaGrid}>
            {[
              { label: 'New Quote',   sub: 'Create & send quote',  color: 'blue',   Icon: PlusIcon   },
              { label: 'New Invoice', sub: 'Invoice a customer',   color: 'green',  Icon: FileIcon   },
              { label: 'Service Job', sub: 'Log a service job',    color: 'orange', Icon: WrenchIcon },
              { label: 'Raise PO',    sub: 'Purchase order',       color: 'purple', Icon: CartIcon   },
              { label: 'Stock Count', sub: 'Start stocktake',      color: 'green',  Icon: BoxIcon    },
              { label: 'Add Contact', sub: 'Customer or supplier', color: 'blue',   Icon: UserIcon   },
            ].map(qa => (
              <button key={qa.label} className={styles.qaBtn}>
                <div className={[styles.qaIcon, styles[qa.color]].join(' ')}>
                  <qa.Icon />
                </div>
                <div className={styles.qaLabel}>{qa.label}</div>
                <div className={styles.qaSub}>{qa.sub}</div>
              </button>
            ))}
          </div>
        </div>

      </div>

      {/* Recent documents */}
      <div className="card fade-up">
        <div className="card-head">
          <span className="card-title">Recent Documents</span>
          <button className="btn btn-outline btn-sm">View all</button>
        </div>

        {loading.docs ? (
          <div className={styles.loadingBlock}>
            <div className="spinner-dark" />
            <span>Loading documents...</span>
          </div>
        ) : errors.docs ? (
          <div className={styles.emptyBlock}>Could not load documents.</div>
        ) : documents.length === 0 ? (
          <div className={styles.emptyBlock}>
            <EmptyIcon />
            <span>No documents yet. Create your first quote or invoice to get started.</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Type</th>
                  <th>Contact</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {documents.map(d => (
                  <tr key={d.id}>
                    <td><span className={styles.docLink}>{d.document_number}</span></td>
                    <td>{DOC_TYPE_LABELS[d.document_type] || d.document_type}</td>
                    <td>{d.contact_name || '-'}</td>
                    <td>{formatDate(d.document_date)}</td>
                    <td style={{ fontFamily: 'DM Mono', fontSize: 13 }}>
                      {formatCurrency(d.total_inc_gst)}
                    </td>
                    <td>
                      <span className={['pill', STATUS_PILLS[d.status] || 'pill-grey'].join(' ')}>
                        {d.status ? d.status.charAt(0).toUpperCase() + d.status.slice(1) : '-'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

/* ── SVG icons ───────────────────────────────────────────────── */
function SvgIcon({ children }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function CalendarIcon() {
  return (
    <SvgIcon>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </SvgIcon>
  );
}
function DollarIcon() {
  return (
    <SvgIcon>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </SvgIcon>
  );
}
function FileIcon() {
  return (
    <SvgIcon>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </SvgIcon>
  );
}
function BoxIcon() {
  return (
    <SvgIcon>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    </SvgIcon>
  );
}
function WrenchIcon() {
  return (
    <SvgIcon>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </SvgIcon>
  );
}
function PlusIcon() {
  return (
    <SvgIcon>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </SvgIcon>
  );
}
function CartIcon() {
  return (
    <SvgIcon>
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </SvgIcon>
  );
}
function UserIcon() {
  return (
    <SvgIcon>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </SvgIcon>
  );
}
function EmptyIcon() {
  return (
    <SvgIcon>
      <circle cx="12" cy="12" r="10" />
      <line x1="8" y1="15" x2="16" y2="15" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </SvgIcon>
  );
}
