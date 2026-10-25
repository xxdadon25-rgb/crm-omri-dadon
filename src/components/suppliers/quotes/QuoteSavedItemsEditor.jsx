import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getQuoteForEditing, listQuoteItems, getProductsByIds, listCatalogForQuoteSuggestions, updateReviewedItem, saveProductPackage, approveMatch } from "@/api/supplierQuotes";
import QuoteProductPicker, { primaryImageUrl } from "@/components/suppliers/quotes/QuoteProductPicker";
import QuotePackagingEditor from "@/components/suppliers/quotes/QuotePackagingEditor";
import { priceBeforeVat } from "@/lib/quoteMath";

// Suggestions are NOT associations: only an explicit user click selects a product.
const FILLER = new Set(["יח", "יחידות", "יחידה", "יחיד", "בקרטון", "קרטון", "חבילה", "קג", "קילו", "מל", "סמק", "של", "עם", "מארז", "גדול"]);
const cleanWords = name => String(name || "").normalize("NFKC").toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .split(/\s+/).map(v => v.trim()).filter(v => v.length >= 2 && !FILLER.has(v));
function quoteCandidates(invoiceName, catalog) {
  const tokens = new Set(cleanWords(invoiceName));
  const invoiceNumbers = new Set([...tokens].filter(t => /^\d+$/.test(t)));
  const words = [...tokens].filter(t => !/^\d+$/.test(t));
  if (!words.length) return [];
  return catalog.map(product => {
    const pTokens = new Set(cleanWords(product.name));
    const pNumbers = [...pTokens].filter(t => /^\d+$/.test(t));
    // Never suggest a conflicting numerical size as if it were the same item.
    if (invoiceNumbers.size && pNumbers.length && !pNumbers.some(n => invoiceNumbers.has(n))) return null;
    const common = words.filter(t => pTokens.has(t));
    if (!common.length) return null;
    const score = common.length * 10 + (invoiceNumbers.size && pNumbers.some(n => invoiceNumbers.has(n)) ? 7 : 0)
      - Math.max(0, pTokens.size - common.length) * 0.3;
    return { product, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 3).map(x => x.product);
}

/**
 * Corrections belong ONLY to the independent quotation tables.
 * Quantity purchased is never assumed to be units per pack.
 */
export default function QuoteSavedItemsEditor({ quoteId, focusItemId = null, onClose, onSaved }) {
  const [quote, setQuote] = useState(null);
  const [items, setItems] = useState([]);
  const [matchedProducts, setMatchedProducts] = useState({});
  const [catalog, setCatalog] = useState([]);
  const [picker, setPicker] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    listCatalogForQuoteSuggestions().then(products => { if (active) setCatalog(products); }).catch(() => {});
    Promise.all([getQuoteForEditing(quoteId), listQuoteItems(quoteId)])
      .then(([q, rows]) => {
        if (!active) return;
        setQuote(q); setItems(rows);
        const ids = [...new Set(rows.map(row => row.product_id).filter(Boolean))];
        if (ids.length) {
          getProductsByIds(ids).then(products => {
            if (active) setMatchedProducts(Object.fromEntries(products.map(p => [p.id, p])));
          }).catch(() => { /* The saved link still exists if a product thumbnail cannot load. */ });
        }
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
  const hasUnappliedPackage = false;
  const save = async () => {
    if (hasUnappliedPackage) { toast.error("יש להחיל את הגדרות האריזה לפני שמירת החשבונית"); return; }
    setBusy(true);
    try {
      for (const item of items.filter(item => !focusItemId || item.id === focusItemId)) {
        const eligible = valid(item);
        const price = priceBeforeVat({
          unit_price: item.unit_price, vat_basis: quote.vat_basis, vat_rate: quote.vat_rate,
        });
        await updateReviewedItem(item.id, {
          product_id: item.product_id || null,
          supplier_sku: item.sku_unavailable ? null : (item.supplier_sku || null),
          sku_unavailable: item.sku_unavailable === true,
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
        if (eligible && item.pack_profile) {
          await saveProductPackage({
            productId: item.product_id,
            unitsPerPack: item.pack_profile.units_per_pack,
            packsPerCarton: item.pack_profile.packs_per_carton,
          });
        }
        if (eligible && (item.sku_unavailable || (item.supplier_sku && item.supplier_sku !== "0"))) {
          await approveMatch({ supplierId: quote.supplier_id,
            item: { ...item, supplier_sku: item.sku_unavailable ? null : item.supplier_sku, base_qty_per_pack: Number(item.base_qty_per_pack) },
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
      <h3 style={{ fontWeight: 700, fontSize: 21 }}>{focusItemId ? "עריכת מוצר" : "תיקון מוצרים ואריזות"} · מסמך {quote.document_number || ""}</h3>
      <p style={{ fontSize: 12, color: "#666" }}>
        ודא את מחיר הספק, כמות בחבילה וכמות חבילות בקרטון. השינויים נשמרים רק בהשוואת המחירים.
      </p>
      {items.map((item, idx) => (!focusItemId || item.id === focusItemId) && (
        <div key={item.id} className="heillo-card" style={{ padding: 18, display: "grid", gap: 12, fontSize: 15 }}>
          <strong>{idx + 1}. {item.supplier_name_raw}</strong>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ fontSize: 12 }}>מק״ט ספק (כפי שמופיע במסמך)
              <Input value={item.sku_unavailable ? "" : (item.supplier_sku ?? "")} disabled={item.sku_unavailable} style={{ width: 160 }}
                onChange={e => change(idx, { supplier_sku: e.target.value })} />
            </label>
            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
              <input type="checkbox" checked={item.sku_unavailable === true}
                onChange={e => change(idx, {
                  sku_unavailable: e.target.checked,
                  supplier_sku: e.target.checked ? null : (item.supplier_sku || ""),
                })} />
              לספק אין מק״ט
            </label>
            <span style={{ fontSize: 12 }}>כמות שנרכשה: {item.quantity ?? "—"}</span>
            {item.product_id && (
              <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 10px",
                borderRadius: 10, border: "1px solid rgba(4,120,87,0.22)", background: "#f0fdf4" }}>
                {primaryImageUrl(matchedProducts[item.product_id]) ? (
                  <img src={primaryImageUrl(matchedProducts[item.product_id])}
                    alt="" loading="lazy"
                    style={{ width: 42, height: 42, borderRadius: 7, objectFit: "cover" }}
                    onError={e => { e.currentTarget.style.display = "none"; }} />
                ) : null}
                <div style={{ display: "grid", gap: 2 }}>
                  <span style={{ fontSize: 11, color: "#047857" }}>מוצר משויך בקטלוג</span>
                  <strong style={{ fontSize: 14 }}>{matchedProducts[item.product_id]?.name || "המוצר המשויך נטען..."}</strong>
                </div>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => setPicker(idx)}>
              {item.product_id ? "שינוי שיוך" : "שיוך מוצר מהקטלוג"}
            </Button>
          </div>
          {!item.product_id && catalog.length > 0 && (() => {
            const suggestions = quoteCandidates(item.supplier_name_raw, catalog);
            if (!suggestions.length) return null;
            return <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#92400e" }}>מוצרים דומים — יש לבדוק לפני שיוך:</span>
              {suggestions.map(p => <button key={p.id} type="button" disabled={busy}
                onClick={() => { setMatchedProducts(prev => ({ ...prev, [p.id]: p })); change(idx, { product_id: p.id, sale_level: null }); }}
                title="בחירת מוצר לקטלוג — המחיר והאריזה עדיין דורשים אישור"
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 9px", border: "1px solid #e5e7eb",
                  borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>
                {primaryImageUrl(p) && <img src={primaryImageUrl(p)} alt="" style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 5 }} />}
                {p.name}
              </button>)}
            </div>;
          })()}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(135px,1fr))", gap: 8 }}>
            <label style={{ fontSize: 12 }}>מחיר לפי החשבונית
              <Input type="number" min="0" step="0.01" value={item.unit_price ?? ""}
                onChange={e => change(idx, { unit_price: e.target.value })} />
            </label>

          </div>
          <QuotePackagingEditor productId={item.product_id}
            saleLevel={item.sale_level}
            invoicedPrice={Number(item.price_before_vat ?? item.unit_price)}
            disabled={busy}
            onApply={patch => change(idx, patch)}
            />
          <small style={{ color: valid(item) ? "#047857" : "#a16207" }}>
            {valid(item) ? "מוכן להשוואת מחירים" : "לא ייכנס להשוואה עד שיושלמו שיוך, אריזה ומחיר"}
          </small>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <Button onClick={save} disabled={busy}>{busy ? "שומר..." : "שמור תיקונים"}</Button>
        <Button variant="outline" onClick={onClose} disabled={busy}>חזרה</Button>
      </div>
      <QuoteProductPicker open={picker !== null}
        selectedId={picker === null ? null : items[picker]?.product_id}
        line={picker === null ? null : items[picker]}
        onClose={() => setPicker(null)}
        onSelect={p => { if (picker !== null) {
          if (p?.id) setMatchedProducts(prev => ({ ...prev, [p.id]: p }));
          change(picker, { product_id: p?.id ?? null, sale_level: null });
        } }} />
    </div>
  );
}
