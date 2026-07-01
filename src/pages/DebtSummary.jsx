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

  return (
    <div dir="rtl">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">יתרות חוב</h1>
          <p className="text-muted-foreground text-sm mt-0.5">לקוחות עם חשבוניות שטרם שולמו במלואן</p>
        </div>
        {!loading && rows.length > 0 && (
          <div className="text-left">
            <p className="text-xs text-muted-foreground">סה״כ חוב מצטבר</p>
            <p className="text-2xl font-bold text-red-600">{fmtILS(grandTotal)}</p>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-card rounded-xl border border-border flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <BookUser className="w-10 h-10" />
          <p className="font-medium">אין יתרות חוב פתוחות</p>
          <p className="text-sm">כל החשבוניות שולמו במלואן</p>
        </div>
      ) : (
        /* NEW sidebar+main layout */
        <div className="flex flex-row gap-5 items-start">

          {/* RIGHT: customer sidebar — hidden on mobile when a customer is selected */}
          <aside className={`shrink-0 bg-white rounded-lg shadow-sm border border-gray-100 flex flex-col overflow-hidden w-full lg:w-72 ${selectedId ? "hidden lg:flex" : "flex"}`}>
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1.5 mb-2">
                <Users className="w-3.5 h-3.5" /> לקוחות ({rows.length})
              </p>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="חיפוש לקוח..."
                  value={sidebarSearch}
                  onChange={e => setSidebarSearch(e.target.value)}
                  className="pr-9 h-9 text-sm"
                />
              </div>
            </div>
            <div className="overflow-y-auto thin-scrollbar max-h-[calc(100vh-16rem)] space-y-2 p-2">
              {filteredRows.map(row => (
                <button
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  className={`w-full text-right rounded-lg p-4 transition-all duration-150 ${
                    selectedId === row.id
                      ? "bg-amber-500 text-white shadow-md"
                      : "bg-white shadow-sm hover:shadow-md text-foreground"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-lg leading-snug truncate">{row.name}</span>
                        {row.isBlocked && (
                          <span className="shrink-0 text-xs font-medium bg-red-500 text-white px-2 py-0.5 rounded-full">חסום</span>
                        )}
                      </div>
                      {row.phone && row.phone !== "—" && (
                        <span className={`text-sm ${selectedId === row.id ? "text-white/70" : "text-gray-500"}`}>{row.phone}</span>
                      )}
                    </div>
                    <span className={`shrink-0 font-bold text-base rounded-full px-3 py-1 ${
                      selectedId === row.id ? "bg-white/20 text-white" : "bg-red-100 text-red-700"
                    }`}>
                      {fmtILS(row.totalDebt)}
                    </span>
                  </div>
                </button>
              ))}
              {filteredRows.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">לא נמצאו לקוחות</p>
              )}
            </div>
          </aside>

          {/* LEFT: main detail area — hidden on mobile when no customer is selected */}
          <div className={`flex-1 min-w-0 ${selectedId ? "block" : "hidden lg:block"}`}>
            {!selectedRow ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-100 flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                <BookUser className="w-10 h-10 opacity-30" />
                <p className="font-medium">בחר לקוח מהרשימה</p>
                <p className="text-sm">לחץ על לקוח כדי לראות את פירוט החוב שלו</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Customer header */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <button
                        onClick={() => setSelectedId(null)}
                        className="lg:hidden flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" /> חזרה
                      </button>
                      <h2 className="text-xl font-bold">{selectedRow.name}</h2>
                    </div>
                    <div className="flex gap-4 text-sm text-muted-foreground">
                      {selectedRow.phone && selectedRow.phone !== "—" && <span>📞 {selectedRow.phone}</span>}
                      {selectedRow.isBlocked && <span className="text-red-600 font-medium">🚫 חסום</span>}
                    </div>
                  </div>
                  <div className="text-left shrink-0">
                    <p className="text-xs text-muted-foreground mb-0.5">יתרת חוב</p>
                    <p className="text-2xl font-bold text-red-600">{fmtILS(selectedRow.totalDebt)}</p>
                  </div>
                </div>

                {/* Invoice breakdown */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-semibold text-sm text-gray-700">חשבוניות פתוחות ({selectedInvoices.length})</h3>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => navigate(`/customer-ledger?customer=${selectedRow.id}`)}
                    >
                      <BookUser className="w-3.5 h-3.5 ml-1" />
                      פתח כרטסת
                    </Button>
                  </div>
                  <div className="overflow-x-auto">
                    <Table className="[&_td]:py-3 [&_td]:px-4 [&_th]:px-4">
                      <TableHeader>
                        <TableRow className="bg-gray-50">
                          <TableHead className="text-right">מספר חשבונית</TableHead>
                          <TableHead className="text-right">תאריך</TableHead>
                          <TableHead className="text-right">סכום חשבונית</TableHead>
                          <TableHead className="text-right">שולם</TableHead>
                          <TableHead className="text-right">יתרה לתשלום</TableHead>
                          <TableHead className="text-right">סטטוס</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedInvoices.map(inv => {
                          const remaining = (inv.total || 0) - (inv.paid_amount || 0);
                          return (
                            <TableRow key={inv.id} className="hover:bg-gray-50">
                              <TableCell className="font-medium text-right">#{inv.invoice_number || "—"}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{inv.date?.slice(0, 10).split("-").reverse().join("/") || "—"}</TableCell>
                              <TableCell className="text-right">{fmtILS(inv.total)}</TableCell>
                              <TableCell className="text-right text-green-700">{fmtILS(inv.paid_amount)}</TableCell>
                              <TableCell className="text-right font-bold text-red-600">{fmtILS(remaining)}</TableCell>
                              <TableCell className="text-right">
                                {/* inv.payment_status === "באיחור" ? "bg-red-100 text-red-700" : inv.payment_status === "שולם חלקית" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700" */}
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getPaymentStatusColor(inv.payment_status)}`}>{inv.payment_status}</span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        /* OLD flat table layout - commented out, can restore:
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right">#</TableHead>
                  <TableHead className="text-right">שם לקוח</TableHead>
                  <TableHead className="text-right">טלפון</TableHead>
                  <TableHead className="text-right">יתרת חוב</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                  <TableHead className="text-right">כרטסת</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={row.id} className="hover:bg-muted/30">
                    <TableCell className="text-right text-muted-foreground text-sm">{i + 1}</TableCell>
                    <TableCell className="text-right font-medium">{row.name}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{row.phone}</TableCell>
                    <TableCell className="text-right font-bold text-red-600">
                      ₪{row.totalDebt.toLocaleString("he-IL", { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.isBlocked && (
                        <span className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">🚫 חסום</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => navigate(`/customer-ledger?customer=${row.id}`)}
                      >
                        <BookUser className="w-3.5 h-3.5 ml-1" />
                        פתח כרטסת
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="px-4 py-3 border-t border-border bg-muted/30 text-sm text-muted-foreground flex justify-between">
            <span>{rows.length} לקוחות עם חוב פתוח</span>
            <span className="font-semibold text-red-600">
              סה״כ: ₪{grandTotal.toLocaleString("he-IL", { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
        END OLD flat table layout */
      )}
    </div>
  );
}
