import { useState, useMemo, useRef, useEffect, useCallback, memo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, Minus, Loader2 } from "lucide-react";

const PAGE_SIZE = 30;

// ─── Memoized product card ────────────────────────────────────────────────────
// Only re-renders when qty for THIS product changes, not when other products change.
const ProductCard = memo(({ product, qty, onUpdate }) => (
  <div
    className={`border rounded-lg overflow-hidden bg-card hover:shadow-md transition-shadow flex flex-col ${
      qty > 0 ? "border-primary ring-2 ring-primary/20" : "border-border"
    }`}
  >
    <div className="w-full h-24 bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
      {product.image_url ? (
        <img
          src={product.image_url.split(",")[0].trim()}
          alt={product.name}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="text-xs text-muted-foreground">ללא תמונה</div>
      )}
    </div>
    <div className="p-2 flex flex-col gap-1.5 flex-1">
      <h4 className="font-medium text-xs leading-tight">{product.name}</h4>
      {product.sku && <p className="text-[10px] text-muted-foreground">SKU: {product.sku}</p>}
      <div className="text-xs border-t border-border pt-1">
        <p className="font-bold">₪{(product.sell_price || 0).toFixed(2)}</p>
        <p className="text-muted-foreground">לפני מע״מ</p>
      </div>
      <div className="flex items-center gap-1 justify-between mt-auto">
        <Button
          variant="outline"
          size="icon"
          className="h-6 w-6 flex-shrink-0"
          onClick={() => onUpdate(product.id, qty - 1)}
          disabled={qty === 0}
        >
          <Minus className="w-2.5 h-2.5" />
        </Button>
        <span className="flex-1 text-center text-xs font-medium">{qty}</span>
        <Button
          variant="outline"
          size="icon"
          className="h-6 w-6 flex-shrink-0"
          onClick={() => onUpdate(product.id, qty + 1)}
        >
          <Plus className="w-2.5 h-2.5" />
        </Button>
      </div>
    </div>
  </div>
));

