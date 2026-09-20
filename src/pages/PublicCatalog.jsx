import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";

// PUBLIC digital catalogue. No login, no session, no customer context.
//
// It reads ONE database object: the public_catalog view, which exposes exactly
// id, name, category, image_url and description for the business's active
// products. No price, stock, supplier, discount or internal column is reachable
// from here, and the products table is never queried by this page.
//
// The view reads live from products, so a product added or edited in QuickStock
// appears here on the next load with no synchronisation step and no second
// catalogue to maintain.
const CATALOG_VIEW = "public_catalog";

// Only these five columns are ever requested.
const CATALOG_COLUMNS = "id, name, category, image_url, description";

const ALL_CATEGORIES = "הכל";
const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 300;

const ACCENT = "#F5885E";
const DARK = "#120F1C";
const MUTED = "#6B6878";
const PAGE_BG = "#F4F5F7";
const CARD_BG = "#FFFFFF";
const FONT = "'Heebo', 'Assistant', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";

// The first usable image for a product.
//
// image_url may hold a COMMA-SEPARATED list of URLs, and the portal has always
// taken the first. A data: URI legitimately contains a comma of its own
// ("data:image/png;base64,iVBOR..."), so splitting one on commas truncates the
// payload and produces a broken image. Those are returned whole; everything
// else keeps the existing split-on-comma behaviour.
function firstImageUrl(raw) {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;
  if (value.startsWith("data:")) return value;
  const first = value.split(",")[0].trim();
  return first || null;
}

function PlaceholderImage({ size = 44 }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: "100%", height: "100%", display: "flex", alignItems: "center",
        justifyContent: "center", background: "#EEEFF2",
      }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#B9BAC3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
      </svg>
    </div>
  );
}

