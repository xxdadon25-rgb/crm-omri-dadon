import { useMemo, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, BookUser, Search, Users, ChevronRight } from "lucide-react";
import { getPaymentStatusColor } from "@/utils/statusColors";
import { formatCurrency } from "@/utils/formatCurrency";

const DEBT_BLOCK_THRESHOLD = 5000;

export default function DebtSummary() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const syncedRef = useRef(false);

  const { data: customers = [], isLoading: loadingCustomers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => base44.entities.Customer.list(),
  });

  const { data: invoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => base44.entities.Invoice.list("-date"),
  });

  const rows = useMemo(() => {
    const debtMap = new Map();
    for (const inv of invoices) {
      if (inv.payment_status === "שולם") continue;
      const debt = (inv.total || 0) - (inv.paid_amount || 0);
      if (debt <= 0) continue;
      debtMap.set(inv.customer_id, (debtMap.get(inv.customer_id) || 0) + debt);
    }

    const customerMap = new Map(customers.map(c => [c.id, c]));

    return Array.from(debtMap.entries())
      .map(([customerId, totalDebt]) => {
        const c = customerMap.get(customerId);
        return {
          id: customerId,
          name: c?.name || "לקוח לא ידוע",
          phone: c?.mobile || c?.phone || "—",
          isBlocked: !!c?.is_blocked,
          totalDebt,
        };
      })
      .sort((a, b) => b.totalDebt - a.totalDebt);
  }, [invoices, customers]);

  // Auto-block/unblock based on debt threshold, runs once per load when data is ready
  useEffect(() => {
    if (loadingCustomers || loadingInvoices || syncedRef.current) return;
    if (customers.length === 0) return;
    syncedRef.current = true;

    const debtMap = new Map(rows.map(r => [r.id, r.totalDebt]));
    const updates = [];

    for (const c of customers) {
      const debt = debtMap.get(c.id) || 0;
      if (debt > DEBT_BLOCK_THRESHOLD && !c.is_blocked) {
        updates.push(base44.entities.Customer.update(c.id, { is_blocked: true }));
      } else if (debt <= DEBT_BLOCK_THRESHOLD && c.is_blocked) {
        updates.push(base44.entities.Customer.update(c.id, { is_blocked: false }));
      }
    }

    if (updates.length > 0) {
      Promise.all(updates).then(() => {
        queryClient.invalidateQueries({ queryKey: ["customers"] });
      });
    }
  }, [loadingCustomers, loadingInvoices, customers, rows]);

  const grandTotal = rows.reduce((s, r) => s + r.totalDebt, 0);
  const loading = loadingCustomers || loadingInvoices;

  const [selectedId, setSelectedId] = useState(null);
  const [sidebarSearch, setSidebarSearch] = useState("");

  const filteredRows = useMemo(() => {
    if (!sidebarSearch.trim()) return rows;
    const q = sidebarSearch.toLowerCase();
    return rows.filter(r => r.name.toLowerCase().includes(q) || r.phone.includes(q));
  }, [rows, sidebarSearch]);

  const selectedRow = rows.find(r => r.id === selectedId) || null;

  const selectedInvoices = useMemo(() => {
    if (!selectedId) return [];
    return invoices
      .filter(inv => inv.customer_id === selectedId && inv.payment_status !== "שולם" && (inv.total || 0) - (inv.paid_amount || 0) > 0)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [invoices, selectedId]);

  // const fmtILS = v => `₪${(v || 0).toLocaleString("he-IL", { minimumFractionDigits: 2 })}`;
  const fmtILS = v => formatCurrency(v);

  // ── Heillo design tokens ──
  const ACCENT = "#F5885E";
  const DARK   = "#120F1C";
  const MUTED  = "#B2B0B1";

  return (
    /* OLD: <div dir="rtl"> */
    <div className="heillo-page" dir="rtl">

      {/* ── Page header ── */}
      {/* OLD: <div className="flex items-center justify-between mb-6"> */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          {/* OLD: <h1 className="text-2xl font-bold">יתרות חוב</h1> */}
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--heillo-text-primary)", margin: 0, fontFamily: "'Heebo', sans-serif" }}>יתרות חוב</h1>
          {/* OLD: <p className="text-muted-foreground text-sm mt-0.5"> */}
          <p style={{ fontSize: 13, color: MUTED, margin: "2px 0 0", fontFamily: "'Heebo', sans-serif" }}>לקוחות עם חשבוניות שטרם שולמו במלואן</p>
        </div>
        {!loading && rows.length > 0 && (
          <div style={{ textAlign: "left" }}>
            {/* OLD: <p className="text-xs text-muted-foreground">סה״כ חוב מצטבר</p> */}
            <p style={{ fontSize: 11, color: MUTED, margin: "0 0 2px", fontFamily: "'Heebo', sans-serif" }}>סה״כ חוב מצטבר</p>
            {/* OLD: <p className="text-2xl font-bold text-red-600"> */}
            <p style={{ fontSize: 24, fontWeight: 700, color: ACCENT, margin: 0, fontFamily: "'Heebo', sans-serif" }}>{fmtILS(grandTotal)}</p>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "64px 0" }}>
          <Loader2 style={{ width: 28, height: 28, color: MUTED, animation: "spin 1s linear infinite" }} />
        </div>
      ) : rows.length === 0 ? (
        /* OLD: <div className="bg-card rounded-xl border border-border flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground"> */
        <div className="heillo-card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "64px 0", gap: 10 }}>
          <BookUser style={{ width: 40, height: 40, color: MUTED, opacity: 0.4 }} />
          <p style={{ fontWeight: 500, color: DARK, margin: 0, fontFamily: "'Heebo', sans-serif" }}>אין יתרות חוב פתוחות</p>
          <p style={{ fontSize: 13, color: MUTED, margin: 0, fontFamily: "'Heebo', sans-serif" }}>כל החשבוניות שולמו במלואן</p>
        </div>
      ) : (
        /* sidebar + main layout */
        <div style={{ display: "flex", flexDirection: "row", gap: 16, alignItems: "flex-start" }}>

          {/* ── RIGHT: customer sidebar ── */}
          {/* OLD: <aside className={`shrink-0 bg-white rounded-lg shadow-sm border border-gray-100 flex flex-col overflow-hidden w-full lg:w-72 ${...}`}> */}
          <aside className={`heillo-card ${selectedId ? "hidden lg:flex" : "flex"}`}
            style={{ flexShrink: 0, flexDirection: "column", overflow: "hidden", width: "100%", maxWidth: 288, padding: 0 }}>
            {/* OLD: <div className="px-4 py-3 border-b border-gray-100"> */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
              {/* OLD: <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1.5 mb-2"> */}
              <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: MUTED, display: "flex", alignItems: "center", gap: 6, margin: "0 0 10px", fontFamily: "'Heebo', sans-serif" }}>
                <Users style={{ width: 13, height: 13 }} /> לקוחות ({rows.length})
              </p>
              <div style={{ position: "relative" }}>
                <Search style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 15, height: 15, color: MUTED, pointerEvents: "none" }} />
                {/* OLD: <Input placeholder="חיפוש לקוח..." className="pr-9 h-9 text-sm" /> */}
                <input placeholder="חיפוש לקוח..." value={sidebarSearch} onChange={e => setSidebarSearch(e.target.value)}
                  className="heillo-input" style={{ width: "100%", boxSizing: "border-box", paddingRight: 38, height: 36 }} />
              </div>
            </div>
            {/* OLD: <div className="overflow-y-auto thin-scrollbar max-h-[calc(100vh-16rem)] space-y-2 p-2"> */}
            <div className="thin-scrollbar" style={{ overflowY: "auto", maxHeight: "calc(100vh - 16rem)", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {filteredRows.map(row => {
                const isSel = selectedId === row.id;
                return (
                  /* OLD: <button className={`w-full text-right rounded-lg p-4 transition-all duration-150 ${isSel ? "bg-amber-500 text-white shadow-md" : "bg-white shadow-sm hover:shadow-md text-foreground"}`}> */
                  <button key={row.id} onClick={() => setSelectedId(row.id)}
                    style={{
                      width: "100%", textAlign: "right", borderRadius: 16, padding: 14,
                      border: "none", cursor: "pointer", transition: "all 0.15s ease",
                      background: isSel ? ACCENT : "#FFFFFF",
                      color: isSel ? "#FFFFFF" : DARK,
                      boxShadow: isSel ? "0 4px 16px rgba(245,136,94,0.3)" : "var(--heillo-card-shadow)",
                      fontFamily: "'Heebo', sans-serif",
                    }}
                    onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = "var(--heillo-accent-light)"; }}
                    onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = "#FFFFFF"; }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {/* OLD: <span className="font-bold text-lg leading-snug truncate"> */}
                          <span style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                          {row.isBlocked && (
                            /* OLD: <span className="shrink-0 text-xs font-medium bg-red-500 text-white px-2 py-0.5 rounded-full"> */
                            <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, background: "#ef4444", color: "#fff", padding: "2px 8px", borderRadius: 99 }}>חסום</span>
                          )}
                        </div>
                        {row.phone && row.phone !== "—" && (
                          /* OLD: <span className={`text-sm ${isSel ? "text-white/70" : "text-gray-500"}`}> */
                          <span style={{ fontSize: 12, color: isSel ? "rgba(255,255,255,0.75)" : MUTED }}>{row.phone}</span>
                        )}
                      </div>
                      {/* OLD: <span className={`shrink-0 font-bold text-base rounded-full px-3 py-1 ${isSel ? "bg-white/20 text-white" : "bg-red-100 text-red-700"}`}> */}
                      <span style={{
                        flexShrink: 0, fontWeight: 700, fontSize: 13, borderRadius: 99, padding: "3px 10px",
                        background: isSel ? "rgba(255,255,255,0.2)" : "rgba(245,136,94,0.1)",
                        color: isSel ? "#FFFFFF" : ACCENT,
                      }}>
                        {fmtILS(row.totalDebt)}
                      </span>
                    </div>
                  </button>
                );
              })}
              {filteredRows.length === 0 && (
                <p style={{ fontSize: 13, color: MUTED, textAlign: "center", padding: "24px 0", fontFamily: "'Heebo', sans-serif" }}>לא נמצאו לקוחות</p>
              )}
            </div>
          </aside>

          {/* ── LEFT: main detail area ── */}
          {/* OLD: <div className={`flex-1 min-w-0 ${selectedId ? "block" : "hidden lg:block"}`}> */}
          <div className={selectedId ? "block" : "hidden lg:block"} style={{ flex: 1, minWidth: 0 }}>
            {!selectedRow ? (
              /* OLD: <div className="bg-white rounded-lg shadow-sm border border-gray-100 flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground"> */
              <div className="heillo-card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0", gap: 10 }}>
                <BookUser style={{ width: 40, height: 40, color: MUTED, opacity: 0.3 }} />
                <p style={{ fontWeight: 500, color: DARK, margin: 0, fontFamily: "'Heebo', sans-serif" }}>בחר לקוח מהרשימה</p>
                <p style={{ fontSize: 13, color: MUTED, margin: 0, fontFamily: "'Heebo', sans-serif" }}>לחץ על לקוח כדי לראות את פירוט החוב שלו</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                {/* ── Customer header ── */}
                {/* OLD: <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 flex items-center justify-between gap-4"> */}
                <div className="heillo-card" style={{ padding: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      {/* OLD: <button onClick={() => setSelectedId(null)} className="lg:hidden flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"> */}
                      <button onClick={() => setSelectedId(null)} className="lg:hidden"
                        style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: MUTED, background: "none", border: "none", cursor: "pointer", fontFamily: "'Heebo', sans-serif" }}>
                        <ChevronRight style={{ width: 15, height: 15 }} /> חזרה
                      </button>
                      {/* OLD: <h2 className="text-xl font-bold"> */}
                      <h2 style={{ fontSize: 18, fontWeight: 700, color: DARK, margin: 0, fontFamily: "'Heebo', sans-serif" }}>{selectedRow.name}</h2>
                    </div>
                    {/* OLD: <div className="flex gap-4 text-sm text-muted-foreground"> */}
                    <div style={{ display: "flex", gap: 16, fontSize: 13, color: MUTED, fontFamily: "'Heebo', sans-serif" }}>
                      {selectedRow.phone && selectedRow.phone !== "—" && <span>📞 {selectedRow.phone}</span>}
                      {selectedRow.isBlocked && <span style={{ color: "#ef4444", fontWeight: 500 }}>🚫 חסום</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "left", flexShrink: 0 }}>
                    {/* OLD: <p className="text-xs text-muted-foreground mb-0.5">יתרת חוב</p> */}
                    <p style={{ fontSize: 11, color: MUTED, margin: "0 0 2px", fontFamily: "'Heebo', sans-serif" }}>יתרת חוב</p>
                    {/* OLD: <p className="text-2xl font-bold text-red-600"> */}
                    <p style={{ fontSize: 24, fontWeight: 700, color: ACCENT, margin: 0, fontFamily: "'Heebo', sans-serif" }}>{fmtILS(selectedRow.totalDebt)}</p>
                  </div>
                </div>

                {/* ── Invoice breakdown ── */}
                {/* OLD: <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden"> */}
                <div className="heillo-card">
                  {/* OLD: <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between"> */}
                  <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(0,0,0,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    {/* OLD: <h3 className="font-semibold text-sm text-gray-700"> */}
                    <h3 style={{ fontSize: 13, fontWeight: 600, color: DARK, margin: 0, fontFamily: "'Heebo', sans-serif" }}>חשבוניות פתוחות ({selectedInvoices.length})</h3>
                    {/* OLD: <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => navigate(...)}> */}
                    <button className="heillo-btn-primary"
                      style={{ fontSize: 12, padding: "6px 14px", display: "flex", alignItems: "center", gap: 5 }}
                      onClick={() => navigate(`/customer-ledger?customer=${selectedRow.id}`)}>
                      <BookUser style={{ width: 13, height: 13 }} /> פתח כרטסת
                    </button>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    {/* OLD: <Table className="[&_td]:py-3 [&_td]:px-4 [&_th]:px-4"><TableHeader><TableRow className="bg-gray-50"> */}
                    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Heebo', sans-serif" }}>
                      <thead className="heillo-table-header">
                        <tr>
                          {["מספר חשבונית", "תאריך", "סכום חשבונית", "שולם", "יתרה לתשלום", "סטטוס"].map(col => (
                            <th key={col} style={{ padding: "14px 20px", textAlign: "right", whiteSpace: "nowrap" }}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedInvoices.map((inv, i) => {
                          const remaining = (inv.total || 0) - (inv.paid_amount || 0);
                          return (
                            /* OLD: <TableRow key={inv.id} className="hover:bg-gray-50"> */
                            <tr key={inv.id} className="heillo-table-row"
                              style={{ borderBottom: i < selectedInvoices.length - 1 ? "1px solid rgba(0,0,0,0.04)" : "none" }}>
                              {/* OLD: <TableCell className="font-medium text-right">#{inv.invoice_number || "—"}</TableCell> */}
                              <td style={{ padding: "14px 20px", fontWeight: 600, fontSize: 13, color: DARK }}>#{inv.invoice_number || "—"}</td>
                              <td style={{ padding: "14px 20px", fontSize: 13, color: MUTED }}>{inv.date?.slice(0, 10).split("-").reverse().join("/") || "—"}</td>
                              <td style={{ padding: "14px 20px", fontSize: 13, color: DARK }}>{fmtILS(inv.total)}</td>
                              {/* OLD: <TableCell className="text-right text-green-700"> */}
                              <td style={{ padding: "14px 20px", fontSize: 13, color: "#16a34a", fontWeight: 500 }}>{fmtILS(inv.paid_amount)}</td>
                              {/* OLD: <TableCell className="text-right font-bold text-red-600"> */}
                              <td style={{ padding: "14px 20px", fontSize: 13, fontWeight: 700, color: ACCENT }}>{fmtILS(remaining)}</td>
                              <td style={{ padding: "14px 20px" }}>
                                {/* OLD: <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getPaymentStatusColor(inv.payment_status)}`}> */}
                                <span className={`heillo-badge ${getPaymentStatusColor(inv.payment_status)}`}>{inv.payment_status}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