// ─── Main modal ───────────────────────────────────────────────────────────────
export default function ProductCatalogModal({ open, onOpenChange, products, onAddProducts }) {
  const pendingDeletedIds = (() => {
    try { return new Set(JSON.parse(sessionStorage.getItem("pendingDeletedProducts") || "[]")); } catch { return new Set(); }
  })();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedProducts, setSelectedProducts] = useState({});

  const scrollRef = useRef(null);
  const sentinelRef = useRef(null);
  // Store filteredProducts.length in a ref so the observer callback is always current
  // without needing to be in the dependency array (avoids disconnect/reconnect on every batch)
  const filteredLengthRef = useRef(0);
  const visibleCountRef = useRef(PAGE_SIZE);

  // Reset on filter change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    visibleCountRef.current = PAGE_SIZE;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [searchTerm, selectedCategory]);

  // Category list
  const categoryListWithCounts = useMemo(() => {
    const map = new Map();
    products.forEach(p => {
      if (!p.is_active || pendingDeletedIds.has(p.id)) return;
      const name = (p.category || "").trim().replace(/\s+/g, " ");
      if (!name || name === "-") return;
      const key = p.category_id || name;
      if (!map.has(key)) map.set(key, { id: key, name, count: 0 });
      map.get(key).count++;
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [products]);

  // Full filtered list (all in memory)
  const filteredProducts = useMemo(() => {
    let result = products.filter(p => p.is_active && !pendingDeletedIds.has(p.id));
    if (selectedCategory) {
      result = result.filter(p => (p.category_id || p.category) === selectedCategory);
    }
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(p =>
        [p.name, p.sku, p.barcode, p.category].some(f => (f || "").toLowerCase().includes(lower))
      );
    }
    return result;
  }, [products, searchTerm, selectedCategory]);

  // Keep ref in sync with latest filtered length
  filteredLengthRef.current = filteredProducts.length;

  const visibleProducts = filteredProducts.slice(0, visibleCount);
  const hasMore = visibleCount < filteredProducts.length;

  // ── Stable IntersectionObserver — set up ONCE per open, never torn down mid-scroll ──
  useEffect(() => {
    if (!open) return;

    // Wait one frame so the DOM is painted and refs are attached
    const raf = requestAnimationFrame(() => {
      const sentinel = sentinelRef.current;
      const container = scrollRef.current;
      if (!sentinel || !container) return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries[0].isIntersecting) return;
          // Always read fresh values from refs — no stale closure
          const current = visibleCountRef.current;
          const total = filteredLengthRef.current;
          if (current < total) {
            const next = Math.min(current + PAGE_SIZE, total);
            visibleCountRef.current = next;
            setVisibleCount(next);
          }
        },
        {
          root: container,
          rootMargin: "0px 0px 400px 0px",
          threshold: 0,
        }
      );
      observer.observe(sentinel);
      return () => observer.disconnect();
    });

    return () => cancelAnimationFrame(raf);
  }, [open, searchTerm, selectedCategory]); // only re-create when dialog opens or filters change (not on every batch)

  // Stable updateQuantity — useCallback so ProductCard memo actually works
  const updateQuantity = useCallback((productId, qty) => {
    setSelectedProducts(prev => {
      if (qty <= 0) {
        const { [productId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [productId]: qty };
    });
  }, []);

  const handleAddProducts = useCallback(() => {
    const toAdd = Object.entries(selectedProducts).map(([productId, qty]) => {
      const product = products.find(p => p.id === productId);
      return {
        product_id: productId,
        name: product.name,
        sku: product.sku || "",
        quantity: qty,
        unit_price: product.sell_price || 0,
        buy_price: product.buy_price || 0,
        discount: 0,
        total: qty * (product.sell_price || 0),
      };
    });
    onAddProducts(toAdd);
    setSelectedProducts({});
    onOpenChange(false);
  }, [selectedProducts, products, onAddProducts, onOpenChange]);

  const selectedCount = useMemo(
    () => Object.values(selectedProducts).reduce((s, q) => s + q, 0),
    [selectedProducts]
  );

  const activeCount = products.filter(p => p.is_active && !pendingDeletedIds.has(p.id)).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl max-h-[90vh] flex flex-col" dir="rtl">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>בחר מוצרים</DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="flex-shrink-0 border-b border-border pb-3">
          <div className="relative">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="חיפוש לפי שם, SKU או ברקוד..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pr-8"
              autoFocus
            />
          </div>
        </div>

        {/* Sidebar + Grid */}
        <div className="flex-1 flex gap-4 overflow-hidden min-h-0">

          {/* Categories sidebar */}
          {categoryListWithCounts.length > 0 && (
            <div className="w-44 flex-shrink-0 border-l border-border overflow-y-auto py-2">
              <div className="space-y-1 px-2">
                <Button
                  variant={!selectedCategory ? "default" : "ghost"}
                  size="sm"
                  className="w-full justify-start text-xs h-8 font-medium"
                  onClick={() => setSelectedCategory("")}
                >
                  הכל ({activeCount})
                </Button>
                {categoryListWithCounts.map(cat => (
                  <Button
                    key={cat.id}
                    variant={selectedCategory === cat.id ? "default" : "ghost"}
                    size="sm"
                    className="w-full justify-between text-xs h-8"
                    onClick={() => setSelectedCategory(cat.id)}
                  >
                    <span className="truncate">{cat.name}</span>
                    <span className="text-muted-foreground ml-1 flex-shrink-0">({cat.count})</span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Scrollable grid — ref is IntersectionObserver root */}
          <div className="flex-1 overflow-y-auto min-h-0" ref={scrollRef}>
            {filteredProducts.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                לא נמצאו מוצרים
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 p-4">
                  {visibleProducts.map(product => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      qty={selectedProducts[product.id] || 0}
                      onUpdate={updateQuantity}
                    />
                  ))}
                </div>

                {/* Sentinel watched by the stable observer */}
                <div ref={sentinelRef} style={{ height: "1px" }} />

                {hasMore && (
                  <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    טוען עוד... ({visibleCount} מתוך {filteredProducts.length})
                  </div>
                )}
                {!hasMore && filteredProducts.length > PAGE_SIZE && (
                  <div className="text-center pb-4 text-xs text-muted-foreground">
                    ✓ מציג את כל {filteredProducts.length} המוצרים
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex-shrink-0 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {selectedCount > 0 ? `נבחרו ${selectedCount} פריטים` : "לא נבחרו מוצרים עדיין"}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>סגור</Button>
              <Button onClick={handleAddProducts} disabled={selectedCount === 0}>
                <Plus className="w-4 h-4 ml-1" />
                הוסף {selectedCount > 0 ? selectedCount : ""} מוצרים
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}