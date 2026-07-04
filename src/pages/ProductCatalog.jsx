import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { fetchProductsWithPending } from "@/lib/pendingProducts";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, BookOpen, Package, Tag, LayoutGrid } from "lucide-react";
import { formatCurrency } from "@/utils/formatCurrency";

export default function ProductCatalog() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const queryClient = useQueryClient();

  // Clear stale sessionStorage ghost products on mount and sync cache with DB
  useEffect(() => {
    sessionStorage.removeItem("pendingProducts");
    sessionStorage.removeItem("pendingProductUpdates");
    sessionStorage.removeItem("pendingDeletedProducts");
    queryClient.invalidateQueries({ queryKey: ["products"] });
  }, []);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: () => fetchProductsWithPending(() => base44.entities.Product.list("-created_date")),
  });

  const categories = ["all", ...new Set(products.map((p) => p.category).filter(Boolean))];

  const filtered = products.filter((p) => {
    const matchSearch =
      !search ||
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.sku?.toLowerCase().includes(search.toLowerCase());
    const matchCat = selectedCategory === "all" || p.category === selectedCategory;
    return matchSearch && matchCat;
  });

  const categoryList = [
    { key: "all", label: "הכל", icon: LayoutGrid },
    ...categories.filter((c) => c !== "all").map((c) => ({ key: c, label: c, icon: Tag })),
  ];

  return (
    <div className="heillo-page" dir="rtl"> {/* OLD: <div> */}

      {/* ── Sticky top section ── */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "transparent", paddingBottom: "16px", borderRadius: "0 0 16px 16px" }}>

      {/* ── Top bar ── */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--heillo-text-primary)", margin: 0, fontFamily: "'Heebo', sans-serif" }}>קטלוג מוצרים</h1>
        <p style={{ fontSize: 13, color: "var(--heillo-text-muted)", margin: "2px 0 0", fontFamily: "'Heebo', sans-serif" }}>{products.length} מוצרים</p>
      </div>

      {/* ── Mobile: horizontal category pills ── */}
      {/* OLD: <div className="lg:hidden mb-4 overflow-x-auto thin-scrollbar pb-1"><div className="flex gap-2 w-max"> */}
      <div className="lg:hidden" style={{ marginBottom: 16, overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 8, width: "max-content", paddingBottom: 4 }}>
          {categoryList.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSelectedCategory(key)}
              style={{
                padding: "6px 14px", borderRadius: 99, fontSize: 13, fontWeight: 500,
                whiteSpace: "nowrap", border: "none", cursor: "pointer",
                fontFamily: "'Heebo', sans-serif", transition: "all 0.2s ease",
                background: selectedCategory === key ? "var(--heillo-accent)" : "rgba(0,0,0,0.05)",
                color: selectedCategory === key ? "#FFFFFF" : "var(--heillo-text-muted)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Search bar ── */}
      {/* OLD: <div className="sticky top-0 z-10 bg-background pb-3 pt-0.5"><div className="relative w-full"><Search .../><Input className="pr-11 h-12 text-base w-full" /></div></div> */}
      <div style={{ position: "relative", marginBottom: 20 }}>
        <Search style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", width: 18, height: 18, color: "var(--heillo-text-muted)", pointerEvents: "none" }} />
        <input
          placeholder="חיפוש מוצר לפי שם או מק״ט..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="heillo-input"
          style={{ width: "100%", boxSizing: "border-box", paddingRight: 44, height: 44, fontSize: 14 }}
        />
      </div>
      </div>{/* end sticky top section */}

      {/* ── Desktop: sidebar + grid ── */}
      {/* OLD: <div className="flex flex-row gap-6 items-start"> */}
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>

        {/* Vertical category sidebar — desktop only */}
        {/* OLD: <aside className="hidden lg:flex flex-col w-56 shrink-0 bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden sticky top-[4.5rem]"> */}
        <aside className="hidden lg:flex" style={{ flexDirection: "column", width: 220, flexShrink: 0, background: "#FFFFFF", borderRadius: 16, boxShadow: "var(--heillo-card-shadow)", border: "var(--heillo-card-border)", overflow: "hidden", position: "sticky", top: "4.5rem" }}>
          {/* OLD: <div className="px-3 py-2.5 border-b border-gray-100"><p className="text-xs font-semibold uppercase tracking-wider text-gray-400">קטגוריות</p></div> */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
            <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--heillo-text-muted)", margin: 0, fontFamily: "'Heebo', sans-serif" }}>קטגוריות</p>
          </div>
          <div className="overflow-y-auto thin-scrollbar" style={{ maxHeight: "calc(100vh - 14rem)", padding: "8px" }}>
            {categoryList.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSelectedCategory(key)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  padding: "9px 12px", borderRadius: 10, fontSize: 13, fontWeight: selectedCategory === key ? 600 : 400,
                  textAlign: "right", border: "none", cursor: "pointer",
                  fontFamily: "'Heebo', sans-serif", transition: "all 0.2s ease",
                  background: selectedCategory === key ? "var(--heillo-accent)" : "transparent",
                  color: selectedCategory === key ? "#FFFFFF" : "var(--heillo-text-muted)",
                  marginBottom: 2,
                }}
                onMouseEnter={e => { if (selectedCategory !== key) e.currentTarget.style.background = "rgba(0,0,0,0.04)"; }}
                onMouseLeave={e => { if (selectedCategory !== key) e.currentTarget.style.background = "transparent"; }}
              >
                <Icon style={{ width: 14, height: 14, flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* Main content: grid */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {isLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "64px 0" }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid rgba(0,0,0,0.08)", borderTopColor: "var(--heillo-accent)", animation: "spin 1s linear infinite" }} />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={BookOpen} title="אין מוצרים" description="לא נמצאו מוצרים תואמים" />
          ) : (
            /* OLD: <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4"> */
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4" style={{ gap: 16 }}>
              {filtered.map((product) => (
                /* OLD: <div className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-md transition-shadow"> */
                <div
                  key={product.id}
                  style={{
                    background: "#FFFFFF",
                    borderRadius: 16,
                    border: "var(--heillo-card-border)",
                    boxShadow: "var(--heillo-card-shadow)",
                    overflow: "hidden",
                    transition: "transform 0.2s ease, box-shadow 0.2s ease",
                    cursor: "default",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 28px rgba(0,0,0,0.08)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "var(--heillo-card-shadow)"; }}
                >
                  {/* OLD: <div className="h-48 bg-gray-100 flex items-center justify-center overflow-hidden"> */}
                  <div style={{ height: 180, background: "#F8F8FA", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        style={{ width: "100%", height: "100%", objectFit: "cover", mixBlendMode: "multiply" }}
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                    ) : (
                      <Package style={{ width: 36, height: 36, color: "var(--heillo-text-muted)", opacity: 0.4 }} />
                    )}
                  </div>
                  {/* OLD: <div className="p-3"> */}
                  <div style={{ padding: "12px 14px" }}>
                    {/* OLD: <p className="font-medium text-sm leading-tight">{product.name}</p> */}
                    <p style={{ fontWeight: 600, fontSize: 13, color: "var(--heillo-text-primary)", margin: 0, lineHeight: 1.4, fontFamily: "'Heebo', sans-serif" }}>{product.name}</p>
                    {product.sku && (
                      <p style={{ fontSize: 11, color: "var(--heillo-text-muted)", margin: "2px 0 0", fontFamily: "'Heebo', sans-serif" }}>{product.sku}</p>
                    )}
                    {product.category && (
                      /* OLD: <Badge variant="secondary" className="mt-1 text-xs">{product.category}</Badge> */
                      <span className="heillo-badge" style={{ background: "var(--heillo-accent-light)", color: "var(--heillo-accent)", display: "inline-block", marginTop: 6 }}>{product.category}</span>
                    )}
                    {/* OLD: <p className="text-sm font-bold mt-2">{formatCurrency(product.sell_price)}</p> */}
                    <p style={{ fontSize: 14, fontWeight: 700, color: "var(--heillo-accent)", margin: "8px 0 0", fontFamily: "'Heebo', sans-serif" }}>{formatCurrency(product.sell_price)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}