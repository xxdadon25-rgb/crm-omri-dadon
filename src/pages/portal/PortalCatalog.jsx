import { useState, useEffect, useMemo, useCallback } from "react";
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
      {/* Image */}
      <div style={{ width: "100%", aspectRatio: "4/3", background: "#F5F3F6", overflow: "hidden", flexShrink: 0 }}>
        {showImage ? (
          <img src={imageUrl} alt={product.name} onError={() => setImgError(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: DARK, margin: 0, lineHeight: 1.4 }}>{product.name}</p>
        {product.description && (
          <p style={{ fontSize: 12, color: MUTED, margin: 0, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {product.description}
          </p>
        )}
        <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: ACCENT }}>₪{fmt(discountedPrice)}</span>
          {discount > 0 && <span style={{ fontSize: 13, color: MUTED, textDecoration: "line-through" }}>₪{fmt(originalPrice)}</span>}
          <span style={{ fontSize: 12, color: MUTED, marginRight: "auto" }}>{product.unit || "יחידה"}</span>
        </div>

        {/* Add to cart button */}
        <button
          onClick={() => onAdd(product, discountedPrice)}
          style={{
            marginTop: 8, height: 36, background: cartQty > 0 ? "rgba(245,136,94,0.12)" : ACCENT,
            color: cartQty > 0 ? ACCENT : "#FFFFFF", border: cartQty > 0 ? `1.5px solid ${ACCENT}` : "none",
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

// ─── Cart Drawer ──────────────────────────────────────────────────────────────
function CartDrawer({ cart, minOrderAmount, onClose, onUpdate, onRemove, onSubmit, submitting, submitResult }) {
  const total = cart.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const belowMin = minOrderAmount > 0 && total < minOrderAmount;
  const canSubmit = cart.length > 0 && !belowMin && !submitting;

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 1000 }} />

      {/* Drawer */}
      <div style={{
        position: "fixed", top: 0, left: 0, bottom: 0, width: "min(420px, 100vw)",
        background: "#FFFFFF", zIndex: 1001, display: "flex", flexDirection: "column",
        boxShadow: "4px 0 32px rgba(0,0,0,0.12)", fontFamily: "'Heebo', sans-serif",
      }} dir="rtl">

        {/* Header */}
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: DARK }}>סל הקניות</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: MUTED, fontSize: 22, lineHeight: 1 }}>✕</button>
        </div>

        {/* Success state */}
        {submitResult === "success" ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center", gap: 16 }}>
            <div style={{ fontSize: 48 }}>✅</div>
            <p style={{ fontSize: 16, fontWeight: 700, color: DARK, margin: 0 }}>ההזמנה נשלחה ומחכה לאישור</p>
            <button onClick={onClose} style={{ marginTop: 8, background: ACCENT, color: "#FFF", border: "none", borderRadius: 12, padding: "10px 24px", fontSize: 14, fontWeight: 700, fontFamily: "'Heebo', sans-serif", cursor: "pointer" }}>
              סגור
            </button>
          </div>
        ) : (
          <>
            {/* Items */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
              {cart.length === 0 ? (
                <p style={{ color: MUTED, textAlign: "center", marginTop: 40, fontSize: 14 }}>הסל ריק</p>
              ) : cart.map(item => (
                <div key={item.product_id} style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 14, marginBottom: 14, borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: "0 0 2px", fontSize: 13, fontWeight: 700, color: DARK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</p>
                    <p style={{ margin: 0, fontSize: 12, color: MUTED }}>₪{fmt(item.unit_price)} ליחידה</p>
                  </div>

                  {/* Qty stepper */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <button onClick={() => onUpdate(item.product_id, item.quantity - 1)}
                      style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)", background: "#F5F3F6", cursor: "pointer", fontSize: 16, fontWeight: 700, color: DARK, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                    <span style={{ fontSize: 14, fontWeight: 700, color: DARK, minWidth: 20, textAlign: "center" }}>{item.quantity}</span>
                    <button onClick={() => onUpdate(item.product_id, item.quantity + 1)}
                      style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)", background: "#F5F3F6", cursor: "pointer", fontSize: 16, fontWeight: 700, color: DARK, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                  </div>

                  {/* Line total */}
                  <span style={{ fontSize: 13, fontWeight: 700, color: ACCENT, flexShrink: 0, minWidth: 60, textAlign: "left" }}>₪{fmt(item.unit_price * item.quantity)}</span>

                  {/* Remove */}
                  <button onClick={() => onRemove(item.product_id)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: MUTED, fontSize: 16, padding: 2, flexShrink: 0 }}>✕</button>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{ padding: "16px 20px 24px", borderTop: "1px solid rgba(0,0,0,0.06)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: DARK }}>סה״כ</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: ACCENT }}>₪{fmt(total)}</span>
              </div>

              {belowMin && (
                <p style={{ margin: 0, fontSize: 13, color: "#dc2626", fontWeight: 600 }}>
                  סכום ההזמנה המינימלי הוא ₪{fmt(minOrderAmount)}
                </p>
              )}

              {submitResult === "error" && (
                <p style={{ margin: 0, fontSize: 13, color: "#dc2626" }}>אירעה שגיאה בשליחת ההזמנה. נסה שוב.</p>
              )}

              <button
                onClick={onSubmit}
                disabled={!canSubmit}
                style={{
                  height: 46, background: canSubmit ? ACCENT : "#E0E0E0", color: canSubmit ? "#FFFFFF" : MUTED,
                  border: "none", borderRadius: 14, fontSize: 15, fontWeight: 700,
                  fontFamily: "'Heebo', sans-serif", cursor: canSubmit ? "pointer" : "not-allowed",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {submitting ? (
                  <><span style={{ width: 18, height: 18, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />שולח...</>
                ) : "שלח הזמנה"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PortalCatalog() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("loading");
  const [discount, setDiscount] = useState(0);
  const [products, setProducts] = useState([]);
  const [customerId, setCustomerId] = useState(null);
  const [minOrderAmount, setMinOrderAmount] = useState(0);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("הכל");
  const [cart, setCart] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null); // null | "success" | "error"

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

      if (!access || !access.is_active) { if (!cancelled) navigate("/portal/login", { replace: true }); return; }

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
    if (!customerId || cart.length === 0) return;
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

  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);

  if (status === "loading") return <Spinner />;

  return (
    <div dir="rtl" style={{ ...PAGE_BG, padding: "24px 16px 96px" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ maxWidth: 1100, margin: "0 auto 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: DARK, margin: 0, letterSpacing: "-0.5px" }}>א.ד שיווק והפצה</h1>
          <p style={{ fontSize: 13, color: MUTED, margin: "2px 0 0" }}>קטלוג מוצרים</p>
        </div>
        <button onClick={() => navigate("/portal/dashboard")}
          style={{ background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, padding: "8px 16px", fontSize: 13, fontWeight: 600, color: DARK, fontFamily: "'Heebo', sans-serif", cursor: "pointer" }}
          onMouseEnter={e => e.currentTarget.style.background = "#F5F3F6"}
          onMouseLeave={e => e.currentTarget.style.background = "#FFFFFF"}>
          ← חזרה לדשבורד
        </button>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Search */}
        <div style={{ position: "relative", marginBottom: 16 }}>
          <svg style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, pointerEvents: "none" }} viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input type="text" placeholder="חיפוש מוצר..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", height: 44, background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, padding: "0 44px 0 14px", fontSize: 14, color: DARK, fontFamily: "'Heebo', sans-serif", outline: "none", boxSizing: "border-box" }} />
        </div>

        {/* Category pills */}
        {categories.length > 1 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
            {categories.map(cat => (
              <button key={cat} onClick={() => setActiveCategory(cat)}
                style={{ padding: "6px 16px", borderRadius: 99, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "'Heebo', sans-serif", background: activeCategory === cat ? ACCENT : "#FFFFFF", color: activeCategory === cat ? "#FFFFFF" : DARK, boxShadow: activeCategory === cat ? "0 2px 8px rgba(245,136,94,0.3)" : "0 1px 4px rgba(0,0,0,0.06)", transition: "background 0.15s, color 0.15s" }}>
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
          <div style={{ textAlign: "center", padding: "64px 0", color: MUTED, fontSize: 15 }}>לא נמצאו מוצרים</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
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

      {/* Floating cart button */}
      {cartCount > 0 && (
        <button onClick={() => { setSubmitResult(null); setDrawerOpen(true); }}
          style={{
            position: "fixed", bottom: 24, left: 24, zIndex: 900,
            background: ACCENT, color: "#FFFFFF", border: "none", borderRadius: 99,
            padding: "14px 22px", fontSize: 15, fontWeight: 800, fontFamily: "'Heebo', sans-serif",
            cursor: "pointer", boxShadow: "0 4px 20px rgba(245,136,94,0.45)",
            display: "flex", alignItems: "center", gap: 10,
          }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 01-8 0" />
          </svg>
          סל ({cartCount})
        </button>
      )}

      {/* Cart drawer */}
      {drawerOpen && (
        <CartDrawer
          cart={cart}
          minOrderAmount={minOrderAmount}
          onClose={() => { setDrawerOpen(false); if (submitResult === "success") clearCart(); }}
          onUpdate={updateQty}
          onRemove={removeItem}
          onSubmit={handleSubmit}
          submitting={submitting}
          submitResult={submitResult}
        />
      )}
    </div>
  );
}
