import { useState, useMemo } from "react";
import {
  Trash2, Minus, Plus, ShoppingCart, FileText, Package, Save,
  ClipboardList, ChevronDown, ChevronUp, MessageCircle, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function QuoteCart({
  items,
  customer,
  businessSettings,
  onUpdate,
  onRemove,
  onSaveQuote,
  onCreateOrder,
  onWhatsApp,
  saving = false,
  embedded = false,
}) {
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const vat = businessSettings?.vat_rate || 17;
  const isBusiness = customer?.customer_type === "עסקי";

  // All prices are NET (before VAT). VAT is added on top.
  const netSubtotal = useMemo(() => items.reduce((s, i) => s + (i.total || 0), 0), [items]);
  const discountAmount = netSubtotal * (discount / 100);
  const afterDiscount = netSubtotal - discountAmount;
  const vatAmount = afterDiscount * (vat / 100);
  const total = afterDiscount + vatAmount; // gross total = net + VAT

  const isEmpty = items.length === 0;

  const cartData = { discount, notes, customerNotes, deliveryNotes, validUntil, isBusiness };

  return (
    <div className={`flex flex-col h-full ${embedded ? "" : "bg-card"}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 shrink-0">
        <ShoppingCart className="w-4 h-4 text-primary" />
        <span className="font-semibold text-sm">סל הזמנה</span>
        {!isEmpty && (
          <span className="mr-auto text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
            {items.length} פריטים
          </span>
        )}
      </div>

      {/* Items list */}
      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center px-4">
            <Package className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">הסל ריק</p>
            <p className="text-xs text-muted-foreground mt-1">לחץ + על מוצר להוספה</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((item) => (
              <CartItem key={item.product_id} item={item} onUpdate={onUpdate} onRemove={onRemove} />
            ))}
          </div>
        )}
      </div>

      {/* Totals + Actions */}
      {!isEmpty && (
        <div className="border-t border-border bg-card shrink-0">
          {/* Discount + Notes toggle */}
          <div className="px-4 py-3 space-y-2.5 border-b border-border">
            <div className="flex items-center gap-3">
              <Label className="text-xs shrink-0">הנחה כללית %</Label>
              <Input
                type="number" min="0" max="100"
                value={discount}
                onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                className="h-7 text-sm w-20"
              />
              <button
                onClick={() => setShowNotes(!showNotes)}
                className="mr-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                הערות {showNotes ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>

            {showNotes && (
              <div className="space-y-2">
                <div>
                  <Label className="text-xs mb-1 block">תוקף הצעה</Label>
                  <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="h-7 text-sm" />
                </div>
                <Textarea
                  placeholder="הערות פנימיות (סוכן מכירות)..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="text-xs resize-none"
                />
                <Textarea
                  placeholder="הערות ללקוח (יופיעו בהצעה)..."
                  value={customerNotes}
                  onChange={(e) => setCustomerNotes(e.target.value)}
                  rows={2}
                  className="text-xs resize-none"
                />
                <Textarea
                  placeholder="הוראות משלוח..."
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  rows={1}
                  className="text-xs resize-none"
                />
              </div>
            )}
            </div>

            {/* Calculations */}
          <div className="px-4 py-3 space-y-1.5 border-b border-border text-sm">
            {isBusiness ? (
              <>
                <div className="flex justify-between text-muted-foreground">
                  <span>סה״כ לפני מע״מ</span>
                  <span>₪{netSubtotal.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>הנחה {discount}%</span>
                    <span className="text-red-500">-₪{discountAmount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>מע״מ {vat}%</span>
                  <span>₪{vatAmount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between font-bold text-base border-t border-border pt-1.5 mt-1">
                  <span>סה״כ כולל מע״מ</span>
                  <span className="text-primary">₪{total.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </>
            ) : (
              <>
                {discount > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>הנחה {discount}%</span>
                    <span className="text-red-500">-₪{discountAmount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base border-t border-border pt-1.5 mt-1">
                  <span>סה״כ לתשלום</span>
                  <span className="text-primary">₪{total.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </>
            )}
          </div>

          {/* Action buttons */}
          <div className="px-4 py-3 space-y-2">
            <Button size="sm" className="w-full" disabled={saving} onClick={() => onSaveQuote("טיוטה", cartData)}>
              {saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <FileText className="w-4 h-4 ml-1" />}
              הפק הצעת מחיר
            </Button>
            {onWhatsApp && (
              <Button size="sm" variant="outline" className="w-full border-green-200 text-green-700 hover:bg-green-50" disabled={saving} onClick={() => onWhatsApp(cartData, total)}>
                {saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <MessageCircle className="w-4 h-4 ml-1" />}
                שלח ב-WhatsApp
              </Button>
            )}
            <Button size="sm" variant="outline" className="w-full" disabled={saving} onClick={() => onCreateOrder(cartData)}>
              {saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <ClipboardList className="w-4 h-4 ml-1" />}
              צור הזמנה
            </Button>
            <Button size="sm" variant="ghost" className="w-full text-muted-foreground" disabled={saving} onClick={() => onSaveQuote("טיוטה", cartData)}>
              {saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Save className="w-4 h-4 ml-1" />}
              שמור טיוטה
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CartItem({ item, onUpdate, onRemove }) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="px-4 py-3 flex gap-3">
      {/* Thumbnail */}
      <div className="w-12 h-12 rounded-lg bg-muted shrink-0 overflow-hidden">
        {item.image_url && !imgError ? (
          <img src={item.image_url.split(",")[0].trim()} alt={item.name} className="w-full h-full object-cover" onError={() => setImgError(true)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-5 h-5 text-muted-foreground/40" />
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium leading-tight line-clamp-2">{item.name}</p>
            {item.sku && <p className="text-xs text-muted-foreground">{item.sku}</p>}
          </div>
          <button onClick={() => onRemove(item.product_id)} className="text-muted-foreground hover:text-destructive transition-colors shrink-0 mt-0.5">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {/* Qty */}
          <div className="flex items-center border border-border rounded-md overflow-hidden h-7">
            <button
              onClick={() => {
                if (item.quantity <= 1) { onRemove(item.product_id); return; }
                onUpdate(item.product_id, "quantity", item.quantity - 1);
              }}
              className="px-2 hover:bg-muted transition-colors h-full"
            >
              <Minus className="w-3 h-3" />
            </button>
            <input
              type="number"
              min="0.001"
              step="1"
              value={item.quantity}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v > 0) onUpdate(item.product_id, "quantity", v);
              }}
              className="w-10 text-center text-xs border-x border-border h-full bg-transparent focus:outline-none"
            />
            <button
              onClick={() => onUpdate(item.product_id, "quantity", item.quantity + 1)}
              className="px-2 hover:bg-muted transition-colors h-full"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          {/* Price */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">₪</span>
            <input
              type="number"
              value={item.unit_price}
              onChange={(e) => onUpdate(item.product_id, "unit_price", parseFloat(e.target.value) || 0)}
              className="w-16 text-xs border border-border rounded px-1.5 h-7 bg-transparent focus:outline-none focus:border-primary"
            />
          </div>

          {/* Discount */}
          <div className="flex items-center gap-1">
            <input
              type="number" min="0" max="100"
              value={item.discount}
              onChange={(e) => onUpdate(item.product_id, "discount", parseFloat(e.target.value) || 0)}
              className="w-12 text-xs border border-border rounded px-1.5 h-7 bg-transparent focus:outline-none focus:border-primary text-center"
              placeholder="0"
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </div>

        <div className="flex justify-end mt-1">
          <span className="text-sm font-semibold">
            ₪{(item.total || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>
    </div>
  );
}