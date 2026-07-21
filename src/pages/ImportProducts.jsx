import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import UploadZone from "@/components/import/UploadZone";
import CsvPreview from "@/components/import/CsvPreview";
import ColumnMapper from "@/components/import/ColumnMapper";
import ImportProgress from "@/components/import/ImportProgress";
import ImportLogsTable from "@/components/import/ImportLogsTable";
import { parseCSV, autoDetectMapping, applyMapping, stripHtml } from "@/lib/csvParser";
import { toast } from "sonner";
import { Play, RotateCcw, Download } from "lucide-react";

const BATCH_SIZE = 10;
const DELAY_BETWEEN_ITEMS_MS = 200;
const DELAY_BETWEEN_BATCHES_MS = 500;
const RATE_LIMIT_RETRY_DELAY_MS = 2500;
const MAX_RETRIES = 3;
const LS_KEY = "import_progress";

// Retry wrapper — backs off on rate limit errors
async function withRetry(fn, maxRetries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err?.message?.toLowerCase().includes("rate limit") ||
                          err?.status === 429 || err?.response?.status === 429;
      if (isRateLimit && attempt < maxRetries) {
        const delay = RATE_LIMIT_RETRY_DELAY_MS * (attempt + 1);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

export default function ImportProducts() {
  const queryClient = useQueryClient();

  const [step, setStep] = useState("upload");
  const [csvData, setCsvData] = useState(null);
  const [mapping, setMapping] = useState({});
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0, startedAt: null, retrying: false });
  const [stats, setStats] = useState({ created: 0, updated: 0, failed: 0, errors: [] });
  const abortRef = useRef(false);

  const handleFile = useCallback((file) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const parsed = parseCSV(text);
      if (parsed.rows.length === 0) { toast.error("הקובץ ריק או בפורמט שגוי"); return; }
      const detectedMapping = autoDetectMapping(parsed.headers);
      setCsvData(parsed);
      setMapping(detectedMapping);
      setStep("preview");
    };
    reader.readAsText(file, "UTF-8");
  }, []);

  const reset = () => {
    abortRef.current = true;
    localStorage.removeItem(LS_KEY);
    setStep("upload");
    setCsvData(null);
    setMapping({});
    setFileName("");
    setProgress({ done: 0, total: 0, startedAt: null, retrying: false });
    setStats({ created: 0, updated: 0, failed: 0, errors: [] });
  };

  const runImport = async () => {
    if (!csvData) return;
    abortRef.current = false;
    setStep("importing");

    const rows = csvData.rows;
    const total = rows.length;
    const startedAt = Date.now();

    // Load all existing products for SKU dedup (paginated)
    let existingProducts = [];
    let pg = 0;
    while (true) {
      const batch = await withRetry(() => base44.entities.Product.list(null, 500, pg * 500));
      existingProducts = existingProducts.concat(batch);
      if (batch.length < 500) break;
      pg++;
    }
    const skuMap = {};
    existingProducts.forEach((p) => { if (p.sku) skuMap[p.sku.trim()] = p; });

    // Load all categories
    const existingCategories = await withRetry(() => base44.entities.Category.list());
    const catMap = {};
    existingCategories.forEach((c) => { catMap[c.name.trim()] = c.id; });

    // Resume from localStorage if same file
    let savedState = null;
    try { savedState = JSON.parse(localStorage.getItem(LS_KEY)); } catch {}
    const isSameFile = savedState?.fileName === fileName;

    let logId = isSameFile ? savedState?.logId : null;
    let startIndex = isSameFile ? (savedState?.lastIndex ?? 0) : 0;
    const localStats = isSameFile
      ? { ...(savedState?.stats || { created: 0, updated: 0, failed: 0, errors: [] }) }
      : { created: 0, updated: 0, failed: 0, errors: [] };

    if (!logId) {
      const logRecord = await withRetry(() => base44.entities.ImportLog.create({
        import_type: "מוצרים",
        file_name: fileName,
        total_rows: total,
        success_rows: 0,
        updated_rows: 0,
        failed_rows: 0,
        status: "בתהליך",
      }));
      logId = logRecord.id;
    }

    setProgress({ done: startIndex, total, startedAt, retrying: false });
    setStats({ ...localStats });
    localStorage.setItem(LS_KEY, JSON.stringify({ fileName, logId, lastIndex: startIndex, stats: localStats }));

    // Process row by row, batch checkpoints every BATCH_SIZE
    for (let i = startIndex; i < rows.length; i++) {
      if (abortRef.current) break;

      const rowNum = i + 1;
      const mapped = applyMapping(rows[i], mapping);
      const name = (mapped.name || "").trim();

      if (!name) {
        localStats.failed++;
        localStats.errors.push(`שורה ${rowNum}: שם מוצר חסר`);
      } else {
        // Full payload used for CREATE (includes defaults for required fields)
        const productData = {
          name,
          sku: (mapped.sku || "").trim() || undefined,
          barcode: (mapped.barcode || "").trim() || undefined,
          supplier: (mapped.supplier || "").trim() || undefined,
          buy_price: mapped.buy_price ? parseFloat(mapped.buy_price) || 0 : undefined,
          sell_price: mapped.sell_price ? parseFloat(mapped.sell_price) || 0 : 0,
          description: stripHtml(mapped.description || ""),
          notes: stripHtml(mapped.short_description || ""),
          image_url: (mapped.image_url || "").split(",")[0].trim() || undefined,
          tags: mapped.tags || undefined,
          quantity: mapped.quantity ? parseInt(mapped.quantity) || 0 : 0,
          min_quantity: mapped.min_quantity ? parseInt(mapped.min_quantity) || 0 : undefined,
          is_active: true,
        };

        // Sparse payload used for UPDATE — only fields the user actually mapped,
        // so unmapped columns are left unchanged in the existing record.
        const updateData = { name };
        if (mapped.sku !== undefined)              updateData.sku              = (mapped.sku || "").trim() || undefined;
        if (mapped.barcode !== undefined)          updateData.barcode          = (mapped.barcode || "").trim() || undefined;
        if (mapped.supplier !== undefined)         updateData.supplier         = (mapped.supplier || "").trim() || undefined;
        if (mapped.buy_price !== undefined)        updateData.buy_price        = (mapped.buy_price || "").trim() ? parseFloat(mapped.buy_price) : undefined;
        if (mapped.sell_price !== undefined)       updateData.sell_price       = (mapped.sell_price || "").trim() ? parseFloat(mapped.sell_price) : undefined;
        if (mapped.description !== undefined)      updateData.description      = stripHtml(mapped.description);
        if (mapped.short_description !== undefined) updateData.notes           = stripHtml(mapped.short_description);
        if (mapped.image_url !== undefined)        updateData.image_url        = (mapped.image_url || "").split(",")[0].trim() || undefined;
        if (mapped.tags !== undefined)             updateData.tags             = mapped.tags || undefined;
        if (mapped.quantity !== undefined)         updateData.quantity         = (mapped.quantity || "").trim() ? parseInt(mapped.quantity) : undefined;
        if (mapped.min_quantity !== undefined)     updateData.min_quantity     = (mapped.min_quantity || "").trim() ? parseInt(mapped.min_quantity) : undefined;

        if (mapped.category) {
          const firstCat = mapped.category.split(",")[0].trim();
          if (firstCat) {
            if (!catMap[firstCat]) {
              const newCat = await withRetry(() => base44.entities.Category.create({ name: firstCat }));
              catMap[firstCat] = newCat.id;
            }
            productData.category = firstCat;
            productData.category_id = catMap[firstCat];
            updateData.category = firstCat;
            updateData.category_id = catMap[firstCat];
          }
        }

        try {
          const existingSku = productData.sku && skuMap[productData.sku];
          if (existingSku) {
            await withRetry(() => base44.entities.Product.update(existingSku.id, updateData));
            localStats.updated++;
          } else {
            const created = await withRetry(() => base44.entities.Product.create(productData));
            if (productData.sku) skuMap[productData.sku] = created;
            localStats.created++;
          }
        } catch (err) {
          localStats.failed++;
          localStats.errors.push(`שורה ${rowNum}: ${err.message || "שגיאה לא ידועה"}`);
        }

        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_ITEMS_MS));
      }

      // Every BATCH_SIZE items: update UI, save progress, update log
      const isBatchEnd = (i + 1) % BATCH_SIZE === 0 || i === rows.length - 1;
      if (isBatchEnd) {
        setProgress({ done: i + 1, total, startedAt, retrying: false });
        setStats({ ...localStats });

        localStorage.setItem(LS_KEY, JSON.stringify({
          fileName, logId, lastIndex: i + 1, stats: localStats
        }));

        await withRetry(() => base44.entities.ImportLog.update(logId, {
          success_rows: localStats.created,
          updated_rows: localStats.updated,
          failed_rows: localStats.failed,
          status: "בתהליך",
        }));

        // Pause between batches to reduce API pressure
        if (i < rows.length - 1) {
          await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
        }
      }
    }

    if (abortRef.current) return;

    // Finalize log
    const finalStatus = localStats.failed > 0
      ? (localStats.created + localStats.updated > 0 ? "הושלם עם שגיאות" : "נכשל")
      : "הושלם";

    await withRetry(() => base44.entities.ImportLog.update(logId, {
      success_rows: localStats.created,
      updated_rows: localStats.updated,
      failed_rows: localStats.failed,
      status: finalStatus,
      error_details: localStats.errors.slice(0, 50).join("\n"),
    }));

    localStorage.removeItem(LS_KEY);
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["import-logs"] });
    setStep("done");
    toast.success(`ייבוא הושלם: ${localStats.created} נוצרו, ${localStats.updated} עודכנו`);
  };

  const downloadTemplate = () => {
    const csv = 'שם,מק"ט,מחיר רגיל,קטגוריות,תיאור,מלאי\nמוצר לדוגמה,SKU001,19.90,קטגוריה,תיאור מוצר,100';
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "template_products.csv"; a.click();
  };

  return (
    /* OLD: <div> */
    <div className="heillo-page" dir="rtl">

      {/* ── Top bar ── */}
      {/* OLD: <PageHeader title="ייבוא מוצרים" ...><Button>הורד תבנית</Button>...</PageHeader> */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, gap: 12, flexWrap: "wrap", fontFamily: "'Heebo', sans-serif" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--heillo-text-primary)", margin: 0 }}>ייבוא מוצרים</h1>
          <p style={{ fontSize: 13, color: "var(--heillo-text-muted)", margin: "2px 0 0" }}>ייבוא ועדכון מוצרים מ-WooCommerce CSV</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={downloadTemplate}
            style={{ background: "#FFFFFF", color: "var(--heillo-text-primary)", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, fontWeight: 500, padding: "7px 14px", fontSize: 13, fontFamily: "'Heebo', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
            onMouseEnter={e => e.currentTarget.style.background = "#F8F8FA"}
            onMouseLeave={e => e.currentTarget.style.background = "#FFFFFF"}
          >
            <Download style={{ width: 15, height: 15 }} /> הורד תבנית
          </button>
          {step !== "upload" && (
            <button
              onClick={reset}
              style={{ background: "transparent", color: "var(--heillo-text-muted)", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, fontWeight: 500, padding: "7px 14px", fontSize: 13, fontFamily: "'Heebo', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.04)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <RotateCcw style={{ width: 15, height: 15 }} /> התחל מחדש
            </button>
          )}
        </div>
      </div>

      {/* OLD: <div className="space-y-6 max-w-4xl"> */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 }}>

        {/* Step 1: Upload */}
        {step === "upload" && (
          /* OLD: <div className="bg-card border border-border rounded-xl p-6"> */
          <div className="heillo-card" style={{ padding: 32 }}>
            <UploadZone onFile={handleFile} />
          </div>
        )}

        {/* Step 2: Preview + Mapping */}
        {step === "preview" && csvData && (
          <>
            <CsvPreview headers={csvData.headers} rows={csvData.rows} />
            <ColumnMapper headers={csvData.headers} mapping={mapping} onChange={setMapping} />
            {/* OLD: <div className="flex justify-end"><Button onClick={runImport} size="lg">...</Button></div> */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={runImport} className="heillo-btn-primary" style={{ fontSize: 14, padding: "10px 24px", display: "flex", alignItems: "center", gap: 8 }}>
                <Play style={{ width: 16, height: 16 }} />
                התחל ייבוא ({csvData.rows.length} מוצרים)
              </button>
            </div>
          </>
        )}

        {/* Step 3 & 4: Progress / Done */}
        {(step === "importing" || step === "done") && (
          <>
            <ImportProgress progress={progress} stats={stats} />
            {step === "done" && (
              /* OLD: <div className="flex gap-3 justify-end"> */
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  onClick={reset}
                  style={{ background: "#FFFFFF", color: "var(--heillo-text-primary)", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, fontWeight: 500, padding: "8px 18px", fontSize: 13, fontFamily: "'Heebo', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                  onMouseEnter={e => e.currentTarget.style.background = "#F8F8FA"}
                  onMouseLeave={e => e.currentTarget.style.background = "#FFFFFF"}
                >
                  <RotateCcw style={{ width: 15, height: 15 }} /> ייבוא נוסף
                </button>
                <button className="heillo-btn-primary" onClick={() => window.location.href = "/inventory"} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  צפה במלאי
                </button>
              </div>
            )}
          </>
        )}

        {/* Import Logs — always visible */}
        <ImportLogsTable />
      </div>
    </div>
  );
}