import { useState, useEffect, useCallback, useRef } from "react";
import { fetchProductsWithPending } from "@/lib/pendingProducts";

// Rows fetched per page, and the chunk size used by the reads that must cover
// the whole table (dropdown options and the CSV export).
const PAGE_SIZE = 30;
const OPTION_CHUNK = 1000;

// Seed from sessionStorage so module-level set is populated after page refresh
const _rawSS = (() => { try { return JSON.parse(sessionStorage.getItem("pendingDeletedProducts") || "[]"); } catch { return []; } })();
const deletedProductIds = new Set(_rawSS);

const getPendingDeletedProductIds = () => {
  try { return new Set(JSON.parse(sessionStorage.getItem("pendingDeletedProducts") || "[]")); } catch { return new Set(); }
};
const setPendingDeletedProductIds = (set) => {
  sessionStorage.setItem("pendingDeletedProducts", JSON.stringify([...set]));
};
import { useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { Plus, Search, Trash2, Pencil, AlertTriangle, Download, Upload, BarChart3 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useNavigate } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import EmptyState from "@/components/shared/EmptyState";
import ProductDialog from "@/components/inventory/ProductDialog";
import { toast } from "sonner";
import { formatCurrency } from "@/utils/formatCurrency";

export default function Inventory() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [selectedProducts, setSelectedProducts] = useState(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showProfit, setShowProfit] = useState(false);
  const queryClient = useQueryClient();

  // Invalidate cache on mount so delivery-driven quantity updates are visible immediately
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.resetQueries({ queryKey: ["products"] });
  }, []);

  // ── Paged product list ────────────────────────────────────────────────────
  // The screen used to download the whole products table on every visit. It now
  // reads 30 rows at a time and appends the next 30 as the list is scrolled.
  // The rows live in local state on purpose: the shared ["products"] cache is
  // read by a dozen other screens that need the COMPLETE catalog, so a paged
  // result must never be written into it.
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categories, setCategories] = useState([]);
  const [supplierNames, setSupplierNames] = useState([]);

  const offsetRef = useRef(0);
  const seenIdsRef = useRef(new Set());
  // Bumped on every reset so a slow response from a previous search or category
  // can never overwrite the rows of the current one.
  const requestIdRef = useRef(0);
  const loadingRef = useRef(false);
  const sentinelRef = useRef(null);

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // The search box has always matched name, sku and barcode. PostgREST splits an
  // `or` expression on commas and parentheses, so each value is quoted and the
  // quote/backslash characters inside it are escaped — otherwise a comma typed
  // into the box would break the filter apart.
  const buildSearchExpr = (term) => {
    const value = `"%${term.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}%"`;
    return ["name", "sku", "barcode"].map(f => `${f}.ilike.${value}`).join(",");
  };

  const applyFilters = (q, term, cat) => {
    if (cat !== "all") q = q.eq("category", cat);
    if (term) q = q.or(buildSearchExpr(term));
    return q;
  };

  // Read-only twin of the delete and update guards in fetchProductsWithPending,
  // used for the pages that infinite scroll appends. It reads exactly the same
  // session-storage entries and applies exactly the same rules, but writes
  // nothing back, so _confirmCount is left untouched. The create guard is
  // deliberately absent: a pending product is the newest row and therefore
  // belongs to the first page, which the shared helper still handles.
  const applyPendingGuardsReadOnly = (rows) => {
    const sessionDeleted = getPendingDeletedProductIds();
    let out = rows.filter(p => !deletedProductIds.has(p.id) && !sessionDeleted.has(p.id));

    const rawUpdate = sessionStorage.getItem("pendingProductUpdates");
    if (rawUpdate) {
      try {
        const pendingUpdates = JSON.parse(rawUpdate);
        out = out.map(p => {
          const pending = pendingUpdates.find(u => u.id === p.id);
          if (!pending) return p;
          const backendCaughtUp = p.updated_date && pending._savedAt &&
            new Date(p.updated_date).getTime() >= pending._savedAt;
          if (backendCaughtUp) return p;
          // Backend still stale — show the version saved locally.

          const { _confirmCount, _savedAt, ...cleanPending } = pending;
          return cleanPending;
        });
      } catch (e) { /* malformed entry — fall back to the backend rows */ }
    }
    return out;
  };

  const loadBatch = useCallback(async (reset) => {
    // A reset is never dropped: typing while a page is still in flight must
    // start the new search, and the older run is discarded by its run id below.
    if (!reset && (loadingRef.current || !hasMore)) return;
    loadingRef.current = true;

    const runId = reset ? ++requestIdRef.current : requestIdRef.current;
    if (reset) {
      offsetRef.current = 0;
      seenIdsRef.current = new Set();
      setIsLoading(true);
      setHasMore(true);
    } else {
      setLoadingMore(true);
    }

    const term = debouncedSearch;
    const cat = categoryFilter;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const from = offsetRef.current;

      // The secondary id key keeps the order stable, so two products sharing a
      // created_date cannot swap between pages and appear twice or not at all.
      let q = supabase.from("products").select("*").eq("user_id", user?.id);
      q = applyFilters(q, term, cat)
        .order("created_date", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      const { data, error } = await q;
      if (error) throw error;
      if (requestIdRef.current !== runId) return;

      const batch = data || [];
      // Same session-storage guards the screen has always applied: locally
      // deleted rows stay hidden, locally saved edits win over a stale row, and
      // a just-created product is shown until the backend returns it.
      //
      // The shared helper also keeps the _confirmCount bookkeeping, and that
      // must advance once per list load exactly as it did before paging — so it
      // runs only on a reset. Scrolling to the next page applies the very same
      // guards read-only, and can never nudge a pending entry towards expiry.
      const merged = reset
        ? await fetchProductsWithPending(() => Promise.resolve([...batch]))
        : applyPendingGuardsReadOnly(batch);
      const sessionDeleted = getPendingDeletedProductIds();
      const fresh = merged.filter(p =>
        !deletedProductIds.has(p.id) &&
        !sessionDeleted.has(p.id) &&
        !seenIdsRef.current.has(p.id) &&
        (!term || [p.name, p.sku, p.barcode].some(f => f?.toLowerCase().includes(term.toLowerCase()))) &&
        (cat === "all" || p.category === cat)
      );
      fresh.forEach(p => seenIdsRef.current.add(p.id));

      offsetRef.current = from + batch.length;
      // A short page means the server has nothing left for this filter.
      setHasMore(batch.length === PAGE_SIZE);
      setProducts(prev => (reset ? fresh : [...prev, ...fresh]));

      if (reset) {
        let cq = supabase.from("products").select("id", { count: "exact", head: true }).eq("user_id", user?.id);
        const { count } = await applyFilters(cq, term, cat);
        if (requestIdRef.current === runId) setTotalCount(count || 0);
      }
    } catch (error) {
      if (requestIdRef.current === runId) {
        setHasMore(false);
        toast.error("שגיאה בטעינת המוצרים");
      }
    } finally {
      // Only the current run clears the flags — a superseded run finishing late
      // must not unlock loading while its replacement is still fetching.
      if (requestIdRef.current === runId) {
        setIsLoading(false);
        setLoadingMore(false);
        loadingRef.current = false;
      }
    }
  }, [debouncedSearch, categoryFilter, hasMore]);

  // A search or category change restarts paging from the first page.
  useEffect(() => {
    loadBatch(true);

  }, [debouncedSearch, categoryFilter]);

  // Infinite scroll: load the next page slightly before the list runs out.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loadingRef.current) loadBatch(false);
    }, { rootMargin: "400px" });
    observer.observe(el);
    return () => observer.disconnect();
    // isLoading and the row count are dependencies because the sentinel is
    // unmounted while the first page loads — the observer has to re-attach to
    // the new node once the table is rendered again.
  }, [hasMore, loadBatch, isLoading, products.length]);

  // The dropdown here and the ones inside ProductDialog must keep offering every
  // existing value, so these are read from the whole table rather than from the
  // rows that happen to be loaded.
  useEffect(() => {
    let cancelled = false;
    const loadOptions = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const cats = new Set();
        const sups = new Set();
        for (let from = 0; ; from += OPTION_CHUNK) {
          const { data, error } = await supabase
            .from("products").select("category, supplier").eq("user_id", user?.id)
            .range(from, from + OPTION_CHUNK - 1);
          if (error) throw error;
          const rows = data || [];
          rows.forEach(r => { if (r.category) cats.add(r.category); if (r.supplier) sups.add(r.supplier); });
          if (rows.length < OPTION_CHUNK) break;
        }
        if (!cancelled) { setCategories([...cats]); setSupplierNames([...sups]); }
      } catch (e) { /* dropdowns stay as they are */ }
    };
    loadOptions();
    return () => { cancelled = true; };
  }, []);

  // Rows are already filtered by the server; nothing left to filter client-side.
  const filtered = products;

  const isAllSelected = filtered.length > 0 && filtered.every(p => selectedProducts.has(p.id));
  const selectedCount = selectedProducts.size;

  const handleSelectProduct = (id) => {
    const updated = new Set(selectedProducts);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setSelectedProducts(updated);
  };

  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedProducts(new Set());
    } else {
      const allIds = new Set(filtered.map(p => p.id));
      setSelectedProducts(allIds);
    }
  };

  const handleDelete = async () => {
    const idToDelete = deleteId;
    setDeleteId(null);

    // Add to module-level set (protects current session)
    deletedProductIds.add(idToDelete);

    // Add to sessionStorage (protects across refetches and page navigations)
    const pendingDeleted = getPendingDeletedProductIds();
    pendingDeleted.add(idToDelete);
    setPendingDeletedProductIds(pendingDeleted);

    queryClient.setQueryData(["products"], (old = []) => old.filter(p => p.id !== idToDelete));
    // The rendered rows are local state now, so drop it here too.
    setProducts(prev => prev.filter(p => p.id !== idToDelete));
    setTotalCount(c => Math.max(0, c - 1));

    try {
      await base44.entities.Product.delete(idToDelete);
      toast.success("המוצר נמחק בהצלחה");
    } catch (error) {
      toast.error("שגיאה במחיקת המוצר");
      // NOTE: No rollback — product stays hidden in UI.
      // Rollback caused the product to reappear after a 404 response.
    } finally {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    }
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    const ids = Array.from(selectedProducts);
    ids.forEach(id => deletedProductIds.add(id));
    const pendingDeleted = getPendingDeletedProductIds();
    ids.forEach(id => pendingDeleted.add(id));
    setPendingDeletedProductIds(pendingDeleted);
    queryClient.setQueryData(["products"], (old = []) => old.filter(p => !deletedProductIds.has(p.id)));
    setProducts(prev => prev.filter(p => !deletedProductIds.has(p.id)));
    setTotalCount(c => Math.max(0, c - ids.length));
    setSelectedProducts(new Set());
    setBulkDeleteOpen(false);
    await Promise.allSettled(ids.map(id => base44.entities.Product.delete(id)));
    toast.success(`${ids.length} מוצרים נמחקו בהצלחה`);
    queryClient.invalidateQueries({ queryKey: ["products"] });
    setDeleting(false);
  };

  // Export keeps covering the COMPLETE inventory. It reads the whole table
  // itself rather than the rows currently paged into the screen, so what lands
  // in the CSV does not depend on how far the list was scrolled.
  const handleExport = async () => {
    let all = [];
    try {
      const { data: { user } } = await supabase.auth.getUser();
      for (let from = 0; ; from += OPTION_CHUNK) {
        const { data, error } = await supabase
          .from("products")
          .select("name, sku, barcode, category, supplier, buy_price, sell_price, quantity, min_quantity, id")
          .eq("user_id", user?.id)
          .order("created_date", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + OPTION_CHUNK - 1);
        if (error) throw error;
        const rows = data || [];
        all = all.concat(rows);
        if (rows.length < OPTION_CHUNK) break;
      }
    } catch (e) {
      toast.error("שגיאה בייצוא המוצרים");
      return;
    }

    const sessionDeleted = getPendingDeletedProductIds();
    all = all.filter(p => !deletedProductIds.has(p.id) && !sessionDeleted.has(p.id));

    const headers = ["שם מוצר", "מק״ט", "ברקוד", "קטגוריה", "ספק", "מחיר קנייה", "מחיר מכירה", "כמות", "מינימום"];
    const rows = all.map((p) => [p.name, p.sku, p.barcode, p.category, p.supplier, p.buy_price, p.sell_price, p.quantity, p.min_quantity]);
    const csv = "\uFEFF" + [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "inventory.csv";
    a.click();
  };

  const handleImport = () => {
    toast.error("ייבוא קבצים אינו זמין כרגע");
  };

  // ── Heillo design tokens ──
  const ACCENT = "#F5885E";
  const DARK   = "#120F1C";
  const MUTED  = "#B2B0B1";
  const CARD_STYLE = {
    background: "#FFFFFF",
    borderRadius: 22,
    border: "1px solid rgba(0,0,0,0.03)",
    boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
    overflow: "hidden",
    fontFamily: "'Heebo', sans-serif",
  };
  const outlineBtn = {
    background: "#FFFFFF", color: DARK, border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 12, fontWeight: 500, padding: "7px 14px", fontSize: 13,
    fontFamily: "'Heebo', sans-serif", cursor: "pointer", display: "flex",
    alignItems: "center", gap: 6, whiteSpace: "nowrap", transition: "background 0.2s ease",
  };

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: "radial-gradient(ellipse 40% 35% at 75% 5%, rgba(252,234,227,0.75) 0%, rgba(236,237,240,0) 100%), #ECEDF0", fontFamily: "'Heebo', sans-serif", padding: 32, paddingTop: 24 }}>

      {/* ── Sticky top section ──────────────────────────────────────────── */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "transparent", paddingBottom: "16px", borderRadius: "0 0 16px 16px" }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      {/* OLD:
      <PageHeader title="ניהול מלאי" ...><Button>לוח בקרה</Button><label>ייבוא</label><Button>ייצוא</Button><Button>הצג רווח</Button><Button>מוצר חדש</Button></PageHeader>
      <div className="flex flex-col sm:flex-row gap-3 mb-4"><Input .../><Select .../></div>
      */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: DARK, margin: 0 }}>ניהול מלאי</h1>
          <p style={{ fontSize: 13, color: MUTED, margin: "2px 0 0" }}>{totalCount} מוצרים</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button style={outlineBtn} onClick={() => navigate("/inventory-dashboard")}
            onMouseEnter={e => e.currentTarget.style.background = "#F8F8FA"}
            onMouseLeave={e => e.currentTarget.style.background = "#FFFFFF"}>
            <BarChart3 style={{ width: 15, height: 15 }} /> לוח בקרה
          </button>
          <label style={{ ...outlineBtn, cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.background = "#F8F8FA"}
            onMouseLeave={e => e.currentTarget.style.background = "#FFFFFF"}>
            <Upload style={{ width: 15, height: 15 }} /> ייבוא
            <input type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={handleImport} />
          </label>
          <button style={outlineBtn} onClick={handleExport}
            onMouseEnter={e => e.currentTarget.style.background = "#F8F8FA"}
            onMouseLeave={e => e.currentTarget.style.background = "#FFFFFF"}>
            <Download style={{ width: 15, height: 15 }} /> ייצוא
          </button>
          <button style={outlineBtn} onClick={() => setShowProfit(v => !v)}
            onMouseEnter={e => e.currentTarget.style.background = "#F8F8FA"}
            onMouseLeave={e => e.currentTarget.style.background = "#FFFFFF"}>
            {showProfit ? "הסתר רווח" : "הצג רווח"}
          </button>
          <button
            onClick={() => { setEditProduct(null); setDialogOpen(true); }}
            style={{ background: ACCENT, color: "#FFFFFF", border: "none", borderRadius: 12, fontWeight: 600, padding: "8px 18px", fontSize: 13, fontFamily: "'Heebo', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", transition: "opacity 0.2s ease" }}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.88"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
            <Plus style={{ width: 16, height: 16 }} /> מוצר חדש
          </button>
        </div>
      </div>

      {/* ── Search + filter bar ──────────────────────────────────────────── */}
      {/* OLD: <div className="flex flex-col sm:flex-row gap-3 mb-4"><Input /><Select /></div> */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: MUTED, pointerEvents: "none" }} />
          <input
            placeholder="חיפוש לפי שם, מק״ט או ברקוד..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, height: 40, padding: "0 40px 0 14px", fontSize: 13, color: DARK, fontFamily: "'Heebo', sans-serif", outline: "none", boxSizing: "border-box" }}
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger style={{ background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, height: 40, fontSize: 13, color: DARK, fontFamily: "'Heebo', sans-serif", minWidth: 160 }}>
            <SelectValue placeholder="קטגוריה" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הקטגוריות</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      </div>{/* end sticky top section */}

      {/* ── Bulk selection bar ───────────────────────────────────────────── */}
      {/* OLD: <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4 ..."> */}
      {selectedCount > 0 && (
        <div style={{ background: "rgba(245,136,94,0.07)", border: "1px solid rgba(245,136,94,0.2)", borderRadius: 14, padding: "10px 16px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: DARK }}>נבחרו {selectedCount} מוצרים</span>
          <button onClick={() => setBulkDeleteOpen(true)} style={{ background: "transparent", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, color: "#ef4444", fontSize: 12, fontWeight: 500, padding: "6px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "'Heebo', sans-serif" }}>
            <Trash2 style={{ width: 14, height: 14 }} /> מחק נבחרים
          </button>
        </div>
      )}

      {/* ── Main card ────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "64px 0" }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid rgba(0,0,0,0.08)", borderTopColor: ACCENT, animation: "spin 1s linear infinite" }} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={search ? Search : null} title={search ? "לא נמצאו תוצאות" : "אין מוצרים"} description={search ? "נסה חיפוש אחר" : "הוסף מוצר ראשון למלאי"} />
      ) : (
        /* OLD: <div className="bg-card rounded-xl border border-border overflow-hidden"><div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-200px)]"> */
        <div style={CARD_STYLE}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Heebo', sans-serif" }}>
              {/* OLD: <TableHeader className="sticky top-0 z-10 bg-white shadow-sm"><TableRow className="bg-muted/50 border-b-2 border-gray-200"> */}
              <thead>
                <tr style={{ background: "#FAFAFA", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                  <th style={{ width: 44, padding: "14px 20px", textAlign: "center" }}>
                    <Checkbox checked={isAllSelected} onCheckedChange={handleSelectAll} />
                  </th>
                  {["מוצר","מק״ט","קטגוריה","מחיר קנייה","מחיר מכירה","כמות", ...(showProfit ? ["רווח"] : []), "פעולות"].map(col => (
                    <th key={col} style={{ padding: "14px 20px", textAlign: "right", fontWeight: 500, fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{col}</th>
                  ))}
                </tr>
              </thead>
              {/* OLD: <TableBody>{filtered.map(p => <TableRow ...> */}
              <tbody>
                {filtered.map((p, i) => {
                  const isLow = p.quantity > 0 && p.quantity <= (p.min_quantity || 0);
                  const isOutOfStock = p.quantity === 0;
                  const profit = ((p.sell_price || 0) - (p.buy_price || 0)).toFixed(2);
                  const isSelected = selectedProducts.has(p.id);
                  const rowBg = isSelected ? "rgba(245,136,94,0.06)" : isOutOfStock ? "rgba(239,68,68,0.04)" : isLow ? "rgba(234,88,12,0.04)" : "transparent";
                  return (
                    <tr
                      key={p.id}
                      style={{ borderBottom: i < filtered.length - 1 ? "1px solid rgba(0,0,0,0.04)" : "none", background: rowBg, transition: "background 0.15s ease" }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "rgba(245,136,94,0.04)"; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = rowBg; }}
                    >
                      <td style={{ padding: "14px 20px", textAlign: "center" }}>
                        <Checkbox checked={isSelected} onCheckedChange={() => handleSelectProduct(p.id)} />
                      </td>
                      {/* OLD: <TableCell><div className="flex items-center gap-2">{p.image_url && <img .../>}<span className="font-medium">{p.name}</span></div></TableCell> */}
                      <td style={{ padding: "14px 20px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {p.image_url && <img src={p.image_url} alt="" loading="lazy" style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover" }} />}
                          <span style={{ fontWeight: 500, fontSize: 13, color: DARK }}>{p.name}</span>
                        </div>
                      </td>
                      <td style={{ padding: "14px 20px", fontSize: 12, color: MUTED }}>{p.sku || "—"}</td>
                      {/* OLD: <TableCell>{p.category && <Badge variant="secondary">{p.category}</Badge>}</TableCell> */}
                      <td style={{ padding: "14px 20px" }}>
                        {p.category && (
                          <span style={{ borderRadius: 99, fontSize: 11, fontWeight: 600, padding: "3px 10px", background: "rgba(0,0,0,0.05)", color: DARK, display: "inline-block" }}>{p.category}</span>
                        )}
                      </td>
                      <td style={{ padding: "14px 20px", fontSize: 13, color: DARK }}>{formatCurrency(p.buy_price)}</td>
                      <td style={{ padding: "14px 20px", fontSize: 13, fontWeight: 500, color: DARK }}>{formatCurrency(p.sell_price)}</td>
                      {/* OLD: <TableCell><div ...>{isOutOfStock && ...}{isLow && ...}<span ...>{p.quantity}</span></div></TableCell> */}
                      <td style={{ padding: "14px 20px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {isOutOfStock && <span style={{ borderRadius: 99, fontSize: 11, fontWeight: 600, padding: "3px 10px", background: "rgba(239,68,68,0.1)", color: "#dc2626", display: "inline-block" }}>אזל</span>}
                          {isLow && !isOutOfStock && <AlertTriangle style={{ width: 14, height: 14, color: "#ea580c" }} />}
                          <span style={{ fontSize: 13, fontWeight: isOutOfStock || isLow ? 600 : 400, color: isOutOfStock ? "#dc2626" : isLow ? "#ea580c" : DARK }}>{p.quantity}</span>
                        </div>
                      </td>
                      {showProfit && (
                        <td style={{ padding: "14px 20px", fontSize: 13, fontWeight: 500, color: Number(profit) >= 0 ? "#16a34a" : "#dc2626" }}>
                          {formatCurrency(Math.abs(Number(profit)))}{Number(profit) < 0 ? " -" : ""}
                        </td>
                      )}
                      {/* OLD: <TableCell><div ...><Button variant="ghost" ...><Pencil/></Button><Button variant="ghost" ...><Trash2/></Button></div></TableCell> */}
                      <td style={{ padding: "14px 20px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          {[
                            { icon: Pencil, action: () => { setEditProduct(p); setDialogOpen(true); }, title: "עריכה" },
                            { icon: Trash2, action: () => setDeleteId(p.id), title: "מחיקה", danger: true },
                          ].map(({ icon: Icon, action, title, danger }) => (
                            <button key={title} onClick={action} title={title}
                              style={{ background: "transparent", border: "none", borderRadius: 8, padding: 6, cursor: "pointer", color: danger ? "#ef4444" : MUTED, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s ease" }}
                              onMouseEnter={e => { e.currentTarget.style.background = danger ? "rgba(239,68,68,0.08)" : "rgba(0,0,0,0.04)"; e.currentTarget.style.color = danger ? "#ef4444" : DARK; }}
                              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = danger ? "#ef4444" : MUTED; }}
                            >
                              <Icon style={{ width: 18, height: 18, strokeWidth: 1.8 }} />
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Infinite scroll sentinel — loads the next 30 before the list ends */}
          <div ref={sentinelRef} style={{ height: 1 }} />
          {loadingMore && (
            <div style={{ display: "flex", justifyContent: "center", padding: "18px 0" }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", border: "3px solid rgba(0,0,0,0.08)", borderTopColor: ACCENT, animation: "spin 1s linear infinite" }} />
            </div>
          )}

          {/* Bottom bulk bar */}
          {selectedCount > 0 && (
            <div style={{ borderTop: "1px solid rgba(0,0,0,0.04)", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: DARK }}>נבחרו {selectedCount} מוצרים</span>
              <button onClick={() => setBulkDeleteOpen(true)} style={{ background: "transparent", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, color: "#ef4444", fontSize: 12, fontWeight: 500, padding: "6px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "'Heebo', sans-serif" }}>
                <Trash2 style={{ width: 14, height: 14 }} /> מחק נבחרים
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── ProductDialog + AlertDialogs (logic unchanged) ───────────────── */}
      <ProductDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        product={editProduct}
        onSaved={(savedProduct) => {
          if (editProduct?.id) {
            queryClient.setQueryData(["products"], (old = []) =>
              old.map(p => p.id === savedProduct.id ? savedProduct : p)
            );
            const existingUpdates = JSON.parse(sessionStorage.getItem("pendingProductUpdates") || "[]");
            const filtered = existingUpdates.filter(p => p.id !== savedProduct.id);
            filtered.unshift({ ...savedProduct, _confirmCount: 0, _savedAt: Date.now() });
            sessionStorage.setItem("pendingProductUpdates", JSON.stringify(filtered));
            // Mirror into the rendered rows, which are local state now.
            setProducts(prev => prev.map(p => p.id === savedProduct.id ? savedProduct : p));
          } else {
            queryClient.setQueryData(["products"], (old = []) => [savedProduct, ...(Array.isArray(old) ? old : [])]);
            const existing = JSON.parse(sessionStorage.getItem("pendingProducts") || "[]");
            existing.unshift({ ...savedProduct, _confirmCount: 0 });
            sessionStorage.setItem("pendingProducts", JSON.stringify(existing));
            // A new product is the newest row, so it belongs at the top of the
            // created_date DESC list the screen is paging through.
            if (!seenIdsRef.current.has(savedProduct.id)) {
              seenIdsRef.current.add(savedProduct.id);
              setProducts(prev => [savedProduct, ...prev]);
              setTotalCount(c => c + 1);
            }
          }
        }}
        categories={categories}
        suppliers={supplierNames}
      />

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת מוצר</AlertDialogTitle>
            <AlertDialogDescription>האם אתה בטוח שברצונך למחוק את המוצר?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">מחק מוצר</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת מוצרים</AlertDialogTitle>
            <AlertDialogDescription>האם אתה בטוח שברצונך למחוק את {selectedCount} המוצרים שנבחרו?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel disabled={deleting}>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} disabled={deleting} className="bg-destructive text-destructive-foreground">
              {deleting ? "מוחק..." : "מחק מוצרים"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}