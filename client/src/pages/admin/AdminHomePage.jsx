import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { usersApi } from '../../api/users';
import styles from './AdminHomePage.module.css';

export default function AdminHomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [userCount, setUserCount] = useState('—');
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    usersApi.list()
      .then(({ data }) => setUserCount(data.data.length))
      .catch(() => setUserCount('?'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Admin Overview</h1>
          <p className={styles.sub}>Organisation health, system status and configuration.</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/admin/users')}>
          <PlusIcon /> Invite User
        </button>
      </div>

      {/* Setup banner */}
      <div className={styles.banner}>
        <div className={styles.bannerLeft}>
          <div className={styles.bannerIcon}><ShieldIcon /></div>
          <div>
            <div className={styles.bannerTitle}>Setup wizard not yet complete</div>
            <div className={styles.bannerSub}>Chart of Accounts, Tax Codes, and Numbering Series need configuration before trading.</div>
          </div>
        </div>
        <div className={styles.bannerActions}>
          <button className="btn btn-ghost btn-sm">Dismiss</button>
          <button className="btn btn-primary btn-sm">Run Setup</button>
        </div>
      </div>

      {/* KPIs */}
      <div className={styles.kpiGrid}>
        {[
          { label: 'Active users',           value: loading ? '…' : userCount, icon: <UsersIcon />, color: 'blue'   },
          { label: 'Custom roles defined',   value: '0',                       icon: <KeyIcon />,   color: 'green'  },
          { label: 'SMTP profiles',          value: '0',                       icon: <MailIcon />,  color: 'orange' },
          { label: 'DB tables loaded',       value: '148',                     icon: <DBIcon />,    color: 'purple' },
        ].map(k => (
          <div key={k.label} className={`${styles.kpiCard} fade-up`}>
            <div className={`${styles.kpiIcon} ${styles[k.color]}`}>{k.icon}</div>
            <div className={styles.kpiValue}>{k.value}</div>
            <div className={styles.kpiLabel}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Settings modules */}
      <div className={styles.sectionTitle}>Settings Modules</div>
      <div className={styles.settingsGrid}>
        {SETTINGS_MODULES.map(m => (
          <div key={m.title} className={`${styles.settingsCard} fade-up`}
            onClick={() => m.path && navigate(m.path)}>
            <div className={styles.sgHead}>
              <div className={`${styles.sgIcon} ${styles[m.color]}`}>{m.icon}</div>
              <div className={styles.sgTitle}>{m.title}</div>
            </div>
            <div className={styles.sgItems}>
              {m.items.map(item => (
                <div key={item} className={styles.sgItem}>
                  {item}
                  <ChevronIcon />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const SETTINGS_MODULES = [
  { title: 'Organisation',     color: 'blue',   path: '/settings/org',
    icon: <OrgIcon />,
    items: ['ABN & legal details', 'Financial year settings', 'Bank details'] },
  { title: 'Accounting & Tax', color: 'green',  path: '/settings/accounting',
    icon: <DollarIcon />,
    items: ['Chart of Accounts', 'GST & Tax Codes', 'BAS configuration', 'Posting rules'] },
  { title: 'Email & SMTP',     color: 'orange', path: '/settings/email',
    icon: <MailIcon />,
    items: ['SMTP profiles', 'Email templates', 'Email log'] },
  { title: 'Users & Teams',    color: 'purple', path: '/admin/users',
    icon: <UsersIcon />,
    items: ['Manage users', 'Teams & departments', 'Pending invites'] },
  { title: 'Numbering Series', color: 'blue',   path: '/settings/numbering',
    icon: <HashIcon />,
    items: ['Invoice & quote series', 'PO & goods receipt', 'Service & delivery'] },
  { title: 'Integrations',     color: 'green',  path: '/settings/integrations',
    icon: <IntIcon />,
    items: ['HubSpot CRM', 'Employment Hero', 'Webhooks'] },
];

/* Icons */
const ic = (d) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;
function PlusIcon()   { return ic(<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>); }
function ShieldIcon() { return ic(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>); }
function UsersIcon()  { return ic(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>); }
function KeyIcon()    { return ic(<><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></>); }
function MailIcon()   { return ic(<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>); }
function DBIcon()     { return ic(<><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></>); }
function OrgIcon()    { return ic(<><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></>); }
function DollarIcon() { return ic(<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>); }
function HashIcon()   { return ic(<><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></>); }
function IntIcon()    { return ic(<><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></>); }
function ChevronIcon(){ return ic(<polyline points="9 18 15 12 9 6"/>); }
