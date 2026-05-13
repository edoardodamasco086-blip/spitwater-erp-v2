import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

// Pages
import LoginPage        from './pages/auth/LoginPage';
import DashboardShell   from './components/layout/DashboardShell';
import HomePage         from './pages/dashboard/HomePage';
import AdminHomePage    from './pages/admin/AdminHomePage';
import UsersPage        from './pages/admin/UsersPage';
import ProfilePage      from './pages/dashboard/ProfilePage';
import NotFoundPage     from './pages/NotFoundPage';
import ContactsPage       from './pages/contacts/ContactsPage';
import SettingsPage       from './pages/settings/SettingsPage';
import AcceptInvitePage   from './pages/auth/AcceptInvitePage';
import PermissionsPage   from './pages/admin/PermissionsPage';
import ProductsPage      from './pages/products/ProductsPage';
import ProductDetailPage  from './pages/products/ProductDetailPage';
import CategoryManager   from './pages/admin/products/CategoryManager';
import CustomFieldManager from './pages/admin/products/CustomFieldManager';
import UomManager            from './pages/admin/products/UomManager';
import FieldValidationPage   from './pages/admin/FieldValidationPage';
import CustomerTiersPage    from './pages/admin/CustomerTiersPage';
import PriceListsPage       from './pages/admin/PriceListsPage';
import ExchangeRatesPage    from './pages/admin/ExchangeRatesPage';
import WarehousePage        from './pages/warehouse/WarehousePage';
import StockReportsPage     from './pages/warehouse/StockReportsPage';
import MovementsReportPage  from './pages/warehouse/MovementsReportPage';
import InventoryLevelsPage  from './pages/warehouse/InventoryLevelsPage';
import AccountingPage       from './pages/accounting/AccountingPage';
import WmsInboundPage      from './pages/wms/WmsInboundPage';
import P2PPage             from './pages/p2p/P2PPage';
import O2CPage             from './pages/o2c/O2CPage';

// ── Route guards ───────────────────────────────────────────────
function RequireAuth({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

function RequireAdmin({ children }) {
  const { isAdmin, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
}

function GuestOnly({ children }) {
  const { isAuthenticated, loading, isAdmin } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (isAuthenticated) return <Navigate to={isAdmin ? '/admin' : '/'} replace />;
  return children;
}

function FullPageSpinner() {
  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#0F1E35'
    }}>
      <div className="spinner-lg" />
    </div>
  );
}

// ── App routes ─────────────────────────────────────────────────
export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route path="/login" element={
        <GuestOnly><LoginPage /></GuestOnly>
      } />

      {/* Protected — all inside DashboardShell (nav + topbar) */}
      <Route path="/" element={
        <RequireAuth><DashboardShell /></RequireAuth>
      }>
        {/* User routes */}
        <Route index element={<HomePage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="products/:id" element={<ProductDetailPage />} />
        <Route path="warehouse"         element={<RequireAdmin><WarehousePage /></RequireAdmin>} />
        <Route path="warehouse/reports" element={<RequireAdmin><StockReportsPage /></RequireAdmin>} />
        <Route path="movements"         element={<MovementsReportPage />} />
        <Route path="inventory"         element={<InventoryLevelsPage />} />
        <Route path="accounting"        element={<AccountingPage />} />
        <Route path="receiving"         element={<Navigate to="/wms/inbound" replace />} />
        <Route path="wms/inbound"       element={<RequireAdmin><WmsInboundPage /></RequireAdmin>} />
        <Route path="p2p"               element={<RequireAdmin><P2PPage /></RequireAdmin>} />
        <Route path="o2c"               element={<RequireAdmin><O2CPage /></RequireAdmin>} />
        <Route path="admin/products/categories"    element={<RequireAdmin><CategoryManager /></RequireAdmin>} />
        <Route path="admin/products/custom-fields" element={<RequireAdmin><CustomFieldManager /></RequireAdmin>} />
        <Route path="admin/products/uom"           element={<RequireAdmin><UomManager /></RequireAdmin>} />
        <Route path="admin/field-validation"       element={<RequireAdmin><FieldValidationPage /></RequireAdmin>} />
        <Route path="admin/customer-tiers"          element={<RequireAdmin><CustomerTiersPage /></RequireAdmin>} />
        <Route path="admin/price-lists"             element={<RequireAdmin><PriceListsPage /></RequireAdmin>} />
        <Route path="admin/exchange-rates"          element={<RequireAdmin><ExchangeRatesPage /></RequireAdmin>} />
        <Route path="settings" element={
          <RequireAdmin><SettingsPage /></RequireAdmin>
        } />
        <Route path="admin/permissions" element={
          <RequireAdmin><PermissionsPage /></RequireAdmin>
        } />

        {/* Admin routes */}
        <Route path="admin" element={
          <RequireAdmin><AdminHomePage /></RequireAdmin>
        } />
        <Route path="admin/users" element={
          <RequireAdmin><UsersPage /></RequireAdmin>
        } />

        {/* 404 inside shell */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
