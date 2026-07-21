import { Search, X, Grid3X3 } from "lucide-react";
import { useRef } from "react";

export default function CatalogFilters({ search, onSearch, categories, selectedCategory, onCategoryChange }) {
  const activeCategories = categories.filter((c) => c.is_active !== false);
  const searchRef = useRef(null);

  const MUTED  = "#B2B0B1";
  const ACCENT = "#F5885E";
  const pillBase = { whiteSpace: "nowrap", fontSize: 13, padding: "6px 16px", borderRadius: 99, border: "1px solid transparent", transition: "all 0.15s ease", fontWeight: 500, cursor: "pointer", fontFamily: "'Heebo', sans-serif" };

  return (
    /* OLD: <div className="bg-card border-b border-border shrink-0"> */
    <div style={{ background: "#FFFFFF", borderBottom: "1px solid rgba(0,0,0,0.05)", flexShrink: 0, fontFamily: "'Heebo', sans-serif" }}>
      {/* Search bar */}
      <div style={{ padding: "12px 16px 8px", display: "flex", gap: 12 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 15, height: 15, color: MUTED, pointerEvents: "none" }} />
          {/* OLD: <Input ref={searchRef} className="pr-9 h-10 text-base" /> */}
          <input
            ref={searchRef}
            className="heillo-input"
            placeholder="חיפוש לפי שם, מק״ט, ברקוד, תגית..."
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            style={{ paddingRight: 36, height: 40, width: "100%" }}
          />
          {search && (
            /* OLD: <button className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"> */
            <button
              onClick={() => { onSearch(""); searchRef.current?.focus(); }}
              style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: MUTED, display: "flex", alignItems: "center" }}
            >
              <X style={{ width: 15, height: 15 }} />
            </button>
          )}
        </div>
      </div>

      {/* Category pills */}
      {activeCategories.length > 0 && (
        <div style={{ overflowX: "auto" }} className="scrollbar-hide">
          <div style={{ display: "flex", gap: 8, padding: "0 16px 12px", minWidth: "max-content" }}>
            {/* OLD: <button className={`... ${selectedCategory === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}> */}
            <button
              onClick={() => onCategoryChange("all")}
              style={{ ...pillBase, display: "inline-flex", alignItems: "center", gap: 5, background: selectedCategory === "all" ? ACCENT : "#F5F3F6", color: selectedCategory === "all" ? "#FFFFFF" : "var(--heillo-text-muted)", borderColor: selectedCategory === "all" ? ACCENT : "transparent" }}
            >
              <Grid3X3 style={{ width: 13, height: 13, opacity: 0.8 }} /> הכל
            </button>
            {activeCategories.map((cat) => (
              /* OLD: <button className={`... ${selectedCategory === cat.name ? "bg-primary ..." : "bg-card ..."}`}> */
              <button
                key={cat.id}
                onClick={() => onCategoryChange(cat.name)}
                style={{ ...pillBase, background: selectedCategory === cat.name ? ACCENT : "#F5F3F6", color: selectedCategory === cat.name ? "#FFFFFF" : "var(--heillo-text-muted)", borderColor: selectedCategory === cat.name ? ACCENT : "transparent" }}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}