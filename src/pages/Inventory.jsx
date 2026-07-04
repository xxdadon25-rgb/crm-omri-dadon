import { useState, useMemo, useEffect } from "react";
import { fetchProductsWithPending } from "@/lib/pendingProducts";

// Seed from sessionStorage so module-level set is populated after page refresh
const _rawSS = (() => { try { return JSON.parse(sessionStorage.getItem("pendingDeletedProducts") || "[]"); } catch { return []; } })();
const deletedProductIds = new Set(_rawSS);

const getPendingDeletedProductIds = () => {
  try { return new Set(JSON.parse(sessionStorage.getItem("pendingDeletedProducts") || "[]")); } catch { return new Set(); }
};
const setPendingDeletedProductIds = (set) => {
  sessionStorage.setItem("pendingDeletedProducts", JSON.stringify([...set]));
};
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Plus, Search, Trash2, Pencil, AlertTriangle, Download, Upload, Check, BarChart3 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import PageHeader from "@/components/shared/PageHeader";
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

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: () => fetchProductsWithPending(() => base44.entities.Product.list("-created_date")),
    refetchOnMount: "always",
    select: (data) => {
      const sessionDeleted = getPendingDeletedProductIds();
      return data.filter(p => !deletedProductIds.has(p.id) && !sessionDeleted.has(p.id));
    },
  });

  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))], [products]);
  const supplierNames = useMemo(() => [...new Set(products.map((p) => p.supplier).filter(Boolean))], [products]);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const matchSearch = !search || [p.name, p.sku, p.barcode].some((f) => f?.toLowerCase().includes(search.toLowerCase()));
      const matchCat = categoryFilter === "all" || p.category === categoryFilter;
      return matchSearch && matchCat;
    });
  }, [products, search, categoryFilter]);

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
    setSelectedProducts(new Set());
    setBulkDeleteOpen(false);
    await Promise.allSettled(ids.map(id => base44.entities.Product.delete(id)));
    toast.success(`${ids.length} מוצרים נמחקו בהצלחה`);
    queryClient.invalidateQueries({ queryKey: ["products"] });
    setDeleting(false);
  };

  const handleExport = () => {
    const headers = ["שם מוצר", "מק״ט", "ברקוד", "קטגוריה", "ספק", "מחיר קנייה", "מחיר מכירה", "כמות", "מינימום"];
    const rows = products.map((p) => [p.name, p.sku, p.barcode, p.category, p.supplier, p.buy_price, p.sell_price, p.quantity, p.min_quantity]);
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
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--heillo-bg-gradient)", paddingBottom: 16 }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      {/* OLD:
      <PageHeader title="ניהול מלאי" ...><Button>לוח בקרה</Button><label>ייבוא</label><Button>ייצוא</Button><Button>הצג רווח</Button><Button>מוצר חדש</Button></PageHeader>
      <div className="flex flex-col sm:flex-row gap-3 mb-4"><Input .../><Select .../></div>
      */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: DARK, margin: 0 }}>ניהול מלאי</h1>
          <p style={{ fontSize: 13, color: MUTED, margin: "2px 0 0" }}>{products.length} מוצרים</p>
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
                          {p.image_url && <img src={p.image_url} alt="" style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover" }} />}
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
          } else {
            queryClient.setQueryData(["products"], (old = []) => [savedProduct, ...(Array.isArray(old) ? old : [])]);
            const existing = JSON.parse(sessionStorage.getItem("pendingProducts") || "[]");
            existing.unshift({ ...savedProduct, _confirmCount: 0 });
            sessionStorage.setItem("pendingProducts", JSON.stringify(existing));
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