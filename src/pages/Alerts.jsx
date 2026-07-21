import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Package, Clock, CheckCircle } from "lucide-react";
import { displayInvoiceNumber } from "@/utils/invoiceDisplay";

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
      message: `חשבונית #${displayInvoiceNumber(inv)} — ${inv.customer_name} — ₪${inv.total?.toLocaleString()}`,
      severity: "critical",
      icon: Clock,
    })),
    ...unpaidInvoices.filter((inv) => !overdueInvoices.find((o) => o.id === inv.id)).map((inv) => ({
      id: `unpaid-${inv.id}`,
      type: "ממתין לתשלום",
      message: `חשבונית #${displayInvoiceNumber(inv)} — ${inv.customer_name} — ₪${inv.total?.toLocaleString()}`,
      severity: "info",
      icon: Clock,
    })),
  ];

  /* OLD severityStyle: badge used Tailwind bg-red/yellow/blue-100, row used border-r-4 border-*-400 */
  const ACCENT = "#F5885E";
  const DARK   = "#120F1C";
  const MUTED  = "#B2B0B1";

  const severityStyle = {
    critical: {
      badgeStyle: { background: "rgba(239,68,68,0.1)", color: "#ef4444" },
      borderStyle: { borderRight: "3px solid #F5885E" },
      iconColor: "#F5885E",
    },
    warning: {
      badgeStyle: { background: "rgba(206,185,181,0.25)", color: "#9a7b77" },
      borderStyle: { borderRight: "3px solid #CEB9B5" },
      iconColor: "#CEB9B5",
    },
    info: {
      badgeStyle: { background: "rgba(178,176,177,0.15)", color: "#6b6a6b" },
      borderStyle: { borderRight: "3px solid #B2B0B1" },
      iconColor: "#B2B0B1",
    },
  };

  return (
    /* OLD: <div className="overflow-y-auto thin-scrollbar max-h-[calc(100vh-4rem)]"> */
    <div className="heillo-page" dir="rtl">

      {/* OLD: <div className="sticky top-0 z-10 bg-background pb-3"><PageHeader .../> */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--heillo-text-primary)", margin: 0, fontFamily: "'Heebo', sans-serif" }}>התראות</h1>
        <p style={{ fontSize: 13, color: MUTED, margin: "3px 0 0", fontFamily: "'Heebo', sans-serif" }}>{allAlerts.length} התראות פעילות</p>
      </div>

      {/* Summary cards */}
      {/* OLD: <div className="grid grid-cols-1 sm:grid-cols-3 gap-4"> */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16, marginBottom: 24 }}>
        {/* OLD: <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center"> */}
        <div className="heillo-card" style={{ padding: 20, textAlign: "center" }}>
          {/* OLD: <p className="text-2xl font-bold text-red-700"> */}
          <p style={{ fontSize: 28, fontWeight: 700, color: "#ef4444", margin: 0, fontFamily: "'Heebo', sans-serif" }}>{allAlerts.filter((a) => a.severity === "critical").length}</p>
          {/* OLD: <p className="text-sm text-red-600">קריטי</p> */}
          <p style={{ fontSize: 13, color: "#ef4444", margin: "4px 0 0", fontFamily: "'Heebo', sans-serif" }}>קריטי</p>
        </div>
        {/* OLD: <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center"> */}
        <div className="heillo-card" style={{ padding: 20, textAlign: "center" }}>
          {/* OLD: <p className="text-2xl font-bold text-yellow-700"> */}
          <p style={{ fontSize: 28, fontWeight: 700, color: "#9a7b77", margin: 0, fontFamily: "'Heebo', sans-serif" }}>{allAlerts.filter((a) => a.severity === "warning").length}</p>
          {/* OLD: <p className="text-sm text-yellow-600">אזהרה</p> */}
          <p style={{ fontSize: 13, color: "#9a7b77", margin: "4px 0 0", fontFamily: "'Heebo', sans-serif" }}>אזהרה</p>
        </div>
        {/* OLD: <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center"> */}
        <div className="heillo-card" style={{ padding: 20, textAlign: "center" }}>
          {/* OLD: <p className="text-2xl font-bold text-blue-700"> */}
          <p style={{ fontSize: 28, fontWeight: 700, color: MUTED, margin: 0, fontFamily: "'Heebo', sans-serif" }}>{allAlerts.filter((a) => a.severity === "info").length}</p>
          {/* OLD: <p className="text-sm text-blue-600">מידע</p> */}
          <p style={{ fontSize: 13, color: MUTED, margin: "4px 0 0", fontFamily: "'Heebo', sans-serif" }}>מידע</p>
        </div>
      </div>

      {allAlerts.length === 0 ? (
        /* OLD: <div className="flex flex-col items-center justify-center py-16 text-center"> */
        <div className="heillo-card" style={{ padding: 48, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          {/* OLD: <div className="p-4 rounded-full bg-green-50 mb-4"> */}
          <div style={{ padding: 16, borderRadius: "50%", background: "rgba(22,163,74,0.08)", marginBottom: 16 }}>
            <CheckCircle style={{ width: 32, height: 32, color: "#16a34a" }} />
          </div>
          {/* OLD: <h3 className="text-lg font-semibold">הכל תקין!</h3> */}
          <h3 style={{ fontSize: 16, fontWeight: 700, color: DARK, margin: 0, fontFamily: "'Heebo', sans-serif" }}>הכל תקין!</h3>
          {/* OLD: <p className="text-sm text-muted-foreground mt-1">אין התראות פעילות</p> */}
          <p style={{ fontSize: 13, color: MUTED, margin: "6px 0 0", fontFamily: "'Heebo', sans-serif" }}>אין התראות פעילות</p>
        </div>
      ) : (
        /* OLD: <div className="space-y-2"> wrapping individual bg-card rows */
        <div className="heillo-card" style={{ overflow: "hidden", padding: 0 }}>
          {allAlerts.map((alert, idx) => (
            <div
              key={alert.id}
              /* OLD: className={`bg-card border border-border rounded-xl p-4 flex items-center gap-4 ${severityStyle[alert.severity].row}`} */
              style={{
                padding: "14px 20px",
                display: "flex",
                alignItems: "center",
                gap: 14,
                borderBottom: idx < allAlerts.length - 1 ? "1px solid rgba(0,0,0,0.05)" : "none",
                ...severityStyle[alert.severity].borderStyle,
                transition: "background 0.15s ease",
                fontFamily: "'Heebo', sans-serif",
                cursor: "default",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(245,136,94,0.04)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {/* OLD: <alert.icon className="w-5 h-5 shrink-0 text-muted-foreground" /> */}
              <alert.icon style={{ width: 18, height: 18, flexShrink: 0, color: severityStyle[alert.severity].iconColor }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* OLD: <p className="text-sm font-medium truncate">{alert.message}</p> */}
                <p style={{ fontSize: 13, fontWeight: 500, color: DARK, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{alert.message}</p>
              </div>
              {/* OLD: <Badge className={severityStyle[alert.severity].badge}>{alert.type}</Badge> */}
              <span className="heillo-badge" style={severityStyle[alert.severity].badgeStyle}>{alert.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}