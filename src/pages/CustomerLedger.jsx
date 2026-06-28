import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import LedgerSummaryBar from "@/components/ledger/LedgerSummaryBar";
import LedgerQuotesTab from "@/components/ledger/LedgerQuotesTab";
import LedgerOrdersTab from "@/components/ledger/LedgerOrdersTab";
import LedgerInvoicesTab from "@/components/ledger/LedgerInvoicesTab";
import LedgerOrderPreview from "@/components/ledger/LedgerOrderPreview";
import LedgerQuotePreview from "@/components/ledger/LedgerQuotePreview";
import LedgerInvoicePreview from "@/components/ledger/LedgerInvoicePreview";
import MonthlyInvoicesTab from "@/components/ledger/MonthlyInvoicesTab";
import LedgerPaymentsTab from "@/components/ledger/LedgerPaymentsTab";
import PaymentDialog from "@/components/payments/PaymentDialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BookUser, Search, Users } from "lucide-react";

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

const MONTHS = [
  { value: "all", label: "כל החודשים" },
  { value: "1", label: "ינואר" }, { value: "2", label: "פברואר" },
  { value: "3", label: "מרץ" }, { value: "4", label: "אפריל" },
  { value: "5", label: "מאי" }, { value: "6", label: "יוני" },
  { value: "7", label: "יולי" }, { value: "8", label: "אוגוסט" },
  { value: "9", label: "ספטמבר" }, { value: "10", label: "אוקטובר" },
  { value: "11", label: "נובמבר" }, { value: "12", label: "דצמבר" },
];

const YEARS = ["all", ...Array.from({ length: 6 }, (_, i) => String(currentYear - i))];

const ALL_STATUSES = "הכל";

function filterByDate(dateStr, selectedMonth, selectedYear, dateFrom, dateTo) {
  const d = dateStr ? new Date(dateStr) : null;
  if (dateFrom && d && d < new Date(dateFrom)) return false;
  if (dateTo && d && d > new Date(dateTo)) return false;
  if (!dateFrom && !dateTo) {
    if (selectedMonth !== "all" && d && d.getMonth() + 1 !== parseInt(selectedMonth)) return false;
    if (selectedYear !== "all" && d && d.getFullYear() !== parseInt(selectedYear)) return false;
  }
  return true;
}

