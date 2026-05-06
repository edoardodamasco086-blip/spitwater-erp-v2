import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import OrgSettings       from './sections/OrgSettings';
import SmtpSettings      from './sections/SmtpSettings';
import CurrencySettings    from './sections/CurrencySettings';
import NumberingSettings from './sections/NumberingSettings';
import WarehouseSettings from './sections/WarehouseSettings';
import AuditLog          from './sections/AuditLog';
import styles from './SettingsPage.module.css';

const SECTIONS = [
  { key: 'org',        label: 'Organisation',      icon: OrgIcon,       desc: 'Name, ABN, address, bank details' },
  { key: 'smtp',       label: 'Email & SMTP',       icon: MailIcon,      desc: 'Mail server configuration'        },
  { key: 'numbering',  label: 'Numbering Series',   icon: HashIcon,      desc: 'Invoice, PO and job numbers'      },
  { key: 'warehouses', label: 'Warehouses',          icon: WarehouseIcon, desc: 'Locations and stock sites'        },
  { key: 'audit',      label: 'Audit Log',           icon: AuditIcon,     desc: 'Full activity history'            },
];

export default function SettingsPage() {
  const { isSuperAdmin } = useAuth();
  const [active, setActive] = useState('org');

  const current = SECTIONS.find(s => s.key === active);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Global Settings</h1>
        <p className={styles.sub}>Configure your organisation, integrations and system behaviour.</p>
      </div>

      <div className={styles.body}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          {SECTIONS.map(s => (
            <button
              key={s.key}
              className={[styles.sideItem, active === s.key ? styles.sideActive : ''].join(' ')}
              onClick={() => setActive(s.key)}
            >
              <span className={styles.sideIcon}><s.icon /></span>
              <div className={styles.sideText}>
                <div className={styles.sideLabel}>{s.label}</div>
                <div className={styles.sideDesc}>{s.desc}</div>
              </div>
            </button>
          ))}
        </aside>

        {/* Content */}
        <div className={styles.content}>
          <div className={styles.contentHeader}>
            <h2 className={styles.contentTitle}>{current?.label}</h2>
            <p className={styles.contentDesc}>{current?.desc}</p>
          </div>

          <div className={styles.contentBody}>
            {active === 'org'        && <OrgSettings />}
            {active === 'smtp'       && <SmtpSettings />}
            {active === 'numbering'  && <NumberingSettings />}
            {active === 'warehouses' && <WarehouseSettings />}
            {active === 'audit'      && <AuditLog />}
          </div>
        </div>
      </div>
    </div>
  );
}

function SvgIcon({ d, children }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
function OrgIcon()       { return <SvgIcon><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></SvgIcon>; }
function MailIcon()      { return <SvgIcon><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></SvgIcon>; }
function HashIcon()      { return <SvgIcon><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></SvgIcon>; }
function WarehouseIcon() { return <SvgIcon><path d="M1 22h22"/><rect x="3" y="10" width="18" height="12"/><path d="M3 10L12 3l9 7"/></SvgIcon>; }
function AuditIcon()     { return <SvgIcon><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></SvgIcon>; }
