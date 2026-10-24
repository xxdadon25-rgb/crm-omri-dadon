import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getQuoteForEditing, listQuoteItems, updateReviewedItem, approveMatch } from "@/api/supplierQuotes";
import QuoteProductPicker from "@/components/suppliers/quotes/QuoteProductPicker";
import QuotePackagingEditor from "@/components/suppliers/quotes/QuotePackagingEditor";
import { priceBeforeVat } from "@/lib/quoteMath";

/**
 * Corrections belong ONLY to the independent quotation tables.
 * Quantity purchased is never assumed to be units per pack.
 */
export default function QuoteSavedItemsEditor({ quoteId, onClose, onSaved }) {
  const [quote, setQuote] = useState(null);
  const [items, setItems] = useState([]);
  const [picker, setPicker] = useState(null);
  const [busy, setBusy] = useState(false);
  const [packageDirty, setPackageDirty] = useState({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    Promise.all([getQuoteForEditing(quoteId), listQuoteItems(quoteId)])
      .then(([q, rows]) => {
        if (!active) return;
        setQuote(q); setItems(rows);
      })
      .catch(err => { if (active) toast.error(err?.message || "טעינת השורות נכשלה"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [quoteId]);

  const change = (index, patch) => setItems(prev => prev.map((item, i) =>
    index === i ? { ...item, ...patch } : item));
  const valid = (i) => !!i.product_id && ["unit", "pack", "carton"].includes(i.sale_level) && !!i.base_unit &&
    Number(i.base_qty_per_pack) > 0 &&
    i.unit_price !== null && i.unit_price !== "" &&
    Number(i.unit_price) >= 0 && ["included", "excluded"].includes(quote?.vat_basis);
  const hasUnappliedPackage = Object.values(packageDirty).some(Boolean);
  const save = async () => {
    if (hasUnappliedPackage) { toast.error("יש להחיל את הגדרות האריזה לפני שמירת החשבונית"); return; }
    setBusy(true);
    try {
      for (const item of items) {
        const eligible = valid(item);
        const price = priceBeforeVat({
          unit_price: item.unit_price, vat_basis: quote.vat_basis, vat_rate: quote.vat_rate,
        });
        await updateReviewedItem(item.id, {
          product_id: item.product_id || null,
          supplier_sku: item.supplier_sku || null,
          supplier_name_raw: item.supplier_name_raw,
          unit: item.unit || null,
          pack_size: item.pack_size === "" ? null : item.pack_size,
          base_unit: item.base_unit || null,
          sale_level: item.sale_level || null,
          base_qty_per_pack: Number(item.base_qty_per_pack) > 0 ? Number(item.base_qty_per_pack) : null,
          unit_price: item.unit_price,
          price_before_vat: price,
          match_status: eligible ? "approved" : "pending",
        });
        if (eligible && item.supplier_sku) {
          await approveMatch({ supplierId: quote.supplier_id,
            item: { ...item, base_qty_per_pack: Number(item.base_qty_per_pack) },
            productId: item.product_id });
        }
      }
      toast.success("פרטי החשבונית עודכנו במערכת ההשוואה");
      onSaved?.();
    } catch (err) {
      toast.error((err?.message || "השמירה נכשלה") + " — ייתכן שחלק מהשורות כבר נשמרו; פתח שוב לבדיקה");
    } finally { setBusy(false); }
  };
  if (loading) return <p>טוען שורות חשבונית...</p>;
  if (!quote) return <Button onClick={onClose}>חזרה</Button>;
  return (
    <div dir="rtl" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ fontWeight: 700 }}>תיקון מוצרים ואריזות במסמך {quote.document_number || ""}</h3>
      <p style={{ fontSize: 12, color: "#666" }}>
        הכמות המוזמנת אינה מספר היחידות באריזה. המחיר להשוואה מחושב ממחיר שורה ליחידת מכירה,
        מחולק בכמות יחידות הבסיס באריזה. הנתונים מתעדכנים רק במערכת השוואת המחירים.
      </p>
      {items.map((item, idx) => (
        <div key={item.id} className="heillo-card" style={{ padding: 12, display: "grid", gap: 8 }}>
          <strong>{idx + 1}. {item.supplier_name_raw}</strong>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ fontSize: 12 }}>מק״ט ספק (כפי שמופיע במסמך)
              <Input value={item.supplier_sku ?? ""} style={{ width: 160 }}
                onChange={e => change(idx, { supplier_sku: e.target.value })} />
            </label>
            <span style={{ fontSize: 12 }}>כמות שנרכשה: {item.quantity ?? "—"}</span>
            <Button variant="outline" size="sm" onClick={() => setPicker(idx)}>
              {item.product_id ? "שינוי מוצר משויך" : "שיוך מוצר מהקטלוג"}
            </Button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(135px,1fr))", gap: 8 }}>
            <label style={{ fontSize: 12 }}>מחיר ליחידת מכירה לפני/כולל מע״מ לפי המסמך
              <Input type="number" min="0" step="0.01" value={item.unit_price ?? ""}
                onChange={e => change(idx, { unit_price: e.target.value })} />
            </label>
            <label style={{ fontSize: 12 }}>יחידת בסיס להשוואה
              <select className="heillo-input" value={item.base_unit || ""}
                onChange={e => change(idx, { base_unit: e.target.value })}>
                <option value="">— בחר —</option>
                <option value="unit">יחידה</option>
                <option value="kg">ק״ג</option>
                <option value="liter">ליטר</option>
                <option value="meter">מטר</option>
              </select>
            </label>
            <label style={{ fontSize: 12 }}>כמה יחידות בסיס יש באריזה אחת?
              <Input type="number" min="0.001" step="any"
                value={item.base_qty_per_pack ?? ""}
                onChange={e => change(idx, { base_qty_per_pack: e.target.value })} />
            </label>
          </div>
          <QuotePackagingEditor productId={item.product_id}
            saleLevel={item.sale_level}
            disabled={busy}
            onApply={patch => change(idx, patch)}
            onDirtyChange={dirty => setPackageDirty(prev => prev[idx] === dirty ? prev : { ...prev, [idx]: dirty })} />
          <small style={{ color: valid(item) ? "#047857" : "#a16207" }}>
            {valid(item) ? "מוכן להשוואת מחירים" : "לא ייכנס להשוואה עד שיושלמו שיוך, אריזה ומחיר"}
          </small>
        </div>
      ))}
      {hasUnappliedPackage && <p role="alert" style={{ fontSize: 12, color: "#b45309", fontWeight: 600 }}>יש שינויי אריזה שעדיין לא הוחלו. לחץ קודם ״שמור הגדרה והחל על השורה״.</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <Button onClick={save} disabled={busy || hasUnappliedPackage}>{busy ? "שומר..." : "שמור תיקונים"}</Button>
        <Button variant="outline" onClick={onClose} disabled={busy}>חזרה</Button>
      </div>
      <QuoteProductPicker open={picker !== null}
        selectedId={picker === null ? null : items[picker]?.product_id}
        line={picker === null ? null : items[picker]}
        onClose={() => setPicker(null)}
        onSelect={p => { if (picker !== null) change(picker, { product_id: p?.id ?? null, sale_level: null }); }} />
    </div>
  );
}
