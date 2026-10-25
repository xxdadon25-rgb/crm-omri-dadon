import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getQuoteForEditing, listQuoteItems, getProductsByIds, listCatalogForQuoteSuggestions, listConfirmedQuoteProductNames, updateReviewedItem, saveProductPackage, approveMatch } from "@/api/supplierQuotes";
import QuoteProductPicker, { primaryImageUrl } from "@/components/suppliers/quotes/QuoteProductPicker";
import QuotePackagingEditor from "@/components/suppliers/quotes/QuotePackagingEditor";
import { priceBeforeVat } from "@/lib/quoteMath";

// Suggestions are NOT associations: only an explicit user click selects a product.
const FILLER = new Set(["יח", "יחידות", "יחידה", "יחיד", "בקרטון", "קרטון", "חבילה", "קג", "קילו", "מל", "סמק", "של", "עם", "מארז", "גדול"]);
const cleanWords = name => String(name || "").normalize("NFKC").toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .split(/\s+/).map(v => v.trim()).filter(v => v.length >= 2 && !FILLER.has(v));
// This matcher is intentionally stricter than the displayed suggestions.
// Only unique exact barcodes, confirmed cross-supplier identities, or a
// dominant semantic match with compatible numeric attributes may be linked.
function uniqueAutoMatch(item, catalog, confirmed = []) {
  const sku = String(item.supplier_sku || "").trim();
  if (sku && sku !== "0" && sku.length >= 8) {
    const byBarcode = catalog.filter(p => String(p.barcode || "").trim() === sku);
    if (byBarcode.length === 1) return byBarcode[0];
  }
  const key = cleanWords(item.supplier_name_raw).join(" ");
  const confirmedIds = new Set(confirmed.filter(x => cleanWords(x.supplier_name_raw).join(" ") === key).map(x => x.product_id));
  if (key && confirmedIds.size === 1) {
    const known = catalog.find(p => p.id === [...confirmedIds][0]);
    if (known) return known;
  }
  const exact = catalog.filter(p => cleanWords(p.name).join(" ") === key && key);
  if (exact.length === 1) return exact[0];
  const invoiceWords = new Set(cleanWords(item.supplier_name_raw));
  const invoiceNums = [...invoiceWords].filter(x => /^\d+$/.test(x));
  const invoiceText = [...invoiceWords].filter(x => !/^\d+$/.test(x));
  const candidates = catalog.map(product => {
    const prod = new Set(cleanWords(product.name));
    const nums = [...prod].filter(x => /^\d+$/.test(x));
    const prodText = [...prod].filter(x => !/^\d+$/.test(x));
    const common = invoiceText.filter(x => prod.has(x));
    if (common.length < 2 || invoiceText.length === 0 || prodText.length === 0) return null;
    if (invoiceNums.length && nums.length && !nums.some(x => invoiceNums.includes(x))) return null;
    const coverage = common.length / Math.min(invoiceText.length, prodText.length);
    const totalCoverage = common.length / Math.max(invoiceText.length, prodText.length);
    const score = coverage * .5 + totalCoverage * .5 + (nums.some(x => invoiceNums.includes(x)) ? .08 : 0);
    return {product, score};
  }).filter(Boolean).sort((a,b) => b.score-a.score);
  return candidates.length && candidates[0].score >= .92 &&
    (!candidates[1] || candidates[0].score-candidates[1].score >= .2)
      ? candidates[0].product : null;
}
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
  const [confirmed, setConfirmed] = useState([]);
  const [autoLinking, setAutoLinking] = useState(false);
  const [picker, setPicker] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    listCatalogForQuoteSuggestions().then(products => { if (active) setCatalog(products); }).catch(() => {});
    listConfirmedQuoteProductNames().then(rows => { if (active) setConfirmed(rows); }).catch(() => {});
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
  const autoCandidates = items.map((item, idx) => ({idx, product: !item.product_id ? uniqueAutoMatch(item, catalog, confirmed) : null}))
    .filter(x => x.product && (!focusItemId || items[x.idx].id === focusItemId));
  const autoLinkAll = async () => {
    if (!autoCandidates.length) return;
    setAutoLinking(true);
    try {
      // Link only: NEVER approve prices or copy packaging/charging units.
      for (const {idx, product} of autoCandidates) {
        await updateReviewedItem(items[idx].id, { product_id: product.id, match_status: "pending" });
      }
      setItems(prev => prev.map((item, idx) => {
        const found = autoCandidates.find(x => x.idx === idx);
        return found ? {...item, product_id: found.product.id, match_status: "pending", auto_linked: true} : item;
      }));
      setMatchedProducts(prev => ({...prev, ...Object.fromEntries(autoCandidates.map(x => [x.product.id,x.product]))}));
      toast.success(`שויכו אוטומטית ${autoCandidates.length} מוצרים. המחיר והאריזה עדיין דורשים אישור כשאינם ברורים.`);
    } catch(err) {
      toast.error((err?.message || "השמירה נכשלה") + " — ייתכן שחלק מהשיוכים נשמרו; פתח שוב לבדיקה");
    } finally { setAutoLinking(false); }
  };
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
      <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",padding:12,border:"1px solid #d1d5db",borderRadius:10}}>
        <strong>משויכים לקטלוג: {items.filter(x=>x.product_id).length} מתוך {items.length}</strong>
        <span style={{fontSize:12,color:"#666"}}>דורשים אישור מחיר/אריזה: {items.filter(x=>!valid(x)).length}</span>
        <Button onClick={autoLinkAll} disabled={busy || autoLinking || !autoCandidates.length}>
          {autoLinking ? "משייך..." : `שיוך אוטומטי של ${autoCandidates.length} מוצרים בטוחים`}
        </Button>
        <span style={{fontSize:11,color:"#666"}}>רק שיוך ודאי. שאר המוצרים לא ישויכו בניחוש.</span>
      </div>
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
