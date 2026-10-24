import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { getProductPackage } from "@/api/supplierQuotes";
import { baseUnitsForSale } from "@/lib/quotePackaging";

/** All pricing choices are made in the product row. No separate apply step.
 * Only the final document save persists the packaging profile and quote rows. */
export default function QuotePackagingEditor({
  productId, saleLevel = "", invoicedPrice = null, onApply, disabled = false,
}) {
  const [unitEnabled, setUnitEnabled] = useState(true);
  const [packEnabled, setPackEnabled] = useState(false);
  const [cartonEnabled, setCartonEnabled] = useState(false);
  const [units, setUnits] = useState("");
  const [cartons, setCartons] = useState("");
  const [level, setLevel] = useState(saleLevel || "");
  const [loading, setLoading] = useState(false);

  const publish = (next) => {
    const u = next.packEnabled ? Number(next.units) : 1;
    const c = next.cartonEnabled ? Number(next.cartons) : null;
    const quantity = baseUnitsForSale({
      units_per_pack: next.packEnabled ? next.units : 1,
      packs_per_carton: next.cartons,
      sale_level: next.level,
    });
    onApply?.({
      sale_level: next.level || null,
      base_unit: quantity ? "unit" : null,
      base_qty_per_pack: quantity || null,
      pack_profile: {
        units_per_pack: next.packEnabled ? (u > 0 ? u : null) : null,
        packs_per_carton: next.cartonEnabled ? (c > 0 ? c : null) : null,
      },
    });
  };
  const edit = (patch) => {
    const next = { unitEnabled, packEnabled, cartonEnabled, units, cartons, level, ...patch };
    if (!next.packEnabled && next.level === "pack") next.level = next.unitEnabled ? "unit" : "";
    if (!next.cartonEnabled && next.level === "carton") next.level = next.packEnabled ? "pack" : "unit";
    setUnitEnabled(next.unitEnabled); setPackEnabled(next.packEnabled); setCartonEnabled(next.cartonEnabled);
    setUnits(next.units); setCartons(next.cartons); setLevel(next.level);
    publish(next);
  };

  useEffect(() => {
    let alive = true;
    setUnits(""); setCartons(""); setPackEnabled(false); setCartonEnabled(false);
    setLevel(saleLevel || "");
    if (!productId) return;
    setLoading(true);
    getProductPackage(productId).then(row => {
      if (!alive) return;
      const pack = row?.units_per_pack != null;
      const carton = row?.packs_per_carton != null;
      setPackEnabled(pack); setCartonEnabled(carton);
      setUnits(pack ? String(row.units_per_pack) : "");
      setCartons(carton ? String(row.packs_per_carton) : "");
      // Never overwrite an already approved invoice's sale level or quantities
      // merely because a profile was loaded. Profile is advisory until edited.
    }).catch(() => {}).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [productId]);

  const count = baseUnitsForSale({
    units_per_pack: packEnabled ? units : 1,
    packs_per_carton: cartons,
    sale_level: level,
  });
  const money = Number(invoicedPrice);
  const priceValid = invoicedPrice !== null && invoicedPrice !== "" && Number.isFinite(money) && money >= 0;
  const packPrice = priceValid && count && packEnabled && Number(units) > 0
    ? money * Number(units) / count : null;
  const canEdit = !!productId && !disabled && !loading;
  const chk = { width: 16, height: 16, accentColor: "#eab308" };

  return <div dir="rtl" style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 12, display: "grid", gap: 10, minWidth: 270 }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
      <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <input type="checkbox" style={chk} checked={unitEnabled} disabled={!canEdit}
          onChange={e => edit({ unitEnabled: e.target.checked })} />יחידה
      </label>
      <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <input type="checkbox" style={chk} checked={packEnabled} disabled={!canEdit}
          onChange={e => edit({ packEnabled: e.target.checked })} />חבילה
      </label>
      <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <input type="checkbox" style={chk} checked={cartonEnabled} disabled={!canEdit}
          onChange={e => edit({ cartonEnabled: e.target.checked })} />קרטון
      </label>
    </div>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {packEnabled && <label style={{ fontSize: 13, flex: "1 1 130px" }}>
        יחידות בחבילה
        <Input type="number" min="1" step="any" value={units} disabled={!canEdit}
          onChange={e => edit({ units: e.target.value })} placeholder="למשל 40" />
      </label>}
      {cartonEnabled && <label style={{ fontSize: 13, flex: "1 1 130px" }}>
        {packEnabled ? "חבילות בקרטון" : "יחידות בקרטון"}
        <Input type="number" min="1" step="any" value={cartons} disabled={!canEdit}
          onChange={e => edit({ cartons: e.target.value })} placeholder="למשל 50" />
      </label>}
      <label style={{ fontSize: 13, flex: "1 1 145px" }}>
        מחיר החשבונית הוא עבור
        <select className="heillo-input" style={{ width: "100%", minHeight: 36 }} value={level}
          disabled={!canEdit} onChange={e => edit({ level: e.target.value })}>
          <option value="">בחר</option>
          <option value="unit">יחידה</option>
          {packEnabled && <option value="pack">חבילה</option>}
          {cartonEnabled && <option value="carton">קרטון</option>}
        </select>
      </label>
    </div>
    {packPrice !== null
      ? <strong style={{ fontSize: 15, color: "#047857" }}>מחיר לחבילה: {new Intl.NumberFormat("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(packPrice)} ₪ לפני מע״מ</strong>
      : <span style={{ fontSize: 12, color: "#6b7280" }}>{!productId ? "בחר תחילה מוצר מהקטלוג" : "סמן את צורת האריזה והשלם את הכמויות"}</span>}
    <span style={{ fontSize: 11, color: "#6b7280" }}>הנתונים יישמרו בלחיצה על ״אישור ושמירה״ של החשבונית.</span>
  </div>;
}
