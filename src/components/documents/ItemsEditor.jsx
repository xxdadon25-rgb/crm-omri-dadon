import { useState, useCallback, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/utils/formatCurrency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ProductCatalogModal from "@/components/products/ProductCatalogModal";
import PackagingClarifyDialog from "@/components/sales/PackagingClarifyDialog";
import { resolveCostBasis } from "@/api/productPackaging";
import { clarificationFor, unitsPerLevel, SALE_LEVELS, LEVEL_LABEL } from "@/lib/packagingMath";

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
function LevelSelect({ value, packaging, onChange }) {
  const units = (lvl) => unitsPerLevel(packaging, lvl);
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={`text-[11px] rounded border px-1 py-0.5 bg-background ${
        value ? "border-border text-muted-foreground" : "border-amber-400 text-amber-700"}`}
      title="מה נמכר בשורה הזו — משפיע על חישוב העלות"
    >
      <option value="">רמת מכירה לא נקבעה</option>
      {SALE_LEVELS.map((lvl) => (
        <option key={lvl} value={lvl}>
          {LEVEL_LABEL[lvl]}{units(lvl) ? ` (${units(lvl)} יח׳)` : ""}
        </option>
      ))}
    </select>
  );
}

export default function ItemsEditor({ items, setItems, products, vatRate = 18, categories = [], defaultDiscount = 0, showPurchasePrice = false, lastPriceByProduct = null }) {
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

      patchLine(line.product_id, {
        packaging: packaging ?? null, buy_level: buyLevel ?? null,
      });

      const need = clarificationFor({
        unitPrice: line.unit_price, buyPrice: line.buy_price,
        packaging, saleLevel: line.sale_level ?? null, buyLevel,
      });
      if (!need.ask) continue;
      pending.push({
        productId: line.product_id, productName: line.name || line.description || "המוצר",
        packaging: packaging ?? {}, kind: need.kind,
        level: need.kind === "packaging" ? need.level : null,
        buyLevel: buyLevel ?? null, missing: need.missing,
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

  /** Move to the next queued question, if any. */
  const advance = () => {
    setClarify(queue[0] ?? null);
    setQueue(q => q.slice(1));
  };

  /**
   * Edit one field of one line.
   *
   * ============================================================================
   * EDITING THE QUANTITY OR THE PRICE INVALIDATES THE SALE LEVEL
   * ============================================================================
   * sale_level says what ONE unit of `quantity` is: a unit, a pack or a
   * carton. It is answered when the product is added, and it was then kept
   * through every later edit.
   *
   * Order #1197 shows why that is wrong. The line was 350 units at ₪0.53 and
   * was edited to 1 carton at ₪186 — the same goods, described differently.
   * Nothing about the line says a level changed, so sale_level stayed "unit",
   * and the popup costed ONE unit of a 350-unit carton: ₪0.29, a 99.8%
   * margin.
   *
   * There is no safe way to tell from the numbers whether the operator
   * rescaled the line or merely corrected a price, and guessing from quantity
   * or price is exactly what must not happen. So an edit to either CLEARS the
   * level: the line reads "ממתין להבהרה" until it is stated again, and the
   * selector on the row is right there to state it.
   *
   * The PRODUCT facts — packaging and the purchase level — are untouched:
   * nothing about an edited quantity changes how many units are in a carton.
   */
  const updateItem = (index, field, value) => {
    const updated = [...items];
    const before = updated[index];
    updated[index] = { ...before, [field]: value };

    const rescaled = (field === "quantity" || field === "unit_price")
      && String(before?.[field] ?? "") !== String(value ?? "");
    if (rescaled && before?.sale_level) {
      updated[index].sale_level = null;
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
          });
        }}
      />
    </div>
  );
}
