import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";

// Seed from sessionStorage so module-level set is populated after page refresh
const deletedOrderIds = new Set((() => { try { return JSON.parse(sessionStorage.getItem("pendingDeletedOrders") || "[]"); } catch { return []; } })());

const getPendingDeletedOrderIds = () => {
  try { return new Set(JSON.parse(sessionStorage.getItem("pendingDeletedOrders") || "[]")); } catch { return new Set(); }
};
const setPendingDeletedOrderIds = (set) => {
  sessionStorage.setItem("pendingDeletedOrders", JSON.stringify([...set]));
};
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Search, Plus, Trash2, Eye, Pencil, Check, FileText, Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import OrderViewModal from "@/components/orders/OrderViewModal";
import OrderEditModal from "@/components/orders/OrderEditModal";
import OrderCreateModal from "@/components/orders/OrderCreateModal";
import { formatDate } from "@/lib/dateUtils";
import { toast } from "sonner";

const Checkbox2 = ({ checked, onChange }) => (
  <button
    onClick={onChange}
    className="w-6 h-6 border border-input rounded flex items-center justify-center hover:bg-muted transition-colors"
    style={{ backgroundColor: checked ? "hsl(var(--primary))" : "transparent" }}
  >
    {checked && <Check className="w-3.5 h-3.5 text-primary-foreground" />}
  </button>
);

const statusColors = {
  "טיוטה": "bg-gray-100 text-gray-700",
  "ממתין לאישור": "bg-yellow-100 text-yellow-800",
  "אושר": "bg-blue-100 text-blue-800",
  "בהכנה": "bg-purple-100 text-purple-800",
  "הושלם": "bg-green-100 text-green-800",
  "בוטל": "bg-red-100 text-red-800",
};

