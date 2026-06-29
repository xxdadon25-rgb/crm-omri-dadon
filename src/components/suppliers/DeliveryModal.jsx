// updated buttons - force redeploy
import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import { Upload, Camera, X, Loader2, CheckCircle, AlertTriangle, PackagePlus } from "lucide-react";

// ── Claude API ────────────────────────────────────────────────────────────────

async function extractFromFile(file, onRetry) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("מפתח VITE_GEMINI_API_KEY חסר ב-.env.local");

  const base64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  const prompt = `זוהי תעודת משלוח או חשבונית ספק. חלץ את כל פריטי המוצרים.
החזר תשובה כ-JSON בלבד. אין להוסיף \`\`\`json או \`\`\` או כל טקסט אחר. רק מערך JSON טהור.
פורמט נדרש:
[{"product_name":"שם המוצר","sku":"מק\"ט או null","quantity":1,"unit_price":0,"total":0}]
אם שדה חסר השתמש ב-null.`;

  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const fetchBody = JSON.stringify({
    contents: [{
      parts: [
        { inline_data: { mime_type: file.type, data: base64 } },
        { text: prompt },
      ],
    }],
    generationConfig: { temperature: 0, maxOutputTokens: 8192 },
  });

  const fetchOpts = { method: "POST", headers: { "content-type": "application/json" }, body: fetchBody };
  let resp = await fetch(GEMINI_URL, fetchOpts);

  const MAX_RETRIES = 3;
  let attempt = 0;
  while (resp.status === 503 && attempt < MAX_RETRIES) {
    attempt++;
    onRetry?.(attempt, MAX_RETRIES);
    await new Promise(res => setTimeout(res, 5000));
    resp = await fetch(GEMINI_URL, fetchOpts);
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `שגיאת API (${resp.status})`);
  }

  const data = await resp.json();
  console.log('Gemini raw response:', JSON.stringify(data, null, 2));
  const candidate = data.candidates?.[0];
  const rawText = candidate?.content?.parts?.[0]?.text ?? "";
  const finishReason = candidate?.finishReason;

  // Strip markdown code fences if Gemini added them despite instructions
  const text = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("לא ניתן לחלץ נתונים מהמסמך");

  try {
    return JSON.parse(match[0]);
  } catch (error) {
    console.log('Parse error:', error);
    // If truncated due to token limit, recover all complete objects before the cutoff
    if (finishReason === "MAX_TOKENS") {
      const partial = match[0];
      const lastClose = partial.lastIndexOf("}");
      if (lastClose !== -1) {
        try {
          return JSON.parse(partial.slice(0, lastClose + 1) + "]");
        } catch (e) {
          console.log('Partial parse error:', e);
        }
      }
    }
    throw new Error("שגיאה בפענוח תשובת ה-AI");
  }
}

// ── Product matching ──────────────────────────────────────────────────────────

