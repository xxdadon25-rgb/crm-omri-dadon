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
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Upload, Camera, X, ArrowUp, ArrowDown, ScanLine, FileText, FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { MAX_PAGES, EXTRACTION_ERRORS } from "@/lib/quoteDocumentImage";
import { preparePages, extractQuotePages, buildDraftFromExtraction, documentContentHash } from "@/lib/quoteExtraction";
import { findExistingQuote } from "@/api/supplierQuotes";

const MUTED = "var(--heillo-text-muted)";
const DARK = "var(--heillo-text-primary)";
const ACCENT = "#0891b2";

/** The types the file input already advertises via `accept`. A drop bypasses
 *  `accept` entirely, so the same set has to be enforced in code. */
const ACCEPTED_TYPES = "image/*,application/pdf";

function isSupported(file) {
  const type = file?.type || "";
  if (type.startsWith("image/") || type === "application/pdf") return true;
  // Some browsers report an empty type for an unusual extension; fall back to
  // the name so a legitimate .jpg is not rejected on a technicality.
  return /\.(jpe?g|png|webp|gif|heic|heif|pdf)$/i.test(file?.name || "");
}

/**
 * Merge newly chosen files into the existing page list.
 *
 * ONE implementation, used by the file input, the camera input AND the drop
 * zone, so "the drop does exactly what picking does" is structural rather than
 * two copies of the rules that drift apart. The rules are the goods-receiving
 * scanner's, carried over unchanged:
 *   * at most MAX_PAGES pages
 *   * a PDF is a whole document: it can neither join existing pages nor be
 *     joined by them
 * Both stop the batch where the original stops it, rather than silently
 * accepting part of a selection and reporting the rest.
 *
 * Unsupported files are SKIPPED rather than aborting the batch, because a drop
 * can easily include a stray file the user did not mean to send and losing the
 * good pages with it would be worse. There is no existing behaviour to preserve
 * here: the picker relied on `accept` and never validated types in code.
 *
 * Pure, and exported for tests: the errors are returned, not toasted, so the
 * caller raises each one exactly once. Toasting inside a state updater — as the
 * original does — can fire twice, because React may call an updater twice.
 */
export function mergeFiles(existing, incoming) {
  const next = [...existing];
  const errors = [];
  const added = [];

  for (const f of incoming) {
    if (!isSupported(f)) {
      errors.push(`הקובץ "${f?.name || "ללא שם"}" אינו נתמך — ניתן לצרף תמונה (JPG, PNG, WEBP) או PDF`);
      continue;
    }
    if (next.length >= MAX_PAGES) {
      errors.push(EXTRACTION_ERRORS.too_many_pages);
      break;
    }
    const isPdf = f.type === "application/pdf";
    if ((isPdf && next.length > 0) || next.some(pg => pg.file.type === "application/pdf")) {
      errors.push("לא ניתן לשלב קובץ PDF עם עמודים נוספים");
      break;
    }
    const page = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file: f,
      previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
    };
    next.push(page);
    added.push(page);
  }

  return { next, errors, added };
}

export default function QuoteScanPanel({ suppliers = [], onDraft, onOpenExisting }) {
  const [supplierId, setSupplierId] = useState("");
  const [pages, setPages] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  // Mirrors `pages` so the drag handlers can read the current list without
  // being re-created on every change.
  const pagesRef = useRef([]);

  // ── Adding files — ONE path for picking, photographing and dropping ─────
  const addFiles = useCallback((incoming) => {
    const selected = Array.from(incoming ?? []);
    if (selected.length === 0) return;

    // The merge is computed OUTSIDE the state updater so each error is shown
    // once; `pagesRef` holds the current list without making this callback
    // depend on it, which keeps the drop handlers stable.
    const { next, errors } = mergeFiles(pagesRef.current, selected);
    // Dedupe: a run of identical "too many pages" errors is one message.
    for (const msg of [...new Set(errors)]) toast.error(msg);
    if (next.length !== pagesRef.current.length) {
      pagesRef.current = next;
      setPages(next);
    }
  }, []);

  const handleFilePick = (e) => {
    addFiles(e.target.files);
    // Cleared so picking the same file twice in a row still fires onChange.
    e.target.value = "";
  };

  // ── Drag & drop ───────────────────────────────────────────────────────────
  // A COUNTER, not a boolean. dragenter/dragleave fire for every child element
  // the pointer crosses, so a boolean toggles off the moment the cursor moves
  // from the zone onto the text inside it and the highlight flickers. Counting
  // enters minus leaves is zero only when the pointer has genuinely left.
  const dragDepth = useRef(0);

  const onDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    setDragActive(true);
  };

  const onDragOver = (e) => {
    // Required: without preventDefault on dragover the drop event never fires
    // and the browser navigates to the file instead.
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };

  const onDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };

  const onDrop = (e) => {
    // Stops the browser opening the dropped file in this tab.
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragActive(false);
    if (scanning) return;
    // `files` preserves the order the user selected them in, which is the page
    // order the document is read in.
    addFiles(e.dataTransfer?.files);
  };

  const removePage = (id) => {
    const target = pagesRef.current.find(pg => pg.id === id);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    const next = pagesRef.current.filter(pg => pg.id !== id);
    pagesRef.current = next;
    setPages(next);
  };

  // Order matters: the document is read front to back.
  const movePage = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= pagesRef.current.length) return;
    const next = [...pagesRef.current];
    [next[index], next[target]] = [next[target], next[index]];
    pagesRef.current = next;
    setPages(next);
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

      {/* ── Drop zone ──────────────────────────────────────────────────────
          The handlers sit on the zone itself and stopPropagation, so a drag
          over the buttons inside it is still the zone's drag. It is also
          clickable, which is what makes it useful on a phone where there is no
          dragging: tapping it opens the same file picker. */}
      <div
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => { if (!scanning) fileInputRef.current?.click(); }}
        role="button"
        tabIndex={0}
        aria-label="גרור לכאן קבצים או לחץ לבחירה"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); }
        }}
        style={{
          marginTop: 14,
          border: `2px dashed ${dragActive ? ACCENT : "rgba(0,0,0,0.14)"}`,
          background: dragActive ? "rgba(8,145,178,0.07)" : "rgba(0,0,0,0.015)",
          borderRadius: 14,
          padding: "20px 16px",
          textAlign: "center",
          cursor: scanning ? "default" : "pointer",
          transition: "border-color 0.15s ease, background 0.15s ease",
        }}
      >
        <FilePlus2 style={{ width: 26, height: 26, color: dragActive ? ACCENT : MUTED, marginBottom: 6 }} />
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: dragActive ? ACCENT : DARK }}>
          {dragActive ? "שחרר כאן את הקבצים" : "גרור לכאן את עמודי החשבונית"}
        </p>
        <p style={{ margin: "4px 0 0", fontSize: 11, color: MUTED }}>
          או לחץ לבחירת קבצים מהמחשב
        </p>

        {/* The original two options, kept exactly as they were. The clicks are
            stopped so they do not also trigger the zone's own click. */}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <Button type="button" variant="outline" disabled={scanning}
            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
            <Upload style={{ width: 15, height: 15, marginInlineEnd: 6 }} /> צירוף קבצים
          </Button>
          <Button type="button" variant="outline" disabled={scanning}
            onClick={(e) => { e.stopPropagation(); cameraInputRef.current?.click(); }}>
            <Camera style={{ width: 15, height: 15, marginInlineEnd: 6 }} /> צילום עמוד
          </Button>
        </div>

        <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_TYPES}
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
