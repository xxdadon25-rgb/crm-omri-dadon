/**
 * The one place that translates a CART LINE into the arguments packagingMath
 * expects.
 *
 * A cart line is the shape the sales catalogue builds and that is stored
 * verbatim in orders.items: product_id, quantity, unit_price, buy_price,
 * discount, and — new — sale_level and packaging. packagingMath knows nothing
 * about that shape on purpose, so this adapter is the only thing that has to
 * change if the line ever changes.
 *
 * `discount` on a cart line is a PERCENTAGE, which is why it is renamed on the
 * way through: `discountPercent` in the maths module leaves no room to wonder.
 *
 * LEGACY LINES
 *   Every order recorded before this feature has no sale_level and no
 *   packaging. They are passed through unchanged, which makes them pending
 *   rather than wrong — never guessed, never rewritten.
 */

/** @param {object} line a cart line / orders.items entry */
export function cartLineForProfit(line) {
  return {
    unitPrice: line?.unit_price,
    quantity: line?.quantity,
    discountPercent: line?.discount ?? 0,
    buyPrice: line?.buy_price,
    packaging: line?.packaging ?? null,
    saleLevel: line?.sale_level ?? null,
    // What the purchase price is quoted per. A product fact, read with the
    // packaging; never inferred from the sale level.
    buyLevel: line?.buy_level ?? null,
    // Set when a price edit left the line's stated level in doubt. The level
    // itself is preserved on the line; only the margin is withheld. Mapped
    // here so EVERY profit display — the cart panel and all four document
    // popups — honours it through the same adapter.
    levelUncertain: !!line?.sale_level_review,
  };
}

/** The same, for a whole cart. */
export function cartLinesForProfit(lines = []) {
  return (lines || []).map(cartLineForProfit);
}
