import { useState, useMemo } from "react";
import { formatWhatsAppMessage } from "@/utils/formatWhatsAppMessage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Search, Receipt, Trash2, Eye, Check, Link2, FileText } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { formatDate } from "@/lib/dateUtils";
import ExternalInvoiceButton from "@/components/invoices/ExternalInvoiceButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import DocumentActions from "@/components/documents/DocumentActions";
import DocumentTotals from "@/components/documents/DocumentTotals";

// Seed from sessionStorage so module-level set is populated after hot reload
const deletedInvoiceIds = new Set((() => { try { return JSON.parse(sessionStorage.getItem("pendingDeletedInvoices") || "[]"); } catch { return []; } })());

// Helpers for sessionStorage-persisted bulk-deleted ids (survive page refresh)
const getPendingDeletedInvoiceIds = () => {
  try { return new Set(JSON.parse(sessionStorage.getItem("pendingDeletedInvoices") || "[]")); } catch { return new Set(); }
};
const setPendingDeletedInvoiceIds = (set) => {
  sessionStorage.setItem("pendingDeletedInvoices", JSON.stringify([...set]));
};
const removePendingDeletedInvoiceIds = (ids) => {
  const current = getPendingDeletedInvoiceIds();
  ids.forEach(id => current.delete(id));
  setPendingDeletedInvoiceIds(current);
};


// const paymentColors = {
//   "ממתין לתשלום": "bg-amber-100 text-amber-700",
//   "שולם חלקית": "bg-blue-100 text-blue-700",
//   "שולם": "bg-green-100 text-green-700",
//   "באיחור": "bg-red-100 text-red-700",
// };
import { getPaymentStatusColor } from "@/utils/statusColors";
import { formatCurrency } from "@/utils/formatCurrency";
import CreditNoteButton from "@/components/invoices/CreditNoteButton";

