import React, { useState, useRef, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import styles from './DashboardShell.module.css';

export default function DashboardShell() {
  const { user, logout, isAdmin } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const [collapsed,    setCollapsed]    = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [openSubs,     setOpenSubs]     = useState({});
  const userMenuRef = useRef(null);

  // Close user menu on outside click
  useEffect(() => {
    function handler(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  function toggleSub(key) {
    setOpenSubs(prev => ({ ...prev, [key]: !prev[key] }));
  }

  const initials = user?.name
    ?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '??';

  const roleBadgeClass = {
    super_admin: styles.roleSuper,
    admin:       styles.roleAdmin,
    editor:      styles.roleEditor,
    viewer:      styles.roleViewer,
  }[user?.role] || styles.roleViewer;

  const roleLabel = {
    super_admin: 'Super Admin',
    admin:       'Admin',
    editor:      'Editor',
    viewer:      'Viewer',
  }[user?.role] || user?.role;

  return (
    <div className={`${styles.shell} ${collapsed ? styles.collapsed : ''}`}>

      {/* ── TOPBAR ─────────────────────────────────────────────── */}
      <header className={styles.topbar}>
        {/* Brand */}
        <div className={styles.brand}>
          <div className={styles.logoMark}>
            <GridIcon />
          </div>
          <span className={styles.brandName}>Spitwater ERP</span>
        </div>

        {/* Left controls */}
        <div className={styles.topLeft}>
          <button
            className={styles.collapseBtn}
            onClick={() => setCollapsed(v => !v)}
            title="Toggle sidebar"
          >
            <MenuIcon />
          </button>
          <div className={styles.searchWrap}>
            <SearchIcon />
            <input placeholder="Search documents, contacts, products… ⌘K" />
          </div>
        </div>

        {/* Right controls */}
        <div className={styles.topRight}>
          <button className={styles.topBtn} title="Help"><HelpIcon /></button>
          <button className={styles.topBtn} title="Notifications">
            <BellIcon />
            <span className={styles.notifDot} />
          </button>

          <div className={styles.dividerV} />

          {/* User chip */}
          <div className={styles.userChip} ref={userMenuRef} onClick={() => setUserMenuOpen(v => !v)}>
            <div className={styles.avatar}>{initials}</div>
            <div className={styles.userInfo}>
              <span className={styles.userName}>{user?.name}</span>
              <span className={`${styles.roleBadge} ${roleBadgeClass}`}>{roleLabel}</span>
            </div>
            <ChevronIcon />

            {/* Dropdown */}
            <div className={`${styles.userDropdown} ${userMenuOpen ? styles.open : ''}`}
              onClick={e => e.stopPropagation()}>
              <div className={styles.ddHeader}>
                <div className={styles.ddAvatar}>{initials}</div>
                <div>
                  <div className={styles.ddName}>{user?.name}</div>
                  <div className={styles.ddEmail}>{user?.email}</div>
                </div>
              </div>
              <div className={styles.ddSep} />
              <button className={styles.ddItem} onClick={() => { navigate('/profile'); setUserMenuOpen(false); }}>
                <UserIcon /> My Profile
              </button>
              {isAdmin && (
                <button className={styles.ddItem} onClick={() => { navigate('/admin'); setUserMenuOpen(false); }}>
                  <ShieldIcon /> Admin Panel
                </button>
              )}
              <div className={styles.ddSep} />
              <button className={`${styles.ddItem} ${styles.ddDanger}`} onClick={handleLogout}>
                <LogoutIcon /> Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ── SIDENAV ────────────────────────────────────────────── */}
      <nav className={styles.sidenav}>
        <div className={styles.navScroll}>

          {/* ── USER NAV ── */}
          <NavSection label="Workspace" collapsed={collapsed}>
            <NavItem to="/" icon={<HomeIcon />} label="Home" collapsed={collapsed} end />
            <NavItem to="/tasks" icon={<TaskIcon />} label="My Tasks" collapsed={collapsed} badge={3} />
          </NavSection>

          <div className={styles.navDivider} />

          <NavSection label="Sales" collapsed={collapsed}>
            <NavItemGroup
              icon={<QuoteIcon />} label="Quotes"
              collapsed={collapsed} id="quotes"
              open={openSubs.quotes} onToggle={() => toggleSub('quotes')}
            >
              <SubItem label="All Quotes" />
              <SubItem label="New Quote" />
              <SubItem label="Awaiting Approval" />
            </NavItemGroup>
            <NavItemGroup
              icon={<OrderIcon />} label="Sales Orders"
              collapsed={collapsed} id="orders"
              open={openSubs.orders} onToggle={() => toggleSub('orders')}
            >
              <SubItem label="All Orders" />
              <SubItem label="Back Orders" />
              <SubItem label="Dealer Orders" />
            </NavItemGroup>
            <NavItem to="/invoices" icon={<InvoiceIcon />} label="Invoices" collapsed={collapsed} />
            <NavItem to="/credit-notes" icon={<CreditIcon />} label="Credit Notes" collapsed={collapsed} />
          </NavSection>

          <div className={styles.navDivider} />

          <NavSection label="Operations" collapsed={collapsed}>
            <NavItem to="/products"  icon={<ProductIcon />} label="Products"     collapsed={collapsed} />
            <NavItem to="/inventory" icon={<BoxIcon />}      label="Inventory"    collapsed={collapsed} />
            <NavItem to="/warehouse" icon={<WarehouseIcon />} label="Warehouse"   collapsed={collapsed} />
            <NavItem to="/purchasing" icon={<CartIcon />}    label="Purchasing"   collapsed={collapsed} />
            <NavItem to="/service"   icon={<WrenchIcon />}   label="Service Jobs" collapsed={collapsed} />
          </NavSection>

          <div className={styles.navDivider} />

          <NavSection label="Finance" collapsed={collapsed}>
            <NavItem to="/journals" icon={<BookIcon />}  label="Journals"   collapsed={collapsed} />
            <NavItem to="/reports"  icon={<ChartIcon />} label="Reports"    collapsed={collapsed} />
            <NavItem to="/bas"      icon={<TaxIcon />}   label="BAS & Tax"  collapsed={collapsed} />
          </NavSection>

          <div className={styles.navDivider} />

          <NavSection label="CRM" collapsed={collapsed}>
            <NavItem to="/contacts" icon={<UsersIcon />}   label="Contacts" collapsed={collapsed} />
          </NavSection>

          {/* ── ADMIN NAV (only visible to admin+) ── */}
          {isAdmin && (
            <>
              <div className={styles.navDivider} />
              <NavSection label="Administration" collapsed={collapsed}>
                <NavItem to="/admin"       icon={<ShieldIcon />} label="Overview"        collapsed={collapsed} end />
                <NavItem to="/admin/users" icon={<UsersIcon />}  label="Users & Teams"   collapsed={collapsed} />
                <NavItem to="/admin/permissions" icon={<KeyIcon />} label="Roles & Permissions" collapsed={collapsed} />
                <NavItem to="/admin/teams"             icon={<UsersIcon />}  label="Teams"               collapsed={collapsed} />
                <NavItem to="/admin/products/categories"   icon={<TagIcon />}    label="Categories"          collapsed={collapsed} />
                <NavItem to="/admin/products/custom-fields"icon={<FieldsIcon />} label="Custom Fields"       collapsed={collapsed} />
                <NavItem to="/admin/products/uom"           icon={<UomIcon />}       label="Units of Measure"   collapsed={collapsed} />
                <NavItem to="/admin/field-validation"      icon={<ValidationIcon />} label="Field Validation"   collapsed={collapsed} />
                <NavItem to="/admin/customer-tiers"        icon={<TierIcon />}       label="Customer Tiers"    collapsed={collapsed} />
                <NavItem to="/admin/price-lists"           icon={<ListIcon />}       label="Price Lists"       collapsed={collapsed} />
                <NavItem to="/admin/exchange-rates"        icon={<FxIcon />}         label="Exchange Rates"    collapsed={collapsed} />
              </NavSection>
              <div className={styles.navDivider} />
              <NavSection label="Settings" collapsed={collapsed}>
                <NavItem to="/settings" icon={<OrgIcon />}   label="Organisation"      collapsed={collapsed} />
                <NavItem to="/settings" icon={<DollarIcon />} label="Accounting & Tax"  collapsed={collapsed} />
                <NavItem to="/settings" icon={<MailIcon />}  label="Email & SMTP"      collapsed={collapsed} />
                
                
              </NavSection>
            </>
          )}
        </div>

        {/* Nav bottom */}
        <div className={styles.navBottom}>
          <NavItem to="/profile"  icon={<UserIcon />}  label="My Profile" collapsed={collapsed} />
          <NavItem to="/settings" icon={<SettingsIcon />} label="Settings"   collapsed={collapsed} />
        </div>
      </nav>

      {/* ── MAIN CONTENT ── */}
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────── */
function NavSection({ label, collapsed, children }) {
  return (
    <div className={styles.navSection}>
      {!collapsed && <div className={styles.navSectionLabel}>{label}</div>}
      {children}
    </div>
  );
}

function NavItem({ to, icon, label, collapsed, badge, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `${styles.navItem} ${isActive ? styles.navActive : ''}`
      }
      title={collapsed ? label : undefined}
      data-label={label}
    >
      <span className={styles.navIcon}>{icon}</span>
      {!collapsed && <span className={styles.navLabel}>{label}</span>}
      {!collapsed && badge && <span className={styles.navBadge}>{badge}</span>}
    </NavLink>
  );
}

function NavItemGroup({ icon, label, collapsed, open, onToggle, children }) {
  return (
    <>
      <button
        className={`${styles.navItem} ${open ? styles.navGroupOpen : ''}`}
        onClick={onToggle}
        data-label={label}
        title={collapsed ? label : undefined}
      >
        <span className={styles.navIcon}>{icon}</span>
        {!collapsed && <span className={styles.navLabel}>{label}</span>}
        {!collapsed && <span className={`${styles.navArrow} ${open ? styles.arrowOpen : ''}`}><ChevronRightIcon /></span>}
      </button>
      {!collapsed && open && (
        <div className={styles.subnav}>{children}</div>
      )}
    </>
  );
}

function SubItem({ label }) {
  return (
    <button className={styles.subnavItem}>
      <span className={styles.subDot} />
      {label}
    </button>
  );
}

/* ── Icons ───────────────────────────────────────────────────── */
const ic = (d) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

function GridIcon()      { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><rect x="2" y="3" width="9" height="9" rx="2"/><rect x="13" y="3" width="9" height="9" rx="2"/><rect x="2" y="14" width="9" height="9" rx="2"/><rect x="13" y="14" width="9" height="9" rx="2"/></svg>; }
function MenuIcon()      { return ic(<><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></>); }
function SearchIcon()    { return ic(<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>); }
function BellIcon()      { return ic(<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>); }
function HelpIcon()      { return ic(<><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></>); }
function ChevronIcon()   { return ic(<polyline points="6 9 12 15 18 9"/>); }
function ChevronRightIcon() { return ic(<polyline points="9 18 15 12 9 6"/>); }
function UserIcon()      { return ic(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>); }
function ShieldIcon()    { return ic(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>); }
function LogoutIcon()    { return ic(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>); }
function HomeIcon()      { return ic(<><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>); }
function TaskIcon()      { return ic(<><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>); }
function QuoteIcon()     { return ic(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>); }
function OrderIcon()     { return ic(<><rect x="1" y="3" width="15" height="13" rx="2"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></>); }
function InvoiceIcon()   { return ic(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></>); }
function CreditIcon()    { return ic(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></>); }
function BoxIcon()       { return ic(<><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></>); }
function WarehouseIcon() { return ic(<><path d="M1 22h22"/><rect x="3" y="10" width="18" height="12"/><path d="M3 10L12 3l9 7"/></>); }
function CartIcon()      { return ic(<><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></>); }
function WrenchIcon()    { return ic(<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>); }
function BookIcon()      { return ic(<><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></>); }
function ChartIcon()     { return ic(<><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>); }
function TaxIcon()       { return ic(<><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></>); }
function UsersIcon()     { return ic(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>); }
function ProductIcon()   { return ic(<><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></>); }
function KeyIcon()       { return ic(<><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></>); }
function OrgIcon()       { return ic(<><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></>); }
function DollarIcon()    { return ic(<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>); }
function MailIcon()      { return ic(<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>); }
function HashIcon()      { return ic(<><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></>); }
function SettingsIcon()    { return ic(<><circle cx='12' cy='12' r='3'/><path d='M19.07 4.93l-1.41 1.41M5.34 5.34L3.93 6.75M12 2v2M12 20v2M2 12h2M20 12h2M4.93 19.07l1.41-1.41M18.66 18.66l1.41 1.41'/></>); }
function TagIcon()    { return ic(<><path d='M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z'/><line x1='7' y1='7' x2='7.01' y2='7'/></>); }
function FieldsIcon() { return ic(<><line x1='8' y1='6' x2='21' y2='6'/><line x1='8' y1='12' x2='21' y2='12'/><line x1='8' y1='18' x2='21' y2='18'/><line x1='3' y1='6' x2='3.01' y2='6'/><line x1='3' y1='12' x2='3.01' y2='12'/><line x1='3' y1='18' x2='3.01' y2='18'/></>); }
function UomIcon()    { return ic(<><path d='M3 3h7v7H3z'/><path d='M14 3h7v7h-7z'/><path d='M14 14h7v7h-7z'/><path d='M3 14h7v7H3z'/></>); }
function ValidationIcon() { return ic(<><path d='M22 11.08V12a10 10 0 1 1-5.93-9.14'/><polyline points='22 4 12 14.01 9 11.01'/></>); }
function TierIcon() { return ic(<><path d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'/></>); }
function ListIcon() { return ic(<><line x1='8' y1='6' x2='21' y2='6'/><line x1='8' y1='12' x2='21' y2='12'/><line x1='8' y1='18' x2='21' y2='18'/><line x1='3' y1='6' x2='3.01' y2='6'/><line x1='3' y1='12' x2='3.01' y2='12'/><line x1='3' y1='18' x2='3.01' y2='18'/></>); }
function FxIcon() { return ic(<><line x1='12' y1='1' x2='12' y2='23'/><path d='M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'/></>); }
