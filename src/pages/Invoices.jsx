import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Search, Receipt, Trash2, Eye, Check, Link2 } from "lucide-react";
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

const Checkbox = ({ checked, onChange }) => (
  <button
    onClick={onChange}
    className="w-4 h-4 border border-input rounded flex items-center justify-center hover:bg-muted transition-colors"
    style={{ backgroundColor: checked ? "hsl(var(--primary))" : "transparent" }}
  >
    {checked && <Check className="w-3 h-3 text-primary-foreground" />}
  </button>
);

// const paymentColors = {
//   "ממתין לתשלום": "bg-amber-100 text-amber-700",
//   "שולם חלקית": "bg-blue-100 text-blue-700",
//   "שולם": "bg-green-100 text-green-700",
//   "באיחור": "bg-red-100 text-red-700",
// };
import { getPaymentStatusColor } from "@/utils/statusColors";

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

  return (
    <div>
      {/* Self-contained scrollable region — sticky works within this container */}
      {/* OLD - can restore: remove outer overflow wrapper and its closing tag before dialogs */}
      <div className="overflow-y-auto thin-scrollbar max-h-[calc(100vh-4rem)]">

        {/* Sticky top bar: page header + search + status filter */}
        <div className="sticky top-0 z-10 bg-background pb-3">
          <PageHeader title="חשבוניות" description={`${invoices.length} חשבוניות`} />
          <div className="flex flex-col sm:flex-row gap-3 mt-1">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="חיפוש..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הסטטוסים</SelectItem>
                <SelectItem value="ממתין לתשלום">ממתין לתשלום</SelectItem>
                <SelectItem value="שולם חלקית">שולם חלקית</SelectItem>
                <SelectItem value="שולם">שולם</SelectItem>
                <SelectItem value="באיחור">באיחור</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {selectedCount > 0 && (
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4 flex items-center justify-between">
            <span className="text-sm font-medium">נבחרו {selectedCount} חשבוניות</span>
            <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
              <Trash2 className="w-4 h-4 ml-1" /> מחק נבחרים
            </Button>
          </div>
        )}

      {isLoading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Receipt} title="אין חשבוניות" description="חשבוניות נוצרות מהצעות מחיר" />
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right w-12">
                    <Checkbox checked={isAllSelected} onChange={handleSelectAll} />
                  </TableHead>
                  <TableHead className="text-right">מספר</TableHead>
                  <TableHead className="text-right">לקוח</TableHead>
                  <TableHead className="text-right">תאריך</TableHead>
                  <TableHead className="text-right">סה״כ</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                  <TableHead className="text-right min-w-[120px]">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(inv => {
                  const isSelected = selectedInvoices.has(inv.id);
                  return (
                  <TableRow key={inv.id} className={`hover:bg-muted/30 ${isSelected ? "bg-primary/5" : ""}`}>
                    <TableCell>
                      <Checkbox checked={isSelected} onChange={() => handleSelectInvoice(inv.id)} />
                    </TableCell>
                    <TableCell className="font-medium">#{inv.invoice_number}</TableCell>
                    <TableCell>{inv.customer_name}</TableCell>
                    <TableCell>{formatDate(inv.date)}</TableCell>
                    <TableCell className="font-medium">₪{(inv.total || 0).toLocaleString()}</TableCell>
                    <TableCell>
                      <Select value={inv.payment_status} onValueChange={(v) => handleStatusChange(inv.id, v)}>
                        <SelectTrigger className="h-7 w-fit border-0 p-0">
                          <Badge className={getPaymentStatusColor(inv.payment_status)}>{inv.payment_status}</Badge>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ממתין לתשלום">ממתין לתשלום</SelectItem>
                          <SelectItem value="שולם חלקית">שולם חלקית</SelectItem>
                          <SelectItem value="שולם">שולם</SelectItem>
                          <SelectItem value="באיחור">באיחור</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="min-w-[120px]">
                      <div className="flex items-center gap-1 flex-nowrap">
                        <Button variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9 shrink-0" onClick={() => setViewInvoice(inv)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9 shrink-0 text-destructive" onClick={() => setDeleteId(inv.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                        {settings[0]?.api_url && (
                          <div className="shrink-0">
                            <ExternalInvoiceButton
                              invoice={inv}
                              customer={getCustomer(inv.customer_id)}
                              settings={settings[0]}
                            />
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {selectedCount > 0 && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mt-4 flex items-center justify-between">
          <span className="text-sm font-medium">נבחרו {selectedCount} חשבוניות</span>
          <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
            <Trash2 className="w-4 h-4 ml-1" /> מחק נבחרים
          </Button>
        </div>
      )}

      </div>{/* end scrollable region */}

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
                      <tr key={i} className="border-t border-border"><td className="px-3 py-2">{item.name}</td><td className="px-3 py-2">{item.quantity}</td><td className="px-3 py-2">₪{(item.unit_price || 0).toFixed(2)}</td><td className="px-3 py-2 font-medium">₪{(item.total || 0).toFixed(2)}</td></tr>
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const customer = getCustomer(viewInvoice.customer_id);
                    const phone = customer?.mobile || customer?.phone || "";
                    const cleaned = phone.replace(/\D/g, "");
                    const intlPhone = cleaned.startsWith("0") ? "972" + cleaned.slice(1) : cleaned;
                    const pdfUrl = `https://crm-omri-dadon.vercel.app/invoice-pdf/${viewInvoice.id}`;
                    const total = (viewInvoice.total || 0).toLocaleString("he-IL", { minimumFractionDigits: 2 });
                    const msg = `שלום ${viewInvoice.customer_name},\n\nחשבונית מספר #${viewInvoice.invoice_number} ממיני סטוק\nסה"כ לתשלום: ${total}₪\n\nלצפייה בחשבונית: ${pdfUrl}\n\nלפרטים נוספים צרו קשר.`;
                    window.open(`https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`, "_blank");
                  }}
                  className="text-green-600 border-green-200 hover:bg-green-50"
                >
                  <Link2 className="w-4 h-4 ml-1" /> קישור WhatsApp לחשבונית
                </Button>
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