export default function Orders() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [viewOrder, setViewOrder] = useState(null);
  const [editOrder, setEditOrder] = useState(null);
  const [saving, setSaving] = useState(false);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [restoreStockDialog, setRestoreStockDialog] = useState(null); // { updates, order }
  const queryClient = useQueryClient();

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders"],
    staleTime: 0,
    queryFn: async () => {
      const result = await base44.entities.Order.list();

      // --- pendingOrderUpdate: read-after-write guard for Order Edit ---
      const rawUpdate = sessionStorage.getItem("pendingOrderUpdate");
      if (rawUpdate) {
        const pendingUpdate = JSON.parse(rawUpdate);
        const fromBackend = result.find(o => o.id === pendingUpdate.id);
        // "stale" = backend hasn't propagated the new total yet
        const isStale = !fromBackend || fromBackend.total !== pendingUpdate.total;
        if (isStale) {
          // Replace the stale entry with our known-good updated object
          const patched = fromBackend
            ? result.map(o => o.id === pendingUpdate.id ? pendingUpdate : o)
            : result;
          return patched;
        } else {
          // Backend returned fresh data — require two consecutive confirmations
          const confirmCount = (pendingUpdate._confirmCount || 0) + 1;
          if (confirmCount >= 2) {
            sessionStorage.removeItem("pendingOrderUpdate");
          } else {
            sessionStorage.setItem("pendingOrderUpdate", JSON.stringify({ ...pendingUpdate, _confirmCount: confirmCount }));
          }
        }
      }

      // ── DELETE guard: prune pendingDeletedOrders once backend confirms ids are gone ──
      const rawDeleted = sessionStorage.getItem("pendingDeletedOrders");
      if (rawDeleted) {
        const pendingDeleted = new Set(JSON.parse(rawDeleted));
        const returnedIds = new Set(result.map(o => o.id));
        [...pendingDeleted].filter(id => !returnedIds.has(id)).forEach(id => pendingDeleted.delete(id));
        if (pendingDeleted.size === 0) sessionStorage.removeItem("pendingDeletedOrders");
        else sessionStorage.setItem("pendingDeletedOrders", JSON.stringify([...pendingDeleted]));
      }

      // --- pendingOrder: existing read-after-write guard for Order Create ---
      const pending = sessionStorage.getItem("pendingOrder");
      if (!pending) return result;
      const pendingOrder = JSON.parse(pending);
      if (result.some(o => o.id === pendingOrder.id)) {
        const confirmCount = (pendingOrder._confirmCount || 0) + 1;
        if (confirmCount >= 2) {
          sessionStorage.removeItem("pendingOrder");
        } else {
          sessionStorage.setItem("pendingOrder", JSON.stringify({ ...pendingOrder, _confirmCount: confirmCount }));
        }
        return result;
      }
      // pendingOrder.id not found in backend — may be write delay or stale ghost
      const missingCount = (pendingOrder._confirmMissingCount || 0) + 1;
      if (missingCount >= 2) {
        sessionStorage.removeItem("pendingOrder");
        return result;
      }
      sessionStorage.setItem("pendingOrder", JSON.stringify({ ...pendingOrder, _confirmMissingCount: missingCount }));
      return [pendingOrder, ...result];
    },
    select: (data) => {
      const sessionDeleted = getPendingDeletedOrderIds();
      return data.filter(o => !deletedOrderIds.has(o.id) && !sessionDeleted.has(o.id));
    },
  });





  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const result = await base44.entities.Customer.list("-created_date");
      const pending = sessionStorage.getItem("pendingCustomer");
      if (!pending) return result;
      const pendingCustomer = JSON.parse(pending);
      if (result.some(c => c.id === pendingCustomer.id)) {
        const ageMs = Date.now() - new Date(pendingCustomer.created_date).getTime();
        if (ageMs >= 180000) {
          sessionStorage.removeItem("pendingCustomer");
        }
        return result;
      }
      return [pendingCustomer, ...result];
    },
    refetchOnMount: true,
  });

  const { data: quotes = [] } = useQuery({
    queryKey: ["orders-quotes"],
    queryFn: () => base44.entities.Quote.list("-created_date"),
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => base44.entities.Product.list("-created_date"),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => base44.entities.Category.list(),
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => base44.entities.Invoice.list("-created_date"),
  });

  const filtered = useMemo(() => orders.filter((o) =>
    !search || o.customer_name?.includes(search) || String(o.order_number)?.includes(search)
  ), [orders, search]);

  const handleDelete = async () => {
    const idToDelete = deleteId;
    setDeleteId(null);
    if (viewOrder?.id === idToDelete) setViewOrder(null);
    if (editOrder?.id === idToDelete) setEditOrder(null);
    deletedOrderIds.add(idToDelete);
    setPendingDeletedOrderIds(deletedOrderIds);
    queryClient.setQueryData(["orders"], (old = []) => old.filter(o => o.id !== idToDelete));
    try {
      await base44.entities.Order.delete(idToDelete);
      toast.success("הזמנה נמחקה");
    } catch (err) {
      deletedOrderIds.delete(idToDelete);
      setPendingDeletedOrderIds(deletedOrderIds);
      toast.error("שגיאה במחיקת ההזמנה: " + err.message);
    } finally {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    }
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    const ids = [...selected];
    ids.forEach(id => deletedOrderIds.add(id));
    const pendingDeleted = getPendingDeletedOrderIds();
    ids.forEach(id => pendingDeleted.add(id));
    setPendingDeletedOrderIds(pendingDeleted);
    queryClient.setQueryData(["orders"], (old = []) => old.filter(o => !deletedOrderIds.has(o.id)));
    setSelected(new Set());
    setBulkDeleteOpen(false);
    await Promise.allSettled(ids.map(id => base44.entities.Order.delete(id)));
    toast.success(`${ids.length} הזמנות נמחקו בהצלחה`);
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    setDeleting(false);
  };

  const toggleSelect = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(o => o.id)));
    }
  };

  const deductInventory = async (items) => {
    console.log('[deductInventory] called with items:', JSON.stringify(items));
    for (const item of items) {
      const productId = item.product_id || item.id;
      console.log('[deductInventory] processing item, productId:', productId, 'quantity:', item.quantity);
      if (!productId) { console.log('[deductInventory] SKIPPED - no productId'); continue; }
      const { data: product, error: fetchErr } = await supabase.from("products").select("id,quantity").eq("id", productId).single();
      console.log('[deductInventory] fetched product:', product, 'error:', fetchErr);
      if (!product) continue;
      const newQty = Math.max(0, (product.quantity || 0) - (item.quantity || 0));
      const { error: updateErr } = await supabase.from("products").update({ quantity: newQty }).eq("id", productId);
      console.log('[deductInventory] update result error:', updateErr, 'newQty:', newQty);
      const raw = sessionStorage.getItem("pendingProductUpdates");
      if (raw) {
        try {
          const filtered = JSON.parse(raw).filter(p => p.id !== productId);
          if (filtered.length === 0) sessionStorage.removeItem("pendingProductUpdates");
          else sessionStorage.setItem("pendingProductUpdates", JSON.stringify(filtered));
        } catch (e) {}
      }
    }
    queryClient.removeQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const restoreInventory = async (items) => {
    for (const item of items) {
      const pid = item.product_id || item.id;
      if (!pid) continue;
      const { data: product } = await supabase.from("products").select("id,quantity").eq("id", pid).single();
      if (!product) continue;
      const newQty = (product.quantity || 0) + (item.quantity || 0);
      await supabase.from("products").update({ quantity: newQty }).eq("id", pid);
      const raw = sessionStorage.getItem("pendingProductUpdates");
      if (raw) {
        try {
          const filtered = JSON.parse(raw).filter(p => p.id !== pid);
          if (filtered.length === 0) sessionStorage.removeItem("pendingProductUpdates");
          else sessionStorage.setItem("pendingProductUpdates", JSON.stringify(filtered));
        } catch (e) {}
      }
    }
    queryClient.removeQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const commitEditSave = async (updates, order, restoreStock = false) => {
    setSaving(true);
    try {
      const items = order.items || [];
      const wasFulfilled = !!order.inventory_deducted;
      const willBeCancelled = updates.status === "בוטל";
      const willBeFulfilled = !!updates.fulfilled;

      if (willBeCancelled && wasFulfilled) {
        if (restoreStock) {
          await restoreInventory(items);
          updates.inventory_deducted = false;
        }
      } else if (willBeFulfilled && !wasFulfilled) {
        await deductInventory(items);
        updates.inventory_deducted = true;
      } else if (!willBeFulfilled && wasFulfilled && !willBeCancelled) {
        await restoreInventory(items);
        updates.inventory_deducted = false;
      }

      const updated = await base44.entities.Order.update(order.id, updates);
      sessionStorage.setItem("pendingOrderUpdate", JSON.stringify(updated));
      queryClient.setQueryData(["orders"], (old = []) => old.map(o => o.id === updated.id ? updated : o));
      setEditOrder(null);
      setRestoreStockDialog(null);
      toast.success("ההזמנה עודכנה בהצלחה");
    } catch (error) {
      toast.error("שגיאה בעדכון ההזמנה");
    } finally {
      setSaving(false);
    }
  };

  const handleEditSave = async (updates) => {
    const order = editOrder;
    const willBeCancelled = updates.status === "בוטל";
    const wasFulfilled = !!order.inventory_deducted;

    if (willBeCancelled && wasFulfilled) {
      setRestoreStockDialog({ updates, order });
      return;
    }
    await commitEditSave(updates, order);
  };

  const handleGenerateDocument = (order) => {
    toast.info("יצירת מסמך... (תכונה בהכנה)");
  };

  const { data: settings = [] } = useQuery({
    queryKey: ["settings"],
    queryFn: () => base44.entities.BusinessSettings?.list() ?? [],
  });

  const handleCreateInvoice = async (order) => {
    // Step 4: fast guard via invoiced_at flag on the order itself
    if (order.invoiced_at) {
      toast.error("כבר הופקה חשבונית עבור הזמנה זו");
      return;
    }

    // Duplicate guard: fetch invoices on-demand to check if one already exists
    const invoicesList = await base44.entities.Invoice.list("-created_date");
    const existing = invoicesList.find(inv =>
      inv.order_id === order.id ||
      (Array.isArray(inv.included_order_ids) && inv.included_order_ids.includes(order.id))
    );
    if (existing) {
      toast.error(`חשבונית כבר קיימת עבור הזמנה זו (#${existing.invoice_number})`);
      return;
    }

    setCreatingInvoice(true);
    try {
      const businessSettings = settings[0] || {};
      const newInvoiceNumber = (businessSettings.invoice_counter || 1000) + 1;

      const newInvoice = await base44.entities.Invoice.create({
        invoice_number: newInvoiceNumber,
        order_id: order.id,
        quote_id: order.quote_id || null,
        customer_id: order.customer_id,
        customer_name: order.customer_name,
        customer_tax_id: order.customer_tax_id || "",
        customer_address: order.delivery_address || "",
        date: new Date().toISOString().split("T")[0],
        items: order.items || [],
        subtotal: order.subtotal || 0,
        gross_total: order.gross_total || order.subtotal || 0,
        discount_amount: order.discount_amount || 0,
        vat_rate: order.vat_rate || 17,
        vat_amount: order.vat_amount || 0,
        total: order.total || 0,
        paid_amount: 0,
        payment_status: "ממתין לתשלום",
        notes: order.notes || "",
      });

      queryClient.setQueryData(["invoices"], (old = []) => [newInvoice, ...(old)]);

      // Step 2: mark order as invoiced
      await base44.entities.Order.update(order.id, { invoiced_at: new Date().toISOString() });
      queryClient.setQueryData(["orders"], (old = []) =>
        old.map(o => o.id === order.id ? { ...o, invoiced_at: new Date().toISOString() } : o)
      );

      // Update invoice counter
      if (businessSettings.id) {
        await base44.entities.BusinessSettings.update(businessSettings.id, {
          invoice_counter: newInvoiceNumber,
        });
        queryClient.invalidateQueries({ queryKey: ["settings"] });
      }

      console.log("[Orders→Invoice] created invoice object:", newInvoice);
      console.log("[Orders→Invoice] created invoice id:", newInvoice?.id);
      sessionStorage.setItem("pendingInvoice", JSON.stringify(newInvoice));
      console.log("[Orders→Invoice] sessionStorage pendingInvoice after setItem:", sessionStorage.getItem("pendingInvoice"));
      setViewOrder(null);
      toast.success(`חשבונית #${newInvoiceNumber} נוצרה בהצלחה`);
      console.log("[Orders→Invoice] calling navigate('/invoices')");
      navigate("/invoices");
    } catch (err) {
      toast.error("שגיאה ביצירת חשבונית: " + err.message);
    } finally {
      setCreatingInvoice(false);
    }
  };

  const handleWhatsApp = (order) => {
    const customer = customers.find(c => c.id === order.customer_id);
    const phone = customer?.mobile || customer?.phone || "";
    if (!phone.trim()) {
      toast.error("ללקוח אין מספר טלפון.");
      return;
    }
    const businessSettings = settings[0] || {};
    const businessName = businessSettings.business_name || "העסק שלי";
    const orderLink = `${window.location.origin}/order-pdf/${order.id}`;
    const msg = `שלום ${order.customer_name},\n\nמצורפת ההזמנה מספר ${order.order_number}.\n\nלצפייה והורדת ההזמנה:\n${orderLink}\n\nבברכה,\n${businessName}`;
    const cleaned = phone.replace(/\D/g, "");
    const intlPhone = cleaned.startsWith("0") ? "972" + cleaned.slice(1) : cleaned;
    window.open(`https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const handleBackToQuote = (order) => {
    if (order.quote_id) {
      window.location.href = `/quotes/edit?id=${order.quote_id}`;
    }
  };

  return (
    <div>
      <PageHeader title="הזמנות" description="ניהול הזמנות לקוחות">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 ml-1" /> הזמנה חדשה
        </Button>
      </PageHeader>

      {selected.size > 0 && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4 flex items-center justify-between">
          <span className="text-sm font-medium">נבחרו {selected.size} הזמנות</span>
          <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)} disabled={deleting}>
            <Trash2 className="w-4 h-4 ml-1" /> מחק נבחרים
          </Button>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="relative max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="חיפוש הזמנה..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="אין הזמנות" description="לא נמצאו הזמנות במערכת" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-12 text-right">
                  <Checkbox2
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead className="text-right">מס׳ הזמנה</TableHead>
                <TableHead className="text-right">לקוח</TableHead>
                <TableHead className="text-right">תאריך</TableHead>
                <TableHead className="text-right">סכום</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
                <TableHead className="text-right w-28">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((order) => (
                <TableRow key={order.id} className={`hover:bg-muted/30 ${selected.has(order.id) ? "bg-primary/5" : ""}`}>
                  <TableCell className="text-right">
                    <Checkbox2
                      checked={selected.has(order.id)}
                      onChange={() => toggleSelect(order.id)}
                    />
                  </TableCell>
                  <TableCell className="font-medium text-right">#{order.order_number || "---"}</TableCell>
                  <TableCell className="text-right">{order.customer_name}</TableCell>
                  <TableCell className="text-right">{formatDate(order.date)}</TableCell>
                  <TableCell className="text-right">₪{order.total?.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <Badge className={statusColors[order.status] || "bg-gray-100 text-gray-700"}>
                      {order.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9" onClick={() => setViewOrder(order)} title="צפיה">
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9" onClick={() => setEditOrder(order)} title="עריכה">
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9 text-destructive" onClick={() => setDeleteId(order.id)} title="מחיקה">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
           <AlertDialogContent dir="rtl">
             <AlertDialogHeader>
               <AlertDialogTitle>מחיקת הזמנות</AlertDialogTitle>
               <AlertDialogDescription>האם אתה בטוח שברצונך למחוק את {selected.size} ההזמנות שנבחרו?</AlertDialogDescription>
             </AlertDialogHeader>
             <AlertDialogFooter className="flex-row-reverse gap-2">
               <AlertDialogCancel disabled={deleting}>ביטול</AlertDialogCancel>
               <AlertDialogAction onClick={handleBulkDelete} disabled={deleting} className="bg-destructive text-destructive-foreground">
                 {deleting ? "מוחק..." : "מחק הזמנות"}
               </AlertDialogAction>
             </AlertDialogFooter>
           </AlertDialogContent>
         </AlertDialog>

        <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
           <AlertDialogContent dir="rtl">
             <AlertDialogHeader>
               <AlertDialogTitle>מחיקת הזמנה</AlertDialogTitle>
               <AlertDialogDescription>האם אתה בטוח שברצונך למחוק את ההזמנה?</AlertDialogDescription>
             </AlertDialogHeader>
             <AlertDialogFooter className="flex-row-reverse gap-2">
               <AlertDialogCancel>ביטול</AlertDialogCancel>
               <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">מחק הזמנה</AlertDialogAction>
             </AlertDialogFooter>
           </AlertDialogContent>
         </AlertDialog>

         {selected.size > 0 && (
           <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 flex items-center justify-between">
             <span className="text-sm font-medium">נבחרו {selected.size} הזמנות</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setBulkDeleteOpen(true)}
                  disabled={deleting}
                >
                  <Trash2 className="w-4 h-4 ml-1" /> מחק נבחרים
                </Button>
           </div>
         )}
        </div>

        <OrderViewModal
         open={!!viewOrder}
         onOpenChange={() => setViewOrder(null)}
         order={viewOrder}
         onEdit={() => { setViewOrder(null); setEditOrder(viewOrder); }}
         onDocument={() => handleGenerateDocument(viewOrder)}
         onBackToQuote={() => handleBackToQuote(viewOrder)}
         onCreateInvoice={() => handleCreateInvoice(viewOrder)}
         creatingInvoice={creatingInvoice}
         customers={customers}
         quotes={quotes}
         businessSettings={settings[0] || {}}
        />

        <OrderCreateModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={async (created) => {
            if (created.fulfilled && !created.inventory_deducted) {
              await deductInventory(created.items || []);
              await base44.entities.Order.update(created.id, { inventory_deducted: true });
              queryClient.setQueryData(["orders"], (old = []) =>
                old.map(o => o.id === created.id ? { ...o, inventory_deducted: true } : o)
              );
            }
          }}
        />

        <OrderEditModal
         open={!!editOrder}
         onOpenChange={() => setEditOrder(null)}
         order={editOrder}
         onSave={handleEditSave}
         isSaving={saving}
         products={products}
         categories={categories}
         invoices={invoices}
        />

        {/* Restore stock dialog — shown when cancelling a fulfilled order */}
        <AlertDialog open={!!restoreStockDialog} onOpenChange={(o) => { if (!o) setRestoreStockDialog(null); }}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>החזרת מלאי</AlertDialogTitle>
              <AlertDialogDescription>
                הזמנה זו סופקה ומלאי כבר נוכה. האם להחזיר את המלאי למערכת?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-row-reverse gap-2">
              <AlertDialogAction onClick={() => commitEditSave(restoreStockDialog.updates, restoreStockDialog.order, true)}>
                כן, החזר מלאי
              </AlertDialogAction>
              <AlertDialogCancel onClick={() => commitEditSave(restoreStockDialog.updates, restoreStockDialog.order, false)}>
                לא, בטל בלי להחזיר מלאי
              </AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        </div>
        );
        }