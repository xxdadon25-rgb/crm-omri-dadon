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
  // Invoice 10054 / order 1108, confirmed by owner on 2026-11-21:
  // 50 lids sold at ₪1 each, ₪0.48 cost per lid. The legacy sales line
  // recorded 2 × ₪25 (two 25-lid groups). Historical buy_price ₪0.25 was
  // an incorrect basis; the verified cost for each 25-lid group is ₪12.
  // Keep the issued invoice and original order amounts untouched.
  if (productId === "a08601f1-f5ad-4669-9cb4-197be38ad27d"
      && cost === 0.25 && sell === 25 && Number(line.quantity) === 2
      && Number(line.total) === 50) return 25 * 0.48;

  // Invoice 10094 / order 1153: owner confirmed 44 individual lids
  // sold at ₪1 each, while the legacy line stores 1 × ₪44.
  // Verified Twins purchase document 581489: ₪144 per 240 lids = ₪0.60 each.
  // The historical sale unit is the full 44-piece group, cost ₪26.40.
  if (productId === "a08601f1-f5ad-4669-9cb4-197be38ad27d"
      && cost === 144 && sell === 44 && Number(line.quantity) === 1
      && Number(line.total) === 44) return 44 * (144 / 240);

  // Invoice 10068 / order 1120, line 9: owner confirmed 14 small colored
  // carrier-bag packs at ₪4.90 sale and ₪3.60 cost per pack on 2026-11-21.
  // The stored legacy buy_price ₪40 has a different, unverified basis.
  // This correction matches ONLY that saved historical line; the separate
  // ₪145 line for the same product is deliberately untouched.
  if (productId === "203154c5-b802-4423-8957-6294f7eee6fe"
      && cost === 40 && sell === 4.9 && Number(line.quantity) === 14
      && Math.abs(Number(line.total) - 68.6) < 0.005) return 3.6;

  // Invoice 10024 / order 1077: source order already records ₪0.05
  // purchase cost per R25 lid, confirmed by owner on 2026-11-21.
  // The issued invoice snapshot mistakenly saved buy_price=0.
  // Cost 100 lids at ₪0.05 without editing the issued invoice or sale total.
  if (productId === "ded74ba9-70de-46c7-9031-f3b5c7528dc2"
      && cost === 0 && sell === 0.15 && Number(line.quantity) === 100
      && Number(line.total) === 15) return 0.05;

  // Historical sales whose carton contents AND saved purchase-price base
  // are established from the reviewed catalogue / supplier packaging:
  // 400 aluminium trays per ₪160 carton, sold as individual trays.
  if (productId === "69faf9af-c6c2-4add-aca0-46e9e486bdba"
      && cost === 160 && sell === 0.88) return 160 / 400;

  // Extra Plast oval casseroles: 66 pieces per pack, 10 packs per carton.
  // Legacy sale qty is individual pieces, saved cost ₪35 per 660-piece carton.
  if (productId === "7e6eec29-42f7-453f-87f1-390625c28179"
      && cost === 35 && sell === 0.1) return 35 / 660;

  // R29/R24 foil lid: 100 pieces at a historical ₪7.50 purchase cost,
  // matching the reviewed catalogue's ₪0.075 per piece.
  if (productId === "dba7dcfc-18ea-4f8c-bddd-d1d591a2bbae"
      && cost === 7.5 && sell === 0.2) return 7.5 / 100;

  // 4.5 L container: 50 individual containers per carton. Historical rows
  // record purchase price PER CONTAINER (₪1.38 / ₪1.80), but quote the sale
  // of one complete 50-piece carton at ₪78.
  if (productId === "46d47622-c490-40f7-8a7d-8dd09a538a74"
      && (cost === 1.38 || cost === 1.8) && sell === 78) {
    return cost * 50;
  }

  // Twelve Basic floor cloths sold together at ₪36; historical cost ₪2.33
  // was per cloth. The reviewed product now sells one cloth at ₪3.
  if (productId === "bf67c2a0-4541-4dfc-8bdd-3e61648028c3"
      && cost === 2.33 && sell === 36) return 2.33 * 12;

  // Dishwashing liquid: four 4L jugs in a carton, but this line's qty=4
  // and ₪18.90 selling price are for INDIVIDUAL jugs. Old labels carton/unit
  // were reversed. ₪9.50 is cost for one jug.
  if (productId === "5a2eb32e-713f-4e0b-9f58-392aa516de71"
      && cost === 9.5 && sell === 18.9 && Number(line.quantity) === 4) {
    return 9.5;
  }

  // 15 kg carrier-bag sack historically bought for ₪110 per 15 kg,
  // with 5 kg sold at ₪8 per kg.
  if (productId === "5383cf57-3321-4f5d-897b-7c4d0a951d68"
      && cost === 110 && sell === 8 && Number(line.quantity) === 5) {
    return 110 / 15;
  }

  return null;
}

/** @param {object} line a cart line / orders.items entry */
export function cartLineForProfit(line) {
  // From the reviewed catalogue onward, both recorded prices refer to ONE
  // selected sales unit (pack / individual item / carton / meter).
  // Old supplier packaging labels must never override this explicit basis.
  if (line?.price_basis === "catalog_same_sold_unit_v1") {
    return {
      unitPrice: line?.unit_price,
      quantity: line?.quantity,
      discountPercent: line?.discount ?? 0,
      buyPrice: line?.buy_price,
      packaging: null,
      saleLevel: "unit",
      buyLevel: "unit",
      levelUncertain: false,
    };
  }
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
    ) || (
      // Legacy documents with NO recorded price basis sometimes carry a
      // carton purchase price against a single-piece selling price.
      // A 3x+ discrepancy is not proof of a loss; with no confirmed basis
      // the result is pending instead of a fictitious 3,000% loss.
      !line?.sale_level && !line?.buy_level &&
      line?.buy_price != null && line?.unit_price != null &&
      Number.isFinite(Number(line.buy_price)) &&
      Number.isFinite(Number(line.unit_price)) &&
      Number(line.unit_price) > 0 &&
      (
        Number(line.buy_price) > Number(line.unit_price) * 3 ||
        // Reversed mismatch: a per-piece purchase price recorded against
        // a per-carton selling price can invent a 98-99% margin.
        Number(line.unit_price) > Number(line.buy_price) * 12
      )
    ),
  };
}

/** The same, for a whole cart. */
export function cartLinesForProfit(lines = []) {
  return (lines || []).map(cartLineForProfit);
}
