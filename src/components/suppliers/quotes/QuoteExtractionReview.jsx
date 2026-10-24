/**
 * Supplier quotation scanning — the review screen.
 *
 * NOTHING IS STORED BEFORE THIS SCREEN IS APPROVED. Extraction produces a
 * draft in memory; this is where a human corrects it and decides what becomes
 * a price. That ordering is the requirement, and it is also the only honest way
 * to use a language model on a financial document.
 *
 * WHAT IT REFUSES TO GUESS
 *   * VAT basis. When the document's own totals do not say whether the line
 *     prices include VAT, the user must answer before anything can be
 *     approved. Treating a gross price as net is an ~18% error that looks
 *     entirely plausible on screen, so it is a blocking question rather than a
 *     default.
 *   * Packaging. An unparsed pack size leaves the comparable price empty and
 *     the line unapprovable, because "10 a bottle" and "10 a six-pack" are not
 *     the same offer.
 *   * Product identity. A line is matched only by explicit choice, or by a
 *     remembered mapping whose SKU *and* packaging both agree. Identical names
 *     with different sizes are never treated as the same product.
 *
 * The original pages stay one click away throughout, because every figure here
 * is a claim about a document that must remain checkable.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, CheckCircle2, Image as ImageIcon, X, ImageOff, Link2 } from "lucide-react";
import { toast } from "sonner";
import {
  priceBeforeVat, parsePackaging, comparablePrice, reviewFlags,
  canAutoApplyMatch, documentCompleteness, round2, toNumber,
} from "@/lib/quoteMath";
import { createScannedQuote, saveReviewedItems, approveMatch, listMatchesForSupplier, getProductsByIds } from "@/api/supplierQuotes";
import QuoteProductPicker, { primaryImageUrl } from "@/components/suppliers/quotes/QuoteProductPicker";
import QuotePackagingEditor from "@/components/suppliers/quotes/QuotePackagingEditor";

const MUTED = "var(--heillo-text-muted)";
const DARK = "var(--heillo-text-primary)";

const REASON_LABEL = {
  match_not_approved: "לא שויך למוצר",
  no_canonical_product: "לא שויך למוצר",
  sku_missing: "חסר מק\"ט",
  packaging_unknown: "אריזה לא זוהתה",
  vat_basis_unknown: "לא ברור אם המחירים כוללים מע\"מ",
  low_confidence: "זיהוי לא ודאי",
  price_missing: "חסר מחיר",
};

export default function QuoteExtractionReview({ scan, suppliers = [], onCancel, onSaved }) {
  const { supplierId, files, draft } = scan;
  const supplierName = suppliers.find(s => s.id === supplierId)?.name || "";

  const [vatBasis, setVatBasis] = useState(draft.document.vat_basis);
  const [vatRate, setVatRate] = useState(draft.document.vat_rate ?? 18);
  const [items, setItems] = useState(draft.items);
  const [matches, setMatches] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showPages, setShowPages] = useState(false);
  // Which line's picker is open, and the chosen products we know about —
  // id -> { name, sku, unit, image_url } — so the table can show a name and a
  // thumbnail without holding the whole catalogue in memory.
  const [pickerIdx, setPickerIdx] = useState(null);
  const [packEditorIdx, setPackEditorIdx] = useState(null);
  const [productById, setProductById] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await listMatchesForSupplier(supplierId);
        if (cancelled) return;
        setMatches(m);
      } catch { /* matching is still possible by hand */ }
    })();
    return () => { cancelled = true; };
  }, [supplierId]);

  // Resolve the products referenced by auto-applied matches, so an
  // automatically matched line shows its name and image like a hand-picked one.
  useEffect(() => {
    const missing = items
      .map(i => i.product_id)
      .filter(id => id && !productById[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await getProductsByIds(missing);
        if (cancelled || rows.length === 0) return;
        setProductById(prev => {
          const next = { ...prev };
          for (const r of rows) next[r.id] = r;
          return next;
        });
      } catch { /* the id is still stored; only the label is missing */ }
    })();
    return () => { cancelled = true; };
  }, [items, productById]);

  // Auto-apply remembered mappings — only where the SKU AND the packaging both
  // agree, via canAutoApplyMatch. A name match is never enough.
  useEffect(() => {
    if (!matches.length) return;
    setItems(prev => prev.map(line => {
      if (line.product_id) return line;
      const candidate = matches.find(m =>
        (m.supplier_sku ?? "").trim() && (m.supplier_sku ?? "").trim() === (line.supplier_sku ?? "").trim());
      // If the document omitted the pack, reuse the exact SKU's previously
      // confirmed pack. Never use the PURCHASE quantity as pack size.
      const withPack = candidate && candidate.status === "approved" &&
        candidate.base_unit && Number(candidate.base_qty_per_pack) > 0 &&
        (!line.base_unit || !(Number(line.base_qty_per_pack) > 0))
          ? { ...line, base_unit: candidate.base_unit, base_qty_per_pack: candidate.base_qty_per_pack }
          : line;
      const verdict = canAutoApplyMatch({ line: withPack, match: candidate });
      if (!verdict.apply || !["unit", "pack", "carton"].includes(candidate?.sale_level)) return line;
      const next = { ...withPack, product_id: candidate.product_id,
        auto_matched: true, sale_level: candidate.sale_level, match_status: "approved" };
      next.comparable_price = comparablePrice(next);
      next.review_reasons = reviewFlags({ item: next, quote: { vat_basis: vatBasis } });
      return next;
    }));
  }, [matches, vatBasis]);

  // Recompute every derived figure whenever the VAT answer changes. The stored
  // unit price is untouched: only the DERIVED pre-VAT price moves.
  useEffect(() => {
    setItems(prev => prev.map(line => {
      const before = priceBeforeVat({ unit_price: line.unit_price, vat_basis: vatBasis, vat_rate: vatRate });
      const row = { ...line, price_before_vat: before };
      row.comparable_price = comparablePrice({ price_before_vat: before, base_qty_per_pack: row.base_qty_per_pack });
      row.review_reasons = reviewFlags({ item: row, quote: { vat_basis: vatBasis } });
      return row;
    }));
  }, [vatBasis, vatRate]);

  const updateLine = (idx, patch) => {
    setItems(prev => prev.map((line, i) => {
      if (i !== idx) return line;
      const next = { ...line, ...patch };
      // Re-parse packaging when the unit or pack size is corrected by hand.
      if ("unit" in patch || "pack_size" in patch) {
        const pack = parsePackaging({ unit: next.unit, pack_size: next.pack_size, text: next.supplier_name_raw });
        next.base_unit = pack.base_unit;
        next.base_qty_per_pack = pack.base_qty_per_pack;
        next.packaging_confident = pack.confident;
      }
      if ("base_unit" in patch || "base_qty_per_pack" in patch) {
        next.base_unit = patch.base_unit ?? next.base_unit;
        next.base_qty_per_pack = toNumber(patch.base_qty_per_pack) ?? next.base_qty_per_pack;
      }
      next.price_before_vat = priceBeforeVat({ unit_price: next.unit_price, vat_basis: vatBasis, vat_rate: vatRate });
      next.comparable_price = comparablePrice(next);
      // A match alone is NOT enough to compare a price. Require known package
      // units too; purchased quantity is never used as pack size.
      next.match_status = next.product_id && ["unit", "pack", "carton"].includes(next.sale_level) && next.base_unit &&
        Number(next.base_qty_per_pack) > 0 && next.price_before_vat !== null
          ? "approved" : "pending";
      next.review_reasons = reviewFlags({ item: next, quote: { vat_basis: vatBasis } });
      return next;
    }));
  };

  const lineSum = useMemo(
    () => round2(items.reduce((s, l) => s + (toNumber(l.line_total) ?? 0), 0)),
    [items]);

  const completeness = useMemo(() => documentCompleteness({
    line_total_sum: lineSum,
    amount_net: draft.document.amount_net,
    amount_gross: draft.document.amount_gross,
    vat_basis: vatBasis,
  }), [lineSum, draft.document.amount_net, draft.document.amount_gross, vatBasis]);

  const approvedCount = items.filter(i => i.match_status === "approved").length;
  const vatUnknown = vatBasis !== "excluded" && vatBasis !== "included";

  const handleSave = async () => {
    if (vatUnknown) { toast.error("בחר אם מחירי השורות כוללים מע\"מ"); return; }
    setSaving(true);
    try {
      // The document and its pages are stored first, so the lines always have
      // a document — and the preserved pages — to belong to.
      const quote = await createScannedQuote({
        supplierId, files, pages: scan.pages, contentHash: scan.contentHash,
        document: { ...draft.document, vat_basis: vatBasis, vat_rate: vatRate },
      });

      await saveReviewedItems({ quoteId: quote.id, items });

      // Remember each approved match so the same line is never reviewed twice.
      for (const line of items) {
        if (line.match_status === "approved" && line.product_id && !line.auto_matched) {
          await approveMatch({ supplierId, item: line, productId: line.product_id }).catch(() => {});
        }
      }

      toast.success(`נשמרו ${items.length} שורות · ${approvedCount} אושרו להשוואה`);
      onSaved?.(quote.id);
    } catch (err) {
      toast.error(err?.message || "השמירה נכשלה");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ── Document header ─────────────────────────────────────────────── */}
      <div className="heillo-card" style={{ padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: DARK }}>{supplierName}</p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: MUTED }}>
              מסמך {draft.document.document_number || "—"} · {draft.document.quote_date || "ללא תאריך"}
              {draft.document.valid_until ? ` · בתוקף עד ${draft.document.valid_until}` : ""}
              {" · "}{items.length} שורות · {files.length} עמודים
            </p>
            {draft.supplier_hint?.name && (
              <p style={{ margin: "2px 0 0", fontSize: 11, color: MUTED }}>
                זוהה במסמך: {draft.supplier_hint.name}
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowPages(v => !v)}>
            <ImageIcon style={{ width: 14, height: 14, marginInlineEnd: 4 }} />
            {showPages ? "הסתר מסמך" : "הצג מסמך"}
          </Button>
        </div>

        {/* The scanned pages, for checking any figure against the source. */}
        {showPages && (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", marginTop: 10, paddingBottom: 4 }}>
            {scan.pages.map((p, i) => (
              <img key={i} alt={`עמוד ${i + 1}`}
                src={`data:${p.mimeType};base64,${p.base64}`}
                style={{ height: 220, borderRadius: 8, border: "1px solid rgba(0,0,0,0.08)" }} />
            ))}
          </div>
        )}

        {/* VAT — a blocking question when the document does not say. */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
          <div>
            <Label style={{ fontSize: 12 }}>מחירי השורות</Label>
            <select value={vatBasis} onChange={(e) => setVatBasis(e.target.value)}
              className="heillo-input" style={{ marginTop: 4, minWidth: 190 }}>
              <option value="unknown">— לא נקבע —</option>
              <option value="excluded">לפני מע"מ</option>
              <option value="included">כולל מע"מ</option>
            </select>
          </div>
          <div>
            <Label style={{ fontSize: 12 }}>שיעור מע"מ %</Label>
            <Input type="number" step="0.1" min="0" value={vatRate ?? ""} style={{ width: 100, marginTop: 4 }}
              onChange={(e) => setVatRate(toNumber(e.target.value))} />
          </div>
          <div style={{ fontSize: 12, color: MUTED }}>
            סה"כ שורות: {lineSum?.toFixed(2)} ₪
            {draft.document.amount_net != null && ` · במסמך (לפני מע"מ): ${Number(draft.document.amount_net).toFixed(2)} ₪`}
            {draft.document.amount_gross != null && ` · כולל מע"מ: ${Number(draft.document.amount_gross).toFixed(2)} ₪`}
          </div>
        </div>

        {vatUnknown && (
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "#b45309", display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle style={{ width: 14, height: 14 }} />
            לא ניתן לקבוע מהמסמך אם המחירים כוללים מע"מ — יש לבחור כדי לאשר.
          </p>
        )}

        {/* The independent missing-line detector. */}
        {completeness.checked && !completeness.ok && (
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "#b91c1c", display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle style={{ width: 14, height: 14 }} />
            סכום השורות שונה מסה"כ המסמך ב-{Math.abs(completeness.gap).toFixed(2)} ₪
            ({(completeness.gap_ratio * 100).toFixed(1)}%) — ייתכן שחסרה שורה. בדוק מול המסמך.
          </p>
        )}
      </div>

      {/* ── Lines ───────────────────────────────────────────────────────── */}
      <div className="heillo-card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "'Heebo', sans-serif" }}>
          <thead className="heillo-table-header">
            <tr>
              {["#", "מק\"ט", "תיאור", "כמות", "יחידה", "באריזה", "יחידת השוואה", "כמות באריזה להשוואה", "מחיר", "לפני מע\"מ", "להשוואה", "מוצר", ""]
                .map((c, i) => <th key={i} style={{ padding: "10px 8px", textAlign: "right", whiteSpace: "nowrap" }}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {items.map((line, idx) => {
              const blocked = line.review_reasons?.length > 0;
              return (
                <tr key={idx} style={{ borderTop: "1px solid rgba(0,0,0,0.05)",
                  background: line.confidence === "low" ? "rgba(245,158,11,0.06)" : undefined }}>
                  <td style={{ padding: "6px 8px", color: MUTED }}>
                    {line.line_no}{line.page_no ? <span style={{ color: MUTED }}> · ע{line.page_no}</span> : null}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    {/* TEXT input, never a number field: leading zeros matter. */}
                    <Input value={line.supplier_sku ?? ""} style={{ width: 110, height: 30 }}
                      onChange={(e) => updateLine(idx, { supplier_sku: e.target.value })} />
                  </td>
                  <td style={{ padding: "6px 8px", minWidth: 220 }}>
                    <Input value={line.supplier_name_raw ?? ""} style={{ width: "100%", height: 30 }}
                      onChange={(e) => updateLine(idx, { supplier_name_raw: e.target.value })} />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Input type="number" step="0.001" value={line.quantity ?? ""} style={{ width: 80, height: 30 }}
                      onChange={(e) => updateLine(idx, { quantity: toNumber(e.target.value) })} />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Input value={line.unit ?? ""} style={{ width: 80, height: 30 }}
                      onChange={(e) => updateLine(idx, { unit: e.target.value })} />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Input type="number" step="0.001" value={line.pack_size ?? ""} style={{ width: 80, height: 30 }}
                      onChange={(e) => updateLine(idx, { pack_size: toNumber(e.target.value) })} />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <select className="heillo-input" style={{ minWidth: 100 }} value={line.base_unit || ""}
                      onChange={e => updateLine(idx, { base_unit: e.target.value || null })}>
                      <option value="">— בחר —</option>
                      <option value="unit">יחידה</option>
                      <option value="kg">ק״ג</option>
                      <option value="liter">ליטר</option>
                      <option value="meter">מטר</option>
                    </select>
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Input type="number" min="0.001" step="any" style={{ width: 100 }}
                      value={line.base_qty_per_pack ?? ""}
                      onChange={e => updateLine(idx, { base_qty_per_pack: e.target.value || null })} />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Input type="number" step="0.01" value={line.unit_price ?? ""} style={{ width: 90, height: 30 }}
                      onChange={(e) => updateLine(idx, { unit_price: toNumber(e.target.value) })} />
                    {line.price_adjusted && (
                      <div style={{ fontSize: 10, color: "#b45309" }}>חושב מהסה"כ</div>
                    )}
                    {line.discount_ok === false && (
                      <div style={{ fontSize: 10, color: "#b45309" }}>
                        הנחה לא מסתדרת (צפוי {line.discount_expected})
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "6px 8px", color: DARK }}>
                    {line.price_before_vat == null ? "—" : line.price_before_vat.toFixed(2)}
                  </td>
                  <td style={{ padding: "6px 8px", fontWeight: 600, color: DARK }}>
                    {line.comparable_price == null
                      ? "—"
                      : `${line.comparable_price.toFixed(2)} / ${line.base_unit}`}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    {/* The visual picker replaces a plain dropdown: a supplier
                        line is matched by recognising the product, which a name
                        in a <select> does not support. Opening it changes
                        nothing — only choosing a card does. */}
                    {(() => {
                      const chosen = line.product_id ? productById[line.product_id] : null;
                      const img = chosen ? primaryImageUrl(chosen) : null;
                      return (
                        <button
                          type="button"
                          onClick={() => setPickerIdx(idx)}
                          title={line.product_id ? "שינוי שיוך" : "שיוך מוצר"}
                          style={{
                            display: "flex", alignItems: "center", gap: 8, minWidth: 180, maxWidth: 230,
                            padding: "4px 8px", cursor: "pointer", textAlign: "right",
                            border: `1px solid ${line.product_id ? "rgba(4,120,87,0.35)" : "rgba(0,0,0,0.12)"}`,
                            borderRadius: 10, background: "#FFFFFF", fontFamily: "'Heebo', sans-serif",
                          }}
                        >
                          {line.product_id ? (
                            <>
                              {img ? (
                                <img src={img} alt="" loading="lazy"
                                  style={{ width: 26, height: 26, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
                              ) : (
                                <span style={{ width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                                  background: "rgba(0,0,0,0.05)", display: "inline-flex",
                                  alignItems: "center", justifyContent: "center" }}>
                                  <ImageOff style={{ width: 12, height: 12, color: MUTED }} />
                                </span>
                              )}
                              <span style={{ fontSize: 11, color: DARK, overflow: "hidden",
                                textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {chosen?.name || "מוצר משויך"}
                              </span>
                            </>
                          ) : (
                            <>
                              <Link2 style={{ width: 14, height: 14, color: MUTED, flexShrink: 0 }} />
                              <span style={{ fontSize: 11, color: MUTED }}>שיוך מוצר</span>
                            </>
                          )}
                        </button>
                      );
                    })()}
                    <Button variant="outline" size="sm" style={{ marginTop: 5 }}
                      onClick={() => setPackEditorIdx(packEditorIdx === idx ? null : idx)}>
                      {packEditorIdx === idx ? "סגור הגדרת אריזה" : "יחידות בחבילה / חבילות בקרטון"}
                    </Button>
                    {packEditorIdx === idx && (
                      <div style={{ minWidth: 320, marginTop: 7 }}>
                        <QuotePackagingEditor
                          productId={line.product_id}
                          saleLevel={line.sale_level}
                          disabled={saving}
                          onApply={patch => updateLine(idx, patch)}
                        />
                      </div>
                    )}
                    {line.auto_matched && (
                      <div style={{ fontSize: 10, color: "#047857" }}>שויך אוטומטית לפי מק"ט ואריזה</div>
                    )}
                  </td>
                  <td style={{ padding: "6px 8px", minWidth: 150 }}>
                    {blocked ? (
                      <span style={{ fontSize: 10, color: "#b45309", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <AlertTriangle style={{ width: 12, height: 12 }} />
                        {line.review_reasons.map(r => REASON_LABEL[r] || r).join(" · ")}
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, color: "#047857", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <CheckCircle2 style={{ width: 12, height: 12 }} /> מוכן להשוואה
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <p style={{ fontSize: 12, color: MUTED, margin: 0, maxWidth: 560, lineHeight: 1.6 }}>
          כל {items.length} השורות יישמרו, כולל שורות שלא שויכו — ההיסטוריה נשמרת במלואה.
          רק שורות שאושרו ({approvedCount}) ייכנסו להשוואת המחירים.
          מחירי הקנייה, המלאי והיסטוריית מחירי הספקים אינם מתעדכנים.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            <X style={{ width: 15, height: 15, marginInlineEnd: 4 }} /> ביטול
          </Button>
          <Button onClick={handleSave} disabled={saving || vatUnknown}>
            {saving ? "שומר..." : `אישור ושמירה (${approvedCount}/${items.length})`}
          </Button>
        </div>
      </div>

      {/* One picker instance, pointed at whichever line is being matched.
          `onSelect(null)` is the explicit "unmatch", which returns the line to
          pending — the same transition the dropdown's empty option made. */}
      <QuoteProductPicker
        open={pickerIdx !== null}
        line={pickerIdx !== null ? items[pickerIdx] : null}
        selectedId={pickerIdx !== null ? items[pickerIdx]?.product_id ?? null : null}
        onClose={() => setPickerIdx(null)}
        onSelect={(product) => {
          if (pickerIdx === null) return;
          if (product) {
            setProductById(prev => ({ ...prev, [product.id]: product }));
            const current = items[pickerIdx];
            // The invoice wins when its packaging is explicit. Otherwise try
            // the exact approved supplier SKU, then the CRM product's own text.
            const cached = matches.find(m =>
              m.product_id === product.id && m.status === "approved" &&
              !!current.supplier_sku && m.supplier_sku === current.supplier_sku &&
              m.base_unit && Number(m.base_qty_per_pack) > 0);
            const catalogPack = parsePackaging({ text: [product.unit, product.description].filter(Boolean).join(" ") });
            const inferred = cached
              ? { base_unit: cached.base_unit, base_qty_per_pack: cached.base_qty_per_pack }
              : catalogPack.confident ? catalogPack : null;
            const missingPack = !current.base_unit || !(Number(current.base_qty_per_pack) > 0);
            updateLine(pickerIdx, {
              product_id: product.id,
              sale_level: current.product_id === product.id ? current.sale_level : null,
              ...(missingPack && inferred ? {
                base_unit: inferred.base_unit, base_qty_per_pack: inferred.base_qty_per_pack,
              } : {}),
            });
          } else {
            updateLine(pickerIdx, { product_id: null, sale_level: null });
          }
        }}
      />
    </div>
  );
}