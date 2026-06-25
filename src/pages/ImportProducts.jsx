import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import PageHeader from "@/components/shared/PageHeader";
import UploadZone from "@/components/import/UploadZone";
import CsvPreview from "@/components/import/CsvPreview";
import ColumnMapper from "@/components/import/ColumnMapper";
import ImportProgress from "@/components/import/ImportProgress";
import ImportLogsTable from "@/components/import/ImportLogsTable";
import { Button } from "@/components/ui/button";
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

        if (mapped.category) {
          const firstCat = mapped.category.split(",")[0].trim();
          if (firstCat) {
            if (!catMap[firstCat]) {
              const newCat = await withRetry(() => base44.entities.Category.create({ name: firstCat }));
              catMap[firstCat] = newCat.id;
            }
            productData.category = firstCat;
            productData.category_id = catMap[firstCat];
          }
        }

        try {
          const existingSku = productData.sku && skuMap[productData.sku];
          if (existingSku) {
            await withRetry(() => base44.entities.Product.update(existingSku.id, productData));
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
    <div>
      <PageHeader title="ייבוא מוצרים" description="ייבוא ועדכון מוצרים מ-WooCommerce CSV">
        <Button variant="outline" size="sm" onClick={downloadTemplate}>
          <Download className="w-4 h-4 ml-1" /> הורד תבנית
        </Button>
        {step !== "upload" && (
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="w-4 h-4 ml-1" /> התחל מחדש
          </Button>
        )}
      </PageHeader>

      <div className="space-y-6 max-w-4xl">

        {/* Step 1: Upload */}
        {step === "upload" && (
          <div className="bg-card border border-border rounded-xl p-6">
            <UploadZone onFile={handleFile} />
          </div>
        )}

        {/* Step 2: Preview + Mapping */}
        {step === "preview" && csvData && (
          <>
            <CsvPreview headers={csvData.headers} rows={csvData.rows} />
            <ColumnMapper headers={csvData.headers} mapping={mapping} onChange={setMapping} />
            <div className="flex justify-end">
              <Button onClick={runImport} size="lg">
                <Play className="w-4 h-4 ml-2" />
                התחל ייבוא ({csvData.rows.length} מוצרים)
              </Button>
            </div>
          </>
        )}

        {/* Step 3 & 4: Progress / Done */}
        {(step === "importing" || step === "done") && (
          <>
            <ImportProgress progress={progress} stats={stats} />
            {step === "done" && (
              <div className="flex gap-3 justify-end">
                <Button variant="outline" onClick={reset}>
                  <RotateCcw className="w-4 h-4 ml-1" /> ייבוא נוסף
                </Button>
                <Button onClick={() => window.location.href = "/inventory"}>
                  צפה במלאי
                </Button>
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