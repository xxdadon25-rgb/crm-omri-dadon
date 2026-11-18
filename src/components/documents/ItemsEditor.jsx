import { useState, useCallback, useRef, useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/utils/formatCurrency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ProductCatalogModal from "@/components/products/ProductCatalogModal";
import PackagingClarifyDialog from "@/components/sales/PackagingClarifyDialog";
import { resolveCostBasis } from "@/api/productPackaging";
import { clarificationFor, unitsPerLevel, SALE_LEVELS, LEVEL_LABEL } from "@/lib/packagingMath";
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

export default function ItemsEditor({ items, setItems, products, vatRate = 18, categories = [], defaultDiscount = 0, showPurchasePrice = false, lastPriceByProduct = null, salePatterns = null }) {
  const [catalogOpen, setCatalogOpen] = useState(false);
  // At most one outstanding packaging question, and a queue behind it so a
  // multi-product selection asks once per product rather than all at once.
  const [clarify, setClarify] = useState(null);
  const [queue, setQueue] = useState([]);

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
   * Attach what is known about a product's packaging to its line, and queue a
   * question when the line's profit cannot be computed without one.
   *
   * Runs AFTER the lines are added, so adding products is never blocked by a
   * question about profitability. A failed read asks nothing: a question
   * answered from a failed read would overwrite a real row.
   */
  const resolveFor = useCallback(async (added) => {
    const pending = [];
    for (const line of added) {
      if (!line?.product_id) continue;
      const { ok, packaging, buyLevel } = await resolveCostBasis(line.product_id);
      if (!ok) continue;

      // THE LEVEL IS REMEMBERED, NOT ASKED, WHEN THE PRICE SAYS WHICH IT IS.
      // Only when exactly one learned price matches; anything else leaves the
      // level unset and the question below is asked as it always was.
      let saleLevel = line.sale_level ?? null;
      let source = line.sale_level_source ?? null;
      if (!saleLevel) {
        const learned = levelForNewLine({
          unitPrice: line.unit_price,
          pattern: patternRef.current.get(line.product_id),
          // The product's packaging is the arbiter when its learned prices
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

      const need = clarificationFor({
        unitPrice: line.unit_price, buyPrice: line.buy_price,
        packaging, saleLevel, buyLevel,
      });
      if (!need.ask) continue;
      pending.push({
        productId: line.product_id, productName: line.name || line.description || "המוצר",
        packaging: packaging ?? {}, kind: need.kind,
        level: need.kind === "packaging" ? need.level : null,
        buyLevel: buyLevel ?? null, missing: need.missing,
        // What the unverified record says, to show beside the question. Not
        // pre-selected: see suggestLevel.
        suggestion: suggestLevel({
          unitPrice: line.unit_price,
          pattern: patternRef.current.get(line.product_id),
          packaging,
        }),
      });
    }
    if (pending.length === 0) return;
    setClarify(pending[0]);
    setQueue(pending.slice(1));
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
   * Put the level question for one line to the owner.
   *
   * Used when the line's price and the owner's own earlier answer contradict
   * each other. Nothing is pre-selected: the point is that neither side of the
   * contradiction may be assumed. Queued behind any question already open.
   */
  const askLevelFor = (line, reason) => {
    if (!line?.product_id) return;
    const req = {
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
      reason,
    };
    setClarify(cur => cur ?? req);
    setQueue(q => (clarify ? [...q, req] : q));
  };

  /** Move to the next queued question, if any. */
  const advance = () => {
    setClarify(queue[0] ?? null);
    setQueue(q => q.slice(1));
  };

  /**
   * Edit one field of one line.
   *
   * ============================================================================
   * A PRICE EDIT IS RE-READ AGAINST THE PRODUCT'S HISTORY
   * ============================================================================
   * sale_level says what ONE unit of `quantity` is: a unit, a pack or a
   * carton. It used to be kept through every later edit, which is how order
   * #1197 went wrong: the line was 350 units at ₪0.53, was edited to 1 carton
   * at ₪186 — the same goods, described differently — and kept sale_level
   * "unit", so the popup costed ONE unit of a 350-unit carton: ₪0.29, a 99.8%
   * margin.
   *
   * The level is now decided by `levelForPriceEdit`, from the product's own
   * confirmed history:
   *
   *   * ₪186 has meant "carton" for this product before, and nothing else has
   *     been near it, so the edit SETS carton. #1197 fixes itself.
   *   * a customer-specific ₪172 still matches carton and nothing else, so the
   *     level is KEPT. An ordinary price edit costs nothing.
   *   * a price that matches nothing learned but moved by a whole packaging
   *     factor is a rescale to an unknown level, so the level is CLEARED, the
   *     line reads "ממתין להבהרה", and the selector on the row states it.
   *
   * THE QUANTITY IS NOT PART OF THIS, and a quantity edit does not touch the
   * level at all: 1 -> 2 cartons is an ordinary edit, and no quantity has ever
   * implied a level. The PRODUCT facts — packaging and the purchase level — are
   * untouched by any edit here.
   */
  const updateItem = (index, field, value) => {
    const updated = [...items];
    const before = updated[index];
    updated[index] = { ...before, [field]: value };

    if (field === "unit_price" && String(before?.unit_price ?? "") !== String(value ?? "")) {
      const decided = levelForPriceEdit({
        currentLevel: before?.sale_level ?? null,
        currentSource: before?.sale_level_source ?? null,
        oldPrice: before?.unit_price, newPrice: value,
        pattern: patternFor(before?.product_id),
        packaging: before?.packaging,
      });
      if (decided.action === "set") {
        updated[index].sale_level = decided.level;
        updated[index].sale_level_source = "pattern";
      } else if (decided.action === "clear") {
        updated[index].sale_level = null;
        updated[index].sale_level_source = null;
      } else if (decided.action === "ask") {
        // The owner's own answer and the owner's own price now disagree. The
        // level is dropped so no wrong cost is shown in the meantime, and the
        // question is put to them once, naming the same product.
        updated[index].sale_level = null;
        updated[index].sale_level_source = null;
        askLevelFor(updated[index], decided.reason);
      }
    }
    // Choosing a level by hand is the owner answering, which is what teaches
    // the pattern — unlike a level this mechanism filled in.
    if (field === "sale_level") {
      updated[index].sale_level_source = value ? "confirmed" : null;
    }
    const qty = parseFloat(updated[index].quantity) || 0;
    const price = parseFloat(updated[index].unit_price) || 0;
    const disc = parseFloat(updated[index].discount) || 0;
    updated[index].total = qty * price * (1 - disc / 100);
    setItems(updated);
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
                      {item.product_id && (
                        <span className="block mt-1">
                          <LevelSelect
                            value={item.sale_level}
                            packaging={item.packaging}
                            source={item.sale_level_source}
                            pattern={patternFor(item.product_id)}
                            onChange={(v) => updateItem(i, "sale_level", v)}
                          />
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
                    {item.product_id && (
                      <span className="block mt-1">
                        <LevelSelect
                          value={item.sale_level}
                          packaging={item.packaging}
                          source={item.sale_level_source}
                          pattern={patternFor(item.product_id)}
                          onChange={(v) => updateItem(i, "sale_level", v)}
                        />
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
                      onChange={(e) => updateItem(i, "unit_price", parseFloat(e.target.value) || 0)} className="h-10" />
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
        onOpenChange={(v) => { if (!v) advance(); }}
        request={clarify}
        onResolved={(res) => {
          if (!res) return;
          patchLine(res.productId, {
            sale_level: res.saleLevel, buy_level: res.buyLevel,
            packaging: res.packaging,
            // An answer, so it teaches the pattern and is never overwritten by
            // one.
            sale_level_source: res.saleLevel ? "confirmed" : null,
          });
        }}
      />
    </div>
  );
}
