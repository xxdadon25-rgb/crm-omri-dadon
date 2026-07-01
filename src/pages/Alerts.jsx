import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import PageHeader from "@/components/shared/PageHeader";
import { AlertTriangle, Package, Clock, CheckCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Alerts() {
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => base44.entities.Product.list("-created_date") });
  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: () => base44.entities.Invoice.list() });

  const lowStock = products.filter((p) => (p.quantity || 0) <= (p.min_quantity || 0));
  const unpaidInvoices = invoices.filter((inv) => inv.payment_status === "ממתין לתשלום");
  const overdueInvoices = invoices.filter((inv) => {
    if (inv.payment_status !== "ממתין לתשלום" || !inv.date) return false;
    const dueDate = new Date(inv.date);
    dueDate.setDate(dueDate.getDate() + 30);
    return dueDate < new Date();
  });

  const allAlerts = [
    ...lowStock.map((p) => ({
      id: `stock-${p.id}`,
      type: "מלאי נמוך",
      message: `${p.name} — ${p.quantity} יחידות (מינימום: ${p.min_quantity})`,
      severity: p.quantity === 0 ? "critical" : "warning",
      icon: Package,
    })),
    ...overdueInvoices.map((inv) => ({
      id: `overdue-${inv.id}`,
      type: "חשבונית באיחור",
      message: `חשבונית #${inv.invoice_number} — ${inv.customer_name} — ₪${inv.total?.toLocaleString()}`,
      severity: "critical",
      icon: Clock,
    })),
    ...unpaidInvoices.filter((inv) => !overdueInvoices.find((o) => o.id === inv.id)).map((inv) => ({
      id: `unpaid-${inv.id}`,
      type: "ממתין לתשלום",
      message: `חשבונית #${inv.invoice_number} — ${inv.customer_name} — ₪${inv.total?.toLocaleString()}`,
      severity: "info",
      icon: Clock,
    })),
  ];

  const severityStyle = {
    critical: { badge: "bg-red-100 text-red-800", row: "border-r-4 border-red-400" },
    warning: { badge: "bg-yellow-100 text-yellow-800", row: "border-r-4 border-yellow-400" },
    info: { badge: "bg-blue-100 text-blue-800", row: "border-r-4 border-blue-300" },
  };

  return (
    <div className="overflow-y-auto thin-scrollbar max-h-[calc(100vh-4rem)]">
      <div className="sticky top-0 z-10 bg-background pb-3">
        <PageHeader title="התראות" description={`${allAlerts.length} התראות פעילות`} />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-red-700">{allAlerts.filter((a) => a.severity === "critical").length}</p>
          <p className="text-sm text-red-600">קריטי</p>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-yellow-700">{allAlerts.filter((a) => a.severity === "warning").length}</p>
          <p className="text-sm text-yellow-600">אזהרה</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-blue-700">{allAlerts.filter((a) => a.severity === "info").length}</p>
          <p className="text-sm text-blue-600">מידע</p>
        </div>
      </div>

      <div className="pt-4">
      {allAlerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="p-4 rounded-full bg-green-50 mb-4">
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
          <h3 className="text-lg font-semibold">הכל תקין!</h3>
          <p className="text-sm text-muted-foreground mt-1">אין התראות פעילות</p>
        </div>
      ) : (
        <div className="space-y-2">
          {allAlerts.map((alert) => (
            <div key={alert.id} className={`bg-card border border-border rounded-xl p-4 flex items-center gap-4 ${severityStyle[alert.severity].row}`}>
              <alert.icon className="w-5 h-5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{alert.message}</p>
              </div>
              <Badge className={severityStyle[alert.severity].badge}>{alert.type}</Badge>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}