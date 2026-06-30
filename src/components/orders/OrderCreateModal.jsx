import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ItemsEditor from "@/components/documents/ItemsEditor";
import DocumentTotals from "@/components/documents/DocumentTotals";
import { toast } from "sonner";

export default function OrderCreateModal({ open, onOpenChange, onCreated }) {
  const queryClient = useQueryClient();

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => base44.entities.Customer.list("-created_date"),
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => base44.entities.Product.list(),
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => base44.entities.Category.list(),
  });
  const { data: settings = [] } = useQuery({
    queryKey: ["settings"],
    queryFn: () => base44.entities.BusinessSettings.list(),
  });
  const businessSettings = settings[0];

  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => base44.entities.Invoice.list(),
    staleTime: 60_000,
  });

  const emptyForm = () => ({
    customer_id: "",
    customer_name: "",
    customer_tax_id: "",
    date: new Date().toISOString().split("T")[0],
    delivery_date: "",
    delivery_address: "",
    items: [],
    notes: "",
    status: "ממתין לאישור",
    fulfilled: false,
    vat_rate: businessSettings?.vat_rate || 17,
  });

  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // Reset form each time the modal opens
  useEffect(() => {
    if (open) {
      setForm({
        ...emptyForm(),
        vat_rate: businessSettings?.vat_rate || 17,
      });
    }
  }, [open, businessSettings?.vat_rate]);

  const vatRate = form.vat_rate || 17;
  const subtotal = useMemo(() => form.items.reduce((s, i) => s + (i.total || 0), 0), [form.items]);
  const grossTotal = useMemo(() => form.items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0), [form.items]);
  const discountTotal = grossTotal - subtotal;
  const vatAmount = subtotal * (vatRate / 100);
  const total = subtotal + vatAmount;

  const handleCustomerChange = (id) => {
    const c = customers.find(x => x.id === id);
    if (c?.is_blocked) {
      const debt = invoices
        .filter(inv => inv.customer_id === id && inv.payment_status !== "שולם")
        .reduce((s, inv) => s + Math.max(0, (inv.total || 0) - (inv.paid_amount || 0)), 0);
      const debtStr = debt > 0 ? ` (חוב: ${debt.toLocaleString("he-IL", { minimumFractionDigits: 0 })}₪)` : "";
      toast.warning(`⚠️ לקוח זה מסומן כחסום${debtStr}`);
    }
    setForm(prev => ({
      ...prev,
      customer_id: id,
      customer_name: c?.name || "",
      customer_tax_id: c?.tax_id || "",
      delivery_address: c?.address || "",
    }));
  };

  const handleSave = async () => {
    if (!form.customer_id) { toast.error("יש לבחור לקוח"); return; }
    if (form.items.length === 0) { toast.error("יש להוסיף לפחות פריט אחד"); return; }

    setSaving(true);
    try {
      const counter = (businessSettings?.order_counter || 1000) + 1;
      const orderData = {
        order_number: counter,
        customer_id: form.customer_id,
        customer_name: form.customer_name,
        customer_tax_id: form.customer_tax_id || "",
        date: form.date,
        delivery_date: form.delivery_date || null,
        delivery_address: form.delivery_address || "",
        items: form.items,
        subtotal,
        gross_total: grossTotal,
        discount_amount: discountTotal,
        vat_rate: vatRate,
        vat_amount: vatAmount,
        total,
        notes: form.notes || "",
        status: form.status,
        fulfilled: !!form.fulfilled,
        inventory_deducted: false,
      };

      const created = await base44.entities.Order.create(orderData);

      if (businessSettings?.id) {
        await base44.entities.BusinessSettings.update(businessSettings.id, { order_counter: counter });
        queryClient.invalidateQueries({ queryKey: ["settings"] });
      }

      sessionStorage.setItem("pendingOrder", JSON.stringify(created));
      queryClient.setQueryData(["orders"], (old = []) => [created, ...(Array.isArray(old) ? old : [])]);

      toast.success(`הזמנה #${counter} נוצרה בהצלחה`);
      onOpenChange(false);
      if (onCreated) onCreated(created);
    } catch (err) {
      toast.error("שגיאה ביצירת הזמנה: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const STATUSES = ["טיוטה", "ממתין לאישור", "אושר", "בהכנה", "הושלם", "בוטל"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>הזמנה חדשה</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Header fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5 lg:col-span-2">
              <Label>לקוח *</Label>
              <Select value={form.customer_id} onValueChange={handleCustomerChange}>
                <SelectTrigger><SelectValue placeholder="בחר לקוח" /></SelectTrigger>
                <SelectContent>
                  {customers.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} {c.customer_type === "עסקי" ? "🏢" : "👤"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>סטטוס</Label>
              <Select value={form.status} onValueChange={(val) => setForm({ ...form, status: val })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>תאריך הזמנה</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>

            <div className="space-y-1.5">
              <Label>תאריך אספקה</Label>
              <Input type="date" value={form.delivery_date} onChange={(e) => setForm({ ...form, delivery_date: e.target.value })} />
            </div>

            <div className="space-y-1.5">
              <Label>מע״מ %</Label>
              <Input type="number" value={form.vat_rate} onChange={(e) => setForm({ ...form, vat_rate: parseFloat(e.target.value) || 0 })} />
            </div>

            <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
              <Label>כתובת משלוח</Label>
              <Input value={form.delivery_address} onChange={(e) => setForm({ ...form, delivery_address: e.target.value })} placeholder="כתובת משלוח..." />
            </div>
          </div>

          {/* Items */}
          <div className="border border-border rounded-lg p-4">
            <ItemsEditor
              items={form.items}
              setItems={(items) => setForm({ ...form, items })}
              defaultDiscount={customers.find(c => c.id === form.customer_id)?.discount_percent || 0}
              products={products}
              categories={categories}
              vatRate={vatRate}
            />
            <div className="mt-4">
              <DocumentTotals
                grossTotal={grossTotal}
                netSubtotal={subtotal}
                discountTotal={discountTotal}
                effectiveDiscountPercent={grossTotal > 0 ? (discountTotal / grossTotal) * 100 : 0}
                vatRate={vatRate}
                total={total}
              />
            </div>
          </div>

          {/* Fulfilled toggle */}
          <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
            <input
              type="checkbox"
              id="fulfilled"
              checked={!!form.fulfilled}
              onChange={e => setForm({ ...form, fulfilled: e.target.checked })}
              className="h-4 w-4 accent-green-600 cursor-pointer"
            />
            <label htmlFor="fulfilled" className="text-sm font-medium cursor-pointer select-none">
              ✅ סופק ללקוח
            </label>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>הערות</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              placeholder="הערות על ההזמנה..."
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1" disabled={saving}>
              ביטול
            </Button>
            <Button onClick={handleSave} disabled={saving} className="flex-1">
              {saving ? "שומר..." : "צור הזמנה"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}