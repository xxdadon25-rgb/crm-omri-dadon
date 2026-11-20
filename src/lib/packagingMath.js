/**
 * Packaging levels, normalised cost, and when the margin may NOT be shown.
 *
 * PURE. No React, no network, no imports — so the arithmetic that decides what
 * a sale earned can be tested exhaustively.
 *
 * ============================================================================
 * TWO DIFFERENT FACTS, AND WHY THEY MUST NOT BE CONFLATED
 * ============================================================================
 *   PACKAGING is a property of the PRODUCT and barely changes: how many units
 *   are in a pack, how many packs in a carton. It is worth asking once and
 *   keeping forever.
 *
 *   THE SALE LEVEL is a property of ONE ORDER LINE: did this line sell units,
 *   packs or cartons? The same product is sold at different levels to
 *   different customers on different days, so an answer here must never be
 *   promoted into a permanent product fact.
 *
 * Mixing them is what produces a confident, wrong margin: a buy price per unit
 * against a selling price per carton reads as a ~2,000% profit.
 *
 * ============================================================================
 * THE VAT FOOTING
 * ============================================================================
 * Both sides are NET here, so the margin is a pre-VAT margin with no VAT
 * arithmetic at all:
 *
 *   * the selling price is net. finbot-invoice sends order unit_price straight
 *     through with `vatType: true` and lets the provider add the VAT, so what
 *     is stored has never included it.
 *   * products.buy_price is net, confirmed by the owner, matching the
 *     supplier-quote pipeline's price_before_vat.
 *
 * Nothing here divides or multiplies by a VAT rate. If the purchase side ever
 * starts carrying VAT, this is the one comment that has to change with it.
 *
 * ============================================================================
 * MONEY IS INTEGER AGOROT
 * ============================================================================
 * 0.1 + 0.2 !== 0.3, and a margin is a ratio of two sums. Every amount is
 * converted to whole agorot on the way in and the arithmetic is integer;
 * shekels appear only at the display edge.
 */

export const SALE_LEVELS = ["unit", "pack", "carton"];

/**
 * THE VAT BASIS OF products.buy_price — stated, not assumed.
 *
 * A normalised cost is only meaningful once this is known: comparing a
 * VAT-inclusive cost with a net selling price understates every margin by 18%.
 * There is no per-product column for it, so the basis is recorded here, with
 * where it came from, and the arithmetic REFUSES to run if it is ever set to
 * "unknown" rather than quietly picking one.
 *
 *   "net"      — excluding VAT. Confirmed by the owner on 2026-11-16, and
 *                consistent with the supplier-quote pipeline, which stores
 *                price_before_vat. The selling side is independently known to
 *                be net: finbot-invoice sends order unit_price straight to the
 *                provider with `vatType: true` and lets it add the VAT.
 *   "gross"    — including VAT. The cost would be divided by (1 + VAT_RATE).
 *   "unknown"  — no margin is computed at all.
 *
 * Both sides being net is why nothing here multiplies or divides by a VAT
 * rate. If the purchase side ever changes, this constant and the division
 * below are the only things that move.
 */
export const BUY_PRICE_VAT_BASIS = "net";
export const VAT_RATE = 0.18;

export const LEVEL_LABEL = {
  unit: "יחידה",
  pack: "מארז",
  carton: "קרטון",
};

/** Why a margin could not be computed. Each one is a different fix. */
export const PENDING = {
  NO_COST: "no_cost",                 // the product has no purchase price
  UNKNOWN_COST_BASIS: "unknown_cost_basis",  // nobody has said if cost has VAT
  NO_LEVEL: "no_level",               // nobody has said what this line sells
  NO_PACKAGING: "no_packaging",       // the level needs a factor we do not have
  NO_BUY_LEVEL: "no_buy_level",       // nobody has said what buy_price is per
  LEVEL_UNCERTAIN: "level_uncertain", // the price moved; the level is unverified
  NO_REVENUE: "no_revenue",           // nothing was charged
  BAD_DATA: "bad_data",               // a value that cannot be arithmetic
};

export const PENDING_MESSAGE = {
  [PENDING.NO_COST]: "רווח ממתין להבהרה — אין מחיר קנייה למוצר",
  [PENDING.UNKNOWN_COST_BASIS]: "רווח ממתין להבהרה — לא ידוע אם מחיר הקנייה כולל מע״מ",
  [PENDING.NO_LEVEL]: "רווח ממתין להבהרה — לא נקבעה רמת האריזה שנמכרה",
  [PENDING.NO_PACKAGING]: "רווח ממתין להבהרה — חסרים נתוני אריזה למוצר",
  [PENDING.NO_BUY_LEVEL]: "רווח ממתין להבהרה — לא ידוע לאיזו רמת אריזה מתייחס מחיר הקנייה",
  [PENDING.LEVEL_UNCERTAIN]: "רווח ממתין לבדיקה — יש לאמת שמחיר הקנייה ומחיר המכירה הם לאותה יחידת מכירה",
  [PENDING.NO_REVENUE]: "רווח ממתין להבהרה — אין סכום מכירה",
  [PENDING.BAD_DATA]: "רווח ממתין להבהרה — נתונים לא תקינים",
};

