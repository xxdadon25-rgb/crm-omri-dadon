import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { usePortalPWAMeta } from "@/hooks/usePortalPWAMeta";

const ACCENT = "#F5885E";
const DARK = "#120F1C";
const MUTED = "#B2B0B1";

const PAGE_BG = {
  minHeight: "100vh",
  background: "radial-gradient(ellipse 40% 35% at 75% 5%, rgba(252,234,227,0.75) 0%, rgba(236,237,240,0) 100%), #ECEDF0",
  fontFamily: "'Heebo', sans-serif",
  direction: "rtl",
};

const fmt = (n) => (n || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div style={{ ...PAGE_BG, display: "flex", alignItems: "center", justifyContent: "center" }} dir="rtl">
      <div style={{ width: 36, height: 36, border: "3px solid rgba(245,136,94,0.2)", borderTopColor: ACCENT, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ─── Product Card ─────────────────────────────────────────────────────────────
function ProductCard({ product, discount, cartQty, onAdd }) {
  const [imgError, setImgError] = useState(false);
  const imageUrl = product.image_url ? product.image_url.split(",")[0].trim() : null;
  const showImage = imageUrl && !imgError;
  const originalPrice = product.sell_price || 0;
  const discountedPrice = originalPrice * (1 - discount / 100);

  return (
    <div style={{ background: "#FFFFFF", borderRadius: 22, boxShadow: "0 4px 20px rgba(0,0,0,0.05)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ width: "100%", aspectRatio: "4/3", background: "#F5F3F6", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {showImage ? (
          <img src={imageUrl} alt={product.name} onError={() => setImgError(true)} style={{ width: "100%", height: "100%", objectFit: "contain", padding: "8px" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}
      </div>

      <div className="card-body" style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
        <p className="card-name" style={{ fontSize: 14, fontWeight: 700, color: DARK, margin: 0, lineHeight: 1.4 }}>{product.name}</p>
        {product.description && (
          <p className="card-desc" style={{ fontSize: 12, color: MUTED, margin: 0, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {product.description}
          </p>
        )}
        <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span className="card-price" style={{ fontSize: 18, fontWeight: 800, color: ACCENT }}>₪{fmt(discountedPrice)}</span>
          {discount > 0 && <span className="card-price-orig" style={{ fontSize: 13, color: MUTED, textDecoration: "line-through" }}>₪{fmt(originalPrice)}</span>}
          <span className="card-unit" style={{ fontSize: 12, color: MUTED, marginRight: "auto" }}>{product.unit || "יחידה"}</span>
        </div>
        <button
          className="card-btn"
          onClick={() => onAdd(product, discountedPrice)}
          style={{
            marginTop: 8, height: 36,
            background: cartQty > 0 ? "rgba(245,136,94,0.12)" : ACCENT,
            color: cartQty > 0 ? ACCENT : "#FFFFFF",
            border: cartQty > 0 ? `1.5px solid ${ACCENT}` : "none",
            borderRadius: 12, fontSize: 13, fontWeight: 700, fontFamily: "'Heebo', sans-serif",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          {cartQty > 0 ? `בסל (${cartQty})` : "הוסף לסל"}
        </button>
      </div>
    </div>
  );
}

// ─── Cart Panel (desktop always-visible / mobile modal inner content) ─────────
function CartPanel({ cart, minOrderAmount, onUpdate, onRemove, onSubmit, submitting, submitResult, onDismissSuccess, isModal }) {
  const total = cart.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const belowMin = minOrderAmount > 0 && total < minOrderAmount;
  const canSubmit = cart.length > 0 && !belowMin && !submitting;

  return (
    <div className="portal-cart-panel" style={{
      background: "#FFFFFF",
      borderRadius: isModal ? "22px 22px 0 0" : 22,
      boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
      display: "flex",
      flexDirection: "column",
      fontFamily: "'Heebo', sans-serif",
      position: isModal ? "static" : "sticky",
      top: isModal ? "auto" : 24,
      maxHeight: isModal ? "80vh" : "calc(100vh - 48px)",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid rgba(0,0,0,0.06)", flexShrink: 0 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: DARK }}>🛒 סל הקניות</h2>
      </div>

      {/* Success state */}
      {submitResult === "success" ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 28, textAlign: "center", gap: 14 }}>
          <div style={{ fontSize: 44 }}>✅</div>
          <p style={{ fontSize: 15, fontWeight: 700, color: DARK, margin: 0 }}>ההזמנה נשלחה ומחכה לאישור</p>
          <button onClick={onDismissSuccess}
            style={{ marginTop: 4, background: ACCENT, color: "#FFF", border: "none", borderRadius: 12, padding: "9px 22px", fontSize: 14, fontWeight: 700, fontFamily: "'Heebo', sans-serif", cursor: "pointer" }}>
            המשך קנייה
          </button>
        </div>
      ) : submitResult === "demo" ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 28, textAlign: "center", gap: 14 }}>
          <div style={{ fontSize: 44 }}>🔍</div>
          <p style={{ fontSize: 15, fontWeight: 700, color: DARK, margin: 0 }}>זהו מצב הדגמה</p>
          <p style={{ fontSize: 13, color: "#B2B0B1", margin: 0 }}>הזמנות לא נשלחות בפועל</p>
          <button onClick={onDismissSuccess}
            style={{ marginTop: 4, background: ACCENT, color: "#FFF", border: "none", borderRadius: 12, padding: "9px 22px", fontSize: 14, fontWeight: 700, fontFamily: "'Heebo', sans-serif", cursor: "pointer" }}>
            המשך צפייה
          </button>
        </div>
      ) : (
        <>
          {/* Items — scrollable */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
            {cart.length === 0 ? (
              <p style={{ color: MUTED, textAlign: "center", marginTop: 32, fontSize: 13 }}>הסל ריק</p>
            ) : cart.map(item => (
              <div key={item.product_id} style={{ display: "flex", alignItems: "flex-start", gap: 8, paddingBottom: 14, marginBottom: 14, borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: "0 0 3px", fontSize: 13, fontWeight: 700, color: DARK, lineHeight: 1.4 }}>{item.name}</p>
                  <p style={{ margin: 0, fontSize: 11, color: MUTED }}>₪{fmt(item.unit_price)} ליחידה</p>
                </div>

                {/* Qty stepper */}
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  <button onClick={() => onUpdate(item.product_id, item.quantity - 1)}
                    style={{ width: 26, height: 26, borderRadius: 7, border: "1px solid rgba(0,0,0,0.1)", background: "#F5F3F6", cursor: "pointer", fontSize: 15, fontWeight: 700, color: DARK, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                  <span style={{ fontSize: 13, fontWeight: 700, color: DARK, minWidth: 18, textAlign: "center" }}>{item.quantity}</span>
                  <button onClick={() => onUpdate(item.product_id, item.quantity + 1)}
                    style={{ width: 26, height: 26, borderRadius: 7, border: "1px solid rgba(0,0,0,0.1)", background: "#F5F3F6", cursor: "pointer", fontSize: 15, fontWeight: 700, color: DARK, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                </div>

                {/* Line total */}
                <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT, flexShrink: 0, minWidth: 54, textAlign: "left" }}>₪{fmt(item.unit_price * item.quantity)}</span>

                {/* Remove */}
                <button onClick={() => onRemove(item.product_id)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: MUTED, fontSize: 15, padding: 2, flexShrink: 0, lineHeight: 1 }}>✕</button>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ padding: "14px 16px 18px", borderTop: "1px solid rgba(0,0,0,0.06)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: DARK }}>סה״כ</span>
              <span style={{ fontSize: 17, fontWeight: 800, color: ACCENT }}>₪{fmt(total)}</span>
            </div>

            {belowMin && (
              <p style={{ margin: 0, fontSize: 12, color: "#dc2626", fontWeight: 600 }}>
                סכום מינימלי: ₪{fmt(minOrderAmount)}
              </p>
            )}

            {submitResult === "error" && (
              <p style={{ margin: 0, fontSize: 12, color: "#dc2626" }}>אירעה שגיאה. נסה שוב.</p>
            )}

            <button onClick={onSubmit} disabled={!canSubmit}
              style={{
                height: 44, background: canSubmit ? ACCENT : "#E0E0E0", color: canSubmit ? "#FFFFFF" : MUTED,
                border: "none", borderRadius: 13, fontSize: 14, fontWeight: 700,
                fontFamily: "'Heebo', sans-serif", cursor: canSubmit ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
              {submitting ? (
                <><span style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />שולח...</>
              ) : "שלח הזמנה"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Mobile: category bottom sheet ────────────────────────────────────────────
function MobileCategorySheet({ categories, activeCategory, onSelect, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }} />
      {/* Sheet */}
      <div style={{ position: "relative", background: "#FFFFFF", borderRadius: "22px 22px 0 0", maxHeight: "70vh", display: "flex", flexDirection: "column", fontFamily: "'Heebo', sans-serif", direction: "rtl" }}>
        {/* Handle + header */}
        <div style={{ padding: "14px 20px 10px", borderBottom: "1px solid rgba(0,0,0,0.06)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: DARK }}>קטגוריות</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: MUTED, lineHeight: 1, padding: 4 }}>✕</button>
        </div>
        {/* Category rows */}
        <div style={{ overflowY: "auto", padding: "8px 0 calc(env(safe-area-inset-bottom) + 16px)" }}>
          {categories.map(cat => (
            <button key={cat} onClick={() => { onSelect(cat); onClose(); }}
              style={{
                width: "100%", padding: "14px 20px", border: "none", cursor: "pointer",
                fontFamily: "'Heebo', sans-serif", textAlign: "right", fontSize: 15, fontWeight: activeCategory === cat ? 700 : 500,
                background: activeCategory === cat ? "rgba(245,136,94,0.08)" : "transparent",
                color: activeCategory === cat ? ACCENT : DARK,
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
              {cat}
              {activeCategory === cat && <span style={{ fontSize: 16 }}>✓</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Mobile: cart bottom sheet ────────────────────────────────────────────────
function MobileCartSheet({ onClose, ...cartProps }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }} />
      {/* Sheet */}
      <div style={{ position: "relative", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <CartPanel {...cartProps} isModal={true} />
      </div>
    </div>
  );
}

// ─── Mobile: floating cart button ─────────────────────────────────────────────
function MobileCartFab({ itemCount, onClick }) {
  if (itemCount === 0) return null;
  return (
    <button onClick={onClick} style={{
      position: "fixed", bottom: "calc(env(safe-area-inset-bottom) + 20px)", left: 20,
      width: 58, height: 58, borderRadius: "50%",
      background: ACCENT, border: "none", cursor: "pointer",
      boxShadow: "0 4px 20px rgba(245,136,94,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 900,
    }}>
      {/* Cart icon */}
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
      {/* Badge */}
      <span style={{
        position: "absolute", top: 2, right: 2,
        background: "#FFFFFF", color: ACCENT,
        borderRadius: "50%", width: 20, height: 20,
        fontSize: 11, fontWeight: 800, fontFamily: "'Heebo', sans-serif",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
      }}>{itemCount}</span>
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PortalCatalog() {
  usePortalPWAMeta();
  const navigate = useNavigate();
  const [status, setStatus] = useState("loading");
  const [discount, setDiscount] = useState(0);
  const [products, setProducts] = useState([]);
  const [customerId, setCustomerId] = useState(null);
  const [minOrderAmount, setMinOrderAmount] = useState(0);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("הכל");
  const [cart, setCart] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null); // null | "success" | "error"
  const [isDemo, setIsDemo] = useState(false);

  // Mobile sheet state
  const [catSheetOpen, setCatSheetOpen] = useState(false);
  const [cartSheetOpen, setCartSheetOpen] = useState(false);

  // Restore cart from sessionStorage once customer_id is known
  useEffect(() => {
    if (!customerId) return;
    try {
      const saved = sessionStorage.getItem(`portal_cart_${customerId}`);
      if (saved) setCart(JSON.parse(saved));
    } catch { /* ignore */ }
  }, [customerId]);

  // Persist cart to sessionStorage on every change
  useEffect(() => {
    if (!customerId) return;
    try {
      sessionStorage.setItem(`portal_cart_${customerId}`, JSON.stringify(cart));
    } catch { /* ignore */ }
  }, [cart, customerId]);

  // Load page data
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { if (!cancelled) navigate("/portal/login", { replace: true }); return; }

      const { data: access } = await supabase
        .from("customer_portal_access")
        .select("is_active, customer_id, custom_discount_percent, min_order_amount")
        .eq("auth_user_id", session.user.id)
        .maybeSingle();

      if (!access || !access.is_active) {
        // Fallback: check if this is a staff member (demo mode)
        const { data: staff } = await supabase
          .from("staff_members")
          .select("id")
          .eq("auth_user_id", session.user.id)
          .maybeSingle();

        if (!staff) { if (!cancelled) navigate("/portal/login", { replace: true }); return; }

        // Demo mode: load all active products, no discount, no blocked filter
        const { data: allProducts } = await supabase
          .from("products")
          .select("id, name, sell_price, quantity, unit, image_url, category, description")
          .eq("is_active", true);

        if (!cancelled) {
          setIsDemo(true);
          setDiscount(0);
          setMinOrderAmount(0);
          setProducts(allProducts || []);
          setStatus("ready");
        }
        return;
      }

      let effectiveDiscount = 0;
      if ((access.custom_discount_percent || 0) > 0) {
        effectiveDiscount = access.custom_discount_percent;
      } else {
        const { data: customer } = await supabase.from("customers").select("discount_percent").eq("id", access.customer_id).maybeSingle();
        effectiveDiscount = customer?.discount_percent || 0;
      }

      const [{ data: allProducts }, { data: blocked }] = await Promise.all([
        supabase.from("products").select("id, name, sell_price, quantity, unit, image_url, category, description").eq("is_active", true),
        supabase.from("customer_blocked_products").select("product_id").eq("customer_id", access.customer_id),
      ]);

      if (!cancelled) {
        const blockedIds = new Set((blocked || []).map(b => b.product_id));
        setCustomerId(access.customer_id);
        setMinOrderAmount(access.min_order_amount || 0);
        setDiscount(effectiveDiscount);
        setProducts((allProducts || []).filter(p => !blockedIds.has(p.id)));
        setStatus("ready");
      }
    };
    load();
    return () => { cancelled = true; };
  }, [navigate]);

  // Cart helpers
  const addToCart = useCallback((product, discountedPrice) => {
    setCart(prev => {
      const existing = prev.find(i => i.product_id === product.id);
      if (existing) return prev.map(i => i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { product_id: product.id, name: product.name, unit_price: discountedPrice, quantity: 1 }];
    });
  }, []);

  const updateQty = useCallback((product_id, qty) => {
    if (qty <= 0) { setCart(prev => prev.filter(i => i.product_id !== product_id)); return; }
    setCart(prev => prev.map(i => i.product_id === product_id ? { ...i, quantity: qty } : i));
  }, []);

  const removeItem = useCallback((product_id) => {
    setCart(prev => prev.filter(i => i.product_id !== product_id));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    if (customerId) sessionStorage.removeItem(`portal_cart_${customerId}`);
  }, [customerId]);

  // Submit order
  const handleSubmit = async () => {
    if (cart.length === 0) return;

    // Demo mode: simulate success without DB insert
    if (isDemo) {
      setSubmitting(true);
      setSubmitResult(null);
      await new Promise(r => setTimeout(r, 800));
      clearCart();
      setSubmitResult("demo");
      setSubmitting(false);
      return;
    }

    if (!customerId) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const total = cart.reduce((s, i) => s + i.unit_price * i.quantity, 0);

      const { data: order, error: orderErr } = await supabase
        .from("portal_orders")
        .insert({ customer_id: customerId, status: "pending", total_amount: total })
        .select("id")
        .single();

      if (orderErr || !order?.id) throw orderErr || new Error("no order id");

      const items = cart.map(i => ({ portal_order_id: order.id, product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price }));
      const { error: itemsErr } = await supabase.from("portal_order_items").insert(items);
      if (itemsErr) throw itemsErr;

      clearCart();
      setSubmitResult("success");
    } catch {
      setSubmitResult("error");
    } finally {
      setSubmitting(false);
    }
  };

  const categories = useMemo(() => {
    const cats = [...new Set(products.map(p => p.category?.trim()).filter(Boolean))].sort();
    return ["הכל", ...cats];
  }, [products]);

  const filtered = useMemo(() => {
    let list = products;
    if (activeCategory !== "הכל") list = list.filter(p => p.category?.trim() === activeCategory);
    if (search.trim()) { const q = search.trim().toLowerCase(); list = list.filter(p => p.name?.toLowerCase().includes(q)); }
    return list;
  }, [products, activeCategory, search]);

  const cartItemCount = cart.reduce((s, i) => s + i.quantity, 0);

  const cartProps = {
    cart,
    minOrderAmount,
    onUpdate: updateQty,
    onRemove: removeItem,
    onSubmit: handleSubmit,
    submitting,
    submitResult,
    onDismissSuccess: () => { setSubmitResult(null); setCartSheetOpen(false); },
  };

  if (status === "loading") return <Spinner />;

  return (
    <div dir="rtl" style={{ ...PAGE_BG, paddingTop: "calc(env(safe-area-inset-top) + 24px)", paddingRight: 16, paddingBottom: 48, paddingLeft: 16 }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @media(max-width:1024px){
          .portal-layout{flex-direction:column !important;}
          .portal-cat-col{display:none !important;}
          .portal-cart-col{display:none !important;}
          .portal-product-grid{grid-template-columns:repeat(4,1fr) !important;}
          .portal-mobile-cat-btn{display:flex !important;}
        }
        @media(max-width:768px){
          .portal-product-grid{grid-template-columns:repeat(2,1fr) !important;}
        }
        @media(min-width:1025px){
          .portal-mobile-cat-btn{display:none !important;}
          .portal-mobile-cart-fab{display:none !important;}
        }
        @media(max-width:480px){
          .portal-product-grid{grid-template-columns:repeat(3,1fr) !important; gap:8px !important;}
          .portal-product-grid .card-body{padding:8px 8px 10px !important;}
          .portal-product-grid .card-name{font-size:11px !important;}
          .portal-product-grid .card-desc{display:none !important;}
          .portal-product-grid .card-price{font-size:14px !important;}
          .portal-product-grid .card-price-orig{font-size:11px !important;}
          .portal-product-grid .card-unit{display:none !important;}
          .portal-product-grid .card-btn{height:30px !important; font-size:11px !important; border-radius:9px !important; margin-top:4px !important;}
        }
      `}</style>

      {/* Page header */}
      <div style={{ maxWidth: 1600, margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: DARK, margin: 0, letterSpacing: "-0.5px" }}>א.ד שיווק והפצה</h1>
            {isDemo && (
              <span style={{
                display: "inline-flex", alignItems: "center",
                background: "rgba(245,136,94,0.15)", color: "#F5885E",
                border: "1px solid rgba(245,136,94,0.35)",
                borderRadius: 99, padding: "2px 10px",
                fontSize: 11, fontWeight: 700,
              }}>מצב הדגמה</span>
            )}
          </div>
          <p style={{ fontSize: 13, color: MUTED, margin: "2px 0 0" }}>קטלוג מוצרים</p>
        </div>
        <button onClick={() => navigate("/portal/dashboard")}
          style={{ background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, padding: "8px 16px", fontSize: 13, fontWeight: 600, color: DARK, fontFamily: "'Heebo', sans-serif", cursor: "pointer" }}
          onMouseEnter={e => e.currentTarget.style.background = "#F5F3F6"}
          onMouseLeave={e => e.currentTarget.style.background = "#FFFFFF"}>
          ← חזרה לדשבורד
        </button>
      </div>

      {/* Three-column layout: categories (right) + catalog (middle) + cart (left) */}
      <div className="portal-layout" style={{ maxWidth: 1600, margin: "0 auto", display: "flex", gap: 20 }}>

        {/* ── Category sidebar (right column — desktop only) ── */}
        {categories.length > 1 && (
          <div className="portal-cat-col" style={{ width: 160, flexShrink: 0, alignSelf: "stretch" }}>
            <div className="portal-cat-sticky" style={{ position: "sticky", top: 0, zIndex: 10, display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 }}>
              {categories.map(cat => (
                <button key={cat} onClick={() => setActiveCategory(cat)}
                  style={{ width: "100%", padding: "9px 16px", borderRadius: 14, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "'Heebo', sans-serif", textAlign: "right", background: activeCategory === cat ? ACCENT : "#FFFFFF", color: activeCategory === cat ? "#FFFFFF" : DARK, boxShadow: activeCategory === cat ? "0 2px 8px rgba(245,136,94,0.3)" : "0 1px 4px rgba(0,0,0,0.06)", transition: "background 0.15s, color 0.15s" }}>
                  {cat}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Catalog column (middle) ── */}
        <div style={{ flex: 1, minWidth: 0, alignSelf: "flex-start" }}>
          {/* Sticky search bar + mobile category button */}
          <div style={{ position: "sticky", top: 0, zIndex: 10, background: "#ECEDF0", paddingBottom: 12, marginBottom: 4 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {/* Mobile category button — hidden on desktop via CSS */}
              {categories.length > 1 && (
                <button
                  className="portal-mobile-cat-btn"
                  onClick={() => setCatSheetOpen(true)}
                  style={{
                    display: "none", // overridden by media query on mobile
                    alignItems: "center", gap: 6, flexShrink: 0,
                    height: 44, padding: "0 14px",
                    background: activeCategory !== "הכל" ? ACCENT : "#FFFFFF",
                    color: activeCategory !== "הכל" ? "#FFFFFF" : DARK,
                    border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14,
                    fontSize: 13, fontWeight: 600, fontFamily: "'Heebo', sans-serif", cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}>
                  {/* Filter icon */}
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="11" y1="18" x2="13" y2="18" />
                  </svg>
                  {activeCategory !== "הכל" ? activeCategory : "קטגוריות"}
                </button>
              )}
              {/* Search input */}
              <div style={{ position: "relative", flex: 1 }}>
                <svg style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, pointerEvents: "none" }}
                  viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                </svg>
                <input type="text" placeholder="חיפוש מוצר..." value={search} onChange={e => setSearch(e.target.value)}
                  style={{ width: "100%", height: 44, background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, padding: "0 44px 0 14px", fontSize: 14, color: DARK, fontFamily: "'Heebo', sans-serif", outline: "none", boxSizing: "border-box" }} />
              </div>
            </div>
          </div>

          {/* Discount banner */}
          {discount > 0 && (
            <div style={{ background: "rgba(245,136,94,0.1)", border: "1px solid rgba(245,136,94,0.25)", borderRadius: 14, padding: "10px 16px", marginBottom: 20, fontSize: 13, color: ACCENT, fontWeight: 600 }}>
              ✓ ההנחה שלך ({discount}%) מחושבת אוטומטית על כל המחירים
            </div>
          )}

          {/* Product grid */}
          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "64px 0", color: MUTED, fontSize: 15 }}>לא נמצאו מוצרים</div>
          ) : (
            <div className="portal-product-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
              {filtered.map(product => {
                const cartItem = cart.find(i => i.product_id === product.id);
                return (
                  <ProductCard key={product.id} product={product} discount={discount}
                    cartQty={cartItem?.quantity || 0} onAdd={addToCart} />
                );
              })}
            </div>
          )}
        </div>

        {/* ── Cart panel column (desktop only — hidden on mobile via CSS) ── */}
        <div className="portal-cart-col" style={{ width: 320, flexShrink: 0, alignSelf: "stretch" }}>
          <CartPanel {...cartProps} isModal={false} />
        </div>

      </div>

      {/* ── Mobile: floating cart FAB (hidden on desktop via CSS) ── */}
      <div className="portal-mobile-cart-fab">
        <MobileCartFab itemCount={cartItemCount} onClick={() => setCartSheetOpen(true)} />
      </div>

      {/* ── Mobile: category bottom sheet ── */}
      {catSheetOpen && (
        <MobileCategorySheet
          categories={categories}
          activeCategory={activeCategory}
          onSelect={setActiveCategory}
          onClose={() => setCatSheetOpen(false)}
        />
      )}

      {/* ── Mobile: cart bottom sheet ── */}
      {cartSheetOpen && (
        <MobileCartSheet
          onClose={() => setCartSheetOpen(false)}
          {...cartProps}
        />
      )}
    </div>
  );
}