function matchProducts(extractedItems, products) {
  return extractedItems.map((item) => {
    const bySkuLower = (item.sku || "").toLowerCase().trim();
    const byNameLower = (item.product_name || "").toLowerCase().trim();

    let matched = null;
    if (bySkuLower) matched = products.find(p => (p.sku || "").toLowerCase().trim() === bySkuLower);
    if (!matched && byNameLower)
      matched = products.find(p => (p.name || "").toLowerCase().trim() === byNameLower);

    const priceChanged = !!(matched && item.unit_price != null && matched.buy_price != null && Math.abs(Number(item.unit_price) - Number(matched.buy_price)) > 0.01);
    console.log('[matchProducts]', item.sku, '| gemini price:', item.unit_price, '| supabase buy_price:', matched?.buy_price, '| priceChanged:', priceChanged);

    return {
      ...item,
      quantity: item.quantity ?? 1,
      unit_price: item.unit_price ?? 0,
      total: item.total ?? 0,
      matched,
      priceChanged,
      skip: false,
    };
  });
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DeliveryModal({ supplier, open, onClose }) {
  const [step, setStep] = useState("upload"); // upload | processing | review | saving | done
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [items, setItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [newProductsDialog, setNewProductsDialog] = useState(false);
  const [retryMsg, setRetryMsg] = useState("");
  const [priceQueue, setPriceQueue] = useState([]);
  const [priceQueueIdx, setPriceQueueIdx] = useState(0);
  const [priceDecisions, setPriceDecisions] = useState({});
  const [addNewPending, setAddNewPending] = useState(false);
  const fileInputRef = useRef();
  const videoRef = useRef();
  const streamRef = useRef();

  // Load products for matching
  useEffect(() => {
    if (!open) return;
    supabase.from("products").select("id,name,sku,buy_price,quantity")
      .then(({ data }) => setProducts(data ?? []));
  }, [open]);

  const reset = () => {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setItems([]);
    setSummary(null);
    stopCamera();
  };

  const handleClose = () => { reset(); onClose(); };

  // ── Camera ────────────────────────────────────────────────────────────────

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraActive(true);
    } catch {
      toast.error("לא ניתן לגשת למצלמה");
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  const capturePhoto = () => {
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d").drawImage(videoRef.current, 0, 0);
    canvas.toBlob((blob) => {
      const f = new File([blob], "camera.jpg", { type: "image/jpeg" });
      setFile(f);
      setPreview(URL.createObjectURL(f));
      stopCamera();
    }, "image/jpeg", 0.9);
  };

  // ── File pick ─────────────────────────────────────────────────────────────

  const handleFilePick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    if (f.type.startsWith("image/")) setPreview(URL.createObjectURL(f));
    else setPreview(null);
  };

  // ── Process ───────────────────────────────────────────────────────────────

  const handleProcess = async () => {
    if (!file) return;
    setStep("processing");
    setRetryMsg("");
    try {
      const extracted = await extractFromFile(file, (attempt, max) => {
        setRetryMsg(`השרת עמוס, מנסה שוב (${attempt}/${max})...`);
      });
      if (!extracted.length) throw new Error("לא נמצאו פריטים במסמך");
      setRetryMsg("");
      setItems(matchProducts(extracted, products));
      setStep("review");
    } catch (err) {
      toast.error("שגיאה בניתוח: " + err.message);
      setRetryMsg("");
      setStep("upload");
    }
  };

  // ── Editable items ────────────────────────────────────────────────────────

  const updateItem = (i, field, val) => {
    setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  };

  // ── Approve ───────────────────────────────────────────────────────────────

  const unmatched = items.filter(i => !i.skip && !i.matched);

  const handleApprove = () => {
    if (unmatched.length > 0) {
      setNewProductsDialog(true);
    } else {
      handleSave(false);
    }
  };

  const handleSave = (addNew) => {
    setNewProductsDialog(false);
    setAddNewPending(addNew);
    console.log('[handleSave] all items:', items.map(i => ({
      product_name: i.product_name,
      skip: i.skip,
      matched: i.matched?.name,
      priceChanged: i.priceChanged,
      unit_price: i.unit_price,
      matched_buy_price: i.matched?.buy_price,
    })));
    const changedItems = items.filter(i => !i.skip && i.matched && i.priceChanged);
    console.log('[handleSave] changedItems count:', changedItems.length);
    if (changedItems.length > 0) {
      setPriceQueue(changedItems);
      setPriceQueueIdx(0);
      setPriceDecisions({});
    } else {
      executeSave(addNew, {});
    }
  };

  const handlePriceDecision = (updatePrice) => {
    const item = priceQueue[priceQueueIdx];
    const newDecisions = { ...priceDecisions, [item.matched.id]: updatePrice };
    const nextIdx = priceQueueIdx + 1;
    console.log('[handlePriceDecision] item:', item.matched?.name, 'updatePrice:', updatePrice, 'nextIdx:', nextIdx, 'queueLen:', priceQueue.length);
    if (nextIdx >= priceQueue.length) {
      console.log('[handlePriceDecision] queue done, calling executeSave with decisions:', newDecisions);
      setPriceQueue([]);
      executeSave(addNewPending, newDecisions);
    } else {
      setPriceDecisions(newDecisions);
      setPriceQueueIdx(nextIdx);
    }
  };

  const handleBackToReview = () => {
    setPriceQueue([]);
    setPriceDecisions({});
    setPriceQueueIdx(0);
  };

  const executeSave = async (addNew, decisions) => {
    console.log('[executeSave] called with addNew:', addNew, 'decisions:', decisions);
    setStep("saving");
    const now = new Date().toISOString();
    let updatedCount = 0;
    let priceChanges = 0;
    let addedCount = 0;

    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Insert delivery record
      const { data: delivery, error: delErr } = await supabase
        .from("supplier_deliveries")
        .insert({ supplier_id: supplier.id, delivery_date: now, file_url: null, status: "הושלם", created_at: now, user_id: user?.id })
        .select()
        .single();
      if (delErr) throw delErr;

      for (const item of items) {
        if (item.skip) continue;

        if (item.matched) {
          const qty = Number(item.quantity) || 0;
          const price = Number(item.unit_price) || 0;
          const newQty = (Number(item.matched.quantity) || 0) + qty;
          const updatePayload = { quantity: newQty };
          if (item.priceChanged && decisions[item.matched.id] === true) {
            updatePayload.buy_price = price;
            priceChanges++;
          }
          console.log('[executeSave] updating product:', item.matched.id, 'payload:', updatePayload, 'existing qty:', item.matched.quantity, 'added qty:', qty);
          const { error: updateErr } = await supabase.from("products").update(updatePayload).eq("id", item.matched.id);
          console.log('[executeSave] update result error:', updateErr);
          updatedCount++;
          await supabase.from("supplier_price_history").insert({
            product_id: item.matched.id,
            supplier_id: supplier.id,
            price,
            delivery_id: delivery.id,
            recorded_at: now,
            user_id: user?.id,
          });
        } else if (addNew) {
          const { data: newProduct } = await supabase.from("products").insert({
            name: item.product_name || "מוצר חדש",
            sku: item.sku || null,
            buy_price: Number(item.unit_price) || 0,
            sell_price: 0,
            quantity: Number(item.quantity) || 0,
            supplier_id: supplier.id,
            supplier: supplier.name,
            user_id: user?.id,
          }).select().single();
          if (newProduct) {
            await supabase.from("supplier_price_history").insert({
              product_id: newProduct.id,
              supplier_id: supplier.id,
              price: Number(item.unit_price) || 0,
              delivery_id: delivery.id,
              recorded_at: now,
              user_id: user?.id,
            });
          }
          addedCount++;
        }
      }

      setSummary({ updatedCount, priceChanges, addedCount });
      setStep("done");
    } catch (err) {
      toast.error("שגיאה בשמירה: " + err.message);
      setStep("review");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>קבלת סחורה — {supplier?.name}</DialogTitle>
        </DialogHeader>

        {/* ── Upload ── */}
        {step === "upload" && (
          <div className="space-y-4 mt-2">
            {cameraActive ? (
              <div className="space-y-3">
                <video ref={videoRef} autoPlay playsInline className="w-full rounded-lg bg-black" />
                <div className="flex gap-2 justify-center">
                  <Button onClick={capturePhoto}><Camera className="w-4 h-4 ml-1" /> צלם</Button>
                  <Button variant="outline" onClick={stopCamera}><X className="w-4 h-4 ml-1" /> ביטול</Button>
                </div>
              </div>
            ) : (
              <>
                <div
                  className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                  <p className="font-medium">גרור קובץ לכאן או לחץ להעלאה</p>
                  <p className="text-sm text-muted-foreground mt-1">תמונה (JPG, PNG) או PDF</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={handleFilePick}
                  />
                </div>
                <div className="flex justify-center">
                  <Button variant="outline" onClick={startCamera}>
                    <Camera className="w-4 h-4 ml-1" /> צלם עם מצלמה
                  </Button>
                </div>
              </>
            )}

            {preview && (
              <div className="relative">
                <img src={preview} alt="תצוגה מקדימה" className="w-full max-h-56 object-contain rounded-lg border border-border" />
                <Button size="icon" variant="ghost" className="absolute top-1 left-1" onClick={() => { setFile(null); setPreview(null); }}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}
            {file && !preview && (
              <div className="flex items-center gap-2 bg-muted rounded-lg px-4 py-3 text-sm">
                <PackagePlus className="w-4 h-4 shrink-0" />
                <span className="truncate">{file.name}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleClose}>ביטול</Button>
              <Button disabled={!file} onClick={handleProcess}>
                <Loader2 className="w-4 h-4 ml-1 hidden" /> ניתוח מסמך
              </Button>
            </div>
          </div>
        )}

        {/* ── Processing ── */}
        {step === "processing" && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-muted-foreground">{retryMsg || "מנתח את המסמך עם AI..."}</p>
          </div>
        )}

        {/* ── Review ── */}
        {step === "review" && (
          <div className="space-y-4 mt-2">
            <p className="text-sm text-muted-foreground">בדוק ותקן את הפריטים שחולצו לפני אישור.</p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-right px-3 py-2 min-w-[80px]">מק&quot;ט</th>
                    <th className="text-right px-3 py-2 w-20">כמות</th>
                    <th className="text-right px-3 py-2 w-28">מחיר יחידה</th>
                    <th className="text-right px-3 py-2 w-28">סה&quot;כ</th>
                    <th className="text-right px-3 py-2">שם המוצר / סטטוס</th>
                    <th className="text-center px-3 py-2 w-16">דלג</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={i} className={`border-t border-border ${item.skip ? "opacity-40" : ""}`}>
                      <td className="px-3 py-2">
                        <Input
                          value={item.sku || ""}
                          onChange={e => updateItem(i, "sku", e.target.value)}
                          className="h-7 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={item.quantity ?? ""}
                          onChange={e => updateItem(i, "quantity", e.target.value)}
                          className="h-7 text-sm w-20"
                        />
                      </td>
                      <td className="px-3 py-2">
                        {item.priceChanged && (
                          <p className="text-xs text-muted-foreground mb-0.5">מחיר קיים במערכת: ₪{item.matched.buy_price}</p>
                        )}
                        <Input
                          type="number"
                          value={item.unit_price ?? ""}
                          onChange={e => updateItem(i, "unit_price", e.target.value)}
                          className={`h-7 text-sm w-20 ${item.priceChanged ? "border-red-400 text-red-600 font-semibold" : ""}`}
                        />
                        {item.priceChanged && (() => {
                          const diff = Math.abs(Number(item.unit_price) - Number(item.matched.buy_price)).toFixed(2);
                          const up = Number(item.unit_price) > Number(item.matched.buy_price);
                          return <p className="text-xs text-red-500 mt-0.5">מחיר חדש לפי תעודה: ₪{item.unit_price} ({up ? `עלה ב-₪${diff}` : `ירד ב-₪${diff}`})</p>;
                        })()}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={item.total ?? ""}
                          onChange={e => updateItem(i, "total", e.target.value)}
                          className="h-7 text-sm w-24"
                        />
                      </td>
                      <td className="px-3 py-2">
                        {item.matched ? (
                          <span className={`inline-flex items-center gap-1 text-xs rounded px-2 py-0.5 border ${item.priceChanged ? "text-red-700 bg-red-50 border-red-200" : "text-green-700 bg-green-50 border-green-200"}`}>
                            <CheckCircle className="w-3 h-3" /> {item.matched.name}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-0.5">
                            <AlertTriangle className="w-3 h-3" /> מוצר חדש
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={item.skip}
                          onChange={e => updateItem(i, "skip", e.target.checked)}
                          className="w-4 h-4 cursor-pointer"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep("upload")}>חזרה</Button>
              <Button onClick={handleApprove} disabled={items.every(i => i.skip)}>
                אישור קבלת סחורה ({items.filter(i => !i.skip && i.matched).length} פריטים)
              </Button>
            </div>
          </div>
        )}

        {/* ── Saving ── */}
        {step === "saving" && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-muted-foreground">שומר נתונים...</p>
          </div>
        )}

        {/* ── Done ── */}
        {step === "done" && summary && (
          <div className="flex flex-col items-center justify-center py-10 gap-6 text-center">
            <CheckCircle className="w-14 h-14 text-green-500" />
            <div>
              <p className="text-xl font-bold">קבלת הסחורה הושלמה</p>
              <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                <p>✅ {summary.updatedCount} מוצרים עודכנו במלאי</p>
                {summary.priceChanges > 0 && (
                  <p className="text-red-600 font-medium">⚠️ {summary.priceChanges} שינויי מחיר זוהו ונשמרו</p>
                )}
                {summary.addedCount > 0 && (
                  <p className="text-green-600 font-medium">➕ {summary.addedCount} מוצרים חדשים נוספו למלאי</p>
                )}
              </div>
            </div>
            <Button onClick={handleClose}>סגור</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>

    {/* ── Price change confirmation dialog ── */}
    {priceQueue.length > 0 && priceQueueIdx < priceQueue.length && (() => {
      const item = priceQueue[priceQueueIdx];
      return (
        <AlertDialog open={true}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>שינוי מחיר ({priceQueueIdx + 1}/{priceQueue.length})</AlertDialogTitle>
              <AlertDialogDescription>
                <strong>{item.matched.name}</strong><br />
                מחיר קיים במערכת: ₪{item.matched.buy_price}<br />
                מחיר חדש לפי תעודה: ₪{item.unit_price} ({Number(item.unit_price) > Number(item.matched.buy_price) ? `עלה ב-₪${Math.abs(Number(item.unit_price) - Number(item.matched.buy_price)).toFixed(2)}` : `ירד ב-₪${Math.abs(Number(item.unit_price) - Number(item.matched.buy_price)).toFixed(2)}`})<br />
                האם לעדכן את מחיר הקנייה במערכת?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-row-reverse gap-2 flex-wrap">
              <Button className="bg-yellow-400 hover:bg-yellow-500 text-black" onClick={() => handlePriceDecision(true)}>עדכן מחיר + מלאי</Button>
              <Button variant="outline" onClick={() => handlePriceDecision(false)}>עדכן מלאי בלבד</Button>
              <Button variant="ghost" className="text-muted-foreground" onClick={handleBackToReview}>חזור לעריכה</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
    })()}

    {/* ── New products confirmation dialog ── */}
    <AlertDialog open={newProductsDialog} onOpenChange={setNewProductsDialog}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>מוצרים חדשים שאינם במערכת</AlertDialogTitle>
          <AlertDialogDescription>
            נמצאו {unmatched.length} מוצרים חדשים שאינם במערכת. האם להוסיף אותם למלאי?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="my-2 max-h-40 overflow-y-auto space-y-1 text-sm">
          {unmatched.map((item, i) => (
            <div key={i} className="flex justify-between px-2 py-1 rounded bg-muted/50">
              <span>{item.product_name}</span>
              <span className="text-muted-foreground">{item.sku || "ללא מק״ט"} · כמות: {item.quantity}</span>
            </div>
          ))}
        </div>
        <AlertDialogFooter className="flex-row-reverse gap-2">
          <Button onClick={() => handleSave(true)}>הוסף למלאי</Button>
          <Button variant="outline" onClick={() => handleSave(false)}>דלג</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
