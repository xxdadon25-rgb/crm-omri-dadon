import { useState, useMemo, useEffect } from "react";
import { fetchProductsWithPending } from "@/lib/pendingProducts";

// Seed from sessionStorage so module-level set is populated after page refresh
const _rawSS = (() => { try { return JSON.parse(sessionStorage.getItem("pendingDeletedProducts") || "[]"); } catch { return []; } })();
console.log("[PROOF] PAGE LOAD — sessionStorage.pendingDeletedProducts raw:", sessionStorage.getItem("pendingDeletedProducts"));
console.log("[PROOF] PAGE LOAD — parsed ids to seed:", _rawSS);
const deletedProductIds = new Set(_rawSS);
console.log("[PROOF] PAGE LOAD — deletedProductIds after seeding:", [...deletedProductIds]);

const getPendingDeletedProductIds = () => {
  try { return new Set(JSON.parse(sessionStorage.getItem("pendingDeletedProducts") || "[]")); } catch { return new Set(); }
};
const setPendingDeletedProductIds = (set) => {
  sessionStorage.setItem("pendingDeletedProducts", JSON.stringify([...set]));
};
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Plus, Search, Trash2, Pencil, AlertTriangle, Download, Upload, Check, BarChart3 } from "lucide-react";
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

const Checkbox = ({ checked, onChange }) => (
  <button
    onClick={onChange}
    className="w-4 h-4 border border-input rounded flex items-center justify-center hover:bg-muted transition-colors"
    style={{ backgroundColor: checked ? "hsl(var(--primary))" : "transparent" }}
  >
    {checked && <Check className="w-3 h-3 text-primary-foreground" />}
  </button>
);

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
      const TARGET = "6a2a0632696b7fe1caf41a8e";
      console.log("[PROOF] SELECT — deletedProductIds:", [...deletedProductIds]);
      console.log("[PROOF] SELECT — sessionStorage pendingDeletedProducts:", sessionStorage.getItem("pendingDeletedProducts"));
      console.log("[PROOF] SELECT — sessionDeleted set:", [...sessionDeleted]);
      console.log("[PROOF] SELECT — input ids count:", data.length);
      console.log("[PROOF] SELECT — target in deletedProductIds:", deletedProductIds.has(TARGET));
      console.log("[PROOF] SELECT — target in sessionDeleted:", sessionDeleted.has(TARGET));
      console.log("[PROOF] SELECT — target in input data:", data.some(p => p.id === TARGET));
      const output = data.filter(p => !deletedProductIds.has(p.id) && !sessionDeleted.has(p.id));
      console.log("[PROOF] SELECT — output ids count:", output.length);
      console.log("[PROOF] SELECT — target in output (should be FALSE):", output.some(p => p.id === TARGET));
      return output;
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
    console.log("[WRITE PROOF] BEFORE setPendingDeletedProductIds — set contents:", [...pendingDeleted]);
    console.log("[WRITE PROOF] BEFORE setPendingDeletedProductIds — sessionStorage raw:", sessionStorage.getItem("pendingDeletedProducts"));
    setPendingDeletedProductIds(pendingDeleted);
    console.log("[WRITE PROOF] AFTER setPendingDeletedProductIds — sessionStorage raw:", sessionStorage.getItem("pendingDeletedProducts"));
    console.log("[WRITE PROOF] AFTER — parsed:", JSON.parse(sessionStorage.getItem("pendingDeletedProducts") || "[]"));
    console.log("[DELETE PROOF] single delete: added to pendingDeletedProducts:", idToDelete);

    queryClient.setQueryData(["products"], (old = []) => old.filter(p => p.id !== idToDelete));

    try {
      await base44.entities.Product.delete(idToDelete);
      toast.success("המוצר נמחק בהצלחה");
    } catch (error) {
      console.log("[DELETE PROOF] delete API error (product stays hidden):", error.message);
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

  return (
    <div>
      <PageHeader title="ניהול מלאי" description={`${products.length} מוצרים`}>
        <Button variant="outline" size="sm" onClick={() => navigate("/inventory-dashboard")}>
          <BarChart3 className="w-4 h-4 ml-1" /> לוח בקרה
        </Button>
        <label className="flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer hover:bg-muted transition-colors text-sm">
          <Upload className="w-4 h-4" /> ייבוא
          <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleImport} />
        </label>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="w-4 h-4 ml-1" /> ייצוא
        </Button>
        <Button size="sm" onClick={() => {setEditProduct(null);setDialogOpen(true);}}>
          <Plus className="w-4 h-4 ml-1" /> מוצר חדש
        </Button>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="חיפוש לפי שם, מק״ט או ברקוד..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="קטגוריה" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הקטגוריות</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {selectedCount > 0 && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4 flex items-center justify-between">
          <span className="text-sm font-medium">נבחרו {selectedCount} מוצרים</span>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setBulkDeleteOpen(true)}
          >
            <Trash2 className="w-4 h-4 ml-1" /> מחק נבחרים
          </Button>
        </div>
      )}

      {isLoading ?
      <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div> :
      filtered.length === 0 ?
      <EmptyState icon={search ? Search : null} title={search ? "לא נמצאו תוצאות" : "אין מוצרים"} description={search ? "נסה חיפוש אחר" : "הוסף מוצר ראשון למלאי"} /> :

      <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right w-12">
                    <Checkbox checked={isAllSelected} onChange={handleSelectAll} />
                  </TableHead>
                  <TableHead className="text-right">מוצר</TableHead>
                  <TableHead className="text-right">מק״ט</TableHead>
                  <TableHead className="text-right">קטגוריה</TableHead>
                  <TableHead className="text-right">מחיר קנייה</TableHead>
                  <TableHead className="text-right">מחיר מכירה</TableHead>
                  <TableHead className="text-right">כמות</TableHead>
                  <TableHead className="text-right">רווח</TableHead>
                  <TableHead className="text-right min-w-[90px]">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => {
                const isLow = p.quantity > 0 && p.quantity <= (p.min_quantity || 0);
                const isOutOfStock = p.quantity === 0;
                const profit = ((p.sell_price || 0) - (p.buy_price || 0)).toFixed(2);
                const isSelected = selectedProducts.has(p.id);
                return (
                  <TableRow key={p.id} className={`hover:bg-muted/30 ${isOutOfStock ? "bg-red-50" : isLow ? "bg-orange-50" : ""} ${isSelected ? "bg-primary/5" : ""}`}>
                      <TableCell className="text-right">
                        <Checkbox checked={isSelected} onChange={() => handleSelectProduct(p.id)} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {p.image_url && <img src={p.image_url} alt="" className="w-8 h-8 rounded object-cover" />}
                          <span className="font-medium">{p.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.sku || "-"}</TableCell>
                      <TableCell>{p.category && <Badge variant="secondary">{p.category}</Badge>}</TableCell>
                      <TableCell>₪{(p.buy_price || 0).toFixed(2)}</TableCell>
                      <TableCell className="font-medium">₪{(p.sell_price || 0).toFixed(2)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {isOutOfStock && <span className="text-xs font-bold text-red-600">אזל</span>}
                          {isLow && !isOutOfStock && <AlertTriangle className="w-3.5 h-3.5 text-orange-600" />}
                          <span className={isOutOfStock ? "text-red-600 font-bold" : isLow ? "text-orange-600 font-medium" : ""}>{p.quantity}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-green-600 font-medium">₪{profit}</TableCell>
                      <TableCell className="min-w-[90px]">
                        <div className="flex items-center gap-1 flex-nowrap">
                          <Button variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9 shrink-0" onClick={() => {setEditProduct(p);setDialogOpen(true);}}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9 shrink-0 text-destructive hover:bg-destructive/10" onClick={() => setDeleteId(p.id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>);

               })}
              </TableBody>
            </Table>
          </div>
        </div>
      }

      {selectedCount > 0 && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mt-4 flex items-center justify-between">
          <span className="text-sm font-medium">נבחרו {selectedCount} מוצרים</span>
          <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
            <Trash2 className="w-4 h-4 ml-1" /> מחק נבחרים
          </Button>
        </div>
      )}

      <ProductDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        product={editProduct}
        onSaved={(savedProduct) => {
          if (editProduct?.id) {
            // Update cache directly.
            queryClient.setQueryData(["products"], (old = []) =>
              old.map(p => p.id === savedProduct.id ? savedProduct : p)
            );
            // Store in sessionStorage so refresh #1 doesn't revert to stale backend data
            const existingUpdates = JSON.parse(sessionStorage.getItem("pendingProductUpdates") || "[]");
            const filtered = existingUpdates.filter(p => p.id !== savedProduct.id);
            filtered.unshift({ ...savedProduct, _confirmCount: 0, _savedAt: Date.now() });
            sessionStorage.setItem("pendingProductUpdates", JSON.stringify(filtered));
          } else {
            // Prepend new product to cache immediately.
            queryClient.setQueryData(["products"], (old = []) => [savedProduct, ...(Array.isArray(old) ? old : [])]);
            // Store in sessionStorage so refresh #1 doesn't lose it
            const existing = JSON.parse(sessionStorage.getItem("pendingProducts") || "[]");
            existing.unshift({ ...savedProduct, _confirmCount: 0 });
            sessionStorage.setItem("pendingProducts", JSON.stringify(existing));

          }
        }}
        categories={categories}
        suppliers={supplierNames} />
      

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
    </div>);

}