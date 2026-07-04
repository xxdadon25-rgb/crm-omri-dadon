import { useState, useMemo } from "react";

// Module-level set — survives component unmount/remount caused by navigation
const deletedSupplierIds = new Set((() => { try { return JSON.parse(sessionStorage.getItem("pendingDeletedSuppliers") || "[]"); } catch { return []; } })());

const getPendingDeletedSuppliers = () => {
  try { return new Set(JSON.parse(sessionStorage.getItem("pendingDeletedSuppliers") || "[]")); } catch { return new Set(); }
};
const setPendingDeletedSuppliers = (set) => {
  sessionStorage.setItem("pendingDeletedSuppliers", JSON.stringify([...set]));
};
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Plus, Search, Pencil, Trash2, Truck, Check, PackagePlus, FolderOpen, ExternalLink, X, ShoppingCart, History } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/api/supabaseClient";
import DeliveryModal from "@/components/suppliers/DeliveryModal";
import ProductCatalogModal from "@/components/products/ProductCatalogModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import { toast } from "sonner";


const empty = { name: "", phone: "", email: "", address: "", tax_id: "", notes: "" };

export default function Suppliers() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(empty);
  const [deleteId, setDeleteId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selectedSuppliers, setSelectedSuppliers] = useState(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deliverySupplier, setDeliverySupplier] = useState(null);
  const [docsSupplier, setDocsSupplier] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [deleteDeliveryId, setDeleteDeliveryId] = useState(null);
  const [deletingDelivery, setDeletingDelivery] = useState(false);
  const [orderSupplier, setOrderSupplier] = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  const [orderProductSearch, setOrderProductSearch] = useState("");
  const [orderFreeText, setOrderFreeText] = useState({ name: "", sku: "", quantity: "" });
  const [orderSaving, setOrderSaving] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [orderCatalogOpen, setOrderCatalogOpen] = useState(false);
  const [historySupplier, setHistorySupplier] = useState(null);
  const [historyOrders, setHistoryOrders] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [deleteOrderId, setDeleteOrderId] = useState(null);
  const [deletingOrder, setDeletingOrder] = useState(false);
  const queryClient = useQueryClient();

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const pendingRaw = sessionStorage.getItem("pendingSuppliers");
      let pendingSuppliers = pendingRaw ? JSON.parse(pendingRaw) : [];

      const pendingUpdateRaw = sessionStorage.getItem("pendingSupplierUpdate");
      const pendingUpdate = pendingUpdateRaw ? JSON.parse(pendingUpdateRaw) : null;

      const result = await base44.entities.Supplier.list("-created_date");

      // Handle pending creates — keep entries alive until backend is consistently stable
      if (pendingSuppliers.length > 0) {
        const backendIds = new Set(result.map(s => s.id));
        const now = Date.now();

        // Age-only gate: keep pending entry for 3 minutes regardless of backend responses.
        // After 3 minutes the platform guarantees eventual consistency — all replicas have the data.
        pendingSuppliers = pendingSuppliers.filter(p => {
          if (!backendIds.has(p.id)) return true;
          const ageMs = now - new Date(p.created_date).getTime();
          return ageMs < 180000; // 3 minutes
        });

        if (pendingSuppliers.length === 0) {
          sessionStorage.removeItem("pendingSuppliers");
        } else {
          sessionStorage.setItem("pendingSuppliers", JSON.stringify(pendingSuppliers));
        }

        const stillMissing = pendingSuppliers.filter(p => !backendIds.has(p.id));
        result.unshift(...stillMissing);
      }

      // Handle pending update — keep overriding the stale backend record until confirmed stable
      if (pendingUpdate) {
        const backendRecord = result.find(s => s.id === pendingUpdate.id);
        const isStale = backendRecord && JSON.stringify(
          Object.fromEntries(Object.entries(pendingUpdate).filter(([k]) => !k.startsWith("_")))
        ) !== JSON.stringify(
          Object.fromEntries(Object.entries(backendRecord).filter(([k]) => !k.startsWith("_")))
        );

        if (!isStale) {
          const confirmCount = (pendingUpdate._confirmCount || 0) + 1;
          if (confirmCount >= 2) {
            sessionStorage.removeItem("pendingSupplierUpdate");
          } else {
            sessionStorage.setItem("pendingSupplierUpdate", JSON.stringify({ ...pendingUpdate, _confirmCount: confirmCount }));
          }
        } else {
          return result.map(s => s.id === pendingUpdate.id
            ? { ...s, ...Object.fromEntries(Object.entries(pendingUpdate).filter(([k]) => !k.startsWith("_"))) }
            : s
          );
        }
      }

      return result;
    },
    refetchOnMount: true,
    select: (data) => data.filter(s => !deletedSupplierIds.has(s.id)),
  });

  const filtered = useMemo(() => {
    return suppliers.filter(s => !search || [s.name, s.phone, s.email].some(f => f?.toLowerCase().includes(search.toLowerCase())));
  }, [suppliers, search]);

  const openDocsModal = async (supplier) => {
    setDocsSupplier(supplier);
    setLoadingDocs(true);
    const { data } = await supabase.from("supplier_deliveries").select("id,supplier_id,delivery_date,file_url,status,created_at").eq("supplier_id", supplier.id).order("created_at", { ascending: false });
    setDeliveries(data || []);
    setLoadingDocs(false);
  };

  const handleDeleteDelivery = async () => {
    const delivery = deliveries.find(d => d.id === deleteDeliveryId);
    if (!delivery) return;
    setDeletingDelivery(true);
    try {
      if (delivery.file_url) {
        const url = new URL(delivery.file_url);
        const pathParts = url.pathname.split("/storage/v1/object/public/delivery-documents/");
        if (pathParts[1]) {
          await supabase.storage.from("delivery-documents").remove([decodeURIComponent(pathParts[1])]);
        }
      }
      await supabase.from("supplier_deliveries").delete().eq("id", deleteDeliveryId);
      setDeliveries(prev => prev.filter(d => d.id !== deleteDeliveryId));
    } catch (err) {
      toast.error("שגיאה במחיקה: " + err.message);
    } finally {
      setDeleteDeliveryId(null);
      setDeletingDelivery(false);
    }
  };

  const openHistoryModal = async (supplier) => {
    setHistorySupplier(supplier);
    setHistoryOrders([]);
    setLoadingHistory(true);
    const { data } = await supabase
      .from("supplier_orders")
      .select("id,status,order_date,created_at,items")
      .eq("supplier_id", supplier.id)
      .order("created_at", { ascending: false });
    setHistoryOrders(data || []);
    setLoadingHistory(false);
  };

  const handleDeleteOrder = async () => {
    setDeletingOrder(true);
    try {
      await supabase.from("supplier_orders").delete().eq("id", deleteOrderId);
      setHistoryOrders(prev => prev.filter(o => o.id !== deleteOrderId));
    } catch (err) {
      toast.error("שגיאה במחיקה: " + err.message);
    } finally {
      setDeleteOrderId(null);
      setDeletingOrder(false);
    }
  };

  const openOrderModal = async (supplier) => {
    setOrderSupplier(supplier);
    setOrderItems([]);
    setOrderProductSearch("");
    setOrderFreeText({ name: "", sku: "", quantity: "" });
    const { data } = await supabase.from("products").select("id,name,sku,buy_price,sell_price,quantity,category,is_active").eq("is_active", true).order("name");
    setCatalogProducts(data || []);
  };

  const addCatalogProduct = (product) => {
    setOrderItems(prev => {
      const exists = prev.find(i => i.product_id === product.id);
      if (exists) return prev.map(i => i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { product_id: product.id, product_name: product.name, sku: product.sku || null, quantity: 1 }];
    });
    setOrderProductSearch("");
  };

  const addProductsFromCatalog = (selectedItems) => {
    const mapped = selectedItems.map(item => ({
      product_id: item.product_id || null,
      product_name: item.name,
      sku: item.sku || null,
      quantity: item.quantity || 1,
    }));
    setOrderItems(prev => {
      const merged = [...prev];
      for (const item of mapped) {
        const exists = merged.findIndex(i => i.product_id && i.product_id === item.product_id);
        if (exists >= 0) merged[exists] = { ...merged[exists], quantity: merged[exists].quantity + item.quantity };
        else merged.push(item);
      }
      return merged;
    });
  };

  const addFreeTextProduct = () => {
    if (!orderFreeText.name.trim() || !orderFreeText.quantity) return;
    setOrderItems(prev => [...prev, {
      product_id: null,
      product_name: orderFreeText.name.trim(),
      sku: orderFreeText.sku.trim() || null,
      quantity: parseFloat(orderFreeText.quantity) || 1,
    }]);
    setOrderFreeText({ name: "", sku: "", quantity: "" });
  };

  const saveSupplierOrder = async () => {
    if (!orderItems.length) { toast.error("יש להוסיף לפחות פריט אחד"); return; }
    setOrderSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("supplier_orders").insert({
        supplier_id: orderSupplier.id,
        order_date: new Date().toISOString(),
        status: "ממתין לאישור",
        items: orderItems.map(i => ({ product_id: i.product_id || null, product_name: i.product_name || i.name || "", sku: i.sku || null, quantity: i.quantity })),
        user_id: user?.id,
      });
      if (error) throw error;
      toast.success("הזמנה נשמרה בהצלחה");
      setOrderSupplier(null);
    } catch (err) {
      toast.error("שגיאה בשמירת הזמנה: " + err.message);
    } finally {
      setOrderSaving(false);
    }
  };

  const openDialog = (item) => {
    setEditItem(item);
    setForm(item ? { ...empty, ...item } : empty);
    setDialogOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    if (editItem?.id) {
      const updated = await base44.entities.Supplier.update(editItem.id, form);
      sessionStorage.setItem("pendingSupplierUpdate", JSON.stringify(updated));
      queryClient.setQueryData(["suppliers"], (old = []) => old.map(s => s.id === updated.id ? updated : s));
    } else {
      const created = await base44.entities.Supplier.create(form);
      const raw = sessionStorage.getItem("pendingSuppliers");
      const pending = raw ? JSON.parse(raw) : [];
      const idx = pending.findIndex(p => p.id === created.id);
      // Always store created_date so age-based cleanup can work
      const entry = { ...created, created_date: created.created_date };
      if (idx >= 0) pending[idx] = entry; else pending.push(entry);
      sessionStorage.setItem("pendingSuppliers", JSON.stringify(pending));
      queryClient.setQueryData(["suppliers"], (old = []) => [created, ...old]);
    }
    setSaving(false);
    setDialogOpen(false);
  };

  const isAllSelected = filtered.length > 0 && filtered.every(s => selectedSuppliers.has(s.id));
  const selectedCount = selectedSuppliers.size;

  const handleSelectSupplier = (id) => {
    const updated = new Set(selectedSuppliers);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setSelectedSuppliers(updated);
  };

  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedSuppliers(new Set());
    } else {
      const allIds = new Set(filtered.map(s => s.id));
      setSelectedSuppliers(allIds);
    }
  };

  const handleDelete = async () => {
    const idToDelete = deleteId;
    setDeleteId(null);
    deletedSupplierIds.add(idToDelete);
    const pendingDeleted = getPendingDeletedSuppliers();
    pendingDeleted.add(idToDelete);
    setPendingDeletedSuppliers(pendingDeleted);
    queryClient.setQueryData(["suppliers"], (old = []) => old.filter(s => s.id !== idToDelete));
    try {
      await base44.entities.Supplier.delete(idToDelete);
      toast.success("ספק נמחק בהצלחה");
    } catch (err) {
      deletedSupplierIds.delete(idToDelete);
      toast.error("שגיאה במחיקת הספק");
    } finally {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    }
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    const ids = Array.from(selectedSuppliers);
    ids.forEach(id => deletedSupplierIds.add(id));
    const pendingDeleted = getPendingDeletedSuppliers();
    ids.forEach(id => pendingDeleted.add(id));
    setPendingDeletedSuppliers(pendingDeleted);
    queryClient.setQueryData(["suppliers"], (old = []) => old.filter(s => !deletedSupplierIds.has(s.id)));
    setSelectedSuppliers(new Set());
    setBulkDeleteOpen(false);
    await Promise.allSettled(ids.map(id => base44.entities.Supplier.delete(id)));
    toast.success(`${ids.length} ספקים נמחקו בהצלחה`);
    queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    setDeleting(false);
  };

  // ── Heillo design tokens ──
  const ACCENT = "#F5885E";
  const DARK   = "#120F1C";
  const MUTED  = "#B2B0B1";

  // Outline action button style reused for the 4 supplier action buttons
  const actionBtn = (color) => ({
    background: "#FFFFFF", border: `1px solid ${color}22`, borderRadius: 10,
    color, fontSize: 12, fontWeight: 500, padding: "5px 10px", cursor: "pointer",
    display: "inline-flex", alignItems: "center", gap: 5,
    fontFamily: "'Heebo', sans-serif", transition: "background 0.15s ease",
  });

  return (
    /* OLD: <div><div className="overflow-y-auto thin-scrollbar max-h-[calc(100vh-4rem)]"> */
    <div className="heillo-page" dir="rtl">

      {/* ── Top bar ── */}
      {/* OLD: <div className="sticky top-0 z-10 bg-background pb-3"><PageHeader .../><div className="relative mt-1"><Search /><Input className="pr-9 max-w-md" /></div></div> */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--heillo-text-primary)", margin: 0, fontFamily: "'Heebo', sans-serif" }}>ספקים</h1>
          <p style={{ fontSize: 13, color: "var(--heillo-text-muted)", margin: "2px 0 0", fontFamily: "'Heebo', sans-serif" }}>{suppliers.length} ספקים</p>
        </div>
        <button className="heillo-btn-primary" onClick={() => openDialog(null)} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Plus style={{ width: 16, height: 16 }} /> ספק חדש
        </button>
      </div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 16, maxWidth: 400 }}>
        <Search style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: MUTED, pointerEvents: "none" }} />
        {/* OLD: <Input placeholder="חיפוש ספקים..." className="pr-9 max-w-md" /> */}
        <input placeholder="חיפוש ספקים..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="heillo-input" style={{ width: "100%", boxSizing: "border-box", paddingRight: 40 }} />
      </div>

      {/* Bulk bar — top */}
      {/* OLD: <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4 ..."> */}
      {selectedCount > 0 && (
        <div style={{ background: "rgba(245,136,94,0.07)", border: "1px solid rgba(245,136,94,0.2)", borderRadius: 14, padding: "10px 16px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: DARK, fontFamily: "'Heebo', sans-serif" }}>נבחרו {selectedCount} ספקים</span>
          <button onClick={() => setBulkDeleteOpen(true)} style={{ background: "transparent", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, color: "#ef4444", fontSize: 12, fontWeight: 500, padding: "6px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "'Heebo', sans-serif" }}>
            <Trash2 style={{ width: 14, height: 14 }} /> מחק נבחרים
          </button>
        </div>
      )}

      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "64px 0" }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid rgba(0,0,0,0.08)", borderTopColor: ACCENT, animation: "spin 1s linear infinite" }} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Truck} title="אין ספקים" description="הוסף ספק ראשון" />
      ) : (
        /* OLD: <div className="bg-card rounded-xl border border-border overflow-hidden"> */
        <div className="heillo-card">
          <div style={{ overflowX: "auto" }}>
            {/* OLD: <Table><TableHeader><TableRow className="bg-muted/50"> */}
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Heebo', sans-serif" }}>
              <thead className="heillo-table-header">
                <tr>
                  <th style={{ width: 44, padding: "14px 20px", textAlign: "center" }}>
                    <Checkbox checked={isAllSelected} onCheckedChange={handleSelectAll} />
                  </th>
                  {["שם", "טלפון", "אימייל", "ח.פ", "פעולות"].map(col => (
                    <th key={col} style={{ padding: "14px 20px", textAlign: "right", whiteSpace: "nowrap" }}>{col}</th>
                  ))}
                </tr>
              </thead>
              {/* OLD: <TableBody>{filtered.map(s => <TableRow className={`hover:bg-muted/30 ${isSelected ? "bg-primary/5" : ""}`}> */}
              <tbody>
                {filtered.map((s, i) => {
                  const isSelected = selectedSuppliers.has(s.id);
                  return (
                    <tr key={s.id} className="heillo-table-row"
                      style={{ background: isSelected ? "rgba(245,136,94,0.04)" : undefined, borderBottom: i < filtered.length - 1 ? "1px solid rgba(0,0,0,0.04)" : "none" }}>
                      <td style={{ padding: "14px 20px", textAlign: "center" }}>
                        <Checkbox checked={isSelected} onCheckedChange={() => handleSelectSupplier(s.id)} />
                      </td>
                      {/* OLD: <TableCell className="font-medium">{s.name}</TableCell> */}
                      <td style={{ padding: "14px 20px", fontWeight: 600, fontSize: 13, color: DARK }}>{s.name}</td>
                      <td style={{ padding: "14px 20px", fontSize: 13, color: MUTED }}>{s.phone || "—"}</td>
                      <td style={{ padding: "14px 20px", fontSize: 13, color: MUTED }}>{s.email || "—"}</td>
                      <td style={{ padding: "14px 20px", fontSize: 13, color: MUTED }}>{s.tax_id || "—"}</td>
                      <td style={{ padding: "14px 20px" }}>
                        {/* OLD: <div className="flex items-center gap-1"><Button variant="outline" ...> x4 + <Button variant="ghost" size="icon"> x2 */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <button style={actionBtn("#16a34a")} onClick={() => openOrderModal(s)}
                            onMouseEnter={e => e.currentTarget.style.background = "rgba(22,163,74,0.06)"}
                            onMouseLeave={e => e.currentTarget.style.background = "#FFFFFF"}>
                            <ShoppingCart style={{ width: 13, height: 13 }} /> הזמנה מספק
                          </button>
                          <button style={actionBtn("#2563eb")} onClick={() => setDeliverySupplier(s)}
                            onMouseEnter={e => e.currentTarget.style.background = "rgba(37,99,235,0.06)"}
                            onMouseLeave={e => e.currentTarget.style.background = "#FFFFFF"}>
                            <PackagePlus style={{ width: 13, height: 13 }} /> קבלת סחורה
                          </button>
                          <button style={actionBtn("#7c3aed")} onClick={() => openDocsModal(s)}
                            onMouseEnter={e => e.currentTarget.style.background = "rgba(124,58,237,0.06)"}
                            onMouseLeave={e => e.currentTarget.style.background = "#FFFFFF"}>
                            <FolderOpen style={{ width: 13, height: 13 }} /> קבצי סחורה
                          </button>
                          <button style={actionBtn("#ea580c")} onClick={() => openHistoryModal(s)}
                            onMouseEnter={e => e.currentTarget.style.background = "rgba(234,88,12,0.06)"}
                            onMouseLeave={e => e.currentTarget.style.background = "#FFFFFF"}>
                            <History style={{ width: 13, height: 13 }} /> היסטוריית הזמנות
                          </button>
                          <button title="עריכה" className="heillo-icon-btn" onClick={() => openDialog(s)}>
                            <Pencil size={17} strokeWidth={1.8} />
                          </button>
                          <button title="מחיקה" className="heillo-icon-btn" style={{ color: "#ef4444" }} onClick={() => setDeleteId(s.id)}
                            onMouseEnter={e => e.currentTarget.style.background = "rgba(239,68,68,0.08)"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                            <Trash2 size={17} strokeWidth={1.8} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bulk bar — bottom */}
      {/* OLD: <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mt-4 ..."> */}
      {selectedCount > 0 && (
        <div style={{ background: "rgba(245,136,94,0.07)", border: "1px solid rgba(245,136,94,0.2)", borderRadius: 14, padding: "10px 16px", marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: DARK, fontFamily: "'Heebo', sans-serif" }}>נבחרו {selectedCount} ספקים</span>
          <button onClick={() => setBulkDeleteOpen(true)} style={{ background: "transparent", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, color: "#ef4444", fontSize: 12, fontWeight: 500, padding: "6px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "'Heebo', sans-serif" }}>
            <Trash2 style={{ width: 14, height: 14 }} /> מחק נבחרים
          </button>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader><DialogTitle>{editItem?.id ? "עריכת ספק" : "ספק חדש"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div className="space-y-1.5"><Label>שם ספק *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div className="space-y-1.5"><Label>טלפון</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>אימייל</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>ח.פ</Label><Input value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} /></div>
            <div className="sm:col-span-2 space-y-1.5"><Label>כתובת</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div className="sm:col-span-2 space-y-1.5"><Label>הערות</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
            <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>ביטול</Button>
              <Button type="submit" disabled={saving}>{saving ? "שומר..." : "שמירה"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת ספק</AlertDialogTitle>
            <AlertDialogDescription>האם אתה בטוח שברצונך למחוק את הספק?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">מחק ספק</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DeliveryModal
        key={deliverySupplier?.id}
        supplier={deliverySupplier}
        open={!!deliverySupplier}
        onClose={() => setDeliverySupplier(null)}
      />

      {/* Delivery documents modal */}
      <Dialog open={!!docsSupplier} onOpenChange={(o) => { if (!o) setDocsSupplier(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>קבצי סחורה — {docsSupplier?.name}</DialogTitle>
          </DialogHeader>
          {loadingDocs ? (
            <p className="text-sm text-muted-foreground py-6 text-center">טוען...</p>
          ) : deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">אין תיעוד קבלות סחורה עבור ספק זה</p>
          ) : (
            <div className="space-y-3 mt-2">
              {deliveries.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-4 border border-border rounded-lg p-3">
                  <div className="space-y-1 text-sm">
                    <p className="font-medium">
                      {new Date(d.delivery_date).toLocaleString("he-IL", {
                        day: "2-digit", month: "2-digit", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </p>
                    <p className="text-muted-foreground">{d.status}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {d.file_url ? (
                      <a
                        href={d.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> פתח קובץ
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">אין קובץ</span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteDeliveryId(d.id)}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteDeliveryId} onOpenChange={(o) => { if (!o) setDeleteDeliveryId(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת רשומת סחורה</AlertDialogTitle>
            <AlertDialogDescription>האם אתה בטוח שברצונך למחוק קובץ זה? פעולה זו אינה הפיכה.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel disabled={deletingDelivery}>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteDelivery} disabled={deletingDelivery} className="bg-destructive text-destructive-foreground">
              {deletingDelivery ? "מוחק..." : "מחק"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Supplier order modal */}
      <Dialog open={!!orderSupplier} onOpenChange={(o) => { if (!o) setOrderSupplier(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>הזמנה מספק — {orderSupplier?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 mt-2">
            {/* Catalog search */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="font-semibold">הוסף מוצר מהקטלוג</Label>
                <Button type="button" size="sm" variant="outline" onClick={() => setOrderCatalogOpen(true)}>
                  <Plus className="w-3.5 h-3.5 ml-1" /> פתח קטלוג מוצרים
                </Button>
              </div>
              <Input
                placeholder="חפש מוצר לפי שם..."
                value={orderProductSearch}
                onChange={e => setOrderProductSearch(e.target.value)}
              />
              {orderProductSearch.trim() && (
                <div className="border border-border rounded-lg max-h-40 overflow-y-auto">
                  {catalogProducts
                    .filter(p => p.name.toLowerCase().includes(orderProductSearch.toLowerCase()) || (p.sku || "").toLowerCase().includes(orderProductSearch.toLowerCase()))
                    .slice(0, 10)
                    .map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addCatalogProduct(p)}
                        className="w-full text-right px-3 py-2 text-sm hover:bg-muted flex justify-between items-center gap-2 border-b border-border last:border-0"
                      >
                        <span>{p.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{p.sku || ""}</span>
                      </button>
                    ))}
                  {catalogProducts.filter(p => p.name.toLowerCase().includes(orderProductSearch.toLowerCase())).length === 0 && (
                    <p className="text-sm text-muted-foreground px-3 py-2">לא נמצאו מוצרים</p>
                  )}
                </div>
              )}
            </div>

            {/* Free-text product */}
            <div className="space-y-2">
              <Label className="font-semibold">או הוסף מוצר חדש / לא מוכר</Label>
              <div className="flex gap-2">
                <Input placeholder="שם מוצר" value={orderFreeText.name} onChange={e => setOrderFreeText(p => ({ ...p, name: e.target.value }))} className="flex-1" />
                <Input placeholder='מק"ט' value={orderFreeText.sku} onChange={e => setOrderFreeText(p => ({ ...p, sku: e.target.value }))} className="w-28" />
                <Input type="number" placeholder="כמות" min="1" value={orderFreeText.quantity} onChange={e => setOrderFreeText(p => ({ ...p, quantity: e.target.value }))} className="w-20" />
                <Button type="button" variant="outline" onClick={addFreeTextProduct} disabled={!orderFreeText.name.trim() || !orderFreeText.quantity}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Items list */}
            {orderItems.length > 0 && (
              <div className="space-y-2">
                <Label className="font-semibold">פריטי הזמנה ({orderItems.length})</Label>
                <div className="border border-border rounded-lg overflow-hidden">
                  {orderItems.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between px-3 py-2 border-b border-border last:border-0 text-sm">
                      <div className="flex-1">
                        <span className="font-medium">{item.product_name}</span>
                        {item.sku && <span className="text-xs text-muted-foreground mr-2">{item.sku}</span>}
                        {!item.product_id && <span className="text-xs text-orange-500 mr-2">חדש</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={e => setOrderItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: parseFloat(e.target.value) || 1 } : it))}
                          className="w-16 h-7 text-center"
                        />
                        <button type="button" onClick={() => setOrderItems(prev => prev.filter((_, i) => i !== idx))} className="text-destructive hover:text-destructive/80">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t">
              <Button variant="outline" className="flex-1" onClick={() => setOrderSupplier(null)}>ביטול</Button>
              <Button className="flex-1" onClick={saveSupplierOrder} disabled={orderSaving || !orderItems.length}>
                {orderSaving ? "שומר..." : "שמור הזמנה"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Supplier order history modal ─────────────────────────────────── */}
      <Dialog open={!!historySupplier} onOpenChange={(o) => { if (!o) setHistorySupplier(null); }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>היסטוריית הזמנות — {historySupplier?.name}</DialogTitle>
          </DialogHeader>
          {loadingHistory ? (
            <p className="text-sm text-muted-foreground py-6 text-center">טוען...</p>
          ) : historyOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">אין הזמנות עבור ספק זה</p>
          ) : (
            <div className="space-y-2 mt-2">
              {historyOrders.map((order) => {
                const isOpen = order.status === "ממתין לאישור";
                const itemCount = Array.isArray(order.items) ? order.items.length : 0;
                const itemSummary = Array.isArray(order.items)
                  ? order.items.slice(0, 3).map(i => i.product_name || i.name || "").filter(Boolean).join(", ") + (itemCount > 3 ? ` ועוד ${itemCount - 3}` : "")
                  : "";
                const date = order.order_date || order.created_at?.slice(0, 10) || "";
                return (
                  <div key={order.id} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{date}</span>
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center text-xs font-semibold rounded-full px-2.5 py-0.5 border ${isOpen ? "bg-yellow-50 text-yellow-800 border-yellow-300" : "bg-green-50 text-green-800 border-green-300"}`}>
                          {isOpen ? "ממתין לאישור" : "הושלם"}
                        </span>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => setDeleteOrderId(order.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    {itemSummary && (
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        <span className="font-medium">{itemCount} פריטים:</span> {itemSummary}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteOrderId} onOpenChange={(o) => { if (!o) setDeleteOrderId(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת הזמנה</AlertDialogTitle>
            <AlertDialogDescription>האם אתה בטוח שברצונך למחוק הזמנה זו? פעולה זו אינה ניתנת לביטול.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel disabled={deletingOrder}>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteOrder} disabled={deletingOrder} className="bg-destructive text-destructive-foreground">
              {deletingOrder ? "מוחק..." : "מחק הזמנה"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ProductCatalogModal
        open={orderCatalogOpen}
        onOpenChange={setOrderCatalogOpen}
        products={catalogProducts}
        onAddProducts={(items) => { addProductsFromCatalog(items); setOrderCatalogOpen(false); }}
        categories={[]}
        defaultDiscount={0}
      />

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת ספקים</AlertDialogTitle>
            <AlertDialogDescription>האם אתה בטוח שברצונך למחוק את {selectedCount} הספקים שנבחרו?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel disabled={deleting}>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} disabled={deleting} className="bg-destructive text-destructive-foreground">
              {deleting ? "מוחק..." : "מחק ספקים"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
      );
      }