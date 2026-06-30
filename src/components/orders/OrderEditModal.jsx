import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle } from "lucide-react";
import ItemsEditor from "@/components/documents/ItemsEditor";
import DocumentTotals from "@/components/documents/DocumentTotals";

const STATUSES = ["טיוטה", "ממתין לאישור", "אושר", "בהכנה", "הושלם", "בוטל"];
const EDITABLE_STATUSES = ["טיוטה", "ממתין לאישור", "בהכנה"];

export default function OrderEditModal({ open, onOpenChange, order, onSave, isSaving, products = [], categories = [], invoices = [] }) {
  const [form, setForm] = useState({ status: "", notes: "", items: [], fulfilled: false });

  useEffect(() => {
    if (order) {
      setForm({
        status: order.status || "",
        notes: order.notes || "",
        items: order.items || [],
        fulfilled: !!order.fulfilled,
      });
    }
  }, [order]);

  const hasInvoice = useMemo(
    () => invoices.some(inv => inv.order_id === order?.id),
    [invoices, order]
  );

  const canEditItems = EDITABLE_STATUSES.includes(form.status) && !hasInvoice;

  const netSubtotal = useMemo(
    () => form.items.reduce((sum, item) => sum + (item.total || 0), 0),
    [form.items]
  );
  const grossTotal = useMemo(
    () => form.items.reduce((sum, item) => sum + (item.quantity || 0) * (item.unit_price || 0), 0),
    [form.items]
  );
  const discountTotal = grossTotal - netSubtotal;
  const effectiveDiscountPercent = grossTotal > 0 ? (discountTotal / grossTotal) * 100 : 0;

  const vatRate = order?.vat_rate || 17;
  const vatAmount = netSubtotal * (vatRate / 100);
  const grandTotal = netSubtotal + vatAmount;

  const handleSave = async () => {
    const updates = { status: form.status, notes: form.notes, items: form.items, fulfilled: form.fulfilled };
    if (canEditItems) {
      updates.subtotal = netSubtotal;
      updates.gross_total = grossTotal;
      updates.discount_amount = discountTotal;
      updates.vat_amount = vatAmount;
      updates.total = grandTotal;
      updates.vat_rate = vatRate;
    }
    await onSave(updates);
  };

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>עריכת הזמנה #{order.order_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Status */}
          <div className="space-y-2">
            <Label>סטטוס</Label>
            <Select value={form.status} onValueChange={(val) => setForm({ ...form, status: val })}>
              <SelectTrigger>
                <SelectValue placeholder="בחר סטטוס" />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Fulfilled — prominent selection */}
          <div className="rounded-lg border-2 border-border bg-muted/20 p-4">
            <p className="text-sm font-semibold mb-3">
              האם ההזמנה סופקה ללקוח?
              {order?.inventory_deducted && (
                <span className="text-xs text-muted-foreground font-normal mr-2">מלאי עודכן</span>
              )}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, fulfilled: true })}
                className={`flex-1 py-2 px-4 rounded-lg border-2 text-sm font-medium transition-all ${
                  form.fulfilled === true
                    ? "border-green-500 bg-green-100 text-green-800"
                    : "border-border bg-background text-foreground hover:border-green-400"
                }`}
              >
                ✅ כן, סופק
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, fulfilled: false })}
                className={`flex-1 py-2 px-4 rounded-lg border-2 text-sm font-medium transition-all ${
                  form.fulfilled === false
                    ? "border-orange-500 bg-orange-100 text-orange-800"
                    : "border-border bg-background text-foreground hover:border-orange-400"
                }`}
              >
                ⏳ לא, טרם סופק
              </button>
            </div>
          </div>

          {/* Invoice lock notice */}
          {hasInvoice && (
            <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>קיימת חשבונית עבור הזמנה זו — עריכת פריטים נעולה.</span>
            </div>
          )}

          {/* Items — editable or read-only */}
          {canEditItems ? (
            <div className="space-y-4">
              <ItemsEditor
                items={form.items}
                setItems={(items) => setForm({ ...form, items })}
                products={products}
                categories={categories}
                vatRate={vatRate}
              />
              <DocumentTotals
                grossTotal={grossTotal}
                netSubtotal={netSubtotal}
                discountTotal={discountTotal}
                effectiveDiscountPercent={effectiveDiscountPercent}
                vatRate={vatRate}
                total={grandTotal}
              />
            </div>
          ) : (
            form.items && form.items.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-3">פריטי הזמנה</h3>
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-right">שם מוצר</TableHead>
                        <TableHead className="text-center w-20">כמות</TableHead>
                        <TableHead className="text-center w-28">מחיר</TableHead>
                        <TableHead className="text-center w-28">סה״כ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {form.items.map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-right text-sm">{item.name}</TableCell>
                          <TableCell className="text-center text-sm">{item.quantity}</TableCell>
                          <TableCell className="text-center text-sm">₪{(item.unit_price || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-center text-sm font-medium">₪{(item.total || 0).toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label>הערות</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              placeholder="הערות על ההזמנה..."
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              ביטול
            </Button>
            <Button onClick={handleSave} disabled={isSaving} className="flex-1">
              {isSaving ? "שומר..." : "שמירה"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}