import { useState, useCallback, useRef, useMemo } from "react";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import { formatCurrency } from "@/utils/formatCurrency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ProductCatalogModal from "@/components/products/ProductCatalogModal";
import PackagingClarifyDialog from "@/components/sales/PackagingClarifyDialog";
import { resolveCostBasis } from "@/api/productPackaging";
import { unitsPerLevel, SALE_LEVELS, LEVEL_LABEL } from "@/lib/packagingMath";
import {
  learnFromLines, mergePatterns, emptyPattern,
  levelForNewLine, levelForPriceEdit, patternHint, suggestLevel,
} from "@/lib/saleLevelPattern";

/**
 * ItemsEditor — NET-FIRST pricing model.
 *
 * unit_price is stored BEFORE VAT (net).
 * line.total = qty × unit_price × (1 - discount/100)  ← net
 *
 * For business customers: show net subtotal + VAT breakdown in DocumentTotals.
 * For private customers: show only gross total in DocumentTotals.
 * The line items themselves are always net — the distinction is only in the summary.
 *
 * ============================================================================
 * PACKAGING CLARIFICATION LIVES HERE, NOT ONLY IN THE SALES CATALOGUE
 * ============================================================================
 * The clarification dialog was first wired into SalesCatalog, which is one way
 * to build an order. It is not the way most orders are built: OrderCreateModal,
 * OrderEditModal and QuoteEditor all add their lines through THIS editor, and
 * none of them went anywhere near that dialog. So adding a product to a new
 * order asked nothing, the line kept no sale level, and its margin stayed
 * pending for ever.
 *
 * Asking from here covers all three, and the workflow is unchanged: lines are
 * added exactly as before and the question follows, one product at a time.
 */
/**
 * What one unit of a line's quantity is.
 *
 * A plain select rather than anything cleverer: the level is a fact the
 * operator states, and an empty value is a real state — "not stated" — which
 * is why it is offered and shown rather than defaulted to "unit". Defaulting
 * is precisely how order #1197 came to cost one unit of a 350-unit carton.
 *
 * Levels whose packaging is unknown are still offered: choosing one makes the
 * line pending for that packaging, which the clarification dialog then asks
 * for, instead of hiding the option.
 */
function LevelSelect({ value, packaging, onChange, source, pattern }) {
  const units = (lvl) => unitsPerLevel(packaging, lvl);
  // A level filled in from the product's history is marked, and says what it
  // was learned from. Remembering is only acceptable while it stays visible and
  // one click away from being overridden.
  const learned = !!value && source === "pattern";
  const hint = learned ? patternHint(pattern, value) : null;
  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value || null)}
        className={`text-[11px] rounded border px-1 py-0.5 bg-background ${
          value ? "border-border text-muted-foreground" : "border-amber-400 text-amber-700"}`}
        title={hint || "מה נמכר בשורה הזו — משפיע על חישוב העלות"}
      >
        <option value="">רמת מכירה לא נקבעה</option>
        {SALE_LEVELS.map((lvl) => (
          <option key={lvl} value={lvl}>
            {LEVEL_LABEL[lvl]}{units(lvl) ? ` (${units(lvl)} יח׳)` : ""}
          </option>
        ))}
      </select>
      {learned && (
        <span className="text-[10px] text-muted-foreground" title={hint || undefined}>
          לפי היסטוריה
        </span>
      )}
    </span>
  );
}

/**
 * THE SMALL THING ON THE ROW THAT REPLACED TEN MODAL DIALOGS.
 *
 * Two states, both of which withhold the line's margin rather than guess it:
 *
 *   "דרוש בירור"  no level at all. Nothing was ever stated and no confirmed
 *                 price matches, so the cost cannot be normalised.
 *   "לבדיקה"      a level the owner stated, whose price has since changed in a
 *                 way the level does not support. The ANSWER IS STILL THERE —
 *                 only the margin is withheld — and one look settles it.
 *
 * Clicking it opens the clarification dialog for that line and only that line.
 * Ignoring it costs nothing: the order is entered, priced and saved exactly the
 * same either way.
 */
function ClarifyFlag({ item, onClarify }) {
  const needs = !item.sale_level;
  const review = !needs && !!item.sale_level_review;
  if (!needs && !review) return null;
  return (
    <button type="button" onClick={onClarify}
      title={needs
        ? "לא ידוע מה נמכר בשורה — הרווח לא מחושב. לחץ לבירור"
        : "המחיר שונה ורמת האריזה לא אומתה מחדש — הרווח לא מחושב. לחץ לבדיקה"}
      className={`inline-flex items-center gap-1 text-[10px] rounded-full border px-1.5 py-0.5
        ${review
          ? "border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100"
          : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"}`}>
      <AlertCircle className="w-3 h-3" />
      {needs ? "דרוש בירור" : "לבדיקה"}
    </button>
  );
}