export default function CustomerLedger() {
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [selectedYear, setSelectedYear] = useState(String(currentYear));
  const [statusFilter, setStatusFilter] = useState(ALL_STATUSES);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [activeTab, setActiveTab] = useState("quotes");
  const [previewOrder, setPreviewOrder] = useState(null);
  const queryClient = useQueryClient();
  const [previewQuote, setPreviewQuote] = useState(null);
  const [previewInvoice, setPreviewInvoice] = useState(null);
  const [previewMonthlyInvoice, setPreviewMonthlyInvoice] = useState(null);
  const [recordPaymentInvoice, setRecordPaymentInvoice] = useState(null);

  const { data: customers = [], isLoading: loadingCustomers } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const result = await base44.entities.Customer.list("-created_date");
      const pending = sessionStorage.getItem("pendingCustomer");
      if (!pending) return result;
      const pendingCustomer = JSON.parse(pending);
      if (result.some(c => c.id === pendingCustomer.id)) {
        const ageMs = Date.now() - new Date(pendingCustomer.created_date).getTime();
        if (ageMs >= 180000) {
          sessionStorage.removeItem("pendingCustomer");
        }
        return result;
      }
      return [pendingCustomer, ...result];
    },
  });

  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ["orders"],
    queryFn: () => base44.entities.Order.list("-created_date"),
  });

  const { data: quotes = [], isLoading: loadingQuotes } = useQuery({
    queryKey: ["quotes"],
    queryFn: () => base44.entities.Quote.list("-created_date"),
  });

  const { data: invoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const pendingRaw = sessionStorage.getItem("pendingInvoice");
      const pendingInvoice = pendingRaw ? JSON.parse(pendingRaw) : null;

      const result = await base44.entities.Invoice.list("-created_date");

      if (pendingInvoice) {
        if (result.some(i => i.id === pendingInvoice.id)) {
          const ageMs = Date.now() - new Date(pendingInvoice.created_date).getTime();
          if (ageMs >= 180000) {
            sessionStorage.removeItem("pendingInvoice");
          }
          return result;
        }
        return [pendingInvoice, ...result];
      }
      return result;
    },
  });

  const { data: payments = [], isLoading: loadingPayments } = useQuery({
    queryKey: ["payments"],
    queryFn: () => base44.entities.Payment.list("-created_date"),
  });

  const { data: settings = [] } = useQuery({
    queryKey: ["settings"],
    queryFn: () => base44.entities.BusinessSettings.list(),
  });

  const businessSettings = settings[0] || {};

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers;
    const q = customerSearch.toLowerCase();
    return customers.filter(c => c.name?.toLowerCase().includes(q) || c.phone?.includes(q));
  }, [customers, customerSearch]);

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

  // All statuses for the active tab
  const allStatuses = useMemo(() => {
    if (!selectedCustomerId) return [ALL_STATUSES];
    let items = [];
    if (activeTab === "quotes") items = quotes.filter(q => q.customer_id === selectedCustomerId);
    else if (activeTab === "orders") items = orders.filter(o => o.customer_id === selectedCustomerId);
    else if (activeTab === "invoices") items = invoices.filter(i => i.customer_id === selectedCustomerId);
    const statuses = [...new Set(items.map(i => i.status || i.payment_status).filter(Boolean))];
    return [ALL_STATUSES, ...statuses];
  }, [activeTab, selectedCustomerId, quotes, orders, invoices]);

  // Filtered data per tab
  const customerQuotes = useMemo(() => {
    if (!selectedCustomerId) return [];
    return quotes.filter(q => {
      if (q.customer_id !== selectedCustomerId) return false;
      if (statusFilter !== ALL_STATUSES && q.status !== statusFilter) return false;
      return filterByDate(q.date, selectedMonth, selectedYear, dateFrom, dateTo);
    });
  }, [quotes, selectedCustomerId, selectedMonth, selectedYear, statusFilter, dateFrom, dateTo]);

  const customerOrders = useMemo(() => {
    if (!selectedCustomerId) return [];
    return orders.filter(o => {
      if (o.customer_id !== selectedCustomerId) return false;
      if (statusFilter !== ALL_STATUSES && o.status !== statusFilter) return false;
      return filterByDate(o.date, selectedMonth, selectedYear, dateFrom, dateTo);
    });
  }, [orders, selectedCustomerId, selectedMonth, selectedYear, statusFilter, dateFrom, dateTo]);

  const customerInvoices = useMemo(() => {
    if (!selectedCustomerId) return [];
    return invoices.filter(inv => {
      if (inv.customer_id !== selectedCustomerId) return false;
      if (inv.invoice_type === "monthly") return false;
      if (statusFilter !== ALL_STATUSES && inv.payment_status !== statusFilter) return false;
      return filterByDate(inv.date, selectedMonth, selectedYear, dateFrom, dateTo);
    });
  }, [invoices, selectedCustomerId, selectedMonth, selectedYear, statusFilter, dateFrom, dateTo]);

  const customerPayments = useMemo(() => {
    if (!selectedCustomerId) return [];
    return payments.filter(p => p.customer_id === selectedCustomerId);
  }, [payments, selectedCustomerId]);

  const customerMonthlyInvoices = useMemo(() => {
    if (!selectedCustomerId) return [];
    return invoices.filter(inv =>
      inv.customer_id === selectedCustomerId && inv.invoice_type === "monthly"
    ).sort((a, b) => (b.billing_year - a.billing_year) || (b.billing_month - a.billing_month));
  }, [invoices, selectedCustomerId]);

  // Summary — all historical data (no filters)
  const summary = useMemo(() => {
    if (!selectedCustomerId) return {};
    const allOrders = orders.filter(o => o.customer_id === selectedCustomerId);
    const allQuotes = quotes.filter(q => q.customer_id === selectedCustomerId);
    const allInvoices = invoices.filter(i => i.customer_id === selectedCustomerId);

    const totalRevenue = allOrders.reduce((s, o) => s + (o.total || 0), 0);
    const totalPaid = allInvoices.reduce((s, i) => s + (i.paid_amount || 0), 0);
    const totalOutstanding = allInvoices
      .filter(i => i.payment_status !== "שולם")
      .reduce((s, i) => s + ((i.total || 0) - (i.paid_amount || 0)), 0);

    const openDocs =
      allQuotes.filter(q => q.status === "טיוטה" || q.status === "נשלח").length +
      allOrders.filter(o => o.status !== "הושלם" && o.status !== "בוטל").length +
      allInvoices.filter(i => i.payment_status === "ממתין לתשלום" || i.payment_status === "שולם חלקית").length;

    const allDates = [
      ...allOrders.map(o => o.date),
      ...allQuotes.map(q => q.date),
      ...allInvoices.map(i => i.date),
    ].filter(Boolean).sort().reverse();
    const lastActivity = allDates[0] || null;

    return {
      totalQuotes: allQuotes.length,
      totalOrders: allOrders.length,
      totalInvoices: allInvoices.length,
      totalRevenue,
      totalPaid,
      totalOutstanding,
      openDocs,
      lastActivity,
    };
  }, [selectedCustomerId, orders, quotes, invoices]);

  const handleSelectCustomer = (id) => {
    setSelectedCustomerId(id);
    setStatusFilter(ALL_STATUSES);
  };

  return (
    <div>
      <PageHeader title="כרטסת לקוח" description="היסטוריית מסמכים וסיכום חשבון לפי לקוח" />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Customer Selector */}
        <div className="lg:col-span-1 bg-card rounded-xl border border-border p-4 h-fit">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
            <Users className="w-4 h-4" /> בחר לקוח
          </h2>
          <div className="relative mb-3">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="חיפוש לקוח..."
              value={customerSearch}
              onChange={e => setCustomerSearch(e.target.value)}
              className="pr-9"
            />
          </div>
          {loadingCustomers ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-4 border-muted border-t-primary rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-1 max-h-[60vh] overflow-y-auto">
              {filteredCustomers.map(c => (
                <button
                  key={c.id}
                  onClick={() => handleSelectCustomer(c.id)}
                  className={`w-full text-right px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    selectedCustomerId === c.id
                      ? "bg-primary text-primary-foreground font-medium"
                      : "hover:bg-muted text-foreground"
                  }`}
                >
                  <div className="font-medium">{c.name}</div>
                  {c.phone && <div className="text-xs opacity-70">{c.phone}</div>}
                </button>
              ))}
              {filteredCustomers.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">לא נמצאו לקוחות</p>
              )}
            </div>
          )}
        </div>

        {/* Main Ledger Area */}
        <div className="lg:col-span-3 space-y-4">
          {!selectedCustomer ? (
            <div className="bg-card rounded-xl border border-border">
              <EmptyState
                icon={BookUser}
                title="בחר לקוח"
                description="בחר לקוח מהרשימה כדי לצפות בכרטסת שלו"
              />
            </div>
          ) : (
            <>
              {/* Customer Header */}
              <div className="bg-card rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold">{selectedCustomer.name}</h2>
                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mt-1">
                      {selectedCustomer.phone && <span>📞 {selectedCustomer.phone}</span>}
                      {selectedCustomer.email && <span>✉️ {selectedCustomer.email}</span>}
                      {selectedCustomer.address && <span>📍 {selectedCustomer.address}</span>}
                    </div>
                  </div>
                  <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                    selectedCustomer.customer_type === "עסקי" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"
                  }`}>
                    {selectedCustomer.customer_type || "פרטי"}
                  </span>
                </div>
              </div>

              {/* Summary Bar */}
              <LedgerSummaryBar summary={summary} />

              {/* Filters */}
              <div className="bg-card rounded-xl border border-border p-4">
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">חודש</label>
                    <Select value={selectedMonth} onValueChange={v => { setSelectedMonth(v); setDateFrom(""); setDateTo(""); }}>
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MONTHS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">שנה</label>
                    <Select value={selectedYear} onValueChange={v => { setSelectedYear(v); setDateFrom(""); setDateTo(""); }}>
                      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">כל השנים</SelectItem>
                        {YEARS.filter(y => y !== "all").map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="text-muted-foreground text-sm self-end pb-2">— או טווח —</div>

                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">מתאריך</label>
                    <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36" />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">עד תאריך</label>
                    <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36" />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">סטטוס</label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {allStatuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setStatusFilter(ALL_STATUSES); }}>
                <TabsList className="w-full grid grid-cols-5" dir="rtl">
                  <TabsTrigger value="quotes">📄 הצעות מחיר ({customerQuotes.length})</TabsTrigger>
                  <TabsTrigger value="orders">📦 הזמנות ({customerOrders.length})</TabsTrigger>
                  <TabsTrigger value="invoices">🧾 חשבוניות ({customerInvoices.length})</TabsTrigger>
                  <TabsTrigger value="monthly">📅 חודשיות ({customerMonthlyInvoices.length})</TabsTrigger>
                  <TabsTrigger value="payments">💳 תשלומים ({customerPayments.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="quotes" className="mt-4">
                  <LedgerQuotesTab
                    quotes={customerQuotes}
                    loading={loadingQuotes}
                    onPreview={setPreviewQuote}
                    businessSettings={businessSettings}
                    selectedCustomer={selectedCustomer}
                  />
                </TabsContent>

                <TabsContent value="orders" className="mt-4">
                  <LedgerOrdersTab
                    orders={customerOrders}
                    invoices={invoices}
                    loading={loadingOrders}
                    onPreview={setPreviewOrder}
                    businessSettings={businessSettings}
                    selectedCustomer={selectedCustomer}
                    allMonthlyInvoices={customerMonthlyInvoices}
                  />
                </TabsContent>

                <TabsContent value="invoices" className="mt-4">
                  <LedgerInvoicesTab
                    invoices={customerInvoices}
                    loading={loadingInvoices}
                    onPreview={setPreviewInvoice}
                    businessSettings={businessSettings}
                    selectedCustomer={selectedCustomer}
                    allOrders={orders}
                  />
                </TabsContent>

                <TabsContent value="monthly" className="mt-4">
                  <MonthlyInvoicesTab
                    selectedCustomer={selectedCustomer}
                    allInvoices={invoices}
                    allOrders={orders}
                    monthlyInvoices={customerMonthlyInvoices}
                    loadingInvoices={loadingInvoices}
                    businessSettings={businessSettings}
                    onPreview={setPreviewMonthlyInvoice}
                  />
                </TabsContent>

                <TabsContent value="payments" className="mt-4">
                  <LedgerPaymentsTab
                    payments={customerPayments}
                    loading={loadingPayments}
                    invoices={invoices.filter(i => i.customer_id === selectedCustomerId && i.invoice_type !== "monthly")}
                    onRecordPayment={setRecordPaymentInvoice}
                  />
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </div>

      {/* Previews */}
      <LedgerOrderPreview
        order={previewOrder}
        onClose={() => setPreviewOrder(null)}
        invoices={invoices}
        businessSettings={businessSettings}
        selectedCustomer={selectedCustomer}
      />
      <LedgerQuotePreview
        quote={previewQuote}
        onClose={() => setPreviewQuote(null)}
        businessSettings={businessSettings}
        selectedCustomer={selectedCustomer}
      />
      <LedgerInvoicePreview
        invoice={previewInvoice}
        onClose={() => setPreviewInvoice(null)}
        businessSettings={businessSettings}
        selectedCustomer={selectedCustomer}
        onRecordPayment={setRecordPaymentInvoice}
      />
      <LedgerInvoicePreview
        invoice={previewMonthlyInvoice}
        onClose={() => setPreviewMonthlyInvoice(null)}
        businessSettings={businessSettings}
        selectedCustomer={selectedCustomer}
      />

      <PaymentDialog
        open={!!recordPaymentInvoice}
        onOpenChange={(v) => { if (!v) setRecordPaymentInvoice(null); }}
        invoice={recordPaymentInvoice}
        customer={selectedCustomer}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ["payments"] });
          queryClient.invalidateQueries({ queryKey: ["invoices"] });
        }}
      />
    </div>
  );
}