import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { Plus, Search, Trash2, Pencil, ExternalLink } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import EmptyState from "@/components/shared/EmptyState";
import ExpenseDialog from "@/components/expenses/ExpenseDialog";
import { toast } from "sonner";
import { formatCurrency } from "@/utils/formatCurrency";
import { formatDate } from "@/lib/dateUtils";

// Extensions whose media type is unambiguous from the name alone. Anything not
// listed here is opened as-is rather than guessed at — a wrong type would make
// the browser render a file as garbage instead of downloading it honestly.
const VIEWABLE_TYPES = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

function viewableTypeOf(url) {
  const path = String(url).split("?")[0].split("#")[0];
  const dot = path.lastIndexOf(".");
  if (dot === -1) return null;
  return VIEWABLE_TYPES[path.slice(dot + 1).toLowerCase()] || null;
}

// Types the browser can actually paint. HEIC is a real, identifiable format
// with no browser decoder, so it gets its own message rather than a generic one.
const DISPLAYABLE_IMAGES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const HEIF_TYPE = "image/heic";

// A media type is only useful if it names a real format. Servers fall back to
// octet-stream whenever they do not know, so that value carries no information.
function usableType(v) {
  if (!v) return null;
  const t = String(v).split(";")[0].trim().toLowerCase();
  if (!t || t === "application/octet-stream" || t === "binary/octet-stream") return null;
  return t;
}

