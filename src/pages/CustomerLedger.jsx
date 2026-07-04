import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
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
import LedgerCreditNotesTab from "@/components/ledger/LedgerCreditNotesTab";
import PaymentDialog from "@/components/payments/PaymentDialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BookUser, Search, Users, Plus, Trash2, CheckCircle2, Circle, ChevronRight } from "lucide-react";
import { toast } from "sonner";

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
  const [searchParams] = useSearchParams();
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);

  useEffect(() => {
    const id = searchParams.get("customer");
    const tab = searchParams.get("tab");
    if (id) setSelectedCustomerId(id);
    if (tab) setActiveTab(tab);
  }, []);
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

  // Tasks
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: "", description: "", due_date: "" });
  const [savingTask, setSavingTask] = useState(false);
  const [deleteTaskId, setDeleteTaskId] = useState(null);
  const [deletingTask, setDeletingTask] = useState(false);

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

  const { data: creditNotes = [], isLoading: loadingCreditNotes } = useQuery({
    queryKey: ["credit_notes"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("credit_notes")
        .select("*")
        .eq("user_id", user?.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: settings = [] } = useQuery({
    queryKey: ["settings"],
    queryFn: () => base44.entities.BusinessSettings.list(),
  });

  const businessSettings = settings[0] || {};

  const { data: tasks = [], isLoading: loadingTasks } = useQuery({
    queryKey: ["customer_tasks", selectedCustomerId],
    enabled: !!selectedCustomerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_tasks")
        .select("*")
        .eq("customer_id", selectedCustomerId)
        .order("status") // 'פתוח' < 'סגור' alphabetically, open first
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data || [];
    },
  });

  const openTasks = tasks.filter(t => t.status === "פתוח");
  const closedTasks = tasks.filter(t => t.status !== "פתוח");
  const sortedTasks = [...openTasks, ...closedTasks];

  const handleAddTask = async () => {
    if (!taskForm.title.trim()) return;
    setSavingTask(true);
    try {
      const { error } = await supabase.from("customer_tasks").insert({
        customer_id: selectedCustomerId,
        title: taskForm.title.trim(),
        description: taskForm.description.trim() || null,
        due_date: taskForm.due_date || null,
        status: "פתוח",
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["customer_tasks", selectedCustomerId] });
      queryClient.invalidateQueries({ queryKey: ["due-tasks"] });
      setTaskForm({ title: "", description: "", due_date: "" });
      setTaskDialogOpen(false);
      toast.success("משימה נוספה");
    } catch (err) {
      toast.error("שגיאה בהוספת משימה: " + err.message);
    } finally {
      setSavingTask(false);
    }
  };

  const handleToggleTask = async (task) => {
    const newStatus = task.status === "פתוח" ? "סגור" : "פתוח";
    const { error } = await supabase.from("customer_tasks").update({ status: newStatus }).eq("id", task.id);
    if (error) { toast.error("שגיאה בעדכון משימה"); return; }
    queryClient.invalidateQueries({ queryKey: ["customer_tasks", selectedCustomerId] });
    queryClient.invalidateQueries({ queryKey: ["due-tasks"] });
  };

  const handleDeleteTask = async () => {
    setDeletingTask(true);
    try {
      const { error } = await supabase.from("customer_tasks").delete().eq("id", deleteTaskId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["customer_tasks", selectedCustomerId] });
      queryClient.invalidateQueries({ queryKey: ["due-tasks"] });
      toast.success("משימה נמחקה");
    } catch (err) {
      toast.error("שגיאה במחיקה: " + err.message);
    } finally {
      setDeleteTaskId(null);
      setDeletingTask(false);
    }
  };

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

  const customerCreditNotes = useMemo(() => {
    if (!selectedCustomerId) return [];
    return creditNotes.filter(cn => cn.customer_id === selectedCustomerId);
  }, [creditNotes, selectedCustomerId]);

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

  // ── Heillo design tokens ──
  const ACCENT = "#F5885E";
  const DARK   = "#120F1C";
  const MUTED  = "#B2B0B1";
  const selectStyle = { background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, height: 36, fontSize: 13, color: DARK, fontFamily: "'Heebo', sans-serif" };
  const dateInputStyle = { background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, height: 36, padding: "0 12px", fontSize: 13, color: DARK, fontFamily: "'Heebo', sans-serif", width: 144 };

  return (
    /* OLD: <div> */
    <div className="heillo-page" dir="rtl">

      {/* ── Page title ── */}
      {/* OLD: <PageHeader title="כרטסת לקוח" description="..." /> */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--heillo-text-primary)", margin: 0, fontFamily: "'Heebo', sans-serif" }}>כרטסת לקוח</h1>
        <p style={{ fontSize: 13, color: "var(--heillo-text-muted)", margin: "2px 0 0", fontFamily: "'Heebo', sans-serif" }}>היסטוריית מסמכים וסיכום חשבון לפי לקוח</p>
      </div>

      {/* OLD: <div className="grid grid-cols-1 lg:grid-cols-4 gap-4"> */}
      <div className="grid grid-cols-1 lg:grid-cols-4" style={{ gap: 16 }}>

        {/* ── Customer Selector sidebar ── */}
        {/* OLD: <div className={`lg:col-span-1 bg-card rounded-xl border border-border p-4 sticky top-[4.5rem] self-start ${...}`}> */}
        <div className={`lg:col-span-1 heillo-card ${selectedCustomerId ? "hidden lg:block" : "block"}`}
          style={{ padding: 16, position: "sticky", top: "4.5rem", alignSelf: "flex-start" }}>
          {/* OLD: <h2 className="text-sm font-semibold mb-3 flex items-center gap-2 text-muted-foreground uppercase tracking-wide"> */}
          <h2 style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 12px", display: "flex", alignItems: "center", gap: 6, fontFamily: "'Heebo', sans-serif" }}>
            <Users style={{ width: 14, height: 14 }} /> בחר לקוח
          </h2>

          {/* OLD: <div className="relative mb-3"><Search .../><Input placeholder="חיפוש לקוח..." className="pr-9" /></div> */}
          <div style={{ position: "relative", marginBottom: 12 }}>
            <Search style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 15, height: 15, color: MUTED, pointerEvents: "none" }} />
            <input placeholder="חיפוש לקוח..." value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
              className="heillo-input" style={{ width: "100%", boxSizing: "border-box", paddingRight: 38, height: 36 }} />
          </div>

          {loadingCustomers ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "32px 0" }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", border: "3px solid rgba(0,0,0,0.08)", borderTopColor: ACCENT, animation: "spin 1s linear infinite" }} />
            </div>
          ) : (
            /* OLD: <div className="max-h-[calc(100vh-12rem)] overflow-y-auto thin-scrollbar divide-y divide-gray-100"> */
            <div style={{ maxHeight: "calc(100vh - 12rem)", overflowY: "auto" }} className="thin-scrollbar">
              {filteredCustomers.map(c => {
                const isSelected = selectedCustomerId === c.id;
                return (
                  /* OLD: <button className={`w-full text-right py-3 px-3 rounded-md transition-colors duration-150 ${isSelected ? "bg-primary text-primary-foreground font-medium" : "hover:bg-gray-50 text-foreground"}`}> */
                  <button key={c.id} onClick={() => handleSelectCustomer(c.id)}
                    style={{
                      width: "100%", textAlign: "right", padding: "10px 12px", borderRadius: 12,
                      border: "none", cursor: "pointer", display: "block", transition: "all 0.15s ease",
                      marginBottom: 2, fontFamily: "'Heebo', sans-serif",
                      background: isSelected ? ACCENT : "transparent",
                      color: isSelected ? "#FFFFFF" : DARK,
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "var(--heillo-accent-light)"; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}>{c.name}</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                      {c.phone && <span style={{ fontSize: 11, color: isSelected ? "rgba(255,255,255,0.75)" : MUTED }}>{c.phone}</span>}
                      {c.customer_type && <span style={{ fontSize: 11, color: isSelected ? "rgba(255,255,255,0.75)" : MUTED }}>{c.customer_type}</span>}
                    </div>
                  </button>
                );
              })}
              {filteredCustomers.length === 0 && (
                <p style={{ fontSize: 13, color: MUTED, textAlign: "center", padding: "16px 0", fontFamily: "'Heebo', sans-serif" }}>לא נמצאו לקוחות</p>
              )}
            </div>
          )}
        </div>

        {/* ── Main Ledger Area ── */}
        {/* OLD: <div className={`lg:col-span-3 space-y-4 ${selectedCustomerId ? "block" : "hidden lg:block"}`}> */}
        <div className={`lg:col-span-3 ${selectedCustomerId ? "block" : "hidden lg:block"}`} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {!selectedCustomer ? (
            /* OLD: <div className="bg-card rounded-xl border border-border"> */
            <div className="heillo-card">
              <EmptyState icon={BookUser} title="בחר לקוח" description="בחר לקוח מהרשימה כדי לצפות בכרטסת שלו" />
            </div>
          ) : (
            <>
              {/* ── Customer Header ── */}
              {/* OLD: <div className="bg-card rounded-xl border border-border p-4"> */}
              <div className="heillo-card" style={{ padding: 16 }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      {/* OLD: <button className="lg:hidden flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"> */}
                      <button onClick={() => setSelectedCustomerId(null)}
                        className="lg:hidden"
                        style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: MUTED, background: "none", border: "none", cursor: "pointer", fontFamily: "'Heebo', sans-serif" }}>
                        <ChevronRight style={{ width: 15, height: 15 }} /> חזרה
                      </button>
                      {/* OLD: <h2 className="text-xl font-bold">{selectedCustomer.name}</h2> */}
                      <h2 style={{ fontSize: 18, fontWeight: 700, color: DARK, margin: 0, fontFamily: "'Heebo', sans-serif" }}>{selectedCustomer.name}</h2>
                    </div>
                    {/* OLD: <div className="flex flex-wrap gap-4 text-sm text-muted-foreground"> */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13, color: MUTED, fontFamily: "'Heebo', sans-serif" }}>
                      {selectedCustomer.phone && <span>📞 {selectedCustomer.phone}</span>}
                      {selectedCustomer.email && <span>✉️ {selectedCustomer.email}</span>}
                      {selectedCustomer.address && <span>📍 {selectedCustomer.address}</span>}
                    </div>
                  </div>
                  {/* OLD: <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${...}`}> */}
                  <span className="heillo-badge" style={{
                    background: selectedCustomer.customer_type === "עסקי" ? "rgba(99,102,241,0.1)" : "rgba(22,163,74,0.1)",
                    color: selectedCustomer.customer_type === "עסקי" ? "#4f46e5" : "#15803d",
                  }}>
                    {selectedCustomer.customer_type || "פרטי"}
                  </span>
                </div>
              </div>

              {/* ── Summary Bar ── */}
              <LedgerSummaryBar summary={summary} />

              {/* ── Filters ── */}
              {/* OLD: <div className="bg-card rounded-xl border border-border p-4"> */}
              <div className="heillo-card" style={{ padding: 16 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, color: MUTED, fontFamily: "'Heebo', sans-serif" }}>חודש</label>
                    {/* OLD: <Select ...><SelectTrigger className="w-36"> */}
                    <Select value={selectedMonth} onValueChange={v => { setSelectedMonth(v); setDateFrom(""); setDateTo(""); }}>
                      <SelectTrigger style={{ ...selectStyle, width: 144 }}><SelectValue /></SelectTrigger>
                      <SelectContent className="z-50">
                        {MONTHS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, color: MUTED, fontFamily: "'Heebo', sans-serif" }}>שנה</label>
                    {/* OLD: <Select ...><SelectTrigger className="w-24"> */}
                    <Select value={selectedYear} onValueChange={v => { setSelectedYear(v); setDateFrom(""); setDateTo(""); }}>
                      <SelectTrigger style={{ ...selectStyle, width: 96 }}><SelectValue /></SelectTrigger>
                      <SelectContent className="z-50">
                        <SelectItem value="all">כל השנים</SelectItem>
                        {YEARS.filter(y => y !== "all").map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div style={{ fontSize: 13, color: MUTED, alignSelf: "flex-end", paddingBottom: 8, fontFamily: "'Heebo', sans-serif" }}>— או טווח —</div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, color: MUTED, fontFamily: "'Heebo', sans-serif" }}>מתאריך</label>
                    {/* OLD: <Input type="date" value={dateFrom} onChange={...} className="w-36" /> */}
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={dateInputStyle} />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, color: MUTED, fontFamily: "'Heebo', sans-serif" }}>עד תאריך</label>
                    {/* OLD: <Input type="date" value={dateTo} onChange={...} className="w-36" /> */}
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={dateInputStyle} />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, color: MUTED, fontFamily: "'Heebo', sans-serif" }}>סטטוס</label>
                    {/* OLD: <Select ...><SelectTrigger className="w-40"> */}
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger style={{ ...selectStyle, width: 160 }}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {allStatuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* ── Tabs ── */}
              <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setStatusFilter(ALL_STATUSES); }}>
                {/* OLD: <TabsList className="w-full grid grid-cols-7 h-auto p-1" dir="rtl">
                    <TabsTrigger ... className="py-3 text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md"> */}
                <TabsList className="w-full grid grid-cols-7 h-auto p-1" dir="rtl"
                  style={{ background: "#F5F3F6", borderRadius: 14 }}>
                  {[
                    { value: "quotes",       label: `📄 הצעות מחיר (${customerQuotes.length})` },
                    { value: "orders",       label: `📦 הזמנות (${customerOrders.length})` },
                    { value: "invoices",     label: `🧾 חשבוניות (${customerInvoices.length})` },
                    { value: "monthly",      label: `📅 חודשיות (${customerMonthlyInvoices.length})` },
                    { value: "payments",     label: `💳 תשלומים (${customerPayments.length})` },
                    { value: "credit_notes", label: `↩️ זיכויים (${customerCreditNotes.length})` },
                    { value: "tasks",        label: `✅ משימות (${openTasks.length})` },
                  ].map(({ value, label }) => (
                    <TabsTrigger key={value} value={value}
                      style={{ fontFamily: "'Heebo', sans-serif" }}
                      className="py-3 text-sm font-semibold data-[state=active]:bg-white data-[state=active]:text-[#120F1C] data-[state=active]:shadow-[0_4px_20px_rgba(0,0,0,0.04)] data-[state=active]:rounded-[10px]">
                      {label}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <TabsContent value="quotes" className="mt-4">
                  <LedgerQuotesTab quotes={customerQuotes} loading={loadingQuotes} onPreview={setPreviewQuote} businessSettings={businessSettings} selectedCustomer={selectedCustomer} />
                </TabsContent>

                <TabsContent value="orders" className="mt-4">
                  <LedgerOrdersTab orders={customerOrders} invoices={invoices} loading={loadingOrders} onPreview={setPreviewOrder} businessSettings={businessSettings} selectedCustomer={selectedCustomer} allMonthlyInvoices={customerMonthlyInvoices} />
                </TabsContent>

                <TabsContent value="invoices" className="mt-4">
                  <LedgerInvoicesTab invoices={customerInvoices} loading={loadingInvoices} onPreview={setPreviewInvoice} businessSettings={businessSettings} selectedCustomer={selectedCustomer} allOrders={orders} />
                </TabsContent>

                <TabsContent value="monthly" className="mt-4">
                  <MonthlyInvoicesTab selectedCustomer={selectedCustomer} allInvoices={invoices} allOrders={orders} monthlyInvoices={customerMonthlyInvoices} loadingInvoices={loadingInvoices} businessSettings={businessSettings} onPreview={setPreviewMonthlyInvoice} />
                </TabsContent>

                <TabsContent value="payments" className="mt-4">
                  <LedgerPaymentsTab payments={customerPayments} loading={loadingPayments} invoices={invoices.filter(i => i.customer_id === selectedCustomerId)} onRecordPayment={setRecordPaymentInvoice} selectedCustomer={selectedCustomer} businessSettings={businessSettings} />
                </TabsContent>

                <TabsContent value="credit_notes" className="mt-4">
                  <LedgerCreditNotesTab creditNotes={customerCreditNotes} loading={loadingCreditNotes} />
                </TabsContent>

                <TabsContent value="tasks" className="mt-4">
                  {/* OLD: <div className="bg-card rounded-xl border border-border p-4 space-y-4"> */}
                  <div className="heillo-card" style={{ padding: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                      {/* OLD: <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide"> */}
                      <h3 style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0, fontFamily: "'Heebo', sans-serif" }}>משימות</h3>
                      {/* OLD: <Button size="sm" className="gap-1" onClick={...}> */}
                      <button className="heillo-btn-primary"
                        onClick={() => { setTaskForm({ title: "", description: "", due_date: "" }); setTaskDialogOpen(true); }}
                        style={{ fontSize: 12, padding: "6px 12px", display: "flex", alignItems: "center", gap: 5 }}>
                        <Plus style={{ width: 13, height: 13 }} /> משימה חדשה
                      </button>
                    </div>
                    {loadingTasks ? (
                      <div style={{ display: "flex", justifyContent: "center", padding: "32px 0" }}>
                        <div style={{ width: 22, height: 22, borderRadius: "50%", border: "3px solid rgba(0,0,0,0.08)", borderTopColor: ACCENT, animation: "spin 1s linear infinite" }} />
                      </div>
                    ) : sortedTasks.length === 0 ? (
                      <p style={{ fontSize: 13, color: MUTED, textAlign: "center", padding: "24px 0", fontFamily: "'Heebo', sans-serif" }}>אין משימות עבור לקוח זה</p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {sortedTasks.map(task => {
                          const isOpen = task.status === "פתוח";
                          const overdue = isOpen && task.due_date && new Date(task.due_date) < new Date();
                          return (
                            /* OLD: <div className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${isOpen ? "border-border bg-background" : "border-border/50 bg-muted/30 opacity-60"}`}> */
                            <div key={task.id} style={{
                              display: "flex", alignItems: "flex-start", gap: 10, borderRadius: 12,
                              border: "1px solid rgba(0,0,0,0.06)", padding: 12, transition: "background 0.15s ease",
                              background: isOpen ? "#FFFFFF" : "rgba(0,0,0,0.02)", opacity: isOpen ? 1 : 0.6,
                            }}>
                              {/* OLD: <button onClick={() => handleToggleTask(task)} className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary transition-colors"> */}
                              <button onClick={() => handleToggleTask(task)}
                                style={{ marginTop: 2, flexShrink: 0, color: MUTED, background: "none", border: "none", cursor: "pointer", transition: "color 0.15s ease" }}
                                onMouseEnter={e => e.currentTarget.style.color = ACCENT}
                                onMouseLeave={e => e.currentTarget.style.color = MUTED}>
                                {isOpen ? <Circle style={{ width: 16, height: 16 }} /> : <CheckCircle2 style={{ width: 16, height: 16, color: "#16a34a" }} />}
                              </button>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                {/* OLD: <p className={`text-sm font-medium ${!isOpen ? "line-through text-muted-foreground" : ""}`}> */}
                                <p style={{ fontSize: 13, fontWeight: 500, color: isOpen ? DARK : MUTED, margin: 0, textDecoration: isOpen ? "none" : "line-through", fontFamily: "'Heebo', sans-serif" }}>{task.title}</p>
                                {task.description && <p style={{ fontSize: 11, color: MUTED, margin: "2px 0 0", fontFamily: "'Heebo', sans-serif" }}>{task.description}</p>}
                                {task.due_date && (
                                  <p style={{ fontSize: 11, margin: "4px 0 0", color: overdue ? "#ef4444" : MUTED, fontWeight: overdue ? 600 : 400, fontFamily: "'Heebo', sans-serif" }}>
                                    {overdue ? "⚠️ " : ""}תאריך יעד: {task.due_date?.split("-").reverse().join("/")}
                                  </p>
                                )}
                              </div>
                              {/* OLD: <button onClick={() => setDeleteTaskId(task.id)} className="shrink-0 text-muted-foreground hover:text-destructive transition-colors mt-0.5"> */}
                              <button onClick={() => setDeleteTaskId(task.id)} className="heillo-icon-btn"
                                style={{ marginTop: 2, flexShrink: 0 }}>
                                <Trash2 style={{ width: 14, height: 14 }} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
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

      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>משימה חדשה — {selectedCustomer?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>כותרת <span className="text-destructive">*</span></Label>
              <Input
                value={taskForm.title}
                onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))}
                placeholder="תיאור קצר של המשימה"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label>פירוט (אופציונלי)</Label>
              <Textarea
                value={taskForm.description}
                onChange={e => setTaskForm(f => ({ ...f, description: e.target.value }))}
                placeholder="הוסף פרטים נוספים..."
                rows={3}
              />
            </div>
            <div className="space-y-1">
              <Label>תאריך יעד (אופציונלי)</Label>
              <Input
                type="date"
                value={taskForm.due_date}
                onChange={e => setTaskForm(f => ({ ...f, due_date: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 pt-2 border-t">
              <Button variant="outline" className="flex-1" onClick={() => setTaskDialogOpen(false)}>ביטול</Button>
              <Button className="flex-1" disabled={!taskForm.title.trim() || savingTask} onClick={handleAddTask}>
                {savingTask ? "שומר..." : "הוסף משימה"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTaskId} onOpenChange={(o) => { if (!o) setDeleteTaskId(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת משימה</AlertDialogTitle>
            <AlertDialogDescription>האם אתה בטוח שברצונך למחוק משימה זו? פעולה זו אינה ניתנת לביטול.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel disabled={deletingTask}>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteTask} disabled={deletingTask} className="bg-destructive text-destructive-foreground">
              {deletingTask ? "מוחק..." : "מחק"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}