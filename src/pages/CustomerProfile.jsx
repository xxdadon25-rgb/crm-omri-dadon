import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Phone, Mail, MapPin, FileText, Pencil } from "lucide-react";
import { format } from "date-fns";
import { formatDate } from "@/lib/dateUtils";
import { formatCurrency } from "@/utils/formatCurrency";
import CustomerStatusBadge from "@/components/crm/CustomerStatusBadge";
import CrmTasksPanel from "@/components/crm/CrmTasksPanel";
import CustomerTimeline from "@/components/crm/CustomerTimeline";
import CustomerDialog from "@/components/customers/CustomerDialog";
import { toast } from "sonner";

const CRM_STATUSES = ["ליד חדש", "בטיפול", "הצעת מחיר נשלחה", "ממתין לתשובה", "לקוח פעיל", "VIP", "לא פעיל", "לא רלוונטי"];

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-muted-foreground min-w-24">{label}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function SummaryCard({ label, value, sub }) {
  return (
    <div className="bg-muted/40 rounded-xl p-3 text-center border border-border min-w-0">
      <p className="text-xl font-bold truncate leading-tight" title={String(value)}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
      <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{label}</p>
    </div>
  );
}

export default function CustomerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState("overview");

  const { data: customers = [] } = useQuery({
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
  const { data: quotes = [] } = useQuery({ queryKey: ["customer-profile-quotes"], queryFn: () => base44.entities.Quote.list() });
  const { data: orders = [] } = useQuery({ queryKey: ["orders"], queryFn: () => base44.entities.Order.list() });
  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: () => base44.entities.Invoice.list() });

  const customer = customers.find(c => c.id === id);
  const customerQuotes = quotes.filter(q => q.customer_id === id);
  const customerOrders = orders.filter(o => o.customer_id === id);
  const customerInvoices = invoices.filter(i => i.customer_id === id);

  const totalPurchases = customerOrders.reduce((s, o) => s + (o.total || 0), 0);
  const avgOrderValue = customerOrders.length > 0 ? totalPurchases / customerOrders.length : 0;
  const lastOrder = customerOrders.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  const lastQuote = customerQuotes.sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0];

  const handleStatusChange = async (status) => {
    await base44.entities.Customer.update(id, { crm_status: status });
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    toast.success("סטטוס עודכן");
  };

  if (!customer) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="text-muted-foreground mb-4">לקוח לא נמצא</p>
        <Button variant="outline" onClick={() => navigate("/customers")}><ArrowRight className="w-4 h-4 ml-1" /> חזרה ללקוחות</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/customers")}>
            <ArrowRight className="w-4 h-4 ml-1" /> לקוחות
          </Button>
          <div className="h-5 w-px bg-border" />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">{customer.name}</h1>
              <Badge variant={customer.customer_type === "עסקי" ? "default" : "secondary"}>
                {customer.customer_type === "עסקי" ? "🏢 עסקי" : "👤 פרטי"}
              </Badge>
              {customer.crm_status && <CustomerStatusBadge status={customer.crm_status} size="lg" />}
            </div>
            {customer.city && <p className="text-sm text-muted-foreground">{customer.city}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={customer.crm_status || "ליד חדש"} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="שנה סטטוס CRM" />
            </SelectTrigger>
            <SelectContent>
              {CRM_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="w-4 h-4 ml-1" /> עריכה
          </Button>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        {/* <SummaryCard label="סה״כ רכישות" value={`₪${totalPurchases.toLocaleString()}`} /> */}
        <SummaryCard label="סה״כ רכישות" value={formatCurrency(totalPurchases)} />
        <SummaryCard label="הזמנות" value={customerOrders.length} />
        <SummaryCard label="הצעות מחיר" value={customerQuotes.length} />
        <SummaryCard label="חשבוניות" value={customerInvoices.length} />
        {/* <SummaryCard label="ממוצע להזמנה" value={`₪${Math.round(avgOrderValue).toLocaleString()}`} /> */}
        <SummaryCard label="ממוצע להזמנה" value={formatCurrency(Math.round(avgOrderValue))} />
        <SummaryCard label="הזמנה אחרונה" value={formatDate(lastOrder?.date)} />
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-border overflow-x-auto">
        {[["overview", "פרטים"], ["timeline", "ציר זמן"], ["tasks", "משימות"], ["quotes", "הצעות"], ["orders", "הזמנות"], ["invoices", "חשבוניות"]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap min-h-[44px] ${tab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-card rounded-xl border border-border p-5">
        {tab === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">פרטי קשר</h3>
              <InfoRow label="טלפון" value={customer.phone} />
              <InfoRow label="נייד" value={customer.mobile} />
              <InfoRow label="אימייל" value={customer.email} />
              <InfoRow label="כתובת" value={[customer.address, customer.city].filter(Boolean).join(", ")} />
              <InfoRow label="ח.פ / ת.ז" value={customer.tax_id} />
              <InfoRow label="איש קשר" value={customer.contact_person} />
              <InfoRow label="תנאי תשלום" value={customer.payment_terms} />
              <InfoRow label="מסגרת אשראי" value={customer.credit_limit ? `₪${Number(customer.credit_limit).toLocaleString()}` : null} />
              <InfoRow label="הנחה קבועה" value={customer.discount_percent ? `${customer.discount_percent}%` : null} />
            </div>
            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">הערות</h3>
              {customer.notes ? (
                <p className="text-sm bg-muted/40 rounded-lg p-3">{customer.notes}</p>
              ) : (
                <p className="text-sm text-muted-foreground">אין הערות</p>
              )}
            </div>
          </div>
        )}

        {tab === "timeline" && (
          <CustomerTimeline customer={customer} quotes={customerQuotes} orders={customerOrders} invoices={customerInvoices} />
        )}

        {tab === "tasks" && (
          <CrmTasksPanel customerId={customer.id} customerName={customer.name} />
        )}

        {tab === "quotes" && (
          <div className="space-y-2">
            {customerQuotes.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">אין הצעות מחיר</p> : customerQuotes.map(q => (
              <div key={q.id} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/30">
                <div>
                  <p className="text-sm font-medium">הצעה #{q.quote_number}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(q.date)} — {q.status}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium">₪{(q.total || 0).toLocaleString()}</span>
                  <Button variant="ghost" size="sm" onClick={() => navigate(`/quotes/edit?id=${q.id}`)}>
                    <FileText className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "orders" && (
          <div className="space-y-2">
            {customerOrders.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">אין הזמנות</p> : customerOrders.map(o => (
              <div key={o.id} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/30">
                <div>
                  <p className="text-sm font-medium">הזמנה #{o.order_number}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(o.date)} — {o.status}</p>
                </div>
                <span className="font-medium">₪{(o.total || 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}

        {tab === "invoices" && (
          <div className="space-y-2">
            {customerInvoices.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">אין חשבוניות</p> : customerInvoices.map(inv => (
              <div key={inv.id} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/30">
                <div>
                  <p className="text-sm font-medium">חשבונית #{inv.invoice_number}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(inv.date)} — {inv.payment_status}</p>
                </div>
                <span className="font-medium">₪{(inv.total || 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <CustomerDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        customer={customer}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ["customers"] })}
      />
    </div>
  );
}