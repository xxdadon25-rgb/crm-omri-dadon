import { useState, useMemo } from "react";

// Module-level set — survives component unmount/remount, loaded from sessionStorage on init
const PENDING_DELETED_KEY = "pendingDeletedQuotes";
const deletedQuoteIds = new Set(
  (() => {
    try {
      return JSON.parse(sessionStorage.getItem(PENDING_DELETED_KEY)) || [];
    } catch { return []; }
  })()
);
function persistDeletedIds() {
  try {
    sessionStorage.setItem(PENDING_DELETED_KEY, JSON.stringify(Array.from(deletedQuoteIds)));
  } catch {}
}
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { Plus, Search, FileText, Pencil, Trash2, Receipt, Store, Check } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import { toast } from "sonner";
import { formatCurrency } from "@/utils/formatCurrency";
import { Checkbox } from "@/components/ui/checkbox";

const statusColors = {
  "טיוטה": "bg-slate-100 text-slate-600",
  "נשלח": "bg-blue-100 text-blue-700",
  "אושר": "bg-green-100 text-green-700",
  "נדחה": "bg-red-100 text-red-700",
  "פגה תוקף": "bg-orange-100 text-orange-700",
  "הומרה להזמנה": "bg-purple-100 text-purple-700",
  "הומרה לחשבונית": "bg-yellow-100 text-yellow-800",
};

