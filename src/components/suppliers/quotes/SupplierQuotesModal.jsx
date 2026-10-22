/**
 * "השוואת הצעות מחיר" — the new Suppliers window.
 *
 * The window hosts three views, chosen by `mode`:
 *   list   — the quotations already imported, plus the manual upload
 *   scan   — capture pages and read them
 *   review — correct the extracted lines and approve them
 *
 * Nothing it contains reaches products.buy_price, inventory,
 * supplier_price_history, supplier_deliveries or supplier_orders. A quotation
 * is an OFFER; those tables record what was received and paid.
 *
 * It is self-contained: Suppliers.jsx only opens and closes it. Every query
 * lives in @/api/supplierQuotes, so the existing supplier windows share no
 * state and no code path with this one and cannot be affected by it.
 */
import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Upload, Trash2, ExternalLink, Scale, ScanLine, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import {
  listQuotes, countItemsByQuote, createQuote, deleteQuote,
  quoteFileUrl, listSuppliersForPicker, isStaffUser,
} from "@/api/supplierQuotes";
import QuoteScanPanel from "@/components/suppliers/quotes/QuoteScanPanel";
import QuoteExtractionReview from "@/components/suppliers/quotes/QuoteExtractionReview";
import QuoteSavedItemsEditor from "@/components/suppliers/quotes/QuoteSavedItemsEditor";
import SupplierPriceComparison from "@/components/suppliers/quotes/SupplierPriceComparison";

const MUTED = "var(--heillo-text-muted)";
const DARK = "var(--heillo-text-primary)";

// 15MB. A phone photo of a price list is well under this; a 60-page PDF is not
// something this window is for.
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ACCEPTED = ".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv";

const STATUS_LABEL = {
  draft: "טיוטה",
  reviewed: "נבדק",
  archived: "בארכיון",
};

