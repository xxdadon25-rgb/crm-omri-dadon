/**
 * Supplier quotation scanning — page capture and extraction.
 *
 * The capture handlers are copied from the goods-receiving scanner
 * (DeliveryModal.jsx lines 482-528): the ten-page cap, the rule that a PDF is
 * a whole document and cannot be mixed with loose pages, the object-URL
 * cleanup, and front-to-back reordering. Those rules exist because a document
 * read out of order, or a PDF photographed alongside a phone picture, produces
 * a wrong import — and they are proven in daily use.
 *
 * It writes NOTHING. Extraction produces a draft which the review screen owns;
 * the document and its lines are only stored once a human has looked at them.
 */
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Upload, Camera, X, ArrowUp, ArrowDown, ScanLine, FileText } from "lucide-react";
import { toast } from "sonner";
import { MAX_PAGES, EXTRACTION_ERRORS } from "@/lib/quoteDocumentImage";
import { preparePages, extractQuotePages, buildDraftFromExtraction, documentContentHash } from "@/lib/quoteExtraction";
import { findExistingQuote } from "@/api/supplierQuotes";

const MUTED = "var(--heillo-text-muted)";
const DARK = "var(--heillo-text-primary)";

export default function QuoteScanPanel({ suppliers = [], onDraft, onOpenExisting }) {
  const [supplierId, setSupplierId] = useState("");
  const [pages, setPages] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState("");
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  // ── File pick — copied from DeliveryModal.handleFilePick ─────────────────
  const handleFilePick = (e) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length === 0) return;

    setPages(prev => {
      const next = [...prev];
      for (const f of selected) {
        if (next.length >= MAX_PAGES) {
          toast.error(EXTRACTION_ERRORS.too_many_pages);
          break;
        }
        // A PDF is a whole document: it cannot be mixed with loose pages, and
        // only one may be attached.
        const isPdf = f.type === "application/pdf";
        if ((isPdf && next.length > 0) || next.some(pg => pg.file.type === "application/pdf")) {
          toast.error("לא ניתן לשלב קובץ PDF עם עמודים נוספים");
          break;
        }
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file: f,
          previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
        });
      }
      return next;
    });

    e.target.value = "";
  };

  const removePage = (id) => {
    setPages(prev => {
      const target = prev.find(pg => pg.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter(pg => pg.id !== id);
    });
  };

  // Order matters: the document is read front to back.
  const movePage = (index, direction) => {
    setPages(prev => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleScan = async () => {
    if (!supplierId) { toast.error("בחר ספק"); return; }
    if (pages.length === 0) { toast.error("צרף לפחות עמוד אחד"); return; }

    setScanning(true);
    try {
      const files = pages.map(pg => pg.file);

      setProgress("מכין את העמודים...");
      const prepared = await preparePages(files);

      // The duplicate check runs BEFORE extraction, so a document already
      // imported costs neither an API call nor an upload.
      setProgress("בודק כפילויות...");
      const contentHash = await documentContentHash(prepared);
      const existing = await findExistingQuote({ supplierId, contentHash });
      if (existing) {
        toast.error("המסמך הזה כבר נסרק עבור ספק זה");
        onOpenExisting?.(existing);
        return;
      }

      setProgress("קורא את המסמך...");
      const extraction = await extractQuotePages(prepared);
      const draft = buildDraftFromExtraction(extraction);

      // The reference check needs the document number, which only exists after
      // extraction — so it runs here, before anything is written.
      if (draft.document.document_number && draft.document.quote_date) {
        const byRef = await findExistingQuote({
          supplierId,
          documentNumber: draft.document.document_number,
          quoteDate: draft.document.quote_date,
        });
        if (byRef) {
          toast.error(`מסמך ${draft.document.document_number} מתאריך זה כבר קיים`);
          onOpenExisting?.(byRef);
          return;
        }
      }

      onDraft?.({ supplierId, files, pages: prepared, contentHash, draft });
    } catch (err) {
      toast.error(EXTRACTION_ERRORS[err?.message] || err?.message || "הסריקה נכשלה");
    } finally {
      setScanning(false);
      setProgress("");
    }
  };

  const supplierName = suppliers.find(s => s.id === supplierId)?.name;

  return (
    <div className="heillo-card" style={{ padding: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: DARK, margin: "0 0 12px" }}>
        סריקת חשבונית או הצעת מחיר
      </h3>

      <div style={{ maxWidth: 320 }}>
        <Label style={{ fontSize: 12 }}>ספק *</Label>
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
          className="heillo-input" style={{ width: "100%", boxSizing: "border-box", marginTop: 4 }}>
          <option value="">— בחר ספק —</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={scanning}>
          <Upload style={{ width: 15, height: 15, marginInlineEnd: 6 }} /> צירוף קבצים
        </Button>
        <Button type="button" variant="outline" onClick={() => cameraInputRef.current?.click()} disabled={scanning}>
          <Camera style={{ width: 15, height: 15, marginInlineEnd: 6 }} /> צילום עמוד
        </Button>
        <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf"
          style={{ display: "none" }} onChange={handleFilePick} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment"
          style={{ display: "none" }} onChange={handleFilePick} />
      </div>

      <p style={{ fontSize: 11, color: MUTED, margin: "8px 0 0" }}>
        תמונה (JPG, PNG) או PDF · עד {MAX_PAGES} עמודים למסמך אחד · הסדר הוא סדר הקריאה
      </p>

      {pages.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
          {pages.map((pg, i) => (
            <div key={pg.id} style={{ display: "flex", alignItems: "center", gap: 10,
              border: "1px solid rgba(0,0,0,0.06)", borderRadius: 10, padding: 8 }}>
              <span style={{ fontSize: 12, color: MUTED, minWidth: 54 }}>עמוד {i + 1}</span>
              {pg.previewUrl
                ? <img src={pg.previewUrl} alt="" style={{ width: 40, height: 52, objectFit: "cover", borderRadius: 6 }} />
                : <FileText style={{ width: 20, height: 20, color: MUTED }} />}
              <span style={{ fontSize: 12, color: DARK, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {pg.file.name}
              </span>
              <button type="button" title="העלה" className="heillo-icon-btn" disabled={i === 0 || scanning}
                onClick={() => movePage(i, -1)}><ArrowUp size={15} /></button>
              <button type="button" title="הורד" className="heillo-icon-btn" disabled={i === pages.length - 1 || scanning}
                onClick={() => movePage(i, 1)}><ArrowDown size={15} /></button>
              <button type="button" title="הסר" className="heillo-icon-btn" style={{ color: "#ef4444" }}
                disabled={scanning} onClick={() => removePage(pg.id)}><X size={15} /></button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: MUTED }}>
          {scanning ? progress : supplierName ? `${supplierName} · ${pages.length} עמודים` : ""}
        </span>
        <Button onClick={handleScan} disabled={scanning || !supplierId || pages.length === 0}>
          <ScanLine style={{ width: 15, height: 15, marginInlineEnd: 6 }} />
          {scanning ? "סורק..." : "סרוק מסמך"}
        </Button>
      </div>

      <p style={{ fontSize: 11, color: MUTED, margin: "10px 0 0", lineHeight: 1.6 }}>
        הסריקה מזהה את שורות המוצרים, המק"טים, האריזה והמחירים. <strong>שום מחיר אינו נשמר לפני אישורך</strong> במסך הבדיקה.
        מחירי ההצעה אינם מעדכנים מחירי קנייה, מלאי או היסטוריית מחירי ספקים.
      </p>
    </div>
  );
}
