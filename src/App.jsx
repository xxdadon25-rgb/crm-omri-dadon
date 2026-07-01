import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClientInstance } from "@/lib/query-client";
import { BrowserRouter as Router, Route, Routes, Navigate } from "react-router-dom";
import PageNotFound from "./lib/PageNotFound";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import UserNotRegisteredError from "@/components/UserNotRegisteredError";
import ProtectedRoute from "@/components/ProtectedRoute";
import InstallPrompt from "@/pwa/InstallPrompt";

import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import QuotePDFPreview from "@/pages/QuotePDFPreview";
import OrderPDFPreview from "@/pages/OrderPDFPreview";
import InvoicePDFPreview from "@/pages/InvoicePDFPreview";

import AppLayout from "@/components/layout/AppLayout";
import Dashboard from "@/pages/Dashboard";
import Inventory from "@/pages/Inventory";
import InventoryDashboard from "@/pages/InventoryDashboard";
import ProductCatalog from "@/pages/ProductCatalog";
import ImportProducts from "@/pages/ImportProducts";
import Customers from "@/pages/Customers";
import Suppliers from "@/pages/Suppliers";
import Quotes from "@/pages/Quotes";
import QuoteEditor from "@/pages/QuoteEditor";
import Orders from "@/pages/Orders";
import Invoices from "@/pages/Invoices";
import Reports from "@/pages/Reports";
import Alerts from "@/pages/Alerts";
import Settings from "@/pages/Settings";
import ApiSettings from "@/pages/ApiSettings";
import InvoiceLogs from "@/pages/InvoiceLogs";
import Backup from "@/pages/Backup";
import SalesCatalog from "@/pages/SalesCatalog";
import CustomerProfile from "@/pages/CustomerProfile";
import CustomerLedger from "@/pages/CustomerLedger";
import PriceMigration from "@/pages/PriceMigration";
import ImageMigration from "@/pages/ImageMigration";
import DebtSummary from "@/pages/DebtSummary";
import CreditNotePDFPreview from "@/pages/CreditNotePDFPreview";
import DocumentCenter from "@/pages/DocumentCenter";

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
          <Routes>
            <Route path="/quote-pdf/:quoteId" element={<QuotePDFPreview />} />
            <Route path="/order-pdf/:orderId" element={<OrderPDFPreview />} />
            <Route path="/invoice-pdf/:invoiceId" element={<InvoicePDFPreview />} />
            <Route path="/credit-note-pdf/:creditNoteId" element={<CreditNotePDFPreview />} />
            <Route path="*" element={<AuthenticatedApp />} />
          </Routes>
        </Router>
        <Toaster />
        <SonnerToaster position="top-center" richColors />
        <InstallPrompt />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;