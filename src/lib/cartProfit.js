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

/**
 * Temporary reconciled price bases for three catalogue entries whose stored
 * legacy packaging labels contradict the actual sold unit.
 *
 * These are NOT generic margin/price guesses. Each rule applies only to an
 * exact product + recorded purchase price + observed selling price combination.
 * - Jumbo hand towel, 6-roll carton: ₪60 cost / sold carton (orders 1194, 1203).
 * - Nitrile gloves L/M: owner confirmed ₪98 per carton of TEN sold packs.
 *   Only the ₪14-per-pack sales are covered; e.g. a ₪135-per-carton sale must
 *   continue to use its own ₪98 carton cost.
 *
 * Remove these narrow reconciliations when the product catalogue has a single
 * verified purchase price per sold unit. No orders or catalogue prices are edited.
 */
function verifiedCostPerSoldItem(line) {
  const productId = line?.product_id;
  const cost = Number(line?.buy_price);
  const sell = Number(line?.unit_price);
  if (!Number.isFinite(cost) || !Number.isFinite(sell)) return null;

  if (productId === "112c32af-ce11-4033-a780-260b99660e25"
      && cost === 60 && (sell === 85 || sell === 65)) {
    return 60; // One sold item = one 6-roll carton.
  }

  if ((productId === "0daf0ef8-bbe0-4115-9989-76af2a7adb2d"
      || productId === "efeea7a8-86ca-40b9-9f7c-953378a33166")
      && cost === 98 && sell === 14) {
    return 9.8; // ₪98 / 10 packs in the purchased carton.
  }
  return null;
}

/** @param {object} line a cart line / orders.items entry */
export function cartLineForProfit(line) {
  const verifiedUnitCost = verifiedCostPerSoldItem(line);
  if (verifiedUnitCost !== null) {
    return {
      unitPrice: line?.unit_price,
      quantity: line?.quantity,
      discountPercent: line?.discount ?? 0,
      buyPrice: verifiedUnitCost,
      packaging: null,
      saleLevel: "unit",
      buyLevel: "unit",
      levelUncertain: false,
    };
  }

  return {
    unitPrice: line?.unit_price,
    quantity: line?.quantity,
    discountPercent: line?.discount ?? 0,
    buyPrice: line?.buy_price,
    packaging: line?.packaging ?? null,
    // Default business rule: when no separate purchase/sale basis was
    // recorded, both saved prices refer to the same sold line unit.
    // Explicitly recorded differing levels remain authoritative and are
    // still converted rather than silently treating a carton as one pack.
    saleLevel: line?.sale_level ?? line?.buy_level ?? "unit",
    buyLevel: line?.buy_level ?? line?.sale_level ?? "unit",
    // Set when a price edit left the line's stated level in doubt. The level
    // itself is preserved on the line; only the margin is withheld. Mapped
    // here so EVERY profit display — the cart panel and all four document
    // popups — honours it through the same adapter.
    // Never trust an old unit/carton conversion that was not confirmed for
    // this specific order line. A mismatched stored label can make a ₪60
    // carton look like ₪0.06 per sold item and report a fictitious margin.
    // Matching price units still use buy_price × quantity automatically.
    levelUncertain: !!line?.sale_level_review || (
      !!line?.sale_level &&
      !!line?.buy_level &&
      line.sale_level !== line.buy_level &&
      line.sale_level_source !== "confirmed"
    ),
  };
}

/** The same, for a whole cart. */
export function cartLinesForProfit(lines = []) {
  return (lines || []).map(cartLineForProfit);
}
