import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getProductPackage, saveProductPackage } from "@/api/supplierQuotes";
import { baseUnitsForSale } from "@/lib/quotePackaging";

/**
 * Owner-controlled canonical product packaging, exclusively for quote comparison.
 * A separate sale level identifies what ONE invoiced price refers to.
 * No inference from invoice purchase quantity.
 */
export default function QuotePackagingEditor({ productId, saleLevel = "", invoicedPrice = null, onApply, onDirtyChange, disabled = false }) {
  const [units, setUnits] = useState("");
  const [cartons, setCartons] = useState("");
  const [level, setLevel] = useState(saleLevel || "");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => { setLevel(saleLevel || ""); setDirty(false); onDirtyChange?.(false); }, [saleLevel, productId]);
  useEffect(() => {
    let alive = true;
    setUnits(""); setCartons("");
    if (!productId) return;
    setLoading(true);
    getProductPackage(productId).then(row => {
      if (!alive) return;
      setUnits(row?.units_per_pack == null ? "" : String(row.units_per_pack));
      setCartons(row?.packs_per_carton == null ? "" : String(row.packs_per_carton));
    }).catch(err => { if (alive) toast.error(err?.message || "טעינת הגדרות האריזה נכשלה"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [productId]);

  const markEdited = () => { setDirty(true); onDirtyChange?.(true); };
  const normalized = baseUnitsForSale({
    units_per_pack: units, packs_per_carton: cartons, sale_level: level,
  });
  const apply = async () => {
    if (!productId || !level || !normalized) {
      toast.error("יש לבחור מוצר, צורת מכירה וכמות יחידות מתאימה");
      return;
    }
    setBusy(true);
    try {
      await saveProductPackage({ productId, unitsPerPack: units, packsPerCarton: cartons });
      onApply?.({ sale_level: level, base_unit: "unit", base_qty_per_pack: normalized });
      setDirty(false);
      onDirtyChange?.(false);
      toast.success("האריזה נשמרה למוצר והוחלה על השורה");
    } catch (err) { toast.error(err?.message || "שמירת האריזה נכשלה"); }
    finally { setBusy(false); }
  };
  return <div style={{ padding: 10, border: "1px solid rgba(0,0,0,.12)", borderRadius: 10, display: "grid", gap: 8 }}>
    <strong style={{ fontSize: 15 }}>פרטי החבילה והקרטון</strong>
    {!productId && <span style={{ fontSize: 12, color: "#a16207" }}>יש לשייך מוצר לפני הגדרת האריזה.</span>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
      <label style={{ fontSize: 12 }}>כמות בחבילה
        <Input type="number" min="0.001" step="any" value={units} disabled={!productId || loading || disabled}
          onChange={e => { setUnits(e.target.value); markEdited(); }} placeholder="לדוגמה: 10" />
      </label>
      <label style={{ fontSize: 12 }}>כמות חבילות בקרטון (לא חובה)
        <Input type="number" min="0.001" step="any" value={cartons} disabled={!productId || loading || disabled}
          onChange={e => { setCartons(e.target.value); markEdited(); }} placeholder="לדוגמה: 12" />
      </label>
      <label style={{ fontSize: 12 }}>המחיר בחשבונית הוא ל־
        <select className="heillo-input" style={{ width: "100%" }} value={level}
          disabled={!productId || loading || disabled} onChange={e => { setLevel(e.target.value); markEdited(); }}>
          <option value="">— בחר צורת מכירה —</option>
          <option value="unit">יחידה בודדת</option>
          <option value="pack">חבילה</option>
          <option value="carton">קרטון</option>
        </select>
      </label>
    </div>
    {dirty && <p role="alert" style={{ margin: 0, color: "#b45309", fontWeight: 600, fontSize: 12 }}>שינית פרטי אריזה — לחץ על ״אישור פרטי אריזה״ לפני שמירת החשבונית.</p>}
    <span style={{ fontSize: 14, fontWeight: 600 }}>
      {normalized && units && invoicedPrice !== null && invoicedPrice !== undefined && invoicedPrice !== ""
        ? "מחיר לחבילה לפי החשבונית: " + (Number(invoicedPrice) * Number(units) / normalized).toFixed(3).replace(/0+$/, "").replace(/\\.$/, "") + " ₪ לפני מע״מ"
        : "בחר מה הספק מחייב וכמה יש בחבילה"}
    </span>
    <Button size="sm" variant="outline" disabled={!productId || busy || loading || disabled || !normalized}
      onClick={apply}>{busy ? "שומר..." : "שמור הגדרה והחל על השורה"}</Button>
    <small style={{ color: "#666" }}>הפרטים נשמרים להשוואות הבאות בלבד. המלאי לא משתנה.</small>
  </div>;
}
