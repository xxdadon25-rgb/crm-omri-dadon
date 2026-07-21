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
import { Plus, Search, FileText, Pencil, Trash2, Receipt, Store } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
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
      const pendingRaw = sessionStorage.getItem("pendingQuotes");
      const pendingQuotes = pendingRaw ? JSON.parse(pendingRaw) : [];
      const result = await base44.entities.Quote.list("-created_date");

      if (pendingQuotes.length > 0) {
        const backendIds = new Set(result.map(q => q.id));

        // Prepend only pending quotes NOT already in backend — no early cleanup
        const missing = pendingQuotes.filter(p => !backendIds.has(p.id));

        if (missing.length > 0) {
          // Strip internal _confirmCount before injecting into visible result
          const cleanMissing = missing.map(({ _confirmCount, ...p }) => p);
          result.unshift(...cleanMissing);
        }
      } else {
      }

      // Deduplicate by id to prevent visual duplicates
      const deduped = result.filter((q, i, arr) => arr.findIndex(x => x.id === q.id) === i);
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

  // ── Heillo design tokens ──
  const ACCENT = "#F5885E";
  const DARK   = "#120F1C";
  const MUTED  = "#B2B0B1";
  const CARD_STYLE = {
    background: "#FFFFFF",
    borderRadius: 22,
    border: "1px solid rgba(0,0,0,0.03)",
    boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
    overflow: "hidden",
    fontFamily: "'Heebo', sans-serif",
  };

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: "radial-gradient(ellipse 40% 35% at 75% 5%, rgba(252,234,227,0.75) 0%, rgba(236,237,240,0) 100%), #ECEDF0", fontFamily: "'Heebo', sans-serif", padding: 32, paddingTop: 24 }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      {/* OLD:
      <div className="sticky top-0 z-10 bg-background pb-3">
        <PageHeader title="הצעות מחיר" ...><Button>מכירה בקטלוג</Button><Button>הצעה חדשה</Button></PageHeader>
        <div className="relative mt-1"><Search .../><Input .../></div>
      </div>
      */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "transparent", paddingBottom: "16px", borderRadius: "0 0 16px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 0, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: DARK, margin: 0 }}>הצעות מחיר</h1>
          <p style={{ fontSize: 13, color: MUTED, margin: "2px 0 0" }}>{quotes.length} הצעות</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ position: "relative" }}>
            <Search style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: MUTED, pointerEvents: "none" }} />
            <input
              placeholder="חיפוש..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, height: 40, padding: "0 40px 0 14px", fontSize: 13, color: DARK, fontFamily: "'Heebo', sans-serif", outline: "none", width: 220 }}
            />
          </div>
          <button
            onClick={() => navigate("/sales-catalog")}
            style={{ background: "#FFFFFF", color: DARK, border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, fontWeight: 600, padding: "8px 16px", fontSize: 13, fontFamily: "'Heebo', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
            onMouseEnter={e => e.currentTarget.style.background = "#F8F8FA"}
            onMouseLeave={e => e.currentTarget.style.background = "#FFFFFF"}
          >
            <Store style={{ width: 15, height: 15 }} /> מכירה בקטלוג
          </button>
          <button
            onClick={() => navigate("/quotes/new")}
            style={{ background: ACCENT, color: "#FFFFFF", border: "none", borderRadius: 12, fontWeight: 600, padding: "8px 18px", fontSize: 13, fontFamily: "'Heebo', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", transition: "opacity 0.2s ease" }}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.88"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}
          >
            <Plus style={{ width: 16, height: 16 }} /> הצעה חדשה
          </button>
        </div>
      </div>
      </div>{/* end sticky top section */}

      {/* ── Bulk selection bar ───────────────────────────────────────────── */}
      {/* OLD: <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4 ..."> */}
      {selectedCount > 0 && (
        <div style={{ background: "rgba(245,136,94,0.07)", border: "1px solid rgba(245,136,94,0.2)", borderRadius: 14, padding: "10px 16px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: DARK }}>נבחרו {selectedCount} הצעות</span>
          <button
            onClick={() => setBulkDeleteOpen(true)}
            style={{ background: "transparent", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, color: "#ef4444", fontSize: 12, fontWeight: 500, padding: "6px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "'Heebo', sans-serif" }}
          >
            <Trash2 style={{ width: 14, height: 14 }} /> מחק נבחרים
          </button>
        </div>
      )}

      {/* ── Main card ────────────────────────────────────────────────────── */}
      {/* OLD: loading spinner / EmptyState / <div className="bg-card rounded-xl border border-border overflow-hidden"> */}
      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "64px 0" }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid rgba(0,0,0,0.08)", borderTopColor: ACCENT, animation: "spin 1s linear infinite" }} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={FileText} title="אין הצעות מחיר" description="צור הצעת מחיר ראשונה" />
      ) : (
        <div style={CARD_STYLE}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Heebo', sans-serif" }}>
              {/* OLD: <TableHeader><TableRow className="bg-muted/50">...</TableRow></TableHeader> */}
              <thead>
                <tr style={{ background: "#FAFAFA", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                  <th style={{ width: 44, padding: "14px 20px", textAlign: "center" }}>
                    <Checkbox checked={isAllSelected} onCheckedChange={handleSelectAll} />
                  </th>
                  {["מספר","לקוח","תאריך","סה״כ","סוכן","סטטוס","פעולות"].map(col => (
                    <th key={col} style={{ padding: "14px 20px", textAlign: "right", fontWeight: 500, fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{col}</th>
                  ))}
                </tr>
              </thead>
              {/* OLD: <TableBody>{filtered.map(q => <TableRow ...>...</TableRow>)}</TableBody> */}
              <tbody>
                {filtered.map((q, i) => {
                  const isSelected = selectedQuotes.has(q.id);
                  return (
                    <tr
                      key={q.id}
                      style={{
                        borderBottom: i < filtered.length - 1 ? "1px solid rgba(0,0,0,0.04)" : "none",
                        background: isSelected ? "rgba(245,136,94,0.04)" : "transparent",
                        transition: "background 0.15s ease",
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "rgba(245,136,94,0.04)"; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                    >
                      <td style={{ padding: "14px 20px", textAlign: "center" }}>
                        <Checkbox checked={isSelected} onCheckedChange={() => handleSelectQuote(q.id)} />
                      </td>
                      <td style={{ padding: "14px 20px", fontWeight: 500, fontSize: 13, color: DARK, whiteSpace: "nowrap" }}>#{q.quote_number}</td>
                      <td style={{ padding: "14px 20px", fontSize: 13, color: DARK }}>{q.customer_name}</td>
                      <td style={{ padding: "14px 20px", fontSize: 13, color: MUTED, whiteSpace: "nowrap" }}>{formatDate(q.date)}</td>
                      <td style={{ padding: "14px 20px", fontSize: 13, fontWeight: 500, color: DARK, whiteSpace: "nowrap" }}>{formatCurrency(q.total)}</td>
                      <td style={{ padding: "14px 20px", fontSize: 12, color: MUTED }}>{q.agent || "—"}</td>
                      <td style={{ padding: "14px 20px" }}>
                        {/* OLD: <Badge className={statusColors[q.status] || ""}>{q.status}</Badge> */}
                        <span className={statusColors[q.status] || ""} style={{ borderRadius: 99, fontSize: 11, fontWeight: 600, padding: "3px 10px", display: "inline-block" }}>
                          {q.status}
                        </span>
                      </td>
                      <td style={{ padding: "14px 20px" }}>
                        {/* OLD: <Button variant="ghost" size="icon" ...> */}
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          {[
                            { icon: Pencil, action: () => navigate(`/quotes/edit?id=${q.id}`), title: "עריכה" },
                            ...( q.status !== "הומרה לחשבונית" ? [{ icon: Receipt, action: () => handleConvertToInvoice(q), title: "הפוך לחשבונית", accent: true }] : [] ),
                            { icon: Trash2, action: () => setDeleteId(q.id), title: "מחיקה", danger: true },
                          ].map(({ icon: Icon, action, title, danger, accent }) => (
                            <button
                              key={title}
                              onClick={action}
                              title={title}
                              style={{ background: "transparent", border: "none", borderRadius: 8, padding: 6, cursor: "pointer", color: danger ? "#ef4444" : accent ? "#16a34a" : MUTED, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s ease" }}
                              onMouseEnter={e => { e.currentTarget.style.background = danger ? "rgba(239,68,68,0.08)" : accent ? "rgba(22,163,74,0.08)" : "rgba(0,0,0,0.04)"; e.currentTarget.style.color = danger ? "#ef4444" : accent ? "#16a34a" : DARK; }}
                              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = danger ? "#ef4444" : accent ? "#16a34a" : MUTED; }}
                            >
                              <Icon style={{ width: 18, height: 18, strokeWidth: 1.8 }} />
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Bottom bulk-delete bar */}
          {selectedCount > 0 && (
            <div style={{ borderTop: "1px solid rgba(0,0,0,0.04)", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: DARK }}>נבחרו {selectedCount} הצעות</span>
              <button
                onClick={() => setBulkDeleteOpen(true)}
                style={{ background: "transparent", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, color: "#ef4444", fontSize: 12, fontWeight: 500, padding: "6px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "'Heebo', sans-serif" }}
              >
                <Trash2 style={{ width: 14, height: 14 }} /> מחק נבחרים
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Dialogs (unchanged) ──────────────────────────────────────────── */}
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