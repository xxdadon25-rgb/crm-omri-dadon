/**
 * The profitability figures a DOCUMENT shows: an order, an invoice, a quote.
 *
 * ============================================================================
 * THE TWO DEFECTS THIS REPLACES
 * ============================================================================
 * Every document-level popup computed the same two things, and both were
 * wrong:
 *
 *   1. COST WAS NOT NORMALISED.
 *      `Σ buy_price × quantity` assumes the purchase price is quoted per unit
 *      sold. Order #1197 sold 350 units of a product whose purchase price is
 *      ₪100 PER CARTON of 350, and the popup charged ₪100 for each of the 350
 *      units: ₪35,000 instead of ₪100, turning ₪85.99 of profit into a
 *      ₪34,814 loss.
 *
 *   2. THE MARGIN WAS OVER COST, NOT REVENUE.
 *      `profit / cost` is a markup, not a gross margin, and it was labelled
 *      "רווחיות %". For #1197 the correct figure is 85.99 / 185.99 = 46.23%;
 *      over cost it would read 85.99%.
 *
 * Both are fixed here, once, so the order popup, the invoice preview, the
 * invoices page and the quote editor cannot drift apart again.
 *
 * ============================================================================
 * WHAT IS SHOWN WHEN A LINE CANNOT BE COSTED
 * ============================================================================
 * Normalising needs the line's sale level and the product's purchase level.
 * Documents recorded before those existed have neither, and no amount of
 * arithmetic can recover them.
 *
 * Such a line is NOT costed as zero, which is what would quietly inflate a
 * margin. It is reported as pending, the percentage is withheld, and the
 * revenue of the whole document is still shown — what was charged is never
 * the uncertain part.
 */
import { lineProfit, toAgorot, toShekels } from "@/lib/packagingMath";
import { cartLineForProfit } from "@/lib/cartProfit";

/**
 * @param {Array} items  document lines (orders.items / invoice items)
 * @returns {{
 *   ok: boolean,
 *   totalSalesNet: number, totalCostNet: number, totalProfit: number,
 *   profitMargin: number|null,
 *   itemCount: number, avgProfitPerItem: number|null,
 *   pendingLines: number, reviewLines: number, costedLines: number,
 *   message: string|null
 * }}  amounts in SHEKELS, margin as a percentage
 */
export function documentProfit(items = []) {
  const lines = items || [];

  let costAgorot = 0;          // the cost of the lines that could be costed
  let costedRevenue = 0;       // what those same lines were charged
  let salesAgorot = 0;         // what the WHOLE document was charged
  let costedLines = 0, pendingLines = 0, reviewLines = 0;

  for (const line of lines) {
    // THE LINE'S REVENUE IS ITS STORED TOTAL, not unit_price x quantity.
    //
    // `total` is the amount of record: it already carries the line discount
    // and any price the operator edited, and on a document it is what the
    // customer was actually charged. Recomputing it from the unit price
    // reintroduces rounding the document has already settled — on order #1197
    // that alone moved the profit by ₪0.49, because ₪185.99 over 350 units is
    // not a whole number of agorot.
    const lineRevenue = toAgorot(line?.total) ?? 0;
    salesAgorot += lineRevenue;

    // The COST still comes from the packaging arithmetic, which is the part
    // that was wrong.
    const r = lineProfit(cartLineForProfit(line));
    if (r.ok) {
      costAgorot += r.cost;
      costedRevenue += lineRevenue;
      costedLines += 1;
    } else {
      pendingLines += 1;
      // A line whose stated level the price no longer supports is reported
      // separately: it is a REVIEW, not a gap. The owner answered; the answer
      // just has not been re-checked against the new price.
      if (r.pending === "level_uncertain") reviewLines += 1;
    }
  }

  const ok = pendingLines === 0 && costedLines > 0;
  const profitAgorot = costedRevenue - costAgorot;
  const itemCount = lines.reduce((s, i) => s + (Number(i?.quantity) || 0), 0);

  return {
    ok,
    totalSalesNet: toShekels(salesAgorot),
    // The cost of the lines that COULD be costed. The caller labels it as
    // partial when some could not.
    totalCostNet: toShekels(costAgorot),
    totalProfit: toShekels(profitAgorot),
    // A GROSS MARGIN: profit over revenue, and only when every line is costed.
    profitMargin: ok && costedRevenue > 0 ? (profitAgorot / costedRevenue) * 100 : null,
    itemCount,
    avgProfitPerItem: ok && itemCount > 0 ? toShekels(profitAgorot) / itemCount : null,
    pendingLines,
    reviewLines,
    costedLines,
    message: pendingLines > 0
      ? (reviewLines === pendingLines
          ? (reviewLines === 1
              ? "רווח ממתין לבדיקה — שורה אחת שינתה מחיר ורמת האריזה לא אומתה מחדש"
              : `רווח ממתין לבדיקה — ${reviewLines} שורות שינו מחיר ורמת האריזה לא אומתה מחדש`)
          : (pendingLines === 1
              ? "רווח ממתין להבהרה — שורה אחת חסרת נתוני אריזה"
              : `רווח ממתין להבהרה — ${pendingLines} שורות חסרות נתוני אריזה`
                + (reviewLines > 0 ? `, מתוכן ${reviewLines} לבדיקה` : "")))
      : (costedLines === 0 ? "רווח ממתין להבהרה" : null),
  };
}