export default function Invoices() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deleteId, setDeleteId] = useState(null);
  const [viewInvoice, setViewInvoice] = useState(null);
  const [selectedInvoices, setSelectedInvoices] = useState(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const queryClient = useQueryClient();

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const pendingRaw = sessionStorage.getItem("pendingInvoice");
      const pendingInvoice = pendingRaw ? JSON.parse(pendingRaw) : null;

      const result = await base44.entities.Invoice.list("-created_date");

      let finalResult;
      if (pendingInvoice) {
        const backendIds = new Set(result.map(i => i.id));
        const foundInBackend = backendIds.has(pendingInvoice.id);

        if (foundInBackend) {
          // Age-only gate: keep pending entry for 3 minutes regardless of backend responses.
          // After 3 minutes the platform guarantees eventual consistency — all replicas have the data.
          const now = Date.now();
          const ageMs = now - new Date(pendingInvoice.created_date).getTime();
          if (ageMs >= 180000) {
            sessionStorage.removeItem("pendingInvoice");
          }
        }

        if (!backendIds.has(pendingInvoice.id)) {
          // Backend returned stale data — merge pending back so invoice stays visible
          finalResult = [pendingInvoice, ...result];
        } else {
          finalResult = result;
        }
      } else {
        finalResult = result;
      }

      // Prune pendingDeletedInvoices: remove ids that are confirmed absent from backend
      const pendingDeleted = getPendingDeletedInvoiceIds();
      if (pendingDeleted.size > 0) {
        const returnedIds = new Set(finalResult.map(i => i.id));
        const confirmedGone = [...pendingDeleted].filter(id => !returnedIds.has(id));
        if (confirmedGone.length > 0) {
          removePendingDeletedInvoiceIds(confirmedGone);
        }
      }

      return finalResult;
    },
    select: (data) => {
      const sessionDeleted = getPendingDeletedInvoiceIds();
      return data.filter(i => !deletedInvoiceIds.has(i.id) && !sessionDeleted.has(i.id));
    },
  });

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
  const { data: settings = [] } = useQuery({ queryKey: ["settings"], queryFn: () => base44.entities.BusinessSettings.list() });
  const { data: orders = [] } = useQuery({ queryKey: ["orders"], queryFn: () => base44.entities.Order.list("-created_date") });

  const filtered = useMemo(() => {
    return invoices.filter(i => {
      const matchSearch = !search || [i.customer_name, String(i.invoice_number)].some(f => f?.toLowerCase().includes(search.toLowerCase()));
      const matchStatus = statusFilter === "all" || i.payment_status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [invoices, search, statusFilter]);

  const handleDelete = async () => {
    const idToDelete = deleteId;
    setDeleteId(null);

    deletedInvoiceIds.add(idToDelete);
    const pendingDeleted = getPendingDeletedInvoiceIds();
    pendingDeleted.add(idToDelete);
    setPendingDeletedInvoiceIds(pendingDeleted);

    queryClient.setQueryData(["invoices"], (old = []) => old.filter(i => i.id !== idToDelete));

    try {
      await base44.entities.Invoice.delete(idToDelete);
      toast.success("החשבונית נמחקה בהצלחה");
    } catch (err) {
      deletedInvoiceIds.delete(idToDelete);
      toast.error("שגיאה במחיקת החשבונית: " + err.message);
    } finally {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    }
  };

  const handleStatusChange = async (id, status) => {
    queryClient.setQueryData(["invoices"], (old = []) => old.map(i => i.id === id ? { ...i, payment_status: status } : i));
    await base44.entities.Invoice.update(id, { payment_status: status });
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
  };

  const getCustomer = (id) => customers.find(c => c.id === id);

  const isAllSelected = filtered.length > 0 && filtered.every(i => selectedInvoices.has(i.id));
  const selectedCount = selectedInvoices.size;

  const handleSelectInvoice = (id) => {
    const updated = new Set(selectedInvoices);
    if (updated.has(id)) updated.delete(id); else updated.add(id);
    setSelectedInvoices(updated);
  };

  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedInvoices(new Set());
    } else {
      setSelectedInvoices(new Set(filtered.map(i => i.id)));
    }
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    const ids = Array.from(selectedInvoices);

    // 1. Mark as deleted in module-level set AND persist to sessionStorage (survives page refresh)
    ids.forEach(id => deletedInvoiceIds.add(id));
    const pendingDeleted = getPendingDeletedInvoiceIds();
    ids.forEach(id => pendingDeleted.add(id));
    setPendingDeletedInvoiceIds(pendingDeleted);

    // 2. Patch the raw cache immediately so the UI updates before any async work
    queryClient.setQueryData(["invoices"], (old = []) => old.filter(i => !ids.includes(i.id)));

    // 3. Close dialog and clear selection
    setSelectedInvoices(new Set());
    setBulkDeleteOpen(false);
    setDeleting(false);

    // 4. Fire deletes in background — do NOT invalidate immediately (would race with optimistic update)
    toast.success(`${ids.length} חשבוניות נמחקו בהצלחה`);
    await Promise.all(ids.map(id => base44.entities.Invoice.delete(id).catch(() => {})));
    // Invalidate only after all backend deletes complete, so server data is fresh
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
  };

  // ── Heillo design tokens ──
  const ACCENT = "#F5885E";
  const DARK   = "#120F1C";
  const MUTED  = "#B2B0B1";
  const selectStyle = { background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, height: 40, fontSize: 13, color: DARK, fontFamily: "'Heebo', sans-serif" };

  return (
    /* OLD: <div><div className="overflow-y-auto thin-scrollbar max-h-[calc(100vh-4rem)]"> */
    <div className="heillo-page" dir="rtl">

      {/* ── Sticky top section ── */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "transparent", paddingBottom: "16px", borderRadius: "0 0 16px 16px" }}>

      {/* ── Top bar ── */}
      {/* OLD: <div className="sticky top-0 z-10 bg-background pb-3"><PageHeader .../><div className="flex flex-col sm:flex-row gap-3 mt-1">...</div></div> */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--heillo-text-primary)", margin: 0, fontFamily: "'Heebo', sans-serif" }}>חשבוניות</h1>
        <p style={{ fontSize: 13, color: "var(--heillo-text-muted)", margin: "2px 0 0", fontFamily: "'Heebo', sans-serif" }}>{invoices.length} חשבוניות</p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: MUTED, pointerEvents: "none" }} />
          {/* OLD: <Input placeholder="חיפוש..." className="pr-9" /> */}
          <input placeholder="חיפוש..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="heillo-input" style={{ width: "100%", boxSizing: "border-box", paddingRight: 40 }} />
        </div>
        {/* OLD: <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-full sm:w-[180px]"> */}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger style={{ ...selectStyle, width: 180 }}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הסטטוסים</SelectItem>
            <SelectItem value="ממתין לתשלום">ממתין לתשלום</SelectItem>
            <SelectItem value="שולם חלקית">שולם חלקית</SelectItem>
            <SelectItem value="שולם">שולם</SelectItem>
            <SelectItem value="באיחור">באיחור</SelectItem>
          </SelectContent>
        </Select>
      </div>
      </div>{/* end sticky top section */}

      {/* Bulk bar — top */}
      {/* OLD: <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4 ..."> */}
      {selectedCount > 0 && (
        <div style={{ background: "rgba(245,136,94,0.07)", border: "1px solid rgba(245,136,94,0.2)", borderRadius: 14, padding: "10px 16px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: DARK, fontFamily: "'Heebo', sans-serif" }}>נבחרו {selectedCount} חשבוניות</span>
          <button onClick={() => setBulkDeleteOpen(true)} style={{ background: "transparent", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, color: "#ef4444", fontSize: 12, fontWeight: 500, padding: "6px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "'Heebo', sans-serif" }}>
            <Trash2 style={{ width: 14, height: 14 }} /> מחק נבחרים
          </button>
        </div>
      )}

      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "64px 0" }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid rgba(0,0,0,0.08)", borderTopColor: ACCENT, animation: "spin 1s linear infinite" }} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Receipt} title="אין חשבוניות" description="חשבוניות נוצרות מהצעות מחיר" />
      ) : (
        /* OLD: <div className="bg-card rounded-xl border border-border overflow-hidden"> */
        <div className="heillo-card">
          <div style={{ overflowX: "auto" }}>
            {/* OLD: <Table><TableHeader><TableRow className="bg-muted/50"> */}
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Heebo', sans-serif" }}>
              <thead className="heillo-table-header">
                <tr>
                  <th style={{ width: 44, padding: "14px 20px", textAlign: "center" }}>
                    <Checkbox checked={isAllSelected} onCheckedChange={handleSelectAll} />
                  </th>
                  {["מספר", "לקוח", "תאריך", "סה״כ", "סטטוס", "פעולות"].map(col => (
                    <th key={col} style={{ padding: "14px 20px", textAlign: "right", whiteSpace: "nowrap" }}>{col}</th>
                  ))}
                </tr>
              </thead>
              {/* OLD: <TableBody>{filtered.map(inv => <TableRow className={`hover:bg-muted/30 ${isSelected ? "bg-primary/5" : ""}`}> */}
              <tbody>
                {filtered.map((inv, i) => {
                  const isSelected = selectedInvoices.has(inv.id);
                  return (
                    <tr key={inv.id} className="heillo-table-row"
                      style={{ background: isSelected ? "rgba(245,136,94,0.04)" : undefined, borderBottom: i < filtered.length - 1 ? "1px solid rgba(0,0,0,0.04)" : "none" }}>
                      <td style={{ padding: "14px 20px", textAlign: "center" }}>
                        <Checkbox checked={isSelected} onCheckedChange={() => handleSelectInvoice(inv.id)} />
                      </td>
                      {/* OLD: <TableCell className="font-medium">#{inv.invoice_number}</TableCell> */}
                      <td style={{ padding: "14px 20px", fontWeight: 600, fontSize: 13, color: DARK }}>#{inv.invoice_number}</td>
                      <td style={{ padding: "14px 20px", fontSize: 13, color: DARK }}>{inv.customer_name}</td>
                      <td style={{ padding: "14px 20px", fontSize: 13, color: MUTED }}>{formatDate(inv.date)}</td>
                      <td style={{ padding: "14px 20px", fontSize: 13, fontWeight: 600, color: DARK }}>₪{(inv.total || 0).toLocaleString()}</td>
                      <td style={{ padding: "14px 20px" }}>
                        {/* OLD: {inv.credited_at ? <Badge className={getPaymentStatusColor("זוכה")}>זוכה</Badge> : <Select><SelectTrigger className="h-7 w-fit border-0 p-0"><Badge .../></SelectTrigger>...</Select>} */}
                        {inv.credited_at ? (
                          <span className={`heillo-badge ${getPaymentStatusColor("זוכה")}`}>זוכה</span>
                        ) : (
                          <Select value={inv.payment_status} onValueChange={(v) => handleStatusChange(inv.id, v)}>
                            <SelectTrigger style={{ height: "auto", width: "fit-content", border: "none", padding: 0, background: "transparent", boxShadow: "none" }}>
                              <span className={`heillo-badge ${getPaymentStatusColor(inv.payment_status)}`}>{inv.payment_status}</span>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ממתין לתשלום">ממתין לתשלום</SelectItem>
                              <SelectItem value="שולם חלקית">שולם חלקית</SelectItem>
                              <SelectItem value="שולם">שולם</SelectItem>
                              <SelectItem value="באיחור">באיחור</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td style={{ padding: "14px 20px", minWidth: 120 }}>
                        {/* OLD: <div className="flex items-center gap-1 flex-wrap"><Button variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9 shrink-0" .../> */}
                        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                          <button title="צפייה" className="heillo-icon-btn" onClick={() => setViewInvoice(inv)}>
                            <Eye size={17} strokeWidth={1.8} />
                          </button>
                          {!inv.credited_at && (
                            /* OLD: <Button variant="ghost" size="icon" className="... text-destructive" onClick={() => setDeleteId(inv.id)}> */
                            <button title="מחיקה" className="heillo-icon-btn" style={{ color: "#ef4444" }} onClick={() => setDeleteId(inv.id)}
                              onMouseEnter={e => e.currentTarget.style.background = "rgba(239,68,68,0.08)"}
                              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                              <Trash2 size={17} strokeWidth={1.8} />
                            </button>
                          )}
                          {inv.credited_at && inv.credit_note_id && (
                            /* OLD: <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-purple-600" title="הפק PDF זיכוי" ...> */
                            <button title="הפק PDF זיכוי" className="heillo-icon-btn" style={{ color: "#7c3aed" }}
                              onClick={() => window.open(`/credit-note-pdf/${inv.credit_note_id}`, "_blank")}
                              onMouseEnter={e => e.currentTarget.style.background = "rgba(124,58,237,0.08)"}
                              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                              <FileText size={17} strokeWidth={1.8} />
                            </button>
                          )}
                          {!inv.credited_at && <CreditNoteButton invoice={inv} />}
                          {settings[0]?.api_url && (
                            <div style={{ flexShrink: 0 }}>
                              <ExternalInvoiceButton
                                invoice={inv}
                                customer={getCustomer(inv.customer_id)}
                                settings={settings[0]}
                              />
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bulk bar — bottom */}
      {/* OLD: <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mt-4 ..."> */}
      {selectedCount > 0 && (
        <div style={{ background: "rgba(245,136,94,0.07)", border: "1px solid rgba(245,136,94,0.2)", borderRadius: 14, padding: "10px 16px", marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: DARK, fontFamily: "'Heebo', sans-serif" }}>נבחרו {selectedCount} חשבוניות</span>
          <button onClick={() => setBulkDeleteOpen(true)} style={{ background: "transparent", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, color: "#ef4444", fontSize: 12, fontWeight: 500, padding: "6px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "'Heebo', sans-serif" }}>
            <Trash2 style={{ width: 14, height: 14 }} /> מחק נבחרים
          </button>
        </div>
      )}

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader><AlertDialogTitle>מחיקת חשבוניות</AlertDialogTitle><AlertDialogDescription>האם למחוק את {selectedCount} החשבוניות שנבחרו?</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel disabled={deleting}>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} disabled={deleting} className="bg-destructive text-destructive-foreground">
              {deleting ? "מוחק..." : "מחק חשבוניות"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader><AlertDialogTitle>מחיקת חשבונית</AlertDialogTitle><AlertDialogDescription>האם למחוק חשבונית זו?</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2"><AlertDialogCancel>ביטול</AlertDialogCancel><AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">מחק</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!viewInvoice} onOpenChange={() => setViewInvoice(null)}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader><DialogTitle>חשבונית #{viewInvoice?.invoice_number}</DialogTitle></DialogHeader>
          {viewInvoice && (() => {
            const linkedOrder = viewInvoice.order_id ? orders.find(o => o.id === viewInvoice.order_id) : null;
            const docWithOrder = linkedOrder ? { ...viewInvoice, _linkedOrder: linkedOrder } : viewInvoice;
            return (
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">לקוח:</span> <span className="font-medium">{viewInvoice.customer_name}</span></div>
                <div><span className="text-muted-foreground">תאריך:</span> <span className="font-medium">{formatDate(viewInvoice.date)}</span></div>
              </div>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-muted/50"><th className="text-right px-3 py-2">מוצר</th><th className="text-right px-3 py-2">כמות</th><th className="text-right px-3 py-2">מחיר</th><th className="text-right px-3 py-2">סה״כ</th></tr></thead>
                  <tbody>
                    {linkedOrder && (
                      <tr className="bg-blue-50 border-t border-border">
                        <td colSpan={4} className="px-3 py-1.5 text-xs font-semibold text-blue-700">
                          הזמנה #{linkedOrder.order_number} — {formatDate(linkedOrder.date)}
                        </td>
                      </tr>
                    )}
                    {(viewInvoice.items || []).map((item, i) => (
                      <tr key={i} className="border-t border-border"><td className="px-3 py-2">{item.name}</td><td className="px-3 py-2">{item.quantity}</td><td className="px-3 py-2">{formatCurrency(item.unit_price)}</td><td className="px-3 py-2 font-medium">{formatCurrency(item.total)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(() => {
                const invItems = viewInvoice.items || [];
                const grossTotal = invItems.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
                const netSubtotal = viewInvoice.subtotal || 0;
                const discountTotal = grossTotal - netSubtotal;
                const effectivePct = grossTotal > 0 ? (discountTotal / grossTotal) * 100 : 0;
                return (
                  <DocumentTotals
                    grossTotal={grossTotal}
                    netSubtotal={netSubtotal}
                    discountTotal={discountTotal}
                    effectiveDiscountPercent={effectivePct}
                    vatRate={viewInvoice.vat_rate || 17}
                    total={viewInvoice.total}
                  />
                );
              })()}
              <div className="flex flex-wrap gap-2">
                <DocumentActions
                  type="invoice"
                  doc={docWithOrder}
                  businessSettings={settings[0]}
                  customerPhone={getCustomer(viewInvoice.customer_id)?.mobile || getCustomer(viewInvoice.customer_id)?.phone}
                  customerEmail={getCustomer(viewInvoice.customer_id)?.email}
                />
                {/* OLD: <Button variant="outline" size="sm" className="text-green-600 border-green-200 hover:bg-green-50"> */}
                <button
                  onClick={() => {
                    const customer = getCustomer(viewInvoice.customer_id);
                    const phone = customer?.mobile || customer?.phone || "";
                    const cleaned = phone.replace(/\D/g, "");
                    const intlPhone = cleaned.startsWith("0") ? "972" + cleaned.slice(1) : cleaned;
                    const pdfUrl = `${window.location.origin}/invoice-pdf/${viewInvoice.id}`;
                    const total = (viewInvoice.total || 0).toLocaleString("he-IL", { minimumFractionDigits: 2 });
                    const msg = formatWhatsAppMessage(settings[0]?.whatsapp_template, { name: viewInvoice.customer_name, number: viewInvoice.invoice_number, amount: total, docType: "חשבונית" });
                    window.open(`https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`, "_blank");
                  }}
                  style={{ background: "#FFFFFF", border: "1px solid rgba(245,136,94,0.4)", borderRadius: 12, color: "var(--heillo-accent)", fontSize: 13, fontWeight: 500, padding: "7px 14px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "'Heebo', sans-serif" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(245,136,94,0.06)"}
                  onMouseLeave={e => e.currentTarget.style.background = "#FFFFFF"}
                >
                  <Link2 style={{ width: 15, height: 15 }} /> קישור WhatsApp לחשבונית
                </button>
                {settings[0]?.api_url && (
                  <ExternalInvoiceButton
                    invoice={viewInvoice}
                    customer={getCustomer(viewInvoice.customer_id)}
                    settings={settings[0]}
                  />
                )}
              </div>
            </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}