import { useState, useMemo } from "react";
import {
  Trash2, Minus, Plus, ShoppingCart, FileText, Package, Save,
  ClipboardList, ChevronDown, ChevronUp, MessageCircle, Loader2
} from "lucide-react";

const ACCENT = "#F5885E";
const DARK   = "#120F1C";
const MUTED  = "#B2B0B1";

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

  const labelStyle = { fontSize: 11, color: MUTED, fontWeight: 500, fontFamily: "'Heebo', sans-serif", flexShrink: 0 };
  const rowStyle  = { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: MUTED, fontFamily: "'Heebo', sans-serif" };
  const inputSmall = { height: 28, fontSize: 12, padding: "0 8px", background: "#FAFAFA", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 8, outline: "none", fontFamily: "'Heebo', sans-serif", color: DARK };
  const textareaStyle = { fontSize: 12, padding: "8px 10px", background: "#FAFAFA", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 10, resize: "none", outline: "none", width: "100%", fontFamily: "'Heebo', sans-serif", color: DARK };
  const actionBtn = (variant) => ({
    width: "100%", padding: "9px 0", borderRadius: 12, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", transition: "opacity 0.15s ease", fontFamily: "'Heebo', sans-serif", border: "none",
    ...(variant === "primary" ? { background: ACCENT, color: "#FFFFFF" } :
        variant === "green"   ? { background: "rgba(22,163,74,0.08)", color: "#16a34a", border: "1px solid rgba(22,163,74,0.2)" } :
        variant === "outline" ? { background: "#FFFFFF", color: DARK, border: "1px solid rgba(0,0,0,0.1)" } :
                                { background: "transparent", color: MUTED }),
  });

  return (
    /* OLD: <div className={`flex flex-col h-full ${embedded ? "" : "bg-card"}`}> */
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#FFFFFF", borderRight: "1px solid rgba(0,0,0,0.05)", fontFamily: "'Heebo', sans-serif" }}>
      {/* Header */}
      {/* OLD: <div className="px-4 py-3 border-b border-border flex items-center gap-2 shrink-0"> */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(0,0,0,0.05)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <ShoppingCart style={{ width: 16, height: 16, color: ACCENT }} />
        <span style={{ fontWeight: 700, fontSize: 14, color: DARK }}>סל הזמנה</span>
        {!isEmpty && (
          /* OLD: <span className="mr-auto text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium"> */
          <span className="heillo-badge" style={{ marginRight: "auto", background: "rgba(245,136,94,0.1)", color: ACCENT }}>
            {items.length} פריטים
          </span>
        )}
      </div>

      {/* Items list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {isEmpty ? (
          /* OLD: <div className="flex flex-col items-center justify-center h-full py-12 text-center px-4"> */
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: "48px 16px", textAlign: "center", gap: 8 }}>
            <Package style={{ width: 36, height: 36, color: MUTED, opacity: 0.3 }} />
            <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>הסל ריק</p>
            <p style={{ fontSize: 11, color: MUTED, margin: 0 }}>לחץ + על מוצר להוספה</p>
          </div>
        ) : (
          /* OLD: <div className="divide-y divide-border"> */
          <div>
            {items.map((item) => (
              <CartItem key={item.product_id} item={item} onUpdate={onUpdate} onRemove={onRemove} />
            ))}
          </div>
        )}
      </div>

      {/* Totals + Actions */}
      {!isEmpty && (
        /* OLD: <div className="border-t border-border bg-card shrink-0"> */
        <div style={{ borderTop: "1px solid rgba(0,0,0,0.05)", background: "#FFFFFF", flexShrink: 0 }}>
          {/* Discount + Notes toggle */}
          {/* OLD: <div className="px-4 py-3 space-y-2.5 border-b border-border"> */}
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10, borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {/* OLD: <Label className="text-xs shrink-0">הנחה כללית %</Label> */}
              <label style={labelStyle}>הנחה כללית %</label>
              {/* OLD: <Input type="number" ... className="h-7 text-sm w-20" /> */}
              <input
                type="number" min="0" max="100"
                value={discount}
                onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                style={{ ...inputSmall, width: 70 }}
              />
              {/* OLD: <button className="mr-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"> */}
              <button
                onClick={() => setShowNotes(!showNotes)}
                style={{ marginRight: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 11, color: MUTED, display: "flex", alignItems: "center", gap: 3, fontFamily: "'Heebo', sans-serif" }}
              >
                הערות {showNotes ? <ChevronUp style={{ width: 12, height: 12 }} /> : <ChevronDown style={{ width: 12, height: 12 }} />}
              </button>
            </div>

            {showNotes && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  {/* OLD: <Label className="text-xs mb-1 block">תוקף הצעה</Label> */}
                  <label style={{ ...labelStyle, display: "block", marginBottom: 4 }}>תוקף הצעה</label>
                  {/* OLD: <Input type="date" value={validUntil} onChange={...} className="h-7 text-sm" /> */}
                  <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} style={{ ...inputSmall, width: "100%" }} />
                </div>
                {/* OLD: <Textarea placeholder="הערות פנימיות..." className="text-xs resize-none" /> */}
                <textarea placeholder="הערות פנימיות (סוכן מכירות)..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={textareaStyle} />
                <textarea placeholder="הערות ללקוח (יופיעו בהצעה)..." value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} rows={2} style={textareaStyle} />
                <textarea placeholder="הוראות משלוח..." value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} rows={1} style={textareaStyle} />
              </div>
            )}
          </div>

          {/* Calculations */}
          {/* OLD: <div className="px-4 py-3 space-y-1.5 border-b border-border text-sm"> */}
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6, borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
            {isBusiness ? (
              <>
                {/* OLD: <div className="flex justify-between text-muted-foreground"> */}
                <div style={rowStyle}><span>סה״כ לפני מע״מ</span><span>₪{netSubtotal.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                {discount > 0 && (
                  <div style={rowStyle}><span>הנחה {discount}%</span><span style={{ color: "#ef4444" }}>-₪{discountAmount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                )}
                <div style={rowStyle}><span>מע״מ {vat}%</span><span>₪{vatAmount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                {/* OLD: <div className="flex justify-between font-bold text-base border-t border-border pt-1.5 mt-1"> */}
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 14, color: DARK, borderTop: "2px solid rgba(0,0,0,0.08)", paddingTop: 8, marginTop: 4 }}>
                  <span>סה״כ כולל מע״מ</span>
                  {/* OLD: <span className="text-primary"> */}
                  <span style={{ color: ACCENT }}>₪{total.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </>
            ) : (
              <>
                {discount > 0 && (
                  <div style={rowStyle}><span>הנחה {discount}%</span><span style={{ color: "#ef4444" }}>-₪{discountAmount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 14, color: DARK, borderTop: "2px solid rgba(0,0,0,0.08)", paddingTop: 8, marginTop: 4 }}>
                  <span>סה״כ לתשלום</span>
                  <span style={{ color: ACCENT }}>₪{total.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </>
            )}
          </div>

          {/* Action buttons */}
          {/* OLD: <div className="px-4 py-3 space-y-2"> */}
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            {/* OLD: <Button size="sm" className="w-full" ...>הפק הצעת מחיר</Button> */}
            <button className="heillo-btn-primary" style={{ width: "100%", justifyContent: "center", display: "flex", gap: 6 }} disabled={saving} onClick={() => onSaveQuote("טיוטה", cartData)}>
              {saving ? <Loader2 style={{ width: 14, height: 14, animation: "spin 0.8s linear infinite" }} /> : <FileText style={{ width: 14, height: 14 }} />}
              הפק הצעת מחיר
            </button>
            {onWhatsApp && (
              /* OLD: <Button size="sm" variant="outline" className="w-full border-green-200 text-green-700 hover:bg-green-50" ...> */
              <button style={actionBtn("green")} disabled={saving} onClick={() => onWhatsApp(cartData, total)}>
                {saving ? <Loader2 style={{ width: 14, height: 14 }} /> : <MessageCircle style={{ width: 14, height: 14 }} />}
                שלח ב-WhatsApp
              </button>
            )}
            {/* OLD: <Button size="sm" variant="outline" className="w-full" ...>צור הזמנה</Button> */}
            <button style={actionBtn("outline")} disabled={saving} onClick={() => onCreateOrder(cartData)}>
              {saving ? <Loader2 style={{ width: 14, height: 14 }} /> : <ClipboardList style={{ width: 14, height: 14 }} />}
              צור הזמנה
            </button>
            {/* OLD: <Button size="sm" variant="ghost" className="w-full text-muted-foreground" ...>שמור טיוטה</Button> */}
            <button style={actionBtn("ghost")} disabled={saving} onClick={() => onSaveQuote("טיוטה", cartData)}>
              {saving ? <Loader2 style={{ width: 14, height: 14 }} /> : <Save style={{ width: 14, height: 14 }} />}
              שמור טיוטה
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CartItem({ item, onUpdate, onRemove }) {
  const [imgError, setImgError] = useState(false);
  const [hovered, setHovered] = useState(false);

  const inputTiny = { height: 28, fontSize: 11, background: "#FAFAFA", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 6, outline: "none", fontFamily: "'Heebo', sans-serif", color: DARK, textAlign: "center" };

  return (
    /* OLD: <div className="px-4 py-3 flex gap-3"> */
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ padding: "12px 16px", display: "flex", gap: 12, borderBottom: "1px solid rgba(0,0,0,0.05)", background: hovered ? "rgba(245,136,94,0.04)" : "transparent", transition: "background 0.15s ease" }}
    >
      {/* Thumbnail */}
      {/* OLD: <div className="w-12 h-12 rounded-lg bg-muted shrink-0 overflow-hidden"> */}
      <div style={{ width: 44, height: 44, borderRadius: 10, background: "#F5F3F6", flexShrink: 0, overflow: "hidden" }}>
        {item.image_url && !imgError ? (
          <img src={item.image_url.split(",")[0].trim()} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => setImgError(true)} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Package style={{ width: 18, height: 18, color: MUTED, opacity: 0.4 }} />
          </div>
        )}
      </div>

      {/* Details */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            {/* OLD: <p className="text-sm font-medium leading-tight line-clamp-2"> */}
            <p style={{ fontSize: 13, fontWeight: 600, color: DARK, lineHeight: 1.3, margin: 0, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{item.name}</p>
            {/* OLD: {item.sku && <p className="text-xs text-muted-foreground">} */}
            {item.sku && <p style={{ fontSize: 11, color: MUTED, margin: "2px 0 0" }}>{item.sku}</p>}
          </div>
          {/* OLD: <button ... className="text-muted-foreground hover:text-destructive transition-colors shrink-0 mt-0.5"> */}
          <button
            onClick={() => onRemove(item.product_id)}
            style={{ background: "none", border: "none", cursor: "pointer", color: MUTED, flexShrink: 0, marginTop: 2, padding: 2, transition: "color 0.15s ease" }}
            onMouseEnter={e => { e.currentTarget.style.color = "#ef4444"; }}
            onMouseLeave={e => { e.currentTarget.style.color = MUTED; }}
          >
            <Trash2 style={{ width: 14, height: 14 }} />
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {/* Qty controls */}
          {/* OLD: <div className="flex items-center border border-border rounded-md overflow-hidden h-7"> */}
          <div style={{ display: "flex", alignItems: "center", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 8, overflow: "hidden", height: 28 }}>
            <button
              onClick={() => {
                if (item.quantity <= 1) { onRemove(item.product_id); return; }
                onUpdate(item.product_id, "quantity", item.quantity - 1);
              }}
              /* OLD: className="px-2 hover:bg-muted transition-colors h-full" */
              style={{ padding: "0 8px", background: "none", border: "none", cursor: "pointer", height: "100%", color: DARK, display: "flex", alignItems: "center" }}
            >
              <Minus style={{ width: 11, height: 11 }} />
            </button>
            <input
              type="number" min="0.001" step="1"
              value={item.quantity}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v > 0) onUpdate(item.product_id, "quantity", v);
              }}
              /* OLD: className="w-10 text-center text-xs border-x border-border h-full bg-transparent focus:outline-none" */
              style={{ width: 36, ...inputTiny, borderRadius: 0, borderTop: "none", borderBottom: "none", height: "100%" }}
            />
            <button
              onClick={() => onUpdate(item.product_id, "quantity", item.quantity + 1)}
              style={{ padding: "0 8px", background: "none", border: "none", cursor: "pointer", height: "100%", color: DARK, display: "flex", alignItems: "center" }}
            >
              <Plus style={{ width: 11, height: 11 }} />
            </button>
          </div>

          {/* Price */}
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: 11, color: MUTED }}>₪</span>
            {/* OLD: <input className="w-16 text-xs border border-border rounded px-1.5 h-7 bg-transparent focus:outline-none focus:border-primary" /> */}
            <input
              type="number"
              value={item.unit_price}
              onChange={(e) => onUpdate(item.product_id, "unit_price", parseFloat(e.target.value) || 0)}
              style={{ ...inputTiny, width: 60, padding: "0 6px" }}
            />
          </div>

          {/* Discount */}
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            {/* OLD: <input className="w-12 text-xs border border-border rounded px-1.5 h-7 bg-transparent focus:outline-none focus:border-primary text-center" /> */}
            <input
              type="number" min="0" max="100"
              value={item.discount}
              onChange={(e) => onUpdate(item.product_id, "discount", parseFloat(e.target.value) || 0)}
              style={{ ...inputTiny, width: 44, padding: "0 4px" }}
              placeholder="0"
            />
            <span style={{ fontSize: 11, color: MUTED }}>%</span>
          </div>
        </div>

        {/* Line total */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
          {/* OLD: <span className="text-sm font-semibold"> */}
          <span style={{ fontSize: 13, fontWeight: 700, color: ACCENT }}>
            ₪{(item.total || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>
    </div>
  );
}