/** Shekels -> whole agorot. Null-ish becomes null, NOT zero: "no price" and
 *  "free" are different facts and only one of them is arithmetic. */
export function toAgorot(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[₪,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return n < 0 ? -Math.round(-n * 100) : Math.round(n * 100);
}

/** Whole agorot -> shekels, for display only. */
export function toShekels(agorot) {
  return (agorot || 0) / 100;
}

/**
 * The purchase price on a NET footing, or null when the basis is unknown.
 *
 * Rounded once, here, so a gross basis cannot leave a fraction of an agora to
 * be multiplied by a packaging factor later.
 */
export function netCostAgorot(costAgorot) {
  if (costAgorot === null || costAgorot === undefined) return null;
  if (BUY_PRICE_VAT_BASIS === "net") return costAgorot;
  if (BUY_PRICE_VAT_BASIS === "gross") return Math.round(costAgorot / (1 + VAT_RATE));
  return null;                                  // "unknown": refuse to guess
}

/** A positive finite packaging factor, or null. Never 0 — a pack of zero units
 *  is not a fact, it is a typo, and dividing by it would be worse. */
function factor(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * How many BASE UNITS one sold item contains at this level.
 *
 * @returns {number|null} null when the packaging needed for that level is not
 *   known. A unit is always 1, so a product with no packaging at all can still
 *   be sold and costed by the unit — which is why asking is only ever needed
 *   for a pack or a carton.
 */
export function unitsPerLevel(packaging, level) {
  if (level === "unit") return 1;
  const perPack = factor(packaging?.units_per_pack);
  if (level === "pack") return perPack;
  if (level === "carton") {
    const perCarton = factor(packaging?.packs_per_carton);
    if (perPack === null || perCarton === null) return null;
    return perPack * perCarton;
  }
  return null;
}

/** Which levels can be priced at all, given what is known about the product. */
export function availableLevels(packaging) {
  return SALE_LEVELS.filter(l => unitsPerLevel(packaging, l) !== null);
}

/** What is missing before this level can be used. */
export function missingForLevel(packaging, level) {
  if (level === "unit") return [];
  const missing = [];
  if (factor(packaging?.units_per_pack) === null) missing.push("units_per_pack");
  if (level === "carton" && factor(packaging?.packs_per_carton) === null) {
    missing.push("packs_per_carton");
  }
  return missing;
}

/**
 * ============================================================================
 * THERE IS NO INFERENCE OF THE SALE LEVEL. THIS IS DELIBERATE.
 * ============================================================================
 * An earlier version of this module guessed the level from the price, by
 * asking which level would imply a "plausible" gross margin (0-60%). That has
 * been removed.
 *
 * The reason is that it inverted the evidence. A margin band is an ASSUMPTION
 * about how this business prices; the sale level is a FACT about what left the
 * warehouse. Deriving the fact from the assumption means that whenever the
 * assumption is wrong — a clearance sale, a loss leader, an unusually rich
 * margin — the system silently costs the line at the wrong level and reports a
 * confident, wrong profit. That is the exact failure this feature exists to
 * end, so reintroducing it one layer down would be self-defeating.
 *
 * What IS used is verified data: the packaging recorded for the product, the
 * prices as entered, and the level the owner confirmed for the line. When the
 * level has not been confirmed, nothing is assumed — the line is pending and
 * the owner is asked.
 *
 * `clarificationFor` therefore asks for the level whenever it is unknown, and
 * there is no code path that fills it in.
 */

/**
 * The purchase price per BASE UNIT.
 *
 * ============================================================================
 * buy_price IS NOT NECESSARILY PER UNIT
 * ============================================================================
 * It is typed off a supplier document, and that document may quote per unit,
 * per pack or per carton. Treating a per-carton price as per-unit overstates
 * the cost by the whole carton factor and turns a good sale into an apparent
 * loss — the same class of error as the inflated margin this feature exists to
 * remove, pointing the other way.
 *
 * So the level is required, not assumed. `buyLevel` comes from the product's
 * recorded buy_price_level, which is either derived from APPROVED supplier
 * data or answered once by the owner.
 *
 * @returns {number|null} agorot per base unit, or null when it cannot be known
 */
export function costPerBaseUnit({ buyPrice, packaging, buyLevel } = {}) {
  const raw = toAgorot(buyPrice);
  if (raw === null || raw < 0) return null;

  // The VAT footing is a SEPARATE question from the packaging one, applied
  // first so the division below works on net money.
  const net = netCostAgorot(raw);
  if (net === null) return null;

  if (!buyLevel || !SALE_LEVELS.includes(buyLevel)) return null;
  const unitsInBuy = unitsPerLevel(packaging, buyLevel);
  if (unitsInBuy === null) return null;

  // NOT rounded here. Rounding a per-unit cost before multiplying it by a
  // carton's 24 units would drift by up to 12 agorot on the line; the single
  // rounding happens once the line's whole cost is known.
  return net / unitsInBuy;
}

/**
 * The profit of one order line, or an honest refusal.
 *
 * A DISCOUNT reduces the revenue and nothing else: the goods cost what they
 * cost. A custom selling price simply replaces the price — there is no
 * separate concept for it here, which is the point.
 *
 * Rounding happens ONCE, on the line's revenue and on the line's cost, in
 * agorot. Rounding each unit first and multiplying would drift by up to half
 * an agora per unit.
 *
 * @returns {{
 *   ok: boolean, pending: string|null, message: string|null,
 *   revenue: number|null, cost: number|null, profit: number|null,
 *   margin: number|null, unitsPerItem: number|null, baseUnits: number|null
 * }}  amounts in AGOROT, margin as a fraction
 */
export function lineProfit({
  unitPrice, quantity, discountPercent = 0, buyPrice, packaging, saleLevel,
  buyLevel, levelUncertain = false,
} = {}) {
  const fail = (pending) => ({
    ok: false, pending, message: PENDING_MESSAGE[pending],
    revenue: null, cost: null, profit: null, margin: null,
    unitsPerItem: null, baseUnits: null,
  });

  const price = toAgorot(unitPrice);
  const qty = Number(quantity);
  const disc = Number(discountPercent ?? 0);

  if (price === null || !Number.isFinite(qty) || qty <= 0) return fail(PENDING.BAD_DATA);
  if (!Number.isFinite(disc) || disc < 0 || disc > 100) return fail(PENDING.BAD_DATA);

  // Revenue is computable on its own, and is reported even when the cost is
  // not: knowing what was charged is never the uncertain part.
  const revenue = Math.round(price * qty * (1 - disc / 100));
  if (revenue <= 0) return fail(PENDING.NO_REVENUE);

  const rawCost = toAgorot(buyPrice);
  if (rawCost === null || rawCost < 0) return fail(PENDING.NO_COST);
  if (netCostAgorot(rawCost) === null) return fail(PENDING.UNKNOWN_COST_BASIS);

  // WHAT THE PURCHASE PRICE IS PER — required, never assumed.
  if (!buyLevel || !SALE_LEVELS.includes(buyLevel)) return fail(PENDING.NO_BUY_LEVEL);

  // WHAT THE LINE SOLD.
  //
  // A LEVEL THE PRICE NO LONGER SUPPORTS IS NOT USED, AND IS NOT DISCARDED.
  // When a price edit leaves a level the owner stated looking doubtful, the
  // level stays on the line — it is their answer, and only they may change it —
  // but the margin is withheld. Costing a line at a level the price contradicts
  // is exactly how order #1197 reported a 99.8% margin, and showing nothing is
  // the only honest alternative to showing that.
  if (levelUncertain) return fail(PENDING.LEVEL_UNCERTAIN);
  if (!saleLevel || !SALE_LEVELS.includes(saleLevel)) return fail(PENDING.NO_LEVEL);

  // If buying and selling levels are exactly the same, packaging factors
  // cancel. E.g. 10 packs sold at ₪30 per pack cost ₪300 even if we do not
  // know how many individual pieces are inside a pack. No inferred levels.
  if (saleLevel === buyLevel) {
    const cost = Math.round(netCostAgorot(rawCost) * qty);
    return {
      ok: true, pending: null, message: null,
      revenue, cost, profit: revenue - cost, margin: (revenue - cost) / revenue,
      unitsPerItem: unitsPerLevel(packaging, saleLevel), baseUnits: null,
    };
  }

  // Different buy/sale levels REQUIRE a known conversion factor.
  if (unitsPerLevel(packaging, buyLevel) === null) return fail(PENDING.NO_PACKAGING);
  const unitsPerItem = unitsPerLevel(packaging, saleLevel);
  if (unitsPerItem === null) return fail(PENDING.NO_PACKAGING);

  const perUnit = costPerBaseUnit({ buyPrice, packaging, buyLevel });
  if (perUnit === null) return fail(PENDING.NO_BUY_LEVEL);

  const baseUnits = qty * unitsPerItem;
  // Rounded ONCE, here, with the whole line's cost in hand.
  const lineCost = Math.round(perUnit * baseUnits);
  const profit = revenue - lineCost;

  return {
    ok: true, pending: null, message: null,
    revenue, cost: lineCost, profit,
    margin: profit / revenue,
    unitsPerItem, baseUnits,
  };
}

/**
 * The profit of a whole order.
 *
 * A LINE THAT CANNOT BE COSTED DOES NOT BECOME ZERO. It is counted as pending
 * and excluded from the totals, and the result says how many lines are in that
 * state — because a total that silently treats unknown cost as free is exactly
 * the confident wrong number this is meant to replace.
 */
export function orderProfit(lines = []) {
  let revenue = 0, cost = 0, costed = 0;
  const pending = [];

  for (const line of lines) {
    const r = lineProfit(line);
    if (r.ok) {
      revenue += r.revenue;
      cost += r.cost;
      costed += 1;
    } else {
      // Deliberately NOT added to `revenue`: that figure is the revenue the
      // margin is a ratio of, and mixing in revenue whose cost is unknown is
      // what makes a percentage lie. The line is reported instead.
      pending.push({ line, pending: r.pending, message: r.message });
    }
  }

  const profit = revenue - cost;
  return {
    // A margin is only shown when EVERY line could be costed. One unknown line
    // is enough to make a percentage misleading, and the point of this whole
    // change is to stop showing those.
    ok: pending.length === 0 && costed > 0,
    revenue, cost, profit,
    margin: revenue > 0 ? profit / revenue : null,
    costedLines: costed,
    pendingLines: pending.length,
    pending,
    message: pending.length > 0
      ? (pending.length === 1
          ? "רווח ממתין להבהרה — שורה אחת חסרת נתונים"
          : `רווח ממתין להבהרה — ${pending.length} שורות חסרות נתונים`)
      : (costed === 0 ? "רווח ממתין להבהרה" : null),
  };
}

/**
 * What to ask about one order line, if anything.
 *
 * At most ONE question per line, and only when the answer cannot be worked
 * out. The question is about the LINE (which level was sold) or about the
 * PRODUCT (how big is a pack) — the caller needs to know which, because only
 * the second is saved permanently.
 *
 * @returns {{
 *   ask: boolean, kind: 'sale_level'|'packaging'|null,
 *   level: string|null, missing: string[], options: string[], reason: string
 * }}
 */
export function clarificationFor({
  unitPrice, buyPrice, packaging, saleLevel, buyLevel, quantity,
} = {}) {
  const none = { ask: false, kind: null, level: null, missing: [], options: [], reason: "" };

  // No cost means no margin to get wrong, so there is nothing to clarify. The
  // product's purchase price is a separate gap, surfaced as pending, not as a
  // question during order entry.
  if (toAgorot(buyPrice) === null) return { ...none, reason: "no_cost" };
  // If the cost basis is unknown no amount of packaging makes the margin
  // reliable, so there is nothing useful to ask during order entry.
  if (netCostAgorot(toAgorot(buyPrice)) === null) {
    return { ...none, reason: "unknown_cost_basis" };
  }

  // The purchase level is a PRODUCT fact and is asked for first: without it
  // no margin is possible at any sale level, so asking about the line before
  // it would be asking a question that cannot yet pay off.
  if (!buyLevel || !SALE_LEVELS.includes(buyLevel)) {
    return {
      ask: true, kind: "buy_level", level: null, missing: ["buy_price_level"],
      options: SALE_LEVELS, reason: "buy_level_unknown",
    };
  }

  if (saleLevel && SALE_LEVELS.includes(saleLevel)) {
    const missing = [...new Set([
      ...missingForLevel(packaging, buyLevel),
      ...missingForLevel(packaging, saleLevel),
    ])];
    if (missing.length === 0) return { ...none, reason: "already_known" };
    // The level is settled; what is missing is a permanent product fact.
    return {
      ask: true, kind: "packaging", level: saleLevel, missing,
      options: [], reason: "packaging_missing",
    };
  }

  // No level on the line, and nothing may be inferred: the owner is asked.
  // Every level is offered, including ones whose packaging is not yet known —
  // the dialog collects that in the same step, so one question settles it.
  return {
    ask: true, kind: "sale_level", level: null, missing: [],
    options: SALE_LEVELS, reason: "level_unknown",
  };
}
