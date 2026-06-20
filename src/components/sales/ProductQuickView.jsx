import { useState } from "react";
import { X, Plus, Minus, Package, ZoomIn, ChevronRight, ChevronLeft, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ProductQuickView({ product, cartQty, onAdd, onClose }) {
  const [currentImage, setCurrentImage] = useState(0);
  const [zoomed, setZoomed] = useState(false);

  // Support multiple images (comma-separated in image_url or images array)
  const images = product.images
    ? product.images
    : product.image_url
    ? product.image_url.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const hasImages = images.length > 0;
  const displayImage = hasImages ? images[currentImage] : null;

  const nextImage = () => setCurrentImage((i) => (i + 1) % images.length);
  const prevImage = () => setCurrentImage((i) => (i - 1 + images.length) % images.length);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-card rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto flex flex-col md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Image section */}
        <div className="md:w-2/5 shrink-0 bg-muted flex flex-col">
          {/* Main image */}
          <div className="relative aspect-square overflow-hidden bg-muted">
            {displayImage ? (
              <>
                <img
                  src={displayImage}
                  alt={product.name}
                  className={`w-full h-full object-cover transition-transform cursor-zoom-in ${zoomed ? "scale-150" : ""}`}
                  onClick={() => setZoomed(!zoomed)}
                />
                {!zoomed && (
                  <button onClick={() => setZoomed(true)} className="absolute bottom-2 left-2 bg-black/40 text-white p-1.5 rounded-lg">
                    <ZoomIn className="w-4 h-4" />
                  </button>
                )}
                {zoomed && (
                  <div className="absolute inset-0 flex items-center justify-center" onClick={() => setZoomed(false)}>
                    <X className="w-6 h-6 text-white bg-black/50 rounded-full p-1" />
                  </div>
                )}
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Package className="w-20 h-20 text-muted-foreground/20" />
              </div>
            )}

            {/* Navigation arrows */}
            {images.length > 1 && !zoomed && (
              <>
                <button onClick={prevImage} className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 text-white p-1.5 rounded-full">
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button onClick={nextImage} className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 text-white p-1.5 rounded-full">
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </>
            )}
          </div>

          {/* Thumbnail strip */}
          {images.length > 1 && (
            <div className="flex gap-2 p-2 overflow-x-auto">
              {images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentImage(i)}
                  className={`w-14 h-14 rounded-lg overflow-hidden shrink-0 border-2 transition-all ${
                    currentImage === i ? "border-primary" : "border-transparent"
                  }`}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details section */}
        <div className="flex-1 flex flex-col p-5">
          {/* Close */}
          <button onClick={onClose} className="absolute top-4 left-4 md:relative md:self-end text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>

          <div className="flex-1 space-y-4">
            {/* Title */}
            <div>
              <h2 className="text-xl font-bold leading-tight">{product.name}</h2>
              <div className="flex flex-wrap gap-2 mt-1">
                {product.sku && <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">מק״ט: {product.sku}</span>}
                {product.barcode && <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">ברקוד: {product.barcode}</span>}
                {product.category && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">{product.category}</span>}
              </div>
            </div>

            {/* Price */}
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold text-primary">
                ₪{(product.sell_price || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              {product.unit && product.unit !== "יחידה" && (
                <span className="text-sm text-muted-foreground">לכל {product.unit}</span>
              )}
            </div>

            {/* Stock */}
            {product.quantity !== undefined && (
              <div className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-full ${
                product.quantity <= 0
                  ? "bg-red-100 text-red-700"
                  : product.quantity <= (product.min_quantity || 5)
                  ? "bg-yellow-100 text-yellow-700"
                  : "bg-green-100 text-green-700"
              }`}>
                {product.quantity <= 0 ? "אזל מהמלאי" : `במלאי: ${product.quantity} ${product.unit || "יח׳"}`}
              </div>
            )}

            {/* Description */}
            {product.description && (
              <div>
                <h3 className="text-sm font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">תיאור</h3>
                <p className="text-sm leading-relaxed">{product.description}</p>
              </div>
            )}

            {/* Specifications from notes */}
            {product.notes && (
              <div>
                <h3 className="text-sm font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">מפרט</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{product.notes}</p>
              </div>
            )}

            {/* Tags */}
            {product.tags && (
              <div className="flex flex-wrap gap-1.5">
                {product.tags.split(",").map((tag, i) => (
                  <span key={i} className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">
                    {tag.trim()}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Add to cart */}
          <div className="mt-5 pt-4 border-t border-border">
            <Button
              className="w-full h-12 text-base font-semibold"
              onClick={() => { onAdd(product); onClose(); }}
            >
              <ShoppingCart className="w-5 h-5 ml-2" />
              {cartQty > 0 ? `הוסף עוד (${cartQty} בסל)` : "הוסף לסל"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}