function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function SupplierQuotesModal({ open, onClose }) {
  const [staff, setStaff] = useState(null);     // null = not yet known
  // list | scan | review. `scan` holds the in-memory draft between the last
  // two: it is never persisted until the review screen is approved.
  const [mode, setMode] = useState("list");
  const [scan, setScan] = useState(null);
  const [editQuoteId, setEditQuoteId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [quotes, setQuotes] = useState([]);
  const [counts, setCounts] = useState({});
  const [suppliers, setSuppliers] = useState([]);
  const [deletingId, setDeletingId] = useState(null);

  // Upload form
  const [supplierId, setSupplierId] = useState("");
  const [quoteDate, setQuoteDate] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listQuotes({});
      setQuotes(rows);
      setCounts(await countItemsByQuote(rows.map(r => r.id)));
    } catch (err) {
      // The tables may not exist yet: the migration is applied separately. That
      // must read as "nothing here yet", not as a crash.
      console.warn("[supplier-quotes] load failed", err?.message || err);
      setQuotes([]);
      setCounts({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const ok = await isStaffUser();
      if (cancelled) return;
      setStaff(ok);
      if (!ok) return;          // not staff: nothing is loaded at all
      try {
        setSuppliers(await listSuppliersForPicker());
      } catch { /* the picker simply stays empty */ }
      await load();
    })();
    return () => { cancelled = true; };
  }, [open, load]);

  const resetForm = () => {
    setSupplierId(""); setQuoteDate(""); setValidUntil(""); setNotes(""); setFile(null);
  };

  const handleUpload = async () => {
    if (!supplierId) { toast.error("בחר ספק"); return; }
    if (file && file.size > MAX_FILE_BYTES) {
      toast.error("הקובץ גדול מדי (עד 15MB)");
      return;
    }
    setUploading(true);
    try {
      await createQuote({ supplierId, quoteDate, validUntil, notes, file });
      toast.success("הצעת המחיר נשמרה");
      resetForm();
      await load();
    } catch (err) {
      toast.error(err?.message || "שמירת הצעת המחיר נכשלה");
    } finally {
      setUploading(false);
    }
  };

  const handleOpenFile = async (q) => {
    try {
      const url = await quoteFileUrl(q.file_path);
      if (!url) { toast.error("לא נמצא קובץ"); return; }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err?.message || "פתיחת הקובץ נכשלה");
    }
  };

  const handleDelete = async (q) => {
    if (!window.confirm("למחוק את החשבונית וכל העמודים שלה ממערכת ההשוואה? פעולה זו אינה הפיכה.")) return;
    setDeletingId(q.id);
    try {
      await deleteQuote({ id: q.id });
      toast.success("הצעת המחיר נמחקה");
      await load();
    } catch (err) {
      toast.error(err?.message || "המחיקה נכשלה");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Dialog open={!!open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Scale style={{ width: 18, height: 18 }} /> השוואת הצעות מחיר
          </DialogTitle>
        </DialogHeader>

        {staff === false ? (
          // Belt and braces: RLS already returns nothing to a non-staff caller.
          <p style={{ fontSize: 14, color: MUTED, padding: "32px 0", textAlign: "center" }}>
            אין לך הרשאה לצפות בהצעות מחיר מספקים.
          </p>
        ) : mode === "scan" ? (
          <>
            <Button variant="ghost" size="sm" style={{ alignSelf: "flex-start" }}
              onClick={() => setMode("list")}>
              <ArrowRight style={{ width: 14, height: 14, marginInlineEnd: 4 }} /> חזרה לרשימה
            </Button>
            <QuoteScanPanel
              suppliers={suppliers}
              onDraft={(result) => { setScan(result); setMode("review"); }}
              onOpenExisting={() => { setMode("list"); load(); }}
            />
          </>
        ) : mode === "edit" && editQuoteId ? (
          <QuoteSavedItemsEditor quoteId={editQuoteId}
            onClose={() => { setEditQuoteId(null); setMode("list"); load(); }}
            onSaved={() => { setEditQuoteId(null); setMode("list"); load(); }} />
        ) : mode === "review" && scan ? (
          <QuoteExtractionReview
            scan={scan}
            suppliers={suppliers}
            onCancel={() => { setScan(null); setMode("scan"); }}
            onSaved={() => { setScan(null); setMode("list"); load(); }}
          />
        ) : (
          <>
            {/* Scanning is the primary path; the manual form below stays for a
                quotation that arrives as a figure rather than a document. */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
              <Button onClick={() => setMode("scan")}>
                <ScanLine style={{ width: 15, height: 15, marginInlineEnd: 6 }} /> סריקת מסמך
              </Button>
            </div>

            <SupplierPriceComparison suppliers={suppliers} onEditQuote={id => {
              setEditQuoteId(id); setMode("edit");
            }} />

            {/* ── Upload ─────────────────────────────────────────────── */}
            <div className="heillo-card" style={{ padding: 16, marginTop: 10 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: DARK, margin: "0 0 12px" }}>
                העלאת הצעת מחיר
              </h3>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <div>
                  <Label style={{ fontSize: 12 }}>ספק *</Label>
                  <select
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="heillo-input"
                    style={{ width: "100%", boxSizing: "border-box", marginTop: 4 }}
                  >
                    <option value="">— בחר ספק —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label style={{ fontSize: 12 }}>תאריך הצעה</Label>
                  <Input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} style={{ marginTop: 4 }} />
                </div>
                <div>
                  <Label style={{ fontSize: 12 }}>בתוקף עד</Label>
                  <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} style={{ marginTop: 4 }} />
                </div>
                <div>
                  <Label style={{ fontSize: 12 }}>קובץ</Label>
                  <Input type="file" accept={ACCEPTED} style={{ marginTop: 4 }}
                    onChange={(e) => setFile(e.target.files?.[0] || null)} />
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <Label style={{ fontSize: 12 }}>הערות</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ marginTop: 4 }} />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <Button onClick={handleUpload} disabled={uploading || !supplierId}>
                  <Upload style={{ width: 15, height: 15, marginInlineEnd: 6 }} />
                  {uploading ? "שומר..." : "שמירת הצעה"}
                </Button>
              </div>

              <p style={{ fontSize: 11, color: MUTED, margin: "10px 0 0", lineHeight: 1.5 }}>
                בשלב זה ההצעה נשמרת כמסמך בלבד. זיהוי אוטומטי של המוצרים והשוואת מחירים יתווספו בשלב הבא.
                מחירי ההצעה אינם מעדכנים מחירי קנייה, מלאי או היסטוריית מחירי ספקים.
              </p>
            </div>

            {/* ── List ───────────────────────────────────────────────── */}
            <h3 style={{ fontSize: 14, fontWeight: 600, color: DARK, margin: "20px 0 10px" }}>
              הצעות מחיר שמורות
            </h3>

            {loading ? (
              <p style={{ fontSize: 13, color: MUTED, padding: "24px 0", textAlign: "center" }}>טוען...</p>
            ) : quotes.length === 0 ? (
              <p style={{ fontSize: 13, color: MUTED, padding: "24px 0", textAlign: "center" }}>
                אין הצעות מחיר שמורות
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {quotes.map(q => {
                  const c = counts[q.id] || { total: 0, pending: 0, approved: 0 };
                  return (
                    <div key={q.id} className="heillo-card"
                      style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: DARK }}>
                          {q.supplier_name}
                        </p>
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: MUTED }}>
                          תאריך: {fmtDate(q.quote_date)} · בתוקף עד: {fmtDate(q.valid_until)} ·{" "}
                          {STATUS_LABEL[q.status] || q.status}
                          {c.total > 0 && ` · ${c.total} שורות (${c.pending} ממתינות לאישור)`}
                        </p>
                        {q.notes && (
                          <p style={{ margin: "2px 0 0", fontSize: 12, color: MUTED }}>{q.notes}</p>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {c.total > 0 && (
                          <Button variant="outline" size="sm" onClick={() => { setEditQuoteId(q.id); setMode("edit"); }}>
                            תיקון שורות ואריזות
                          </Button>
                        )}
                        {q.file_path && (
                          <Button variant="outline" size="sm" onClick={() => handleOpenFile(q)}>
                            <ExternalLink style={{ width: 14, height: 14, marginInlineEnd: 4 }} /> מסמך
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10"
                          disabled={deletingId === q.id} onClick={() => handleDelete(q)}>
                          <Trash2 style={{ width: 16, height: 16 }} />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {quotes.length === 0 && !loading && (
              <p style={{ fontSize: 11, color: MUTED, textAlign: "center", margin: "8px 0 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <FileText style={{ width: 13, height: 13 }} /> העלה הצעת מחיר ראשונה כדי להתחיל
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
