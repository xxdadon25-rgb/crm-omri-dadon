/**
 * Visual product picker for matching a scanned invoice line to a CRM product.
 *
 * SELECTION ONLY. Clicking a card reports a product id to the caller and
 * closes. It writes nothing, approves nothing, and opening or searching the
 * catalogue changes no state outside this dialog — a line becomes "approved"
 * only when the review screen records a chosen product, exactly as it did with
 * the dropdown this replaces.
 *
 * READ-ONLY ON PRODUCTS. It reads id, name, sku, barcode, unit, image_url and
 * category. It never writes to products, never uploads or rewrites an image,
 * and uses the product's EXISTING image_url with the same convention as the
 * rest of the CRM: the field may hold several comma-separated URLs and the
 * first is the primary one.
 *
 * WHY NOT REUSE ProductCatalogModal
 *   That dialog is a multi-select quantity picker for supplier ORDERS: its
 *   cards carry +/- controls and it reports {product: qty} through
 *   onAddProducts. Single-select matching needs a different contract, and
 *   reshaping it would mean editing a component the supplier-order flow depends
 *   on — out of scope. Its proven paging idea is reused here; its code is not
 *   touched.
 *
 * PAGING: search and paging run in the database (see listProductsForMatching),
 * so a large catalogue costs one page per scroll instead of a full download
 * when the dialog opens.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ImageOff, Loader2, X } from "lucide-react";
import { listProductsForMatching } from "@/api/supplierQuotes";

const PAGE_SIZE = 30;
const MUTED = "var(--heillo-text-muted)";
const DARK = "var(--heillo-text-primary)";
const ACCENT = "#0891b2";

/** The CRM's existing convention: image_url may hold several comma-separated
 *  URLs, and the first is the primary image. Mirrors ProductCard/ProductGrid. */
export function primaryImageUrl(product) {
  const raw = product?.image_url;
  if (!raw) return null;
  const first = String(raw).split(",")[0].trim();
  return first || null;
}

