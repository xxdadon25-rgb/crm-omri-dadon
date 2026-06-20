import { useState } from "react";
import { Plus, Package, Eye, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ProductCard({ product, cartQty, onAdd, onQuickView, isFavorite, onToggleFavorite }) {
  const [imgError, setImgError] = useState(false);
  const inCart = cartQty > 0;

  // Support multiple images
  const imageUrl = product.image_url
    ? product.image_url.split(",")[0].trim()
    : null;

  return (
    <div
      className={`bg-card border rounded-xl overflow-hidden flex flex-col transition-all hover:shadow-lg group ${
        inCart ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/40"
      }`}
    >
      {/* Image */}
      <div className="aspect-square bg-muted relative overflow-hidden cursor-pointer" onClick={() => onQuickView?.(product)}>
        {imageUrl && !imgError ? (
          <img
            src={imageUrl}
            alt={product.name}
            className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-300"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-12 h-12 text-muted-foreground/30" />
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
          <div className="bg-white/90 text-foreground text-xs font-medium px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow">
            <Eye className="w-3.5 h-3.5" /> צפה בפרטים
          </div>
        </div>

        {/* Stock badge */}
        {product.quantity !== undefined && (
          <div className={`absolute bottom-2 left-2 text-xs font-medium px-2 py-0.5 rounded-full shadow-sm ${
            product.quantity <= 0
              ? "bg-red-100 text-red-700"
              : product.quantity <= (product.min_quantity || 5)
              ? "bg-yellow-100 text-yellow-700"
              : "bg-green-100 text-green-700"
          }`}>
            {product.quantity <= 0 ? "אזל" : `${product.quantity}`}
          </div>
        )}

        {/* Cart qty badge */}
        {inCart && (
          <div className="absolute top-2 right-2 bg-primary text-primary-foreground text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shadow-sm">
            {cartQty}
          </div>
        )}

        {/* Favorite */}
        {onToggleFavorite && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(product.id); }}
            className={`absolute top-2 left-2 p-1.5 rounded-full shadow transition-all ${
              isFavorite ? "bg-red-500 text-white" : "bg-white/80 text-muted-foreground hover:text-red-500"
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${isFavorite ? "fill-current" : ""}`} />
          </button>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col flex-1">
        <div className="flex-1">
          <p className="font-semibold text-sm leading-tight">{product.name}</p>
          {product.sku && <p className="text-xs text-muted-foreground mt-0.5">מק״ט: {product.sku}</p>}
          {product.category && (
            <span className="inline-block text-xs text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded mt-1">{product.category}</span>
          )}
        </div>

        <div className="mt-2.5 flex items-end justify-between gap-2">
          <div>
            <p className="text-base font-bold text-primary">
              ₪{(product.sell_price || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            {product.unit && product.unit !== "יחידה" && (
              <p className="text-xs text-muted-foreground">לכל {product.unit}</p>
            )}
          </div>
          <Button
            size="sm"
            className="h-9 w-9 shrink-0 p-0"
            onClick={() => onAdd(product)}
            variant={inCart ? "default" : "outline"}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}