function ProductCard({ product, onOpen }) {
  const [failed, setFailed] = useState(false);
  const src = firstImageUrl(product.image_url);
  const showImage = src && !failed;

  return (
    <button
      type="button"
      onClick={() => onOpen(product)}
      className="pc-card"
      style={{
        display: "flex", flexDirection: "column", textAlign: "right",
        background: CARD_BG, border: "none", borderRadius: 16, overflow: "hidden",
        cursor: "pointer", padding: 0, fontFamily: FONT,
        boxShadow: "0 1px 3px rgba(18,15,28,0.08)",
      }}
    >
      <div style={{ width: "100%", aspectRatio: "1 / 1", background: "#F7F7F9", overflow: "hidden" }}>
        {showImage ? (
          <img
            src={src}
            alt={product.name || ""}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            style={{ width: "100%", height: "100%", objectFit: "contain", padding: 10, boxSizing: "border-box" }}
          />
        ) : (
          <PlaceholderImage />
        )}
      </div>

      <div style={{ padding: "12px 12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: DARK, lineHeight: 1.35 }}>
          {product.name || "ללא שם"}
        </div>
        {product.category ? (
          <div style={{ fontSize: 12, color: ACCENT, fontWeight: 600 }}>
            {String(product.category).trim()}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function ProductLightbox({ product, onClose }) {
  const [failed, setFailed] = useState(false);
  const src = firstImageUrl(product.image_url);
  const showImage = src && !failed;

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={product.name || "מוצר"}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000, background: "rgba(18,15,28,0.72)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: CARD_BG, borderRadius: 20, overflow: "hidden", width: "100%",
          maxWidth: 520, maxHeight: "90vh", display: "flex", flexDirection: "column",
          fontFamily: FONT, direction: "rtl",
        }}
      >
        <div style={{ position: "relative", width: "100%", background: "#F7F7F9" }}>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירה"
            style={{
              position: "absolute", top: 10, left: 10, zIndex: 2, width: 34, height: 34,
              borderRadius: "50%", border: "none", cursor: "pointer", background: "rgba(255,255,255,0.94)",
              color: DARK, fontSize: 18, lineHeight: "34px", padding: 0,
              boxShadow: "0 2px 8px rgba(18,15,28,0.18)",
            }}
          >
            ✕
          </button>
          <div style={{ width: "100%", aspectRatio: "1 / 1", maxHeight: "58vh" }}>
            {showImage ? (
              <img
                src={src}
                alt={product.name || ""}
                onError={() => setFailed(true)}
                style={{ width: "100%", height: "100%", objectFit: "contain", padding: 14, boxSizing: "border-box" }}
              />
            ) : (
              <PlaceholderImage size={64} />
            )}
          </div>
        </div>

        <div style={{ padding: "16px 18px 20px", overflowY: "auto" }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: DARK, lineHeight: 1.35 }}>
            {product.name || "ללא שם"}
          </h2>
          {product.category ? (
            <div style={{ marginTop: 6, fontSize: 13, fontWeight: 600, color: ACCENT }}>
              {String(product.category).trim()}
            </div>
          ) : null}
          {product.description ? (
            <p style={{ margin: "12px 0 0", fontSize: 14, lineHeight: 1.7, color: MUTED, whiteSpace: "pre-wrap" }}>
              {product.description}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function PublicCatalog() {
  const [categories, setCategories] = useState([ALL_CATEGORIES]);
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [selected, setSelected] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  // The category column holds untrimmed variants of the same label, so each
  // trimmed label keeps the raw values it came from and the filter matches on
  // all of them. Same approach the portal catalogue already uses.
  const categoryValuesRef = useRef(new Map());
  const offsetRef = useRef(0);
  const requestIdRef = useRef(0);
  const sentinelRef = useRef(null);

  // The browser tab title, for this page only. The previous title is captured
  // on mount and restored on unmount, so navigating from here into the CRM
  // leaves its own title exactly as it was. The visible header is untouched.
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "קטלוג א.ד שיווק והפצה";
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Read once across the whole catalogue, so every category stays visible even
  // though only one page of products is loaded at a time.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase.from(CATALOG_VIEW).select("category");
      if (cancelled || error) return;

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
      setCategories([ALL_CATEGORIES, ...[...map.keys()].sort((a, b) => a.localeCompare(b, "he"))]);
    })();

    return () => { cancelled = true; };
  }, [reloadKey]);

  // Search and category filtering run in the DATABASE, so a product that has
  // not been loaded yet is still reachable — which is what keeps ~700 products
  // responsive on a phone without shipping them all to the browser.
  const fetchPage = useCallback((from) => {
    let query = supabase
      .from(CATALOG_VIEW)
      .select(CATALOG_COLUMNS)
      // Deterministic order, with id as a tiebreaker so equal names cannot
      // shuffle between pages and duplicate or skip a row.
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (activeCategory !== ALL_CATEGORIES) {
      const raws = categoryValuesRef.current.get(activeCategory) || [activeCategory];
      query = query.in("category", raws);
    }
    if (search) query = query.ilike("name", `%${search}%`);

    return query;
  }, [activeCategory, search]);

  // First page, and a full reset whenever the search or the category changes.
  useEffect(() => {
    const runId = ++requestIdRef.current;
    offsetRef.current = 0;
    setStatus("loading");
    setProducts([]);
    setHasMore(true);

    (async () => {
      const { data, error } = await fetchPage(0);
      if (requestIdRef.current !== runId) return; // a newer request supersedes this one
      if (error) {
        setStatus("error");
        return;
      }
      const rows = data || [];
      setProducts(rows);
      offsetRef.current = rows.length;
      setHasMore(rows.length === PAGE_SIZE);
      setStatus("ready");
    })();
  }, [fetchPage, reloadKey]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || status !== "ready") return;

    const runId = requestIdRef.current;
    setLoadingMore(true);

    const { data, error } = await fetchPage(offsetRef.current);
    if (requestIdRef.current !== runId) {
      setLoadingMore(false);
      return;
    }
    if (error) {
      setLoadingMore(false);
      setHasMore(false);
      return;
    }

    const rows = data || [];
    setProducts((prev) => [...prev, ...rows]);
    offsetRef.current += rows.length;
    setHasMore(rows.length === PAGE_SIZE);
    setLoadingMore(false);
  }, [fetchPage, hasMore, loadingMore, status]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return undefined;

    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) loadMore(); },
      { rootMargin: "400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  const retry = () => setReloadKey((k) => k + 1);

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: PAGE_BG, fontFamily: FONT }}>
      <style>{`
        .pc-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        @media (min-width: 640px)  { .pc-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; } }
        @media (min-width: 900px)  { .pc-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; } }
        @media (min-width: 1200px) { .pc-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 20px; } }
        .pc-card { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .pc-card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(18,15,28,0.12); }
        .pc-cats::-webkit-scrollbar { display: none; }
        .pc-cats { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* ── Business header ── */}
      <header style={{ background: CARD_BG, borderBottom: "1px solid #E7E8EC" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "20px 16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 44, height: 44, borderRadius: 12, background: ACCENT, color: "#FFFFFF",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, fontWeight: 900, flexShrink: 0,
              }}
            >
              א
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: DARK, lineHeight: 1.25 }}>
                א.ד שיווק והפצה
              </h1>
              <p style={{ margin: "2px 0 0", fontSize: 13, color: MUTED }}>
                קטלוג מוצרים · מוצרי ניקיון, חד-פעמי וציוד לעסקים ולמוסדות
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* ── Sticky search + categories ── */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: PAGE_BG, borderBottom: "1px solid #E7E8EC" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "12px 16px 10px" }}>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="חיפוש מוצר…"
            aria-label="חיפוש מוצר"
            style={{
              width: "100%", boxSizing: "border-box", padding: "12px 16px", borderRadius: 14,
              border: "1px solid #E1E2E8", background: CARD_BG, fontSize: 15, color: DARK,
              fontFamily: FONT, textAlign: "right", outline: "none",
            }}
          />

          {categories.length > 1 ? (
            <div
              className="pc-cats"
              style={{ display: "flex", gap: 8, overflowX: "auto", marginTop: 10, paddingBottom: 2 }}
            >
              {categories.map((cat) => {
                const active = cat === activeCategory;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    style={{
                      flexShrink: 0, padding: "8px 14px", borderRadius: 999, border: "none",
                      cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: FONT,
                      background: active ? ACCENT : CARD_BG,
                      color: active ? "#FFFFFF" : DARK,
                      boxShadow: active ? "0 2px 8px rgba(245,136,94,0.3)" : "0 1px 3px rgba(18,15,28,0.08)",
                    }}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Body ── */}
      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "16px 16px 48px" }}>
        {status === "loading" ? (
          <div className="pc-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                style={{ background: CARD_BG, borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 3px rgba(18,15,28,0.08)" }}
              >
                <div style={{ width: "100%", aspectRatio: "1 / 1", background: "#EDEEF1" }} />
                <div style={{ padding: 12 }}>
                  <div style={{ height: 12, borderRadius: 6, background: "#EDEEF1", width: "80%" }} />
                  <div style={{ height: 10, borderRadius: 5, background: "#F1F2F5", width: "45%", marginTop: 8 }} />
                </div>
              </div>
            ))}
          </div>
        ) : status === "error" ? (
          <div style={{ textAlign: "center", padding: "56px 16px" }}>
            <div style={{ fontSize: 40 }}>⚠️</div>
            <p style={{ margin: "12px 0 0", fontSize: 16, fontWeight: 700, color: DARK }}>
              לא הצלחנו לטעון את הקטלוג
            </p>
            <p style={{ margin: "6px 0 16px", fontSize: 14, color: MUTED }}>
              בדקו את החיבור לאינטרנט ונסו שוב.
            </p>
            <button
              type="button"
              onClick={retry}
              style={{
                padding: "10px 22px", borderRadius: 12, border: "none", cursor: "pointer",
                background: ACCENT, color: "#FFFFFF", fontSize: 14, fontWeight: 700, fontFamily: FONT,
              }}
            >
              נסו שוב
            </button>
          </div>
        ) : products.length === 0 ? (
          <div style={{ textAlign: "center", padding: "56px 16px" }}>
            <div style={{ fontSize: 40 }}>🔍</div>
            <p style={{ margin: "12px 0 0", fontSize: 16, fontWeight: 700, color: DARK }}>
              לא נמצאו מוצרים
            </p>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: MUTED }}>
              נסו חיפוש אחר או בחרו קטגוריה אחרת.
            </p>
          </div>
        ) : (
          <>
            <div className="pc-grid">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} onOpen={setSelected} />
              ))}
            </div>

            <div ref={sentinelRef} style={{ height: 1 }} />

            {loadingMore ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: MUTED, fontSize: 13 }}>
                טוען עוד…
              </div>
            ) : null}
          </>
        )}
      </main>

      {selected ? <ProductLightbox product={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
