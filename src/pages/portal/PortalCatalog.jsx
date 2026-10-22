import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { usePortalPWAMeta } from "@/hooks/usePortalPWAMeta";

// One page of ALLOWED products shown to the customer.
const PAGE_SIZE = 30;
// Rows read from the server per round trip. Larger than PAGE_SIZE so that
// removing blocked products does not produce a short page.
const SOURCE_CHUNK = 60;
// Previously-ordered product ids requested per round trip, as an `id=in.(…)`
// filter. PostgREST puts that list in the QUERY STRING, and a uuid costs ~38
// bytes there, so the whole purchased list must never go into one URL: 30 ids
// is ~1.1KB, which no proxy will object to. It also matches PAGE_SIZE, so a
// page overshoots by at most one chunk.
const PURCHASED_ID_CHUNK = 30;

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
function ProductCard({ product, discount, customerPrice, cartQty, onAdd }) {
  const [imgError, setImgError] = useState(false);
  const imageUrl = product.image_url ? product.image_url.split(",")[0].trim() : null;
  const showImage = imageUrl && !imgError;
  const originalPrice = product.sell_price || 0;

  // A price saved for this customer in the CRM is the FINAL price: the
  // percentage discount is deliberately NOT applied on top of it, because that
  // price was already set by hand for this customer. With no saved price the
  // original behaviour is untouched — sell_price with the customer discount.
  const hasCustomerPrice = typeof customerPrice === "number" && Number.isFinite(customerPrice);
  const discountedPrice = hasCustomerPrice
    ? customerPrice
    : originalPrice * (1 - discount / 100);
  // The struck-through original is only meaningful when a discount was applied.
  const showOriginal = !hasCustomerPrice && discount > 0;

  return (
    <div style={{ background: "#FFFFFF", borderRadius: 22, boxShadow: "0 4px 20px rgba(0,0,0,0.05)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ width: "100%", aspectRatio: "1 / 1", background: "#F5F3F6", position: "relative", overflow: "hidden", flexShrink: 0 }}>
        {showImage ? (
          <img src={imageUrl} alt={product.name} onError={() => setImgError(true)} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain", padding: "8px", boxSizing: "border-box" }} />
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
          {showOriginal && <span className="card-price-orig" style={{ fontSize: 13, color: MUTED, textDecoration: "line-through" }}>₪{fmt(originalPrice)}</span>}
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
function CartPanel({ cart, minOrderAmount, onUpdate, onRemove, onSubmit, submitting, submitResult, submitMessage, onDismissSuccess, isModal }) {
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
              <p style={{ margin: 0, fontSize: 12, color: "#dc2626" }}>{submitMessage || "אירעה שגיאה. נסה שוב."}</p>
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
  // product_id -> price saved for this customer in the CRM. Empty in demo mode.
  const [customerPrices, setCustomerPrices] = useState({});
  const [minOrderAmount, setMinOrderAmount] = useState(0);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("הכל");

  // ── Paging ────────────────────────────────────────────────────────────────
  // The catalog used to fetch every active product in one query and render all
  // of them. It now pages 30 allowed products at a time, and search and the
  // category filter run in the DATABASE, so a product that has not been loaded
  // yet is still findable.
  const [categories, setCategories] = useState(["הכל"]);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Blocked ids are fetched once and applied client-side, exactly as before, so
  // the existing customer_blocked_products rule is unchanged.
  const blockedIdsRef = useRef(new Set());
  // Raw category values per trimmed label: the column may hold untrimmed text
  // and the UI has always compared trimmed values.
  const categoryValuesRef = useRef(new Map());
  // How far into the SERVER result set we have read. Advanced by rows actually
  // consumed, never by chunk size, so nothing is skipped.
  const sourceOffsetRef = useRef(0);
  const seenIdsRef = useRef(new Set());
  // Incremented on every reset; a resolving fetch whose id no longer matches is
  // discarded, which is what makes a mid-flight search or category change safe.
  const requestIdRef = useRef(0);
  const loadingRef = useRef(false);
  const sentinelRef = useRef(null);

  // ── Personalised ordering ────────────────────────────────────────────────
  // Product ids this customer has ordered before, MOST-ORDERED FIRST, exactly
  // as portal_my_purchased_products returned them. The Set is the same ids and
  // exists only so the second phase can skip them in O(1).
  //
  // A ref rather than state: the loader reads it, and re-rendering on it would
  // restart paging. It is written once, before the first page is requested.
  const purchasedRef = useRef({ ids: [], set: new Set() });
  // How far into `purchased.ids` the loader has read, and which phase it is in:
  // "purchased" drains the ids above, then "rest" is the existing catalogue
  // query. Both reset together.
  const purchasedCursorRef = useRef(0);
  const phaseRef = useRef("rest");
  const [cart, setCart] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
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

  // ── Category list ─────────────────────────────────────────────────────────
  // Read once from the whole catalog, so every category stays visible even
  // though only 30 products are loaded. The column may hold untrimmed values
  // and the UI has always compared trimmed ones, so each trimmed label keeps
  // the raw variants it came from and the filter matches on all of them.
  const loadCategories = useCallback(async () => {
    const { data } = await supabase
      .from("products")
      .select("category")
      .eq("is_active", true);

    const map = new Map();
    for (const row of data || []) {
      const raw = row?.category;
      if (raw === null || raw === undefined) continue;
      const label = String(raw).trim();
      if (!label) continue;
      const list = map.get(label) || [];
      if (!list.includes(raw)) list.push(raw);
      map.set(label, list);
    }
    categoryValuesRef.current = map;
    setCategories(["הכל", ...[...map.keys()].sort()]);
  }, []);

  // ── One page of allowed products ──────────────────────────────────────────
  // Search and category run in the database, so a product that has never been
  // loaded is still reachable. Blocked products are removed after the read, and
  // the loop keeps reading source rows until PAGE_SIZE allowed products are
  // collected or the server runs out — a page is never short just because
  // blocked items were filtered out.
  //
  // TWO PHASES, ONE STREAM
  //   Phase "purchased" walks purchasedRef.current.ids — the customer's own
  //   history, most-ordered first — and phase "rest" is the catalogue query
  //   this function has always run, which now SKIPS those ids.
  //
  //   WHY THE SKIP IS CLIENT-SIDE
  //     The obvious way to exclude them is `.not("id", "in", "(…)")`, but that
  //     puts the ENTIRE purchased list in the query string of EVERY page
  //     request: 200 uuids is ~7.6KB of URL, repeated on every scroll. Blocked
  //     products are already filtered client-side from a Set for exactly this
  //     reason, so purchased ids are filtered the same way. The URL stops
  //     growing with a customer's history, and the two filters read alike.
  //
  //   WHY NOT SORT THE LOADED ARRAY INSTEAD
  //     Because only 30 products are in memory at a time. Sorting what is
  //     loaded would put "my products" first within each page rather than
  //     first in the catalogue, and the order would change as pages arrive.
  //
  //   A customer with no history has an empty ids array and an empty Set, so
  //   the phase starts at "rest" and nothing below does anything differently
  //   from before. That covers staff demo mode too, which never calls the RPC.
  const loadBatch = useCallback(async (reset) => {
    if (loadingRef.current) return;

    if (reset) {
      // Invalidate anything already in flight: its result is stale.
      requestIdRef.current += 1;
      sourceOffsetRef.current = 0;
      seenIdsRef.current = new Set();
      // Both phase cursors reset together with the offset. Resetting one and
      // not the other is what would duplicate or skip rows after a search.
      purchasedCursorRef.current = 0;
      phaseRef.current = purchasedRef.current.ids.length > 0 ? "purchased" : "rest";
    }
    const runId = requestIdRef.current;

    loadingRef.current = true;
    setLoadingMore(true);

    const collected = [];
    let exhausted = false;

    try {
      // ---- Phase 1: the customer's own products, most-ordered first --------
      // Whole chunks are consumed: the cursor advances past a chunk only once
      // every id in it has been considered, so a page that fills mid-chunk
      // overshoots PAGE_SIZE slightly rather than dropping the remainder.
      while (collected.length < PAGE_SIZE && phaseRef.current === "purchased") {
        const ids = purchasedRef.current.ids.slice(
          purchasedCursorRef.current,
          purchasedCursorRef.current + PURCHASED_ID_CHUNK,
        );
        if (ids.length === 0) { phaseRef.current = "rest"; break; }

        let pq = supabase
          .from("products")
          .select("id, name, sell_price, quantity, unit, image_url, category, description")
          .eq("is_active", true)
          .in("id", ids);

        // The SAME filters as phase 2. A purchased product that does not match
        // the current search or category must stay hidden, exactly like any
        // other product — being previously ordered promotes a product, it does
        // not exempt it from the filters.
        if (activeCategory !== "הכל") {
          const raws = categoryValuesRef.current.get(activeCategory) || [activeCategory];
          pq = pq.in("category", raws);
        }
        if (debouncedSearch) pq = pq.ilike("name", `%${debouncedSearch}%`);

        const { data, error } = await pq;

        if (requestIdRef.current !== runId) return;
        // A failure here must not cost the customer the catalogue: fall through
        // to the normal listing, where these products appear in name order.
        if (error) { phaseRef.current = "rest"; break; }

        purchasedCursorRef.current += ids.length;

        // Re-imposed order: `in` returns rows in whatever order the server
        // chooses, while `ids` carries the frequency ranking. Walking `ids` and
        // looking each row up is what makes most-ordered actually come first.
        const byId = new Map((data || []).map(r => [r.id, r]));
        for (const id of ids) {
          const row = byId.get(id);
          // Absent means filtered out by search/category, or no longer active.
          if (!row) continue;
          if (blockedIdsRef.current.has(row.id)) continue;
          if (seenIdsRef.current.has(row.id)) continue;
          seenIdsRef.current.add(row.id);
          collected.push(row);
        }

        if (purchasedCursorRef.current >= purchasedRef.current.ids.length) {
          phaseRef.current = "rest";
        }
      }

      // ---- Phase 2: the rest of the catalogue, unchanged -------------------
      while (collected.length < PAGE_SIZE && phaseRef.current === "rest" && !exhausted) {
        const from = sourceOffsetRef.current;

        let q = supabase
          .from("products")
          .select("id, name, sell_price, quantity, unit, image_url, category, description")
          .eq("is_active", true)
          // Deterministic order, with id as a tiebreaker so equal names cannot
          // shuffle between pages and duplicate or skip a row.
          .order("name", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + SOURCE_CHUNK - 1);

        if (activeCategory !== "הכל") {
          const raws = categoryValuesRef.current.get(activeCategory) || [activeCategory];
          q = q.in("category", raws);
        }
        if (debouncedSearch) q = q.ilike("name", `%${debouncedSearch}%`);

        const { data, error } = await q;

        // A newer search or category change happened while this was running.
        if (requestIdRef.current !== runId) return;
        if (error) { exhausted = true; break; }

        const rows = data || [];
        let consumed = 0;
        for (const row of rows) {
          consumed++;
          if (blockedIdsRef.current.has(row.id)) continue;
          // Already shown — or still to be shown — by phase 1. Skipping it here
          // is what keeps a purchased product from appearing twice, and it is
          // why no id list has to travel in the URL.
          if (purchasedRef.current.set.has(row.id)) continue;
          if (seenIdsRef.current.has(row.id)) continue;
          seenIdsRef.current.add(row.id);
          collected.push(row);
          if (collected.length >= PAGE_SIZE) break;
        }
        // Advance by rows actually consumed, never by the chunk size, so the
        // rows after an early break are read again on the next call.
        sourceOffsetRef.current = from + consumed;

        if (rows.length < SOURCE_CHUNK) exhausted = true;
      }

      if (requestIdRef.current !== runId) return;
      setProducts(prev => (reset ? collected : [...prev, ...collected]));
      setHasMore(!exhausted);
    } finally {
      if (requestIdRef.current === runId) setLoadingMore(false);
      loadingRef.current = false;
    }
  }, [activeCategory, debouncedSearch]);

  // Load page data
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { if (!cancelled) navigate("/portal/login", { replace: true }); return; }

      const { data: access, error: accessErr } = await supabase
        .from("customer_portal_access")
        .select("is_active, customer_id, custom_discount_percent, min_order_amount")
        .eq("auth_user_id", session.user.id)
        .maybeSingle();

      // maybeSingle() returns an error, not a row, when more than one row
      // carries this auth_user_id. Discarding it sent the customer back to the
      // login screen with no reason given, in a loop.
      if (accessErr) {
        console.error("[portal] access lookup failed", accessErr);
        if (!cancelled) setStatus("unlinked");
        return;
      }

      // An access row can be active while customer_id is still NULL. Such a
      // customer used to reach a fully working-looking catalogue and only
      // discover at the very end that the send button did nothing, because an
      // order has no customer to belong to. It is stopped here instead, with an
      // explanation.
      if (access && access.is_active && !access.customer_id) {
        if (!cancelled) setStatus("unlinked");
        return;
      }

      if (!access || !access.is_active) {
        // Fallback: check if this is a staff member (demo mode)
        const { data: staff } = await supabase
          .from("staff_members")
          .select("id")
          .eq("auth_user_id", session.user.id)
          .maybeSingle();

        if (!staff) { if (!cancelled) navigate("/portal/login", { replace: true }); return; }

        // Demo mode: no discount and no blocked filter. Products themselves are
        // loaded by the paging effect below, exactly like the customer path.
        if (!cancelled) {
          blockedIdsRef.current = new Set();
          // Demo mode has no customer, so no purchase history: the RPC is never
          // called and the catalogue keeps its existing order.
          purchasedRef.current = { ids: [], set: new Set() };
          purchasedCursorRef.current = 0;
          phaseRef.current = "rest";
          await loadCategories();
          setIsDemo(true);
          setDiscount(0);
          setMinOrderAmount(0);
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

      // Blocked ids are read once for this customer — the same rule as before,
      // just no longer bundled with a full product download.
      const { data: blocked } = await supabase
        .from("customer_blocked_products")
        .select("product_id")
        .eq("customer_id", access.customer_id);

      // Prices this customer was last charged in the CRM. Read once, like the
      // blocked ids: there is at most one row per product this customer has
      // actually been quoted, so this stays small even for a large catalogue.
      // A missing row simply means "no special price" and the product keeps its
      // normal sell_price + discount.
      const { data: savedPrices } = await supabase
        .from("customer_product_prices")
        .select("product_id, unit_price")
        .eq("customer_id", access.customer_id);

      // Products this customer has ordered before, most-ordered first.
      //
      // The RPC takes NO customer id: it resolves one from auth.uid() through
      // customer_portal_access itself, so this browser cannot ask about anybody
      // else's history, and `access.customer_id` is deliberately not passed.
      //
      // Entirely optional data. Any failure — missing function, permission,
      // network — leaves the list empty, and an empty list means the catalogue
      // renders in exactly the order it does today. It is read here, before
      // status becomes "ready", because the paging effect fires on that and
      // must see the final list on its very first page.
      let purchasedIds = [];
      const { data: purchased, error: purchasedErr } = await supabase
        .rpc("portal_my_purchased_products", { p_limit: 200 });
      if (purchasedErr) {
        console.warn("[portal] purchase history unavailable", purchasedErr.message);
      } else {
        purchasedIds = (purchased || [])
          .map(r => r?.product_id)
          .filter(id => typeof id === "string" && id.length > 0);
      }

      if (!cancelled) {
        // Blocked products are removed from the prioritised list too. They are
        // filtered again during loading; dropping them here as well keeps them
        // out of the `id=in.(…)` filters entirely.
        const blockedSet = new Set((blocked || []).map(b => b.product_id));
        const prioritised = purchasedIds.filter(id => !blockedSet.has(id));
        purchasedRef.current = { ids: prioritised, set: new Set(prioritised) };
        purchasedCursorRef.current = 0;
        phaseRef.current = prioritised.length > 0 ? "purchased" : "rest";

        blockedIdsRef.current = blockedSet;
        const priceMap = {};
        for (const row of savedPrices || []) {
          const price = Number(row.unit_price);
          if (Number.isFinite(price)) priceMap[row.product_id] = price;
        }
        setCustomerPrices(priceMap);
        await loadCategories();
        setCustomerId(access.customer_id);
        setMinOrderAmount(access.min_order_amount || 0);
        setDiscount(effectiveDiscount);
        setStatus("ready");
      }
    };
    load();
    return () => { cancelled = true; };
  }, [navigate, loadCategories]);

  // ── Debounce the search box ───────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // ── Reset and load the first page whenever the query changes ──────────────
  useEffect(() => {
    if (status !== "ready") return;
    loadBatch(true);
  }, [status, debouncedSearch, activeCategory, loadBatch]);

  // ── Infinite scroll ───────────────────────────────────────────────────────
  // IntersectionObserver rather than scroll maths: it is the reliable option on
  // mobile Safari, and rootMargin starts the next fetch before the user reaches
  // the very bottom.
  useEffect(() => {
    if (status !== "ready" || !hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) loadBatch(false); },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [status, hasMore, loadBatch, products.length]);

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

    // Was a bare `return`, so the button simply did nothing — no spinner, no
    // message. The access gate above now prevents this state from being
    // reachable at all, but if it ever is, the customer is told rather than
    // left clicking a dead button.
    if (!customerId) {
      setSubmitMessage("החשבון שלך עדיין לא משויך ללקוח. אנא פנה אלינו.");
      setSubmitResult("error");
      return;
    }

    setSubmitting(true);
    setSubmitResult(null);
    setSubmitMessage("");
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

      // The order is saved at this point. The Telegram notification is a
      // side-effect of that, never a condition of it, so it gets its own
      // try/catch: reaching the outer handler below would flip an order that
      // WAS saved into "אירעה שגיאה" on the customer's screen, which is worse
      // than a missed notification.
      //
      // Only the order id is sent. The function reads the customer, the total
      // and the item count back from the database itself.
      //
      // invoke() resolves rather than throws on a non-2xx reply, so the
      // returned error is inspected too — otherwise a 403 or 502 from the
      // function would pass unnoticed. Both channels only log.
      try {
        const { error: notifyError } = await supabase.functions.invoke(
          "notify-portal-order",
          {
            body: { order_id: order.id },
          }
        );

        if (notifyError) {
          // WHY THIS IS NOT JUST console.error(notifyError)
          //   A non-2xx reply becomes a FunctionsHttpError whose `message` is
          //   the generic "Edge Function returned a non-2xx status code". The
          //   function's OWN answer — e.g. { ok: false, error: "invalid_order_id" }
          //   — is the unread body of the Response hanging off `context`, so
          //   logging the error alone threw away the only field that says WHY.
          //
          //   The id is logged beside it, with its JavaScript type, because the
          //   function rejects anything that is not a canonical uuid STRING: a
          //   number or a short string is the difference between "the contract
          //   is wrong" and "the platform refused the request".
          //
          //   Diagnosis only. Nothing here changes the order, the cart, the
          //   customer's screen or whether a notification is retried — it is
          //   not. Every read is guarded, because `context` is only a Response
          //   for an HTTP error (a network failure carries something else), its
          //   body may already be consumed, and a failed log must never become
          //   the thing that breaks a saved order.
          const ctx = notifyError.context;
          let status;
          let responseBody;
          try {
            status = ctx?.status;
            if (typeof ctx?.clone === "function") {
              // clone() so this read cannot disturb anything else holding the
              // body, and text() rather than json() so a non-JSON error page
              // is still captured instead of throwing.
              responseBody = await ctx.clone().text();
            }
          } catch (readErr) {
            responseBody = `<unreadable: ${readErr?.message || readErr}>`;
          }

          console.error("[portal] order notification failed", {
            name: notifyError.name,
            message: notifyError.message,
            status,
            responseBody,
            order_id: order.id,
            order_id_type: typeof order.id,
            order_id_length: typeof order.id === "string" ? order.id.length : undefined,
            error: notifyError,
          });
        }
      } catch (notifyErr) {
        console.error("[portal] order notification failed", notifyErr, {
          order_id: order.id,
          order_id_type: typeof order.id,
        });
      }

      clearCart();
      setSubmitResult("success");
    } catch (err) {
      // The cause used to be discarded entirely, so an RLS rejection and a
      // network drop looked identical and left nothing to diagnose. It is
      // logged for us; the customer still sees only the generic Hebrew line.
      console.error("[portal] order submit failed", err);
      setSubmitMessage("");
      setSubmitResult("error");
    } finally {
      setSubmitting(false);
    }
  };

  // `products` already holds exactly what should be shown: the server applied
  // the search and the category, and blocked items were removed as they were
  // read. There is no client-side filtering left to do.
  const filtered = products;

  const cartItemCount = cart.reduce((s, i) => s + i.quantity, 0);

  const cartProps = {
    cart,
    minOrderAmount,
    onUpdate: updateQty,
    onRemove: removeItem,
    onSubmit: handleSubmit,
    submitting,
    submitResult,
    submitMessage,
    onDismissSuccess: () => { setSubmitResult(null); setCartSheetOpen(false); },
  };

  if (status === "loading") return <Spinner />;

  // Signed in, but the account is not usable for ordering yet: either it is not
  // linked to a CRM customer, or its access rows are ambiguous. Shown instead
  // of a catalogue whose send button could not work.
  if (status === "unlinked") {
    return (
      <div style={{ ...PAGE_BG, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} dir="rtl">
        <div style={{ background: "#FFFFFF", borderRadius: 22, boxShadow: "0 4px 20px rgba(0,0,0,0.05)", padding: "32px 28px", maxWidth: 380, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
          <p style={{ fontSize: 16, fontWeight: 800, color: DARK, margin: "0 0 8px" }}>החשבון ממתין לאישור</p>
          <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.6 }}>
            החשבון שלך עדיין לא משויך ללקוח במערכת. לאחר האישור תוכל לבצע הזמנות.
          </p>
        </div>
      </div>
    );
  }

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
          {filtered.length === 0 && !loadingMore ? (
            <div style={{ textAlign: "center", padding: "64px 0", color: MUTED, fontSize: 15 }}>לא נמצאו מוצרים</div>
          ) : (
            <div className="portal-product-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
              {filtered.map(product => {
                const cartItem = cart.find(i => i.product_id === product.id);
                return (
                  <ProductCard key={product.id} product={product} discount={discount}
                    customerPrice={customerPrices[product.id]}
                    cartQty={cartItem?.quantity || 0} onAdd={addToCart} />
                );
              })}
            </div>
          )}

          {/* Infinite-scroll sentinel: observed only while more results exist. */}
          {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}

          {loadingMore && (
            <div style={{ textAlign: "center", padding: "24px 0", color: MUTED, fontSize: 13 }}>טוען מוצרים נוספים…</div>
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
