import { useState, useEffect, useRef, useCallback } from "react";
import { Package } from "lucide-react";
import ProductCard from "./ProductCard";
import ProductQuickView from "./ProductQuickView";

const PAGE_SIZE = 48;

export default function ProductGrid({ products, cartItems, onAdd, loading, favorites, onToggleFavorite, recentlyViewed, searchActive }) {
  const [page, setPage] = useState(1);
  const [quickViewProduct, setQuickViewProduct] = useState(null);
  const loaderRef = useRef(null);

  // Reset pagination when products list changes
  useEffect(() => { setPage(1); }, [products]);

  const visibleProducts = products.slice(0, page * PAGE_SIZE);
  const hasMore = visibleProducts.length < products.length;

  // Infinite scroll via IntersectionObserver
  const onIntersect = useCallback((entries) => {
    if (entries[0].isIntersecting && hasMore) {
      setPage((p) => p + 1);
    }
  }, [hasMore]);

  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(onIntersect, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [onIntersect]);

  const cartMap = {};
  cartItems.forEach((i) => { cartMap[i.product_id] = i.quantity; });

  const MUTED  = "#B2B0B1";
  const ACCENT = "#F5885E";

  if (loading) {
    return (
      /* OLD: <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-3 2xl:grid-cols-4 gap-4"> */
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          /* OLD: <div key={i} className="bg-card border border-border rounded-xl overflow-hidden animate-pulse"> */
          <div key={i} style={{ background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.05)", borderRadius: 16, overflow: "hidden", animation: "pulse 1.5s ease-in-out infinite" }}>
            {/* OLD: <div className="aspect-square bg-muted" /> */}
            <div style={{ aspectRatio: "1 / 1", background: "#F5F3F6" }} />
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {/* OLD: <div className="h-4 bg-muted rounded w-3/4" /> */}
              <div style={{ height: 14, background: "#F5F3F6", borderRadius: 6, width: "75%" }} />
              <div style={{ height: 12, background: "#F5F3F6", borderRadius: 6, width: "50%" }} />
              <div style={{ height: 32, background: "#F5F3F6", borderRadius: 10, width: "100%", marginTop: 4 }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      /* OLD: <div className="flex flex-col items-center justify-center py-20 text-muted-foreground"> */
      <div className="heillo-card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "64px 24px", textAlign: "center", gap: 12 }}>
        <Package style={{ width: 56, height: 56, color: ACCENT, opacity: 0.3 }} />
        {/* OLD: <p className="text-lg font-medium"> */}
        <p style={{ fontSize: 16, fontWeight: 600, color: "#120F1C", margin: 0, fontFamily: "'Heebo', sans-serif" }}>לא נמצאו מוצרים</p>
        {/* OLD: <p className="text-sm mt-1"> */}
        <p style={{ fontSize: 13, color: MUTED, margin: 0, fontFamily: "'Heebo', sans-serif" }}>נסה לשנות את הסינון או החיפוש</p>
      </div>
    );
  }

  return (
    <>
      {/* Recently viewed strip */}
      {recentlyViewed?.length > 0 && !searchActive && (
        <div style={{ marginBottom: 20 }}>
          {/* OLD: <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2"> */}
          <p style={{ fontSize: 10, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, fontFamily: "'Heebo', sans-serif" }}>נצפו לאחרונה</p>
          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
            {recentlyViewed.map((product) => (
              /* OLD: <button className="shrink-0 flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 hover:border-primary transition-all"> */
              <button
                key={product.id}
                onClick={() => setQuickViewProduct(product)}
                style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.06)", borderRadius: 12, padding: "7px 12px", cursor: "pointer", transition: "border-color 0.15s ease", fontFamily: "'Heebo', sans-serif" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = ACCENT; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(0,0,0,0.06)"; }}
              >
                {/* OLD: <div className="w-8 h-8 rounded overflow-hidden bg-muted shrink-0"> */}
                <div style={{ width: 28, height: 28, borderRadius: 8, overflow: "hidden", background: "#F5F3F6", flexShrink: 0 }}>
                  {product.image_url ? (
                    <img src={product.image_url.split(",")[0].trim()} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <Package style={{ width: 14, height: 14, margin: "7px auto", display: "block", color: MUTED, opacity: 0.4 }} />
                  )}
                </div>
                {/* OLD: <span className="text-xs font-medium max-w-24 line-clamp-1"> */}
                <span style={{ fontSize: 12, fontWeight: 500, maxWidth: 96, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#120F1C" }}>{product.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {visibleProducts.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            cartQty={cartMap[product.id] || 0}
            onAdd={onAdd}
            onQuickView={setQuickViewProduct}
            isFavorite={favorites?.has(product.id)}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>

      {/* Infinite scroll trigger */}
      <div ref={loaderRef} style={{ height: 16 }} />
      {hasMore && (
        /* OLD: <div className="text-center py-4 text-xs text-muted-foreground"> */
        <div style={{ textAlign: "center", padding: "12px 0", fontSize: 12, color: MUTED, fontFamily: "'Heebo', sans-serif" }}>
          טוען עוד {Math.min(PAGE_SIZE, products.length - visibleProducts.length)} מוצרים...
        </div>
      )}
      {/* OLD: <div className="text-center py-2 text-xs text-muted-foreground"> */}
      <div style={{ textAlign: "center", padding: "6px 0", fontSize: 12, color: MUTED, fontFamily: "'Heebo', sans-serif" }}>
        מציג {visibleProducts.length} מתוך {products.length} מוצרים
      </div>

      {quickViewProduct && (
        <ProductQuickView
          product={quickViewProduct}
          cartQty={cartMap[quickViewProduct.id] || 0}
          onAdd={onAdd}
          onClose={() => setQuickViewProduct(null)}
        />
      )}
    </>
  );
}