function ProductCardImage({ product }) {
  const [failed, setFailed] = useState(false);
  const url = primaryImageUrl(product);

  // A placeholder covers both "no image recorded" and "the recorded URL did
  // not load" — a broken thumbnail is worse than an honest placeholder.
  if (!url || failed) {
    return (
      <div style={{
        width: "100%", aspectRatio: "4 / 3", background: "rgba(0,0,0,0.04)",
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 4, color: MUTED,
      }}>
        <ImageOff style={{ width: 18, height: 18 }} />
        <span style={{ fontSize: 10 }}>ללא תמונה</span>
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={product.name || ""}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", background: "rgba(0,0,0,0.04)" }}
    />
  );
}

export default function QuoteProductPicker({ open, onClose, onSelect, line = null, selectedId = null }) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");

  const offsetRef = useRef(0);
  const seenRef = useRef(new Set());
  // Incremented on every reset; a resolving page whose id no longer matches is
  // discarded, which is what makes typing mid-fetch safe.
  const runIdRef = useRef(0);
  const loadingRef = useRef(false);
  const sentinelRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadPage = useCallback(async (reset) => {
    if (loadingRef.current) return;
    if (reset) {
      runIdRef.current += 1;
      offsetRef.current = 0;
      seenRef.current = new Set();
    }
    const runId = runIdRef.current;
    loadingRef.current = true;
    setLoading(true);
    try {
      const rows = await listProductsForMatching({
        search: debounced, limit: PAGE_SIZE, offset: offsetRef.current,
      });
      if (runIdRef.current !== runId) return;
      offsetRef.current += rows.length;
      const fresh = rows.filter(r => !seenRef.current.has(r.id));
      for (const r of fresh) seenRef.current.add(r.id);
      setProducts(prev => (reset ? fresh : [...prev, ...fresh]));
      setHasMore(rows.length === PAGE_SIZE);
      setError("");
    } catch (err) {
      if (runIdRef.current !== runId) return;
      setError(err?.message || "טעינת המוצרים נכשלה");
      setHasMore(false);
    } finally {
      if (runIdRef.current === runId) setLoading(false);
      loadingRef.current = false;
    }
  }, [debounced]);

  // Reset and reload whenever the dialog opens or the query changes.
  useEffect(() => {
    if (!open) return;
    loadPage(true);
  }, [open, debounced, loadPage]);

  // Clear the query between openings, so the dialog does not reopen filtered by
  // whatever was typed for a different line.
  useEffect(() => {
    if (!open) { setSearch(""); setDebounced(""); }
  }, [open]);

  // Infinite scroll, same approach as the portal catalogue: an observer on a
  // sentinel starts the next page before the user reaches the bottom.
  useEffect(() => {
    if (!open || !hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) loadPage(false); },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [open, hasMore, loadPage, products.length]);

  const choose = (product) => {
    // The ONLY place a product is reported. Selection happens on an explicit
    // click; browsing and searching report nothing.
    onSelect?.(product);
    onClose?.();
  };

  return (
    <Dialog open={!!open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle>שיוך מוצר</DialogTitle>
        </DialogHeader>

        {/* What the supplier's document called it, so the choice can be made
            against the original wording without leaving the dialog. */}
        {line && (
          <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.6, marginTop: -4 }}>
            שורת הספק: <strong style={{ color: DARK }}>{line.supplier_name_raw || "—"}</strong>
            {line.supplier_sku ? ` · מק"ט ספק: ${line.supplier_sku}` : " · ללא מק\"ט ספק"}
            {line.unit ? ` · ${line.unit}` : ""}
            {line.base_qty_per_pack ? ` · ${line.base_qty_per_pack} ${line.base_unit || ""} באריזה` : ""}
          </div>
        )}

        <div style={{ position: "relative", marginTop: 8 }}>
          <Search style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
            width: 15, height: 15, color: MUTED, pointerEvents: "none" }} />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='חיפוש לפי שם, מק"ט או ברקוד...'
            style={{ paddingRight: 34 }}
          />
        </div>

        <div style={{ overflowY: "auto", marginTop: 10, flex: 1, minHeight: 200 }}>
          {error && (
            <p style={{ fontSize: 13, color: "#b91c1c", textAlign: "center", padding: "16px 0" }}>{error}</p>
          )}

          {!error && products.length === 0 && !loading && (
            <p style={{ fontSize: 13, color: MUTED, textAlign: "center", padding: "32px 0" }}>
              לא נמצאו מוצרים
            </p>
          )}

          {/* auto-fill keeps the cards legible from a phone to a wide screen
              without a media query. */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 10,
          }}>
            {products.map(p => {
              const isSelected = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => choose(p)}
                  style={{
                    textAlign: "right", padding: 0, cursor: "pointer", overflow: "hidden",
                    border: `1px solid ${isSelected ? ACCENT : "rgba(0,0,0,0.08)"}`,
                    boxShadow: isSelected ? `0 0 0 2px rgba(8,145,178,0.25)` : "none",
                    borderRadius: 12, background: "#FFFFFF",
                    display: "flex", flexDirection: "column",
                    fontFamily: "'Heebo', sans-serif",
                  }}
                >
                  <ProductCardImage product={p} />
                  <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: DARK, lineHeight: 1.3 }}>
                      {p.name}
                    </span>
                    {p.sku && (
                      <span style={{ fontSize: 10, color: MUTED }}>מק"ט: {p.sku}</span>
                    )}
                    {p.unit && (
                      <span style={{ fontSize: 10, color: MUTED }}>יחידה: {p.unit}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {loading && (
            <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
              <Loader2 style={{ width: 20, height: 20, color: MUTED, animation: "spin 1s linear infinite" }} />
            </div>
          )}

          {hasMore && !loading && <div ref={sentinelRef} style={{ height: 1 }} />}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 8, paddingTop: 10, borderTop: "1px solid rgba(0,0,0,0.06)" }}>
          <span style={{ fontSize: 11, color: MUTED }}>
            בחירת מוצר אינה מאשרת מחיר — האישור נעשה במסך הבדיקה
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {selectedId && (
              <Button variant="outline" onClick={() => { onSelect?.(null); onClose?.(); }}>
                בטל שיוך
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              <X style={{ width: 14, height: 14, marginInlineEnd: 4 }} /> סגור
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}