// Reads the file's own signature. This identifies the format from the bytes
// themselves rather than from a filename or a header, so it is the last resort
// and also the most reliable one.
async function sniffType(blob) {
  let bytes;
  try {
    bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  } catch (e) {
    return null;
  }
  const at = (offset, sig) => sig.every((b, i) => bytes[offset + i] === b);
  const ascii = (offset, len) =>
    String.fromCharCode(...bytes.slice(offset, offset + len));

  // %PDF
  if (at(0, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  // RIFF....WEBP — the four size bytes between the two markers are skipped.
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  // ISO base media container: ....ftyp<brand>. Only the HEIF brands matter here.
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4).toLowerCase();
    if (["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
      return HEIF_TYPE;
    }
  }
  return null;
}

// Suggestions only — category stays free text, so anything typed is kept.
const DEFAULT_CATEGORIES = [
  "רכישות ספקים", "דלק", "שכירות", "חשמל", "פרסום",
  "ציוד", "תחזוקה ותיקונים", "עמלות ובנק", "ביטוח", "אחר",
];

export default function Expenses() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editExpense, setEditExpense] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  // Newest first. RLS already limits this to the logged-in user's rows.
  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("expenses")
        .select("*")
        .eq("user_id", user?.id)
        .order("date", { ascending: false })
        .order("created_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Supplier-sourced expenses point at a delivery that already holds the
  // scanned document. The file is read through that link — never re-uploaded
  // and never copied.
  const deliveryIds = useMemo(
    () => [...new Set(expenses.map(e => e.supplier_delivery_id).filter(Boolean))],
    [expenses]
  );

  const [deliveryFiles, setDeliveryFiles] = useState({});
  useEffect(() => {
    let cancelled = false;
    if (deliveryIds.length === 0) { setDeliveryFiles({}); return; }
    supabase
      .from("supplier_deliveries")
      .select("id, file_url")
      .in("id", deliveryIds)
      .then(({ data }) => {
        if (cancelled) return;
        const map = {};
        (data || []).forEach(d => { if (d.file_url) map[d.id] = d.file_url; });
        setDeliveryFiles(map);
      });
    return () => { cancelled = true; };
  }, [deliveryIds]);

  const categories = useMemo(() => {
    const used = new Set(expenses.map(e => e.category).filter(Boolean));
    return [...new Set([...DEFAULT_CATEGORIES, ...used])];
  }, [expenses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expenses.filter(e => {
      const matchSearch = !q || [e.payee, e.description, e.document_number]
        .some(f => f?.toLowerCase().includes(q));
      const matchCat = categoryFilter === "all" || e.category === categoryFilter;
      const matchFrom = !fromDate || (e.date && e.date >= fromDate);
      const matchTo = !toDate || (e.date && e.date <= toDate);
      return matchSearch && matchCat && matchFrom && matchTo;
    });
  }, [expenses, search, categoryFilter, fromDate, toDate]);

  // The headline figure, and the one the dashboard will later mirror: the sum
  // of amount_net over exactly what is on screen. Never derived from gross.
  const totalNet = useMemo(
    () => filtered.reduce((sum, e) => sum + (Number(e.amount_net) || 0), 0),
    [filtered]
  );

  // ── Document viewer ───────────────────────────────────────────────────────
  // The stored object is served with headers that make the browser download it
  // rather than display it, so the same bytes are re-served through a blob URL
  // carrying an explicit media type and rendered inside this page. The stored
  // file is only read — never replaced, copied or re-uploaded — and the user
  // never leaves the Expenses page, so filters and scroll position survive.
  const [viewer, setViewer] = useState({ open: false, loading: false, url: null, type: null, error: "" });
  const blobUrlRef = useRef(null);
  // Guards against a slow first document overwriting a second one opened after it.
  const viewerReqRef = useRef(0);

  const releaseBlob = () => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  };

  // Last line of defence: navigating away while the viewer is open must not
  // leave the blob held in memory.
  useEffect(() => releaseBlob, []);

  // The same thing Suppliers and DocumentCenter do with a supplier document:
  // give the URL to the browser and let it (or the OS) take over. Used for the
  // formats no browser can render.
  const openExternally = (fileUrl) => {
    const win = window.open(fileUrl, "_blank");
    if (!win) {
      setViewer({ open: true, loading: false, url: null, type: null, error: "הדפדפן חסם את פתיחת החלון" });
      return;
    }
    try { win.opener = null; } catch (e) { /* cross-origin guard */ }
    closeViewer();
  };

  const openDocument = async (url) => {
    const runId = ++viewerReqRef.current;
    releaseBlob();
    setViewer({ open: true, loading: true, url: null, type: null, error: "" });

    try {
      // The one and only request for this document.
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const bytes = await res.blob();
      if (viewerReqRef.current !== runId) return;

      // Header first, then what the Blob reports, then the file name, and only
      // then the bytes. The document is never judged before it is read — a
      // missing or unknown extension says nothing about the file itself.
      const type =
        usableType(res.headers.get("content-type")) ||
        usableType(bytes.type) ||
        viewableTypeOf(url) ||
        await sniffType(bytes);
      if (viewerReqRef.current !== runId) return;

      // HEIC/HEIF, and anything whose type could not be resolved, cannot be
      // painted by the browser. Rather than decoding it here, the stored URL is
      // handed to the browser exactly as the supplier screens already do, and
      // the operating system opens it. Nothing is fetched a second time — this
      // is a plain navigation to the same public file_url.
      if (type === HEIF_TYPE || (type !== "application/pdf" && !DISPLAYABLE_IMAGES.includes(type))) {
        openExternally(url);
        return;
      }

      // Re-typed from the same bytes already fetched — nothing is requested,
      // uploaded or stored again.
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type }));
      blobUrlRef.current = blobUrl;
      setViewer({ open: true, loading: false, url: blobUrl, type, error: "" });
    } catch (err) {
      if (viewerReqRef.current !== runId) return;
      setViewer({ open: true, loading: false, url: null, type: null, error: "שגיאה בטעינת המסמך" });
    }
  };

  const closeViewer = () => {
    viewerReqRef.current++;
    releaseBlob();
    setViewer({ open: false, loading: false, url: null, type: null, error: "" });
  };

  const handleDelete = async () => {
    const id = deleteId;
    setDeleteId(null);
    try {
      // Removes the expense row only. The linked supplier delivery, its file,
      // stock movements, price history and every invoice stay exactly as they
      // are — nothing else references this row.
      await base44.entities.Expense.delete(id);
      queryClient.setQueryData(["expenses"], (old = []) => old.filter(e => e.id !== id));
      toast.success("ההוצאה נמחקה");
    } catch (err) {
      toast.error("שגיאה במחיקת ההוצאה");
    } finally {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    }
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
  const inputStyle = {
    background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14,
    height: 40, padding: "0 14px", fontSize: 13, color: DARK,
    fontFamily: "'Heebo', sans-serif", outline: "none", boxSizing: "border-box",
  };
  const th = { padding: "14px 20px", textAlign: "right", fontWeight: 500, fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" };
  const td = { padding: "14px 20px", fontSize: 13, color: DARK };

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: "radial-gradient(ellipse 40% 35% at 75% 5%, rgba(252,234,227,0.75) 0%, rgba(236,237,240,0) 100%), #ECEDF0", fontFamily: "'Heebo', sans-serif", padding: 32, paddingTop: 24 }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: DARK, margin: 0 }}>הוצאות</h1>
          <p style={{ fontSize: 13, color: MUTED, margin: "2px 0 0" }}>{filtered.length} רשומות</p>
        </div>
        <button
          onClick={() => { setEditExpense(null); setDialogOpen(true); }}
          style={{ background: ACCENT, color: "#FFFFFF", border: "none", borderRadius: 12, fontWeight: 600, padding: "8px 18px", fontSize: 13, fontFamily: "'Heebo', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", transition: "opacity 0.2s ease" }}
          onMouseEnter={e => e.currentTarget.style.opacity = "0.88"}
          onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
          <Plus style={{ width: 16, height: 16 }} /> הוצאה חדשה
        </button>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: MUTED, pointerEvents: "none" }} />
          <input
            placeholder="חיפוש לפי ספק, תיאור או מספר מסמך..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, width: "100%", padding: "0 40px 0 14px" }}
          />
        </div>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ ...inputStyle, minWidth: 150 }} aria-label="מתאריך" />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ ...inputStyle, minWidth: 150 }} aria-label="עד תאריך" />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger style={{ background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, height: 40, fontSize: 13, color: DARK, fontFamily: "'Heebo', sans-serif", minWidth: 160 }}>
            <SelectValue placeholder="קטגוריה" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הקטגוריות</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* ── Filtered total ──────────────────────────────────────────────── */}
      <div style={{ ...CARD_STYLE, padding: "16px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: MUTED }}>סה״כ הוצאות לפני מע״מ</span>
        <span style={{ fontSize: 22, fontWeight: 800, color: ACCENT }}>{formatCurrency(totalNet)}</span>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "64px 0" }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid rgba(0,0,0,0.08)", borderTopColor: ACCENT, animation: "spin 1s linear infinite" }} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={search ? Search : null} title={search ? "לא נמצאו תוצאות" : "אין הוצאות"} description={search ? "נסה חיפוש אחר" : "הוסף הוצאה ראשונה"} />
      ) : (
        <div style={CARD_STYLE}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Heebo', sans-serif" }}>
              <thead>
                <tr style={{ background: "#FAFAFA", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                  {["תאריך","קטגוריה","ספק / בית עסק","סכום לפני מע״מ","מע״מ","סה״כ כולל מע״מ","מספר מסמך","מסמך","פעולות"].map(col => (
                    <th key={col} style={th}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => {
                  const fileUrl = e.supplier_delivery_id ? deliveryFiles[e.supplier_delivery_id] : null;
                  return (
                    <tr key={e.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid rgba(0,0,0,0.04)" : "none" }}>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(e.date)}</td>
                      <td style={td}>
                        {e.category && (
                          <span style={{ borderRadius: 99, fontSize: 11, fontWeight: 600, padding: "3px 10px", background: "rgba(0,0,0,0.05)", color: DARK, display: "inline-block", whiteSpace: "nowrap" }}>{e.category}</span>
                        )}
                      </td>
                      <td style={td}>{e.payee || "—"}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{formatCurrency(e.amount_net)}</td>
                      <td style={{ ...td, color: MUTED }}>{e.vat_amount == null ? "—" : formatCurrency(e.vat_amount)}</td>
                      <td style={td}>{e.amount_gross == null ? "—" : formatCurrency(e.amount_gross)}</td>
                      <td style={{ ...td, fontSize: 12, color: MUTED }}>{e.document_number || "—"}</td>
                      <td style={td}>
                        {fileUrl ? (
                          <button onClick={() => openDocument(fileUrl)}
                            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#2563eb", background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: "'Heebo', sans-serif", whiteSpace: "nowrap" }}>
                            <ExternalLink style={{ width: 13, height: 13 }} /> צפה במסמך
                          </button>
                        ) : (
                          <span style={{ fontSize: 12, color: MUTED }}>—</span>
                        )}
                      </td>
                      <td style={td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          {[
                            { icon: Pencil, action: () => { setEditExpense(e); setDialogOpen(true); }, title: "עריכה" },
                            { icon: Trash2, action: () => setDeleteId(e.id), title: "מחיקה", danger: true },
                          ].map(({ icon: Icon, action, title, danger }) => (
                            <button key={title} onClick={action} title={title}
                              style={{ background: "transparent", border: "none", borderRadius: 8, padding: 6, cursor: "pointer", color: danger ? "#ef4444" : MUTED, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s ease" }}
                              onMouseEnter={ev => { ev.currentTarget.style.background = danger ? "rgba(239,68,68,0.08)" : "rgba(0,0,0,0.04)"; ev.currentTarget.style.color = danger ? "#ef4444" : DARK; }}
                              onMouseLeave={ev => { ev.currentTarget.style.background = "transparent"; ev.currentTarget.style.color = danger ? "#ef4444" : MUTED; }}
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
        </div>
      )}

      <ExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        expense={editExpense}
        categories={categories}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ["expenses"] })}
      />

      {/* ── Document viewer ─────────────────────────────────────────────── */}
      <Dialog open={viewer.open} onOpenChange={(o) => { if (!o) closeViewer(); }}>
        <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-4 sm:p-6" dir="rtl">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>צפייה במסמך</DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 mt-2 rounded-lg border border-border bg-muted/20 overflow-auto flex items-center justify-center">
            {viewer.loading ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid rgba(0,0,0,0.08)", borderTopColor: ACCENT, animation: "spin 1s linear infinite" }} />
                <span style={{ fontSize: 13, color: MUTED }}>טוען מסמך...</span>
              </div>
            ) : viewer.error ? (
              <p style={{ fontSize: 14, color: "#dc2626", padding: 24, textAlign: "center" }}>{viewer.error}</p>
            ) : viewer.type === "application/pdf" ? (
              // The browser's built-in PDF viewer, pointed at the blob rather
              // than the stored URL, so nothing is downloaded.
              <iframe src={viewer.url} title="מסמך" style={{ width: "100%", height: "100%", border: "none" }} />
            ) : viewer.url ? (
              // Fits the viewer without cropping or distorting the document.
              <img src={viewer.url} alt="מסמך" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block", margin: "auto" }} />
            ) : null}
          </div>

          <div className="flex-shrink-0 flex justify-end pt-3">
            <Button variant="outline" onClick={closeViewer}>סגור</Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת הוצאה</AlertDialogTitle>
            <AlertDialogDescription>
              האם אתה בטוח שברצונך למחוק את ההוצאה? הפעולה מוחקת את רישום ההוצאה בלבד — מסמך הספק, המלאי והחשבוניות אינם מושפעים.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">מחק הוצאה</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
