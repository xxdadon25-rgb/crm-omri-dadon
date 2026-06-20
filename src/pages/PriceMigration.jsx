import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/shared/PageHeader";
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";

const VAT_FACTOR = 1.18;
const BATCH_SIZE = 5;         // 5 products per batch
const ITEM_DELAY_MS = 300;    // 300ms between individual writes (avoids burst)
const BATCH_DELAY_MS = 4000;  // 4 seconds between batches
const RATE_LIMIT_RETRY_MS = 12000; // wait 12s then auto-retry on rate limit

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default function PriceMigration() {
  const queryClient = useQueryClient();

  const [migrating, setMigrating] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [progress, setProgress] = useState(null); // null = not started yet

  // useRef so the async loop can read the latest value without stale closure
  const stopRequestedRef = useRef(false);

  // Diagnostic log (shown in UI)
  const [diagLog, setDiagLog] = useState([]);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products-migration"],
    queryFn: () => base44.entities.Product.list(),
  });

  const pending = products.filter(p => !p.prices_migrated_to_net);
  const migrated = products.filter(p => p.prices_migrated_to_net);

  const handleMigrate = async () => {
    setMigrating(true);
    setStopped(false);
    stopRequestedRef.current = false;
    setDiagLog([]);

    // Step 1: Always fetch FRESH list from server (avoid stale cache)
    let freshProducts;
    try {
      freshProducts = await base44.entities.Product.list();
    } catch (err) {
      setMigrating(false);
      toast.error("שגיאה בטעינת מוצרים: " + err.message);
      return;
    }

    const freshPending = freshProducts.filter(p => !p.prices_migrated_to_net);
    const totalBatches = Math.ceil(freshPending.length / BATCH_SIZE);

    setDiagLog(prev => [...prev, `✅ נטענו ${freshProducts.length} מוצרים. ממתינים להמרה: ${freshPending.length}. Batches: ${totalBatches}`]);

    if (freshPending.length === 0) {
      setMigrating(false);
      setProgress({ converted: 0, failed: 0, currentBatch: 0, totalBatches: 0, done: true });
      toast.success("כל המוצרים כבר הומרו!");
      queryClient.invalidateQueries({ queryKey: ["products-migration"] });
      return;
    }

    // Initialize progress (don't reset if we're resuming — just re-anchor to fresh data)
    setProgress({ converted: 0, failed: 0, currentBatch: 0, totalBatches, done: false });

    let converted = 0;
    let failed = 0;
    let stoppedEarly = false;

    // Small pause before starting — let the list() request settle
    await sleep(500);

    let i = 0; // global product index, so rate-limit retry resumes from exact position
    while (i < freshPending.length) {
      // Read stop flag via ref (not stale state)
      if (stopRequestedRef.current) {
        stoppedEarly = true;
        setDiagLog(prev => [...prev, `⏸ עצירה התבקשה`]);
        break;
      }

      const batchIndex = Math.floor(i / BATCH_SIZE);
      const batch = freshPending.slice(i, i + BATCH_SIZE);
      const currentBatch = batchIndex + 1;
      const totalBatchesCalc = Math.ceil(freshPending.length / BATCH_SIZE);

      setProgress(prev => ({ ...prev, currentBatch, totalBatches: totalBatchesCalc }));
      setDiagLog(prev => [...prev, `⚙️ Batch ${currentBatch}/${totalBatchesCalc}: ${batch.length} מוצרים (אינדקס ${i}–${i + batch.length - 1})`]);

      let rateLimitHit = false;
      let rateLimitProduct = null;

      for (const p of batch) {
        if (stopRequestedRef.current) { stoppedEarly = true; break; }

        try {
          const newSell = (p.sell_price && p.sell_price > 0)
            ? parseFloat((p.sell_price / VAT_FACTOR).toFixed(4))
            : p.sell_price;

          await base44.entities.Product.update(p.id, {
            sell_price: newSell,
            prices_migrated_to_net: true,
          });
          converted++;
          i++; // advance only on success
          setProgress(prev => ({ ...prev, converted }));

          // Per-item delay to avoid burst triggering rate limit
          await sleep(ITEM_DELAY_MS);

        } catch (err) {
          const msg = err?.message || String(err);

          if (msg.toLowerCase().includes("rate limit")) {
            rateLimitHit = true;
            rateLimitProduct = p.name;
            // Do NOT increment i — will retry this product after wait
            break;
          }

          // Non-rate-limit error: log, skip product, continue
          setDiagLog(prev => [...prev, `❌ שגיאה: ${msg} (מוצר: ${p.name})`]);
          failed++;
          i++; // skip this product
          setProgress(prev => ({ ...prev, failed }));
          await sleep(ITEM_DELAY_MS);
        }
      }

      if (stoppedEarly) break;

      if (rateLimitHit) {
        // Auto-retry: wait and continue from exact same product (i not advanced)
        setDiagLog(prev => [...prev, `⚠️ Rate limit! ממתין ${RATE_LIMIT_RETRY_MS / 1000} שניות ומנסה שוב... (מוצר: ${rateLimitProduct})`]);
        toast.warning(`Rate limit — ממתין ${RATE_LIMIT_RETRY_MS / 1000} שניות ומנסה אוטומטית...`);
        await sleep(RATE_LIMIT_RETRY_MS);
        setDiagLog(prev => [...prev, `🔄 מנסה שוב...`]);
        // Loop continues — i was NOT incremented, so same product retried
        continue;
      }

      // Between batches delay (skip after last)
      if (i < freshPending.length) {
        setDiagLog(prev => [...prev, `⏳ ממתין ${BATCH_DELAY_MS / 1000} שניות...`]);
        await sleep(BATCH_DELAY_MS);
      }
    }

    setMigrating(false);

    // Refresh product list so pending count updates
    queryClient.invalidateQueries({ queryKey: ["products-migration"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });

    if (stoppedEarly) {
      setStopped(true);
      setProgress(prev => ({ ...prev, done: false }));
      setDiagLog(prev => [...prev, `⏸ נעצר. הומרו: ${converted}, נכשלו: ${failed}`]);
      toast.warning(`נעצר — ${converted} הומרו, ${freshPending.length - converted} נותרו`);
    } else {
      setProgress(prev => ({ ...prev, done: true }));
      setDiagLog(prev => [...prev, `✅ הושלם! הומרו: ${converted}, נכשלו: ${failed}`]);
      toast.success(`המרה הושלמה — ${converted} מוצרים הומרו`);
    }
  };

  const handleStop = () => {
    stopRequestedRef.current = true;
    toast("בקשת עצירה התקבלה — יסתיים לאחר ה-batch הנוכחי");
  };

  const progressPercent = (progress && progress.totalBatches > 0)
    ? Math.round((progress.currentBatch / progress.totalBatches) * 100)
    : 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="מיגרציית מחירים — המרה לפני מע״מ"
        description="כלי להמרת מחירי מכירה מכולל מע״מ לפני מע״מ. עיבוד ב-batches בטוחים."
      />

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-3xl font-bold">{products.length}</div>
          <div className="text-sm text-muted-foreground mt-1">סה״כ מוצרים</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-amber-700">{pending.length}</div>
          <div className="text-sm text-amber-600 mt-1">ממתינים להמרה</div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-green-700">{migrated.length}</div>
          <div className="text-sm text-green-600 mt-1">כבר הומרו</div>
        </div>
      </div>

      {pending.length === 0 && !migrating ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 flex items-center gap-3">
          <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
          <div>
            <div className="font-semibold text-green-800">כל המוצרים כבר הומרו</div>
            <div className="text-sm text-green-600 mt-0.5">המערכת מוגדרת לעבוד עם מחירים לפני מע״מ.</div>
          </div>
        </div>
      ) : (
        <>
          {/* Warning */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <div className="font-semibold mb-1">רק מחיר מכירה יומר (÷1.18) — מחיר הקנייה לא יישנה</div>
              <div>
                עיבוד ב-batches של {BATCH_SIZE} מוצרים עם {ITEM_DELAY_MS}ms בין כל מוצר ו-{BATCH_DELAY_MS / 1000} שניות בין batches.<br />
                בעת Rate Limit: המתנה אוטומטית של {RATE_LIMIT_RETRY_MS / 1000} שניות וניסיון חוזר ללא צורך בלחיצה.<br />
                בכל הפעלה נטענת רשימה עדכנית — מוצרים שהומרו כבר לא יעובדו שוב.
              </div>
            </div>
          </div>

          {/* Live Progress */}
          {progress && (
            <div className="bg-card border border-border rounded-xl p-5 mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">
                  {progress.done ? "✅ המרה הושלמה" : stopped ? "⏸ המרה נעצרה" : `⚙️ Batch ${progress.currentBatch}/${progress.totalBatches}`}
                </h3>
                <span className="text-sm font-bold text-primary">{progressPercent}%</span>
              </div>

              <div className="w-full bg-muted rounded-full h-3 mb-4 overflow-hidden">
                <div
                  className="h-3 rounded-full transition-all duration-300"
                  style={{
                    width: `${progressPercent}%`,
                    backgroundColor: progress.done ? "#16a34a" : stopped ? "#f59e0b" : "#eab308"
                  }}
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center mb-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="text-xl font-bold text-green-700">{progress.converted}</div>
                  <div className="text-xs text-green-600">הומרו בהצלחה</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="text-xl font-bold text-amber-700">{Math.max(0, (progress.totalBatches * BATCH_SIZE) - progress.converted)}</div>
                  <div className="text-xs text-amber-600">נותרו (משוער)</div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="text-xl font-bold text-blue-700">{progress.currentBatch}/{progress.totalBatches}</div>
                  <div className="text-xs text-blue-600">batch נוכחי</div>
                </div>
                <div className={`rounded-lg p-3 border ${progress.failed > 0 ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"}`}>
                  <div className={`text-xl font-bold ${progress.failed > 0 ? "text-red-700" : "text-slate-400"}`}>{progress.failed}</div>
                  <div className={`text-xs ${progress.failed > 0 ? "text-red-600" : "text-slate-400"}`}>שגיאות</div>
                </div>
              </div>

              {/* Diagnostic log */}
              {diagLog.length > 0 && (
                <div className="bg-slate-900 rounded-lg p-3 max-h-40 overflow-y-auto">
                  {diagLog.map((line, i) => (
                    <div key={i} className="text-xs text-slate-300 font-mono leading-5">{line}</div>
                  ))}
                </div>
              )}

              {stopped && !progress.done && (
                <div className="mt-3 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>המיגרציה נעצרה. לחץ "המשך המרה" — תיטען רשימה מעודכנת ויוסיפו המרה מהמקום שנעצר.</span>
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-3 flex-wrap">
            {progress?.done ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3 w-full">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <span className="font-semibold text-green-800">המרה הושלמה! {progress.converted} מוצרים הומרו.</span>
              </div>
            ) : (
              <>
                <Button
                  onClick={handleMigrate}
                  disabled={migrating}
                  className="bg-amber-500 hover:bg-amber-600 text-white gap-2"
                  size="lg"
                >
                  {migrating ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" /> ממיר...</>
                  ) : stopped ? (
                    <>המשך המרה</>
                  ) : (
                    <>אשר והפעל המרה עבור {pending.length} מוצרים</>
                  )}
                </Button>

                {migrating && (
                  <Button
                    variant="outline"
                    onClick={handleStop}
                    className="border-red-200 text-red-600 hover:bg-red-50"
                  >
                    עצור לאחר ה-batch הנוכחי
                  </Button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}