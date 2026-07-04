import { useState } from "react";
import { Plus, Package, Eye, Heart } from "lucide-react";

const ACCENT = "#F5885E";
const DARK   = "#120F1C";
const MUTED  = "#B2B0B1";

export default function ProductCard({ product, cartQty, onAdd, onQuickView, isFavorite, onToggleFavorite }) {
  const [imgError, setImgError] = useState(false);
  const [hovered, setHovered] = useState(false);
  const inCart = cartQty > 0;

  const imageUrl = product.image_url
    ? product.image_url.split(",")[0].trim()
    : null;

  const stockBadgeStyle = product.quantity <= 0
    ? { background: "rgba(239,68,68,0.1)", color: "#ef4444" }
    : product.quantity <= (product.min_quantity || 5)
    ? { background: "rgba(234,179,8,0.1)", color: "#ca8a04" }
    : { background: "rgba(22,163,74,0.1)", color: "#16a34a" };

  return (
    /* OLD: <div className={`bg-card border rounded-xl overflow-hidden flex flex-col transition-all hover:shadow-lg group ${inCart ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/40"}`}> */
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "#FFFFFF",
        borderRadius: 16,
        border: `1px solid ${inCart || hovered ? ACCENT : "rgba(0,0,0,0.05)"}`,
        boxShadow: hovered ? "0 8px 24px rgba(0,0,0,0.08)" : "0 4px 20px rgba(0,0,0,0.04)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
        transition: "all 0.18s ease",
        ...(inCart ? { outline: "2px solid rgba(245,136,94,0.2)" } : {}),
        fontFamily: "'Heebo', sans-serif",
      }}
    >
      {/* Image */}
      {/* OLD: <div className="aspect-square bg-muted relative overflow-hidden cursor-pointer"> */}
      <div style={{ aspectRatio: "1 / 1", background: "#F5F3F6", position: "relative", overflow: "hidden", cursor: "pointer" }} onClick={() => onQuickView?.(product)}>
        {imageUrl && !imgError ? (
          <img
            src={imageUrl}
            alt={product.name}
            style={{ width: "100%", height: "100%", objectFit: "cover", transition: "transform 0.3s ease", transform: hovered ? "scale(1.05)" : "scale(1)" }}
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          /* OLD: <div className="w-full h-full flex items-center justify-center"> */
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Package style={{ width: 40, height: 40, color: MUTED, opacity: 0.3 }} />
          </div>
        )}

        {/* Hover overlay */}
        {/* OLD: <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100"> */}
        <div style={{ position: "absolute", inset: 0, background: hovered ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0)", transition: "background 0.18s ease", display: "flex", alignItems: "center", justifyContent: "center", opacity: hovered ? 1 : 0 }}>
          {/* OLD: <div className="bg-white/90 text-foreground text-xs font-medium px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow"> */}
          <div style={{ background: "rgba(255,255,255,0.92)", color: DARK, fontSize: 11, fontWeight: 500, padding: "6px 14px", borderRadius: 99, display: "flex", alignItems: "center", gap: 6, boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>
            <Eye style={{ width: 13, height: 13 }} /> צפה בפרטים
          </div>
        </div>

        {/* Stock badge */}
        {product.quantity !== undefined && (
          /* OLD: <div className={`absolute bottom-2 left-2 text-xs font-medium px-2 py-0.5 rounded-full shadow-sm ${...}`}> */
          <div className="heillo-badge" style={{ position: "absolute", bottom: 8, left: 8, ...stockBadgeStyle }}>
            {product.quantity <= 0 ? "אזל" : `${product.quantity}`}
          </div>
        )}

        {/* Cart qty badge */}
        {inCart && (
          /* OLD: <div className="absolute top-2 right-2 bg-primary text-primary-foreground text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shadow-sm"> */
          <div style={{ position: "absolute", top: 8, right: 8, background: ACCENT, color: "#FFFFFF", fontSize: 11, fontWeight: 700, width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(245,136,94,0.4)" }}>
            {cartQty}
          </div>
        )}

        {/* Favorite */}
        {onToggleFavorite && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(product.id); }}
            /* OLD: className={`absolute top-2 left-2 p-1.5 rounded-full shadow transition-all ${isFavorite ? "bg-red-500 text-white" : "bg-white/80 text-muted-foreground hover:text-red-500"}`} */
            style={{ position: "absolute", top: 8, left: 8, padding: 6, borderRadius: "50%", border: "none", cursor: "pointer", background: isFavorite ? "#ef4444" : "rgba(255,255,255,0.85)", color: isFavorite ? "#fff" : MUTED, boxShadow: "0 1px 4px rgba(0,0,0,0.1)", transition: "all 0.15s ease", display: "flex", alignItems: "center" }}
          >
            <Heart style={{ width: 13, height: 13, fill: isFavorite ? "currentColor" : "none" }} />
          </button>
        )}
      </div>

      {/* Info */}
      {/* OLD: <div className="p-3 flex flex-col flex-1"> */}
      <div style={{ padding: 12, display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ flex: 1 }}>
          {/* OLD: <p className="font-semibold text-sm leading-tight"> */}
          <p style={{ fontSize: 13, fontWeight: 600, color: DARK, lineHeight: 1.3, margin: 0 }}>{product.name}</p>
          {/* OLD: {product.sku && <p className="text-xs text-muted-foreground mt-0.5">} */}
          {product.sku && <p style={{ fontSize: 11, color: MUTED, margin: "3px 0 0" }}>מק״ט: {product.sku}</p>}
          {product.category && (
            /* OLD: <span className="inline-block text-xs text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded mt-1"> */
            <span style={{ display: "inline-block", fontSize: 11, color: MUTED, background: "#F5F3F6", padding: "2px 7px", borderRadius: 6, marginTop: 4 }}>{product.category}</span>
          )}
        </div>

        <div style={{ marginTop: 10, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
          <div>
            {/* OLD: <p className="text-base font-bold text-primary"> */}
            <p style={{ fontSize: 15, fontWeight: 700, color: ACCENT, margin: 0 }}>
              ₪{(product.sell_price || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            {product.unit && product.unit !== "יחידה" && (
              /* OLD: <p className="text-xs text-muted-foreground"> */
              <p style={{ fontSize: 11, color: MUTED, margin: "2px 0 0" }}>לכל {product.unit}</p>
            )}
          </div>
          {/* OLD: <Button size="sm" className="h-9 w-9 shrink-0 p-0" onClick={() => onAdd(product)} variant={inCart ? "default" : "outline"}> */}
          <button
            onClick={() => onAdd(product)}
            style={{ width: 34, height: 34, borderRadius: 12, border: "none", background: ACCENT, color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", transition: "opacity 0.15s ease" }}
            onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
          >
            <Plus style={{ width: 16, height: 16 }} />
          </button>
        </div>
      </div>
    </div>
  );
}