import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";

const ACCENT = "#F5885E";
const DARK = "#120F1C";
const MUTED = "#B2B0B1";

const PAGE_BG = {
  minHeight: "100vh",
  background: "radial-gradient(ellipse 40% 35% at 75% 5%, rgba(252,234,227,0.75) 0%, rgba(236,237,240,0) 100%), #ECEDF0",
  fontFamily: "'Heebo', sans-serif",
  direction: "rtl",
};

function Spinner() {
  return (
    <div style={{ ...PAGE_BG, display: "flex", alignItems: "center", justifyContent: "center" }} dir="rtl">
      <div style={{
        width: 36, height: 36,
        border: "3px solid rgba(245,136,94,0.2)",
        borderTopColor: ACCENT,
        borderRadius: "50%",
        animation: "spin 0.7s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ProductCard({ product, discount }) {
  const [imgError, setImgError] = useState(false);
  const imageUrl = product.image_url
    ? product.image_url.split(",")[0].trim()
    : null;
  const showImage = imageUrl && !imgError;

  const originalPrice = product.sell_price || 0;
  const discountedPrice = originalPrice * (1 - discount / 100);

  return (
    <div style={{
      background: "#FFFFFF",
      borderRadius: 22,
      boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Image */}
      <div style={{ width: "100%", aspectRatio: "4/3", background: "#F5F3F6", overflow: "hidden", flexShrink: 0 }}>
        {showImage ? (
          <img
            src={imageUrl}
            alt={product.name}
            onError={() => setImgError(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: DARK, margin: 0, lineHeight: 1.4 }}>
          {product.name}
        </p>
        {product.description && (
          <p style={{ fontSize: 12, color: MUTED, margin: 0, lineHeight: 1.5,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {product.description}
          </p>
        )}
        <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: ACCENT }}>
            ₪{discountedPrice.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          {discount > 0 && (
            <span style={{ fontSize: 13, color: MUTED, textDecoration: "line-through" }}>
              ₪{originalPrice.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}
          <span style={{ fontSize: 12, color: MUTED, marginRight: "auto" }}>{product.unit || "יחידה"}</span>
        </div>
      </div>
    </div>
  );
}

export default function PortalCatalog() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("loading");
  const [discount, setDiscount] = useState(0);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("הכל");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // 1. Session guard
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (!cancelled) navigate("/portal/login", { replace: true });
        return;
      }

      // 2. Portal access guard
      const { data: access } = await supabase
        .from("customer_portal_access")
        .select("is_active, customer_id, custom_discount_percent")
        .eq("auth_user_id", session.user.id)
        .maybeSingle();

      if (!access || !access.is_active) {
        if (!cancelled) navigate("/portal/login", { replace: true });
        return;
      }

      // 3. Effective discount: portal override > customer row > 0
      let effectiveDiscount = 0;
      if ((access.custom_discount_percent || 0) > 0) {
        effectiveDiscount = access.custom_discount_percent;
      } else {
        const { data: customer } = await supabase
          .from("customers")
          .select("discount_percent")
          .eq("id", access.customer_id)
          .maybeSingle();
        effectiveDiscount = customer?.discount_percent || 0;
      }

      // 4. Fetch active products + blocked product IDs in parallel
      const [{ data: allProducts }, { data: blocked }] = await Promise.all([
        supabase.from("products").select("id, name, sell_price, quantity, unit, image_url, category, description").eq("is_active", true),
        supabase.from("customer_blocked_products").select("product_id").eq("customer_id", access.customer_id),
      ]);

      if (!cancelled) {
        const blockedIds = new Set((blocked || []).map(b => b.product_id));
        const visible = (allProducts || []).filter(p => !blockedIds.has(p.id));
        setDiscount(effectiveDiscount);
        setProducts(visible);
        setStatus("ready");
      }
    };

    load();
    return () => { cancelled = true; };
  }, [navigate]);

  const categories = useMemo(() => {
    const cats = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
    return ["הכל", ...cats];
  }, [products]);

  const filtered = useMemo(() => {
    let list = products;
    if (activeCategory !== "הכל") list = list.filter(p => p.category === activeCategory);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p => p.name?.toLowerCase().includes(q));
    }
    return list;
  }, [products, activeCategory, search]);

  if (status === "loading") return <Spinner />;

  return (
    <div dir="rtl" style={{ ...PAGE_BG, padding: "24px 16px 48px" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ maxWidth: 1100, margin: "0 auto 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: DARK, margin: 0, letterSpacing: "-0.5px" }}>
            א.ד שיווק והפצה
          </h1>
          <p style={{ fontSize: 13, color: MUTED, margin: "2px 0 0" }}>קטלוג מוצרים</p>
        </div>
        <button
          onClick={() => navigate("/portal/dashboard")}
          style={{
            background: "#FFFFFF",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 12,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            color: DARK,
            fontFamily: "'Heebo', sans-serif",
            cursor: "pointer",
          }}
          onMouseEnter={e => e.currentTarget.style.background = "#F5F3F6"}
          onMouseLeave={e => e.currentTarget.style.background = "#FFFFFF"}
        >
          ← חזרה לדשבורד
        </button>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Search */}
        <div style={{ position: "relative", marginBottom: 16 }}>
          <svg style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: MUTED, pointerEvents: "none" }}
            viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="חיפוש מוצר..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: "100%", height: 44, background: "#FFFFFF",
              border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14,
              padding: "0 44px 0 14px", fontSize: 14, color: DARK,
              fontFamily: "'Heebo', sans-serif", outline: "none", boxSizing: "border-box",
            }}
          />
        </div>

        {/* Category pills */}
        {categories.length > 1 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                style={{
                  padding: "6px 16px",
                  borderRadius: 99,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "'Heebo', sans-serif",
                  background: activeCategory === cat ? ACCENT : "#FFFFFF",
                  color: activeCategory === cat ? "#FFFFFF" : DARK,
                  boxShadow: activeCategory === cat ? "0 2px 8px rgba(245,136,94,0.3)" : "0 1px 4px rgba(0,0,0,0.06)",
                  transition: "background 0.15s, color 0.15s",
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Discount banner */}
        {discount > 0 && (
          <div style={{ background: "rgba(245,136,94,0.1)", border: "1px solid rgba(245,136,94,0.25)", borderRadius: 14, padding: "10px 16px", marginBottom: 20, fontSize: 13, color: ACCENT, fontWeight: 600 }}>
            ✓ ההנחה שלך ({discount}%) מחושבת אוטומטית על כל המחירים
          </div>
        )}

        {/* Grid */}
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "64px 0", color: MUTED, fontSize: 15 }}>
            לא נמצאו מוצרים
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 16,
          }}>
            {filtered.map(product => (
              <ProductCard key={product.id} product={product} discount={discount} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
