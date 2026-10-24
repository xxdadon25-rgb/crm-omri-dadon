import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  listSelectedPrices, listQuoteItemsNeedingReview, getProductsByIds,
  setSelectedPriceOverride, removeSelectedPriceOverride,
} from "@/api/supplierQuotes";

export default function SupplierPriceComparison({ suppliers = [], onEditQuote }) {
  const [prices, setPrices] = useState([]);
  const [excluded, setExcluded] = useState([]);
  const [products, setProducts] = useState({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [editing, setEditing] = useState(null);
  const [manualPrice, setManualPrice] = useState("");
  const [note, setNote] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [selected, pending] = await Promise.all([
        listSelectedPrices({}), listQuoteItemsNeedingReview(),
      ]);
      setPrices(selected);
      setExcluded(pending);
      const refs = await getProductsByIds(selected.map(p => p.product_id));
      setProducts(Object.fromEntries(refs.map(p => [p.id, p])));
    } catch (e) { toast.error(e?.message || "טעינת ההשוואה נכשלה"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const names = Object.fromEntries(suppliers.map(s => [s.id, s.name]));
  const fmt = value => value === null || value === undefined ? "—" : Number(value).toFixed(2);
  const saveOverride = async p => {
    if (!window.confirm("לשמור מחיר ידני לפני מע״מ עבור מוצר וספק אלה? המחיר ההיסטורי יישמר.")) return;
    setWorking(true);
    try {
      if (p.override_id) await removeSelectedPriceOverride(p.override_id);
      await setSelectedPriceOverride({ supplierId: p.supplier_id, productId: p.product_id,
        baseUnit: p.base_unit, price: manualPrice, note });
      toast.success("המחיר הידני נשמר");
      setEditing(null); setNote(""); await load();
    } catch (err) { toast.error(err?.message || "לא ניתן לשמור מחיר ידני"); }
    finally { setWorking(false); }
  };
  const remove = async p => {
    if (!window.confirm("לבטל את המחיר הידני ולחזור למחיר ההיסטורי?")) return;
    setWorking(true);
    try { await removeSelectedPriceOverride(p.override_id); await load(); }
    catch(e) { toast.error(e?.message || "הסרת המחיר נכשלה"); }
    finally { setWorking(false); }
  };
  if (loading) return <p style={{ fontSize: 16 }}>טוען מחירי השוואה...</p>;
  return <section dir="rtl" style={{ display: "grid", gap: 16, minWidth: 0, marginTop: 18 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <strong style={{ fontSize: 20 }}>מחירים זמינים להשוואה ({prices.length})</strong>
      <Button variant="outline" size="sm" onClick={load}>רענן נתונים</Button>
    </div>
    <p style={{ fontSize: 14, color: "#666", lineHeight: 1.6 }}>
      מחיר היסטורי נמוך אינו הבטחה למחיר עדכני. המחירים לפני מע״מ, ליחידת הבסיס שמוצגת.
      הכמות שנרכשה בחשבונית אינה משמשת כגודל האריזה.
    </p>
    {prices.length === 0 && <p style={{ fontSize: 12 }}>עדיין אין שורות שמוכנות להשוואה. השלם שיוך ואריזה בחשבונית השמורה.</p>}
    {prices.map(p => <div key={[p.supplier_id,p.product_id,p.base_unit].join(":")}
      className="heillo-card" style={{ padding: 18, display: "grid", gap: 9, fontSize: 15, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <strong style={{ fontSize: 18 }}>{products[p.product_id]?.name || "מוצר"}</strong>
          <span style={{ color: "#666" }}>{names[p.supplier_id] || "ספק"}</span>
        </div>
        <Button variant="outline" size="sm" disabled={!p.supplier_quote_id}
          onClick={() => onEditQuote?.(p.supplier_quote_id, p.supplier_quote_item_id)}>
          <Pencil size={16} style={{ marginInlineEnd: 5 }} /> עריכת מוצר
        </Button>
      </div>
      <span>מחיר נבחר: <b>{fmt(p.price_before_vat)} ₪ / {p.base_unit}</b>
        {p.price_source === "manual_override" ? " · מחיר ידני" : " · הנמוך ביותר בהיסטוריה"}</span>
      <span>מחיר חבילה במקור: {fmt(p.pack_price_before_vat)} ₪ · באריזה: {p.base_qty_per_pack ?? "—"} {p.base_unit}
        · מק״ט ספק: {p.supplier_sku || "דורש אימות"}</span>
      <span>מסמך: {p.document_number || "—"} · תאריך: {p.quote_date || "—"}
        {p.quote_expired ? " · הצעה שפג תוקפה" : ""}
        {p.price_age_days > 90 ? " · מחיר ישן — כדאי לאמת מול הספק" : ""}</span>
      {p.price_source === "manual_override" && <span>המחיר הנמוך שנמצא בחשבוניות: {fmt(p.historical_low_price)} ₪ / {p.base_unit}</span>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="outline" disabled={working}
          onClick={() => { setEditing(editing === p.product_id ? null : p.product_id); setManualPrice(String(p.price_before_vat ?? "")); setNote(""); }}>
          קביעת מחיר ידני
        </Button>
        {p.override_id && <Button size="sm" variant="outline" disabled={working} onClick={() => remove(p)}>בטל מחיר ידני</Button>}
      </div>
      {editing === p.product_id && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label>מחיר לפני מע״מ ל־{p.base_unit}
          <Input type="number" min="0" step="0.01" value={manualPrice} onChange={e => setManualPrice(e.target.value)} />
        </label>
        <label>הערה
          <Input value={note} onChange={e => setNote(e.target.value)} />
        </label>
        <Button size="sm" disabled={working || manualPrice === "" || !Number.isFinite(Number(manualPrice))}
          onClick={() => saveOverride(p)}>שמור מחיר</Button>
      </div>}
    </div>)}
    {excluded.length > 0 && <>
      <strong style={{ fontSize: 19 }}>מוצרים שדורשים תיקון ({excluded.length})</strong>
      {excluded.map(e => <div key={e.supplier_quote_item_id}
        className="heillo-card" style={{ padding: 15, fontSize: 15, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={{ flex: 1 }}>{names[e.supplier_id] || "ספק"} · {e.supplier_name_raw} · {e.review_reasons?.join(", ")}</span>
        <Button size="sm" variant="outline" onClick={() => onEditQuote?.(e.supplier_quote_id, e.supplier_quote_item_id)}>עריכת מוצר</Button>
      </div>)}
    </>}
  </section>;
}
