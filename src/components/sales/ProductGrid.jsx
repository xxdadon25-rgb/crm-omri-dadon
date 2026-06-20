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

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-xl overflow-hidden animate-pulse">
            <div className="aspect-square bg-muted" />
            <div className="p-3 space-y-2">
              <div className="h-4 bg-muted rounded w-3/4" />
              <div className="h-3 bg-muted rounded w-1/2" />
              <div className="h-8 bg-muted rounded w-full mt-3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Package className="w-16 h-16 mb-4 opacity-20" />
        <p className="text-lg font-medium">לא נמצאו מוצרים</p>
        <p className="text-sm mt-1">נסה לשנות את הסינון או החיפוש</p>
      </div>
    );
  }

  return (
    <>
      {/* Recently viewed strip — hide when searching */}
      {recentlyViewed?.length > 0 && !searchActive && (
        <div className="mb-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">נצפו לאחרונה</p>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {recentlyViewed.map((product) => (
              <button
                key={product.id}
                onClick={() => setQuickViewProduct(product)}
                className="shrink-0 flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 hover:border-primary transition-all"
              >
                <div className="w-8 h-8 rounded overflow-hidden bg-muted shrink-0">
                  {product.image_url ? (
                    <img src={product.image_url.split(",")[0].trim()} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Package className="w-4 h-4 m-auto mt-2 text-muted-foreground/30" />
                  )}
                </div>
                <span className="text-xs font-medium max-w-24 line-clamp-1">{product.name}</span>
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
      <div ref={loaderRef} className="h-4" />
      {hasMore && (
        <div className="text-center py-4 text-xs text-muted-foreground">
          טוען עוד {Math.min(PAGE_SIZE, products.length - visibleProducts.length)} מוצרים...
        </div>
      )}
      <div className="text-center py-2 text-xs text-muted-foreground">
        מציג {visibleProducts.length} מתוך {products.length} מוצרים
      </div>

      {/* Quick View Modal */}
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