export default function ItemsEditor({ items, setItems, products, vatRate = 18, categories = [], defaultDiscount = 0, showPurchasePrice = false, lastPriceByProduct = null, salePatterns = null }) {
  const [catalogOpen, setCatalogOpen] = useState(false);
  // The clarification dialog, open only when the operator asks for it from a
  // row. There is no queue: nothing opens it in batches any more.
  const [clarify, setClarify] = useState(null);

  // setItems is NOT a React state setter here. Every caller —
  // OrderCreateModal, OrderEditModal, QuoteEditor — passes a plain function
  // that takes the NEXT ARRAY and folds it into its own form state:
  //
  //   setItems={(items) => setForm({ ...form, items })}
  //
  // Handing it an updater function would store the FUNCTION as form.items,
  // and the next render dies on `form.items.reduce is not a function`. So the
  // current lines are read from a ref and a plain array is always passed.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  /**
   * WHAT THIS PRODUCT'S PRICES HAVE MEANT BEFORE.
   *
   * `salePatterns` is learned from SAVED documents by the page that has them
   * (Orders already holds the whole list for the last-price column, so this
   * costs no extra query). Lines confirmed in the document currently being
   * edited are folded in on top, newest evidence first, so the second line of
   * a product does not re-ask what the first one just answered.
   *
   * Only lines the OWNER confirmed teach anything — `learnFromLines` excludes
   * levels this mechanism filled in, which would otherwise reinforce
   * themselves into anchors.
   */
  const pattern = useMemo(
    () => mergePatterns(salePatterns ?? new Map(), learnFromLines(items)),
    [salePatterns, items],
  );
  const patternFor = (productId) => pattern.get(productId) ?? emptyPattern();
  // Read through a ref too: the resolve pass below runs before the parent has
  // re-rendered with the lines it just added.
  const patternRef = useRef(pattern);
  patternRef.current = pattern;

  const patchLine = useCallback((productId, patch) => {
    setItems(itemsRef.current.map(i => i.product_id === productId ? { ...i, ...patch } : i));
  // setItems comes from the parent and is not memoised there.
  }, []);

  /**
   * Attach what is known about a product's packaging to its line, and reuse a
   * level the product's confirmed history identifies beyond doubt.
   *
   * ============================================================================
   * THIS NEVER OPENS A DIALOG. THAT IS THE POINT.
   * ============================================================================
   * It used to queue a question per product that could not be costed, which on
   * a ten-product order meant ten modal dialogs before the operator could type
   * a single price. The information is worth having and the interruption is
   * not: nothing about entering an order needs to stop for it.
   *
   * So a line whose level cannot be established is simply MARKED. The row says
   * it needs clarification, the margin for it is withheld rather than guessed,
   * and the operator can answer from the row whenever they choose — including
   * never. Adding, pricing, re-quantifying and saving are all unaffected.
   *
   * A failed packaging read changes nothing: an answer saved from a failed read
   * would overwrite a real row.
   */
  const resolveFor = useCallback(async (added) => {
    for (const line of added) {
      if (!line?.product_id || line.price_basis === "catalog_same_sold_unit_v1") continue;
      const { ok, packaging, buyLevel } = await resolveCostBasis(line.product_id);
      if (!ok) continue;

      // THE LEVEL IS REMEMBERED, NOT ASKED, WHEN THE PRICE SAYS WHICH IT IS.
      // Only when exactly one confirmed price matches; anything else leaves the
      // level unset, which the row then shows.
      let saleLevel = line.sale_level ?? null;
      let source = line.sale_level_source ?? null;
      if (!saleLevel) {
        const learned = levelForNewLine({
          unitPrice: line.unit_price,
          pattern: patternRef.current.get(line.product_id),
          // The product's packaging is the arbiter when its confirmed prices
          // disagree, so it is passed in with them.
          packaging,
        });
        if (learned.level) { saleLevel = learned.level; source = "pattern"; }
      }

      patchLine(line.product_id, {
        packaging: packaging ?? null, buy_level: buyLevel ?? null,
        ...(saleLevel !== (line.sale_level ?? null)
          ? { sale_level: saleLevel, sale_level_source: source }
          : {}),
      });
    }
  }, [patchLine]);

  const addProductsFromCatalog = (selectedItems) => {
    const next = [...items, ...selectedItems];
    setItems(next);
    // The ref is updated here as well as on render, because resolveFor runs
    // before the parent has re-rendered with the new lines.
    itemsRef.current = next;
    resolveFor(selectedItems);
  };

  /**
   * Open the clarification dialog for ONE line, because the operator asked.
   *
   * Only ever called from the indicator on the row. Nothing in this component
   * calls it on its own — see `resolveFor`.
   */
  const clarifyLine = (line) => {
    if (!line?.product_id) return;
    if (clarify?.productId === line.product_id) return;      // already open
    setClarify({
      productId: line.product_id,
      productName: line.name || line.description || "המוצר",
      packaging: line.packaging ?? {},
      kind: "sale_level", level: null,
      buyLevel: line.buy_level ?? null, missing: [],
      suggestion: suggestLevel({
        unitPrice: line.unit_price,
        pattern: patternFor(line.product_id),
        packaging: line.packaging,
      }),
      reason: "requested",
    });
  };

  const closeClarify = () => setClarify(null);

  /**
   * Edit one field of one line.
   *
   * ============================================================================
   * TYPING IS NOT AN EDIT. THIS IS THE WHOLE FIX.
   * ============================================================================
   * `onChange` fires on every keystroke, so replacing ₪0.53 with ₪186 arrives
   * here three times — as 1, then 18, then 186. The level decision used to run
   * on each of them, which meant the intermediate values were judged as if they
   * were the operator's answer: ₪1 and ₪18 match nothing for a product whose
   * levels are ₪0.53 and ₪186, both look like a rescale, and each one asked a
   * question. The dialog reopened on every digit.
   *
   * So this function now only does what typing means: it stores the characters
   * and recomputes the line total. THE LEVEL IS LEFT EXACTLY AS IT IS — which
   * is also what makes a half-typed price harmless, since a level is never
   * judged against a number the operator has not finished.
   *
   * The decision happens once, in `commitPriceEdit`, when the field is left or
   * Enter is pressed. See the comment there for what it decides and why.
   *
   * THE QUANTITY IS NOT PART OF ANY OF THIS, on any event: 1 -> 2 cartons is an
   * ordinary edit, and no quantity has ever implied a level. The PRODUCT facts —
   * packaging and the purchase level — are untouched by every edit here.
   */
  const updateItem = (index, field, value) => {
    const updated = [...items];
    const before = updated[index];
    updated[index] = { ...before, [field]: value };

    // Choosing a level by hand is the owner answering, which is what teaches
    // the pattern — unlike a level this mechanism filled in.
    if (field === "sale_level") {
      updated[index].sale_level_source = value ? "confirmed" : null;
      // The operator just looked at it, so there is nothing left to review.
      updated[index].sale_level_review = false;
    }
    const qty = parseFloat(updated[index].quantity) || 0;
    const price = parseFloat(updated[index].unit_price) || 0;
    const disc = parseFloat(updated[index].discount) || 0;
    updated[index].total = qty * price * (1 - disc / 100);
    setItems(updated);
  };

  /**
   * The price a row held when the operator started typing in it.
   *
   * A ref, not state: it must not cause a render, and it must survive the
   * renders that every keystroke causes.
   */
  const priceEditRef = useRef(new Map());

  const beginPriceEdit = (index) => {
    if (priceEditRef.current.has(index)) return;        // already in this edit
    const line = itemsRef.current[index];
    priceEditRef.current.set(index, {
      price: line?.unit_price,
      level: line?.sale_level ?? null,
      source: line?.sale_level_source ?? null,
    });
  };

  /**
   * ============================================================================
   * THE LEVEL IS DECIDED ONCE, WHEN THE PRICE IS FINISHED
   * ============================================================================
   * Called on blur and on Enter. It compares the price the operator LEFT with
   * the one they STARTED from — never with the previous keystroke — so a
   * multi-digit entry is one edit with one decision:
   *
   *   * ₪186 has meant "carton" for this product before, and nothing else has
   *     been near it, so the edit SETS carton. Order #1197 fixes itself.
   *   * a customer-specific ₪172 still matches carton and nothing else, so the
   *     level is KEPT. An ordinary price edit costs nothing.
   *   * a price that matches nothing confirmed but moved by a whole packaging
   *     factor is a rescale to an unknown level, so the level is CLEARED, the
   *     line reads "ממתין להבהרה", and the selector on the row states it.
   *   * if the level being contradicted is one the OWNER stated, it is not
   *     replaced silently — the question is asked once instead.
   *
   * An edit that ends where it began decides nothing at all, so tabbing
   * through a price, or blurring twice, cannot ask anything.
   */
  const commitPriceEdit = (index) => {
    const started = priceEditRef.current.get(index);
    priceEditRef.current.delete(index);
    if (!started) return;

    const lines = itemsRef.current;
    const line = lines[index];
    if (!line) return;
    // The reviewed catalog uses one selling-price/cost basis per sold item.
    // Editing a customer-specific price never changes that basis.
    if (line.price_basis === "catalog_same_sold_unit_v1") return;
    // Nothing was actually changed: focus and blur, or typed and undone.
    if (String(started.price ?? "") === String(line.unit_price ?? "")) return;

    const decided = levelForPriceEdit({
      currentLevel: started.level,
      currentSource: started.source,
      oldPrice: started.price,
      newPrice: line.unit_price,
      pattern: patternFor(line.product_id),
      packaging: line.packaging,
    });
    const updated = [...lines];
    if (decided.action === "keep") {
      // The price now agrees with the level, so any earlier doubt is settled.
      if (!line.sale_level_review) return;
      if (decided.reason !== "confirmed_by_pattern") return;
      updated[index] = { ...line, sale_level_review: false };
    } else if (decided.action === "set") {
      updated[index] = {
        ...line, sale_level: decided.level,
        sale_level_source: "pattern", sale_level_review: false,
      };
    } else if (decided.action === "review") {
      // THE OWNER'S ANSWER IS KEPT. Only the margin is withheld, and the row
      // says so. Nothing is asked and nothing is blocked.
      updated[index] = { ...line, sale_level_review: true };
    } else {
      // "clear": the level was a default, and the price no longer supports it.
      updated[index] = {
        ...line, sale_level: null, sale_level_source: null, sale_level_review: false,
      };
    }
    itemsRef.current = updated;
    setItems(updated);
  };

  /** Finish the edit on Enter as well as on blur. */
  const priceKeyDown = (index) => (e) => {
    if (e.key === "Enter") commitPriceEdit(index);
  };

  const removeItem = (index) => setItems(items.filter((_, i) => i !== index));

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">פריטים</h3>
        <Button size="sm" variant="outline" onClick={() => setCatalogOpen(true)}>
          <Plus className="w-4 h-4 ml-1" /> הוסף מוצרים
        </Button>
      </div>

      <ProductCatalogModal
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        products={products}
        onAddProducts={addProductsFromCatalog}
        categories={categories}
        defaultDiscount={defaultDiscount}
      />

      {items.length > 0 ? (
        <div className="border border-border rounded-lg overflow-hidden">
          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-right px-3 py-2 font-medium">מוצר</th>
                  {showPurchasePrice && <th className="text-right px-3 py-2 font-medium w-32">מחיר קנייה לפני מע״מ</th>}
                  <th className="text-right px-3 py-2 font-medium w-20">כמות</th>
                  {lastPriceByProduct && <th className="text-right px-3 py-2 font-medium w-32">מחיר אחרון ללקוח</th>}
                  <th className="text-right px-3 py-2 font-medium w-32">{showPurchasePrice ? "מחיר מכירה לפני מע״מ" : "מחיר לפני מע״מ"}</th>
                  <th className="text-right px-3 py-2 font-medium w-20">הנחה %</th>
                  <th className="text-right px-3 py-2 font-medium w-28">סה״כ לפני מע״מ</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium">
                      {item.name}
                      {/* What ONE unit of the quantity is. Shown on the line
                          because it drives the cost, and because a line whose
                          level is unknown must say so rather than look
                          complete. */}
                      {item.product_id && item.price_basis !== "catalog_same_sold_unit_v1" && (
                        <span className="block mt-1">
                          <LevelSelect
                            value={item.sale_level}
                            packaging={item.packaging}
                            source={item.sale_level_source}
                            pattern={patternFor(item.product_id)}
                            onChange={(v) => updateItem(i, "sale_level", v)}
                          />
                          <ClarifyFlag item={item} onClarify={() => clarifyLine(item)} />
                        </span>
                      )}
                    </td>
                    {showPurchasePrice && (
                      <td className="px-3 py-2 text-muted-foreground">
                        {item.buy_price === 0 || item.buy_price ? formatCurrency(item.buy_price) : "—"}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <Input type="number" min="1" value={item.quantity}
                        onChange={(e) => updateItem(i, "quantity", parseFloat(e.target.value) || 0)}
                        className="h-8 w-20" />
                    </td>
                    {lastPriceByProduct && (
                      <td className="px-3 py-2 text-muted-foreground">
                        {(() => { const lp = lastPriceByProduct[item.product_id]; return lp === 0 || lp ? formatCurrency(lp) : "—"; })()}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <Input type="number" step="0.01" value={item.unit_price}
                        onChange={(e) => updateItem(i, "unit_price", parseFloat(e.target.value) || 0)}
                        onFocus={() => beginPriceEdit(i)}
                        onBlur={() => commitPriceEdit(i)}
                        onKeyDown={priceKeyDown(i)}
                        className="h-8 w-28" />
                    </td>
                    <td className="px-3 py-2">
                      <Input type="number" min="0" max="100" value={item.discount}
                        onChange={(e) => updateItem(i, "discount", parseFloat(e.target.value) || 0)}
                        className="h-8 w-20" />
                    </td>
                    {/* <td className="px-3 py-2 font-medium">₪{(item.total || 0).toFixed(2)}</td> */}
                    <td className="px-3 py-2 font-medium">{formatCurrency(item.total)}</td>
                    <td className="px-2 py-2">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeItem(i)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card layout */}
          <div className="lg:hidden divide-y divide-border">
            {items.map((item, i) => (
              <div key={i} className="p-3 bg-card">
                <div className="flex items-start justify-between mb-3">
                  <span className="font-medium text-sm">{item.name}</span>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive -mt-1" onClick={() => removeItem(i)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {showPurchasePrice && (
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">מחיר קנייה לפני מע״מ</label>
                      <div className="h-10 flex items-center px-3 bg-muted/30 rounded-md text-sm text-muted-foreground">
                        {item.buy_price === 0 || item.buy_price ? formatCurrency(item.buy_price) : "—"}
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">כמות</label>
                    <Input type="number" inputMode="numeric" min="1" value={item.quantity}
                      onChange={(e) => updateItem(i, "quantity", parseFloat(e.target.value) || 0)} className="h-10" />
                    {item.product_id && item.price_basis !== "catalog_same_sold_unit_v1" && (
                      <span className="block mt-1">
                        <LevelSelect
                          value={item.sale_level}
                          packaging={item.packaging}
                          source={item.sale_level_source}
                          pattern={patternFor(item.product_id)}
                          onChange={(v) => updateItem(i, "sale_level", v)}
                        />
                        <ClarifyFlag item={item} onClarify={() => clarifyLine(item)} />
                      </span>
                    )}
                  </div>
                  {lastPriceByProduct && (
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">מחיר אחרון ללקוח</label>
                      <div className="h-10 flex items-center px-3 bg-muted/30 rounded-md text-sm text-muted-foreground">
                        {(() => { const lp = lastPriceByProduct[item.product_id]; return lp === 0 || lp ? formatCurrency(lp) : "—"; })()}
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">{showPurchasePrice ? "מחיר מכירה לפני מע״מ" : "מחיר לפני מע״מ"}</label>
                    <Input type="number" inputMode="decimal" step="0.01" value={item.unit_price}
                      onChange={(e) => updateItem(i, "unit_price", parseFloat(e.target.value) || 0)}
                      onFocus={() => beginPriceEdit(i)}
                      onBlur={() => commitPriceEdit(i)}
                      onKeyDown={priceKeyDown(i)}
                      className="h-10" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">הנחה %</label>
                    <Input type="number" inputMode="numeric" min="0" max="100" value={item.discount}
                      onChange={(e) => updateItem(i, "discount", parseFloat(e.target.value) || 0)} className="h-10" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">סה״כ לפני מע״מ</label>
                    {/* <div className="h-10 flex items-center px-3 bg-muted/30 rounded-md text-sm font-semibold">₪{(item.total || 0).toFixed(2)}</div> */}
                    <div className="h-10 flex items-center px-3 bg-muted/30 rounded-md text-sm font-semibold">{formatCurrency(item.total)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="border border-dashed border-border rounded-lg py-8 text-center text-sm text-muted-foreground">
          אין פריטים. לחץ "הוסף מוצרים" להתחיל
        </div>
      )}
      {/* One question at a time. A packaging answer is saved permanently
          inside the dialog; the sale level comes back here and is written to
          this line only. Skipping leaves the line pending — never guessed. */}
      <PackagingClarifyDialog
        open={!!clarify}
        onOpenChange={(v) => { if (!v) closeClarify(); }}
        request={clarify}
        onResolved={(res) => {
          if (!res) return;
          patchLine(res.productId, {
            sale_level: res.saleLevel, buy_level: res.buyLevel,
            packaging: res.packaging,
            // An answer, so it teaches the pattern and is never overwritten by
            // one.
            sale_level_source: res.saleLevel ? "confirmed" : null,
            sale_level_review: false,
          });
        }}
      />
    </div>
  );
}
