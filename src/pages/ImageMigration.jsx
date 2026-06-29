import { useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

const BUCKET = "product-images";

function extFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
    return match ? match[0].toLowerCase() : ".jpg";
  } catch {
    return ".jpg";
  }
}

function mimeFromExt(ext) {
  const map = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };
  return map[ext] || "image/jpeg";
}

export default function ImageMigration() {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  const handleStart = async () => {
    setRunning(true);
    setDone(false);
    setResults([]);
    setError(null);
    setProgress({ current: 0, total: 0 });

    // 1. Fetch products with ministock URLs
    const { data: products, error: fetchError } = await supabase
      .from("products")
      .select("id, name, sku, image_url")
      .like("image_url", "%ministock.co.il%");

    if (fetchError) {
      setError("שגיאה בשליפת מוצרים: " + fetchError.message);
      setRunning(false);
      return;
    }

    if (!products || products.length === 0) {
      setError("לא נמצאו מוצרים עם תמונות ministock.co.il");
      setRunning(false);
      return;
    }

    setProgress({ current: 0, total: products.length });
    const log = [];

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const originalUrl = product.image_url.split(",")[0].trim();
      const label = product.sku || product.id;

      try {
        // 2. Download image via fetch (browser proxy)
        const res = await fetch(originalUrl);
        if (!res.ok) throw new Error(`הורדה נכשלה: HTTP ${res.status}`);
        const blob = await res.blob();

        const ext = extFromUrl(originalUrl);
        const filename = String(label).replace(/[^a-zA-Z0-9_-]/g, "_") + ext;

        // 3. Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(filename, blob, {
            contentType: mimeFromExt(ext),
            upsert: true,
          });
        if (uploadError) throw new Error("העלאה נכשלה: " + uploadError.message);

        // 4. Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from(BUCKET)
          .getPublicUrl(filename);

        // 5. Update product image_url
        const { error: updateError } = await supabase
          .from("products")
          .update({ image_url: publicUrl })
          .eq("id", product.id);
        if (updateError) throw new Error("עדכון DB נכשל: " + updateError.message);

        log.push({ name: product.name, sku: product.sku, status: "success", newUrl: publicUrl });
      } catch (err) {
        log.push({ name: product.name, sku: product.sku, status: "failed", error: err.message });
      }

      setProgress({ current: i + 1, total: products.length });
      setResults([...log]);
    }

    setRunning(false);
    setDone(true);
  };

  const succeeded = results.filter(r => r.status === "success").length;
  const failed = results.filter(r => r.status === "failed").length;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold">מיגרציית תמונות מוצרים</h1>
        <p className="text-sm text-muted-foreground mt-1">
          מעביר תמונות מ-ministock.co.il לאחסון Supabase
        </p>
      </div>

      <Button onClick={handleStart} disabled={running} className="gap-2">
        {running && <Loader2 className="w-4 h-4 animate-spin" />}
        {running ? "מתבצע..." : "התחל מיגרציה"}
      </Button>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {(running || done) && progress.total > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {progress.current} מתוך {progress.total} הושלמו
          </p>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {done && (
        <div className="rounded-lg bg-muted px-4 py-3 text-sm font-medium">
          סיום: {succeeded} הצליחו, {failed} נכשלו
        </div>
      )}

      {results.length > 0 && (
        <div className="border rounded-lg divide-y text-sm">
          {results.map((r, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3">
              {r.status === "success"
                ? <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                : <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />}
              <div className="min-w-0">
                <p className="font-medium truncate">{r.name}</p>
                {r.sku && <p className="text-xs text-muted-foreground">מק"ט: {r.sku}</p>}
                {r.status === "success"
                  ? <p className="text-xs text-green-600 truncate">{r.newUrl}</p>
                  : <p className="text-xs text-red-600">{r.error}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
