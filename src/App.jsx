import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClientInstance } from "@/lib/query-client";
import { BrowserRouter as Router, Route, Routes, Navigate, Outlet } from "react-router-dom";
import PageNotFound from "./lib/PageNotFound";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import UserNotRegisteredError from "@/components/UserNotRegisteredError";
import ProtectedRoute from "@/components/ProtectedRoute";
import InstallPrompt from "@/pwa/InstallPrompt";

// Entry pages stay EAGER. They are the first thing an unauthenticated visitor
// sees, so splitting them would put a chunk fetch in front of the login form —
// a slower first paint on the most common cold entry, which is the opposite of
// what this change is for.
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import PortalLogin from "@/pages/portal/PortalLogin";

// AppLayout is a layout wrapper rendered for every authenticated route, not a
// route target, so it stays eager too.
import AppLayout from "@/components/layout/AppLayout";

// Every other page is loaded on demand. Before this, App.jsx imported all 31
// pages statically and Vite emitted a single ~2.5 MB bundle, so a portal
// customer downloaded the whole CRM — recharts, jsPDF, html2canvas and every
// admin screen — before anything could render. Each page below now becomes its
// own chunk, fetched the first time its route is visited.
//
// Nothing else in the app imports from "@/pages/", so these are the only
// references to those modules and the split is real rather than nominal.
const QuotePDFPreview = lazy(() => import("@/pages/QuotePDFPreview"));
const PortalDashboard = lazy(() => import("@/pages/portal/PortalDashboard"));
const PortalCatalog = lazy(() => import("@/pages/portal/PortalCatalog"));
const PortalOrders = lazy(() => import("@/pages/portal/PortalOrders"));
const OrderPDFPreview = lazy(() => import("@/pages/OrderPDFPreview"));
const InvoicePDFPreview = lazy(() => import("@/pages/InvoicePDFPreview"));

const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Inventory = lazy(() => import("@/pages/Inventory"));
const InventoryDashboard = lazy(() => import("@/pages/InventoryDashboard"));
const ProductCatalog = lazy(() => import("@/pages/ProductCatalog"));
const ImportProducts = lazy(() => import("@/pages/ImportProducts"));
const Customers = lazy(() => import("@/pages/Customers"));
const Suppliers = lazy(() => import("@/pages/Suppliers"));
const Quotes = lazy(() => import("@/pages/Quotes"));
const QuoteEditor = lazy(() => import("@/pages/QuoteEditor"));
const Orders = lazy(() => import("@/pages/Orders"));
const Invoices = lazy(() => import("@/pages/Invoices"));
const Expenses = lazy(() => import("@/pages/Expenses"));
const Reports = lazy(() => import("@/pages/Reports"));
const Alerts = lazy(() => import("@/pages/Alerts"));
const Settings = lazy(() => import("@/pages/Settings"));
const ApiSettings = lazy(() => import("@/pages/ApiSettings"));
const InvoiceLogs = lazy(() => import("@/pages/InvoiceLogs"));
const Backup = lazy(() => import("@/pages/Backup"));
const SalesCatalog = lazy(() => import("@/pages/SalesCatalog"));
const CustomerProfile = lazy(() => import("@/pages/CustomerProfile"));
const CustomerLedger = lazy(() => import("@/pages/CustomerLedger"));
const PriceMigration = lazy(() => import("@/pages/PriceMigration"));
const ImageMigration = lazy(() => import("@/pages/ImageMigration"));
const DebtSummary = lazy(() => import("@/pages/DebtSummary"));
const CreditNotePDFPreview = lazy(() => import("@/pages/CreditNotePDFPreview"));
const DocumentCenter = lazy(() => import("@/pages/DocumentCenter"));
const QualityControl = lazy(() => import("@/pages/QualityControl"));
const PortalCustomerAccess = lazy(() => import("@/pages/PortalCustomerAccess"));
const RevachAdmin = lazy(() => import("@/pages/RevachAdmin"));

// The exact spinner AuthenticatedApp already shows while auth resolves, hoisted
// so the same markup serves as the chunk-loading fallback. No new component and
// no new styling: a user waiting for a route chunk sees precisely what they
// already see while authentication is checked.
const routeFallback = (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin"></div>
  </div>
);

// A pathless layout route that suspends ONLY the outlet content. Placing the
// boundary here rather than around <AppLayout /> is what keeps the sidebar and
// top bar mounted while a lazy page loads — wrapping the layout itself would
// unmount and flash them on every first visit to a route.
//
// A pathless route affects nothing about matching, so every path, nesting
// level and guard below is unchanged.
const SuspendedOutlet = () => (
  <Suspense fallback={routeFallback}>
    <Outlet />
  </Suspense>
);

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === "user_not_registered") {
      return <UserNotRegisteredError />;
    } else if (authError.type === "auth_required") {
      navigateToLogin();
      return null;
    }
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<AppLayout />}>
          <Route element={<SuspendedOutlet />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/inventory-dashboard" element={<InventoryDashboard />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerProfile />} />
          <Route path="/suppliers" element={<Suppliers />} />
          <Route path="/quotes" element={<Quotes />} />
          <Route path="/quotes/new" element={<QuoteEditor />} />
          <Route path="/quotes/edit" element={<QuoteEditor />} />
          <Route path="/product-catalog" element={<ProductCatalog />} />
          <Route path="/import-products" element={<ImportProducts />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/api-settings" element={<ApiSettings />} />
          <Route path="/invoice-logs" element={<InvoiceLogs />} />
          <Route path="/backup" element={<Backup />} />
          <Route path="/sales-catalog" element={<SalesCatalog />} />
          <Route path="/customer-ledger" element={<CustomerLedger />} />
          <Route path="/price-migration" element={<PriceMigration />} />
          <Route path="/image-migration" element={<ImageMigration />} />
          <Route path="/debt-summary" element={<DebtSummary />} />
          <Route path="/documents" element={<DocumentCenter />} />
          <Route path="/quality-control" element={<QualityControl />} />
          <Route path="/portal-access" element={<PortalCustomerAccess />} />
          <Route path="/revach-admin" element={<RevachAdmin />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          {/* The public tree has no shared layout, so the boundary can sit
              around <Routes> here. Inside AuthenticatedApp the nearer
              SuspendedOutlet boundary wins, which is what keeps AppLayout
              mounted during authenticated navigation. */}
          <Suspense fallback={routeFallback}>
          <Routes>
            <Route path="/portal/login" element={<PortalLogin />} />
            <Route path="/portal/dashboard" element={<PortalDashboard />} />
            <Route path="/portal/catalog" element={<PortalCatalog />} />
            <Route path="/portal/orders" element={<PortalOrders />} />
            <Route path="/quote-pdf/:quoteId" element={<QuotePDFPreview />} />
            <Route path="/order-pdf/:orderId" element={<OrderPDFPreview />} />
            <Route path="/invoice-pdf/:invoiceId" element={<InvoicePDFPreview />} />
            <Route path="/credit-note-pdf/:creditNoteId" element={<CreditNotePDFPreview />} />
            <Route path="*" element={<AuthenticatedApp />} />
          </Routes>
          </Suspense>
        </Router>
        <Toaster />
        <SonnerToaster position="top-center" richColors />
        <InstallPrompt />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;