export default function Quotes() {
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState(null);
  const [selectedQuotes, setSelectedQuotes] = useState(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ["quotes"],
    queryFn: async () => {
      console.log("[QUOTES QUERYFN ACTIVE]");
      const pendingRaw = sessionStorage.getItem("pendingQuotes");
      console.log("[QUERYFN] sessionStorage.pendingQuotes RAW:", pendingRaw);
      const pendingQuotes = pendingRaw ? JSON.parse(pendingRaw) : [];
      console.log("[QUERYFN] parsed pendingQuotes (ids/numbers):", pendingQuotes.map(p => ({ id: p.id, number: p.quote_number })));
      const result = await base44.entities.Quote.list("-created_date");
      console.log("[QUERYFN] Quote.list returned ids:", result.map(q => ({ id: q.id, number: q.quote_number })).slice(0, 5), result.length > 5 ? "..." : "");

      if (pendingQuotes.length > 0) {
        const backendIds = new Set(result.map(q => q.id));
        console.log("[QUERYFN] backendIds count:", backendIds.size);

        // Prepend only pending quotes NOT already in backend — no early cleanup
        const missing = pendingQuotes.filter(p => !backendIds.has(p.id));
        console.log("[QUERYFN] pending NOT in backend:", missing.map(p => ({ id: p.id, number: p.quote_number })));

        if (missing.length > 0) {
          // Strip internal _confirmCount before injecting into visible result
          const cleanMissing = missing.map(({ _confirmCount, ...p }) => p);
          console.log("[QUERYFN] prepending", cleanMissing.length, "missing quotes");
          result.unshift(...cleanMissing);
        }
      } else {
        console.log("[QUERYFN] no pendingQuotes — skipping merge");
      }

      // Deduplicate by id to prevent visual duplicates
      const deduped = result.filter((q, i, arr) => arr.findIndex(x => x.id === q.id) === i);
      console.log("[QUERYFN] FINAL result count:", deduped.length);
      console.log("[QUERYFN] === QUERYFN END ===");
      return deduped;
    },
    select: (data) => data.filter(q => !deletedQuoteIds.has(q.id)),
  });
  const { data: settings = [] } = useQuery({ queryKey: ["settings"], queryFn: () => base44.entities.BusinessSettings.list() });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => base44.entities.Product.list("-created_date") });

  const filtered = useMemo(() => {
    return quotes.filter(q => !search || [q.customer_name, String(q.quote_number)].some(f => f?.toLowerCase().includes(search.toLowerCase())));
  }, [quotes, search]);

  const isAllSelected = filtered.length > 0 && filtered.every(q => selectedQuotes.has(q.id));
  const selectedCount = selectedQuotes.size;

  const handleSelectQuote = (id) => {
    const updated = new Set(selectedQuotes);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setSelectedQuotes(updated);
  };

  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedQuotes(new Set());
    } else {
      const allIds = new Set(filtered.map(q => q.id));
      setSelectedQuotes(allIds);
    }
  };

  const handleDelete = async () => {
    const id = deleteId;
    setDeleteId(null);
    // Mark as deleted so the select filter hides it even after refetch
    deletedQuoteIds.add(id);
    persistDeletedIds();
    queryClient.setQueryData(["quotes"], (old = []) => old.filter(q => q.id !== id));
    try {
      await base44.entities.Quote.delete(id);
      toast.success("הצעת מחיר נמחקה בהצלחה");
    } catch (error) {
      toast.error("שגיאה במחיקת ההצעה");
    }
    queryClient.invalidateQueries({ queryKey: ["quotes"] });
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    const ids = Array.from(selectedQuotes);

    ids.forEach(id => deletedQuoteIds.add(id));
    persistDeletedIds();

    // 2. Remove from visible list immediately
    queryClient.setQueryData(["quotes"], (old = []) => old.filter(q => !ids.includes(q.id)));

    // 3. Clear selection and close dialog
    setSelectedQuotes(new Set());
    setBulkDeleteOpen(false);

    // 4. Await ALL deletes before triggering any refetch
    await Promise.all(ids.map(id => base44.entities.Quote.delete(id).catch(() => {})));

    toast.success(`${ids.length} הצעות נמחקו בהצלחה`);

    queryClient.invalidateQueries({ queryKey: ["quotes"] });

    setDeleting(false);
  };

  const handleConvertToInvoice = async (quote) => {
    const bs = settings[0];
    const counter = (bs?.invoice_counter || 1000) + 1;
    
    const invoiceData = {
      invoice_number: counter,
      quote_id: quote.id,
      customer_id: quote.customer_id,
      customer_name: quote.customer_name,
      date: new Date().toISOString().split("T")[0],
      items: quote.items,
      subtotal: quote.subtotal,
      vat_rate: quote.vat_rate,
      vat_amount: quote.vat_amount,
      total: quote.total,
      notes: quote.notes,
      payment_status: "ממתין לתשלום",
    };

    const newInvoice = await base44.entities.Invoice.create(invoiceData);
    queryClient.setQueryData(["invoices"], (old = []) => [newInvoice, ...(old)]);

    // NOTE: Do NOT deduct stock here. Stock is only managed via the Order
    // workflow (processOrderInventory automation). Converting a quote directly
    // to an invoice does NOT touch inventory — stock was either already
    // deducted when the linked order was approved, or this is a direct-to-invoice
    // scenario with no order, in which case the invoice is a billing document only.

    // Update quote status
    await base44.entities.Quote.update(quote.id, { status: "הומרה לחשבונית" });
    queryClient.setQueryData(["quotes"], (old = []) => old.map(q => q.id === quote.id ? { ...q, status: "הומרה לחשבונית" } : q));

    // Update counter
    if (bs?.id) {
      await base44.entities.BusinessSettings.update(bs.id, { invoice_counter: counter });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    }

    toast.success(`חשבונית מספר ${counter} נוצרה בהצלחה`);
  };

  return (
    <div>
      {/* Self-contained scrollable region — sticky works within this container */}
      {/* OLD - can restore: remove outer overflow wrapper and its closing tag before dialogs */}
      <div className="overflow-y-auto thin-scrollbar max-h-[calc(100vh-4rem)]">

        {/* Sticky top bar: page header + search */}
        <div className="sticky top-0 z-10 bg-background pb-3">
          <PageHeader title="הצעות מחיר" description={`${quotes.length} הצעות`}>
            <Button size="sm" variant="outline" onClick={() => navigate("/sales-catalog")}>
              <Store className="w-4 h-4 ml-1" /> מכירה בקטלוג
            </Button>
            <Button size="sm" onClick={() => navigate("/quotes/new")}>
              <Plus className="w-4 h-4 ml-1" /> הצעה חדשה
            </Button>
          </PageHeader>
          <div className="relative mt-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="חיפוש..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9 max-w-md" />
          </div>
        </div>

       {selectedCount > 0 && (
         <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4 flex items-center justify-between">
           <span className="text-sm font-medium">נבחרו {selectedCount} הצעות</span>
           <Button
             variant="outline"
             size="sm"
             className="border-amber-400 text-amber-700 hover:bg-amber-50 shadow-sm"
             onClick={() => setBulkDeleteOpen(true)}
           >
             <Trash2 className="w-4 h-4 ml-1" /> מחק נבחרים
           </Button>
         </div>
       )}

       {isLoading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={FileText} title="אין הצעות מחיר" description="צור הצעת מחיר ראשונה" />
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right w-12">
                    <Checkbox
                      checked={isAllSelected}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead className="text-right">מספר</TableHead>
                  <TableHead className="text-right">לקוח</TableHead>
                  <TableHead className="text-right">תאריך</TableHead>
                  <TableHead className="text-right">סה״כ</TableHead>
                  <TableHead className="text-right">סוכן</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                  <TableHead className="text-right w-36">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(q => {
                  const isSelected = selectedQuotes.has(q.id);
                  return (
                  <TableRow key={q.id} className={`hover:bg-muted/30 ${isSelected ? "bg-primary/5" : ""}`}>
                    <TableCell className="text-right">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleSelectQuote(q.id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">#{q.quote_number}</TableCell>
                    <TableCell>{q.customer_name}</TableCell>
                    <TableCell>{formatDate(q.date)}</TableCell>
                    {/* <TableCell className="font-medium">₪{(q.total || 0).toLocaleString()}</TableCell> */}
                    <TableCell className="font-medium">{formatCurrency(q.total)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{q.agent || "—"}</TableCell>
                    <TableCell><Badge className={statusColors[q.status] || ""}>{q.status}</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(`/quotes/edit?id=${q.id}`)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        {q.status !== "הומרה לחשבונית" && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600" title="הפוך לחשבונית" onClick={() => handleConvertToInvoice(q)}>
                            <Receipt className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(q.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
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
                      <span className="text-sm font-medium">נבחרו {selectedCount} הצעות</span>
                      <Button variant="outline" size="sm" className="border-amber-400 text-amber-700 hover:bg-amber-50 shadow-sm" onClick={() => setBulkDeleteOpen(true)}>
                        <Trash2 className="w-4 h-4 ml-1" /> מחק נבחרים
                      </Button>
                    </div>
                  )}

      </div>{/* end scrollable region */}

                  <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                  <AlertDialogContent dir="rtl">
                  <AlertDialogHeader>
                  <AlertDialogTitle>מחיקת הצעת מחיר</AlertDialogTitle>
                  <AlertDialogDescription>האם אתה בטוח שברצונך למחוק את הצעה זו?</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="flex-row-reverse gap-2">
                  <AlertDialogCancel>ביטול</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">מחק הצעה</AlertDialogAction>
                  </AlertDialogFooter>
                  </AlertDialogContent>
                  </AlertDialog>

                  <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
                  <AlertDialogContent dir="rtl">
                  <AlertDialogHeader>
                  <AlertDialogTitle>מחיקת הצעות מחיר</AlertDialogTitle>
                  <AlertDialogDescription>האם אתה בטוח שברצונך למחוק את {selectedCount} ההצעות שנבחרו?</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="flex-row-reverse gap-2">
                  <AlertDialogCancel disabled={deleting}>ביטול</AlertDialogCancel>
                  <AlertDialogAction onClick={handleBulkDelete} disabled={deleting} className="bg-destructive text-destructive-foreground">
                  {deleting ? "מוחק..." : "מחק הצעות"}
                  </AlertDialogAction>
                  </AlertDialogFooter>
                  </AlertDialogContent>
                  </AlertDialog>
                  </div>
                  );
                  }