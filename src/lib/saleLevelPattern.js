/**
 * LEARNING WHAT A PRICE MEANS, PER PRODUCT.
 *
 * PURE. No React, no network, no imports — the same reason packagingMath is
 * pure: this decides what a line sold, and that decision has to be testable
 * exhaustively.
 *
 * ============================================================================
 * THE PROBLEM THIS SOLVES
 * ============================================================================
 * `sale_level` says what ONE unit of a line's quantity is. It cannot be
 * computed from the line, so it was asked for — every time, for every product,
 * for ever. That is the right answer to "never guess" and the wrong answer to
 * "let me type an order".
 *
 * There is a third option, and it is neither guessing nor asking: REMEMBERING.
 * The owner has already answered, for most products, many times over. Those
 * answers are on the saved order lines, each next to the price it was given
 * for. A price of ₪186 for the product in order #1197 has meant "one carton"
 * every time it has been entered; ₪0.53 has meant "one unit". Nothing has to be
 * inferred — it has to be looked up.
 *
 * ============================================================================
 * WHY THE PRICE, AND ONLY THE PRICE, IDENTIFIES THE LEVEL
 * ============================================================================
 * The quantity cannot: 1 and 350 are both legitimate at every level, and the
 * two conventions this business actually uses — a carton entered as 1, or the
 * same carton entered as its 350 individual units — differ in the quantity
 * while meaning the same goods. So the quantity is recorded in a pattern for
 * inspection and is DELIBERATELY NOT part of the decision.
 *
 * The price can, because the levels are separated by the packaging factors
 * themselves. A carton of 350 costs about 350x a unit. The prices for two
 * levels of the same product are therefore orders of magnitude apart, while a
 * customer-specific price, a discount or a price rise moves a price by tens of
 * percent. Those two scales do not overlap, and the band below is built so that
 * they provably cannot:
 *
 *   * each learned price gets a band around it
 *   * the band stops at the GEOMETRIC MIDPOINT to the nearest other learned
 *     price, so no price can ever fall in two bands
 *   * and it never exceeds PRICE_BAND_MAX either way, so a price nowhere near
 *     anything known is reported as unknown rather than swallowed by the
 *     closest band
 *
 * This is NOT the margin-band inference that was removed from packagingMath. A
 * margin band is an assumption about how this business prices, and it was used
 * to derive a fact. Here the fact is read off the owner's own confirmed
 * answers; the only thing that has to hold is that the price being typed is
 * near one the owner has already labelled.
 *
 * ============================================================================
 * WHAT IS NOT LEARNED HERE
 * ============================================================================
 * Packaging (units_per_pack, packs_per_carton) and buy_price_level are
 * PRODUCT facts, live in supplier_quote_product_packages, and are untouched by
 * anything in this file. A pattern never writes them, never implies them, and
 * is useless without them — a matched level still needs the packaging to be
 * costed, and still reports pending when it is missing.
 */

import { SALE_LEVELS, unitsPerLevel } from "@/lib/packagingMath";

/**
 * The widest factor, either way, by which a price may differ from a learned
 * one and still be recognised as that level.
 *
 * 2.5 covers the real spread of a single level's price — a customer-specific
 * price, a volume discount, a price rise, a clearance — with room over. It is
 * far below the smallest packaging factor this business uses, so widening it to
 * this is not what could cause a wrong match; two learned prices closer
 * together than its square are what would, and the midpoint rule below is what
 * prevents that.
 */
export const PRICE_BAND_MAX = 2.5;

/**
 * How near a learned price counts as THE SAME PRICE.
 *
 * ============================================================================
 * WHY TWO TIERS, AND NOT ONE WIDE BAND
 * ============================================================================
 * A single 2.5x band is safe only while the levels are far apart. Audited
 * against adjacent levels, it is not:
 *
 *   pack of 2  — a 30% discount on a pack price is read as a UNIT price
 *   pack of 3  — a 45% discount is
 *   pack of 6  — a 60% discount is
 *   pack of 12 — an 80% discount is
 *   carton of 24 or more — no discount reaches the neighbouring band
 *
 * A misread level there halves or doubles the cost and shows a margin nobody
 * would question, which is the whole class of error this feature exists to
 * remove. So the wide band is now allowed to decide only where it provably
 * cannot be crossed — levels at least PRICE_BAND_MAX^2 apart — and everything
 * closer than that must match a learned price almost exactly.
 *
 * 1.15 is deliberately tight: it is a price list that moved, VAT rounding, an
 * agora or two of drift, not a discount. For it to be wrong, two of a
 * product's levels would have to be priced within 1.32x of each other, which
 * no packaging produces.
 */
export const NEAR_EXACT = 1.15;

/**
 * The separation two learned prices need before the WIDE band may decide
 * between them: PRICE_BAND_MAX squared.
 *
 * The algebra is the whole justification. If a level's real prices sit within
 * V of its anchor `a`, and the next anchor is `b`, the bands meet at sqrt(a*b);
 * a real price stays on its own side of that midpoint exactly when
 * a*V < sqrt(a*b), i.e. when b/a > V^2. With V = PRICE_BAND_MAX = 2.5 that is
 * 6.25. Below it the wide band is refused and the near-exact tier decides, or
 * the owner is asked.
 */
export const MIN_WIDE_SEPARATION = PRICE_BAND_MAX * PRICE_BAND_MAX;

/**
 * How big a price change proves the line was RESCALED, when the product's
 * packaging is not known.
 *
 * Used only to INVALIDATE a level that is now certainly wrong, never to pick
 * one. 4x is past any discount or correction and well inside a packaging step.
 */
export const RESCALE_RATIO_FLOOR = 4;

/** How many recent confirmations per level the anchor is taken from. */
export const ANCHOR_SAMPLE = 5;

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[₪,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** The middle value, so one mistyped price among several cannot move an anchor. */
function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * ONE price for a level, from several confirmations of it — or nothing.
 *
 * ============================================================================
 * THE HISTORY ITSELF CONTAINS MISLABELLED LINES
 * ============================================================================
 * This is not hypothetical: order #1197 is SAVED with unit_price 186 and
 * sale_level "unit", because the bug being fixed let it be. Averaging that in
 * with the product's genuine unit price of ₪0.53 would produce an anchor of
 * ₪93, which matches nothing, and taking it at face value would teach the
 * system that ₪186 means a unit — entrenching the very error.
 *
 * So prices for one level are CLUSTERED, at the same band used everywhere
 * else, and only a single clear majority cluster becomes the anchor:
 *
 *   [0.53, 0.52, 186]  -> two clusters, one of two and one of one -> ₪0.525
 *   [0.53, 186]        -> two clusters of one each, no majority   -> NO anchor
 *
 * No anchor means the price is not recognised, which means the owner is asked.
 * Inconsistent evidence therefore degrades to the old behaviour instead of
 * producing a confident wrong level — the same principle as everywhere else
 * here, applied to the training data rather than to the arithmetic.
 */
function anchorFrom(prices) {
  const clean = prices.filter(p => Number.isFinite(p) && p > 0);
  if (clean.length === 0) return null;
  if (clean.length === 1) return clean[0];

  /** @type {number[][]} */
  const clusters = [];
  for (const p of [...clean].sort((a, b) => a - b)) {
    const last = clusters[clusters.length - 1];
    if (last && p / last[0] < PRICE_BAND_MAX) last.push(p);
    else clusters.push([p]);
  }
  if (clusters.length === 1) return median(clusters[0]);

  const sizes = clusters.map(c => c.length).sort((a, b) => b - a);
  // A tie means the confirmations disagree and nothing here can say which is
  // right. Reported as "not learned", so the owner is asked.
  if (sizes[0] === sizes[1]) return null;
  const biggest = clusters.reduce((a, c) => (c.length > a.length ? c : a), clusters[0]);
  return median(biggest);
}

/**
 * ============================================================================
 * TWO GRADES OF EVIDENCE, AND ONLY ONE OF THEM DECIDES
 * ============================================================================
 * Measured against production: 416 order lines, 181 products, and 14 labelled
 * lines on 14 distinct products. No product has two labelled examples, and not
 * one of those labels carries `sale_level_source`, because the field has never
 * been saved.
 *
 * So every label on record today is UNVERIFIED. It may have been answered in
 * the clarification dialog, or chosen on the row — or it may be order #1197's,
 * which is saved as ₪186 = "unit" and is simply wrong. Nothing in the data
 * distinguishes them, and a wrong anchor is worse than no anchor because the
 * margin it produces is one nobody questions.
 *
 *   STRONG  `sale_level_source === "confirmed"` — the owner answered, under
 *           code that records that they did. ONE of these is enough to decide
 *           automatically, for ever, for that product and price. These are the
 *           `levels` of a pattern.
 *
 *   WEAK    a stored level with no provenance. Never decides anything. It is
 *           kept as a `hint`, which does two useful things: it is SHOWN beside
 *           the question so answering is one informed click, and it still
 *           takes part in contradiction detection. These are the `hints`.
 *
 * Today that means automatic identification starts at zero and grows by one
 * product per answer, which is the honest position: there is currently no
 * verified evidence to reuse. What it buys is that no wrong label can ever
 * auto-apply, and that each product is asked about exactly once.
 *
 * @typedef {{anchor: number|null, prices: number[], quantities: number[], n: number}} Slot
 * @typedef {{
 *   levels: Record<string, Slot>,
 *   hints: Record<string, Slot>,
 *   confirmations: number, observations: number
 * }} Pattern
 */

/** An empty pattern — "nothing has been confirmed for this product". */
export function emptyPattern() {
  return { levels: {}, hints: {}, confirmations: 0, observations: 0 };
}

/**
 * Read confirmed (price, level) pairs off document lines.
 *
 * A line counts only when it carries BOTH a valid sale_level and a usable
 * positive unit price. Legacy lines with no level teach nothing — which is
 * correct, since nobody ever said what they sold.
 *
 * `newestFirst` must be true when the lines arrive most-recent-first, so the
 * anchor is taken from the latest confirmations and follows a price change
 * instead of averaging over years.
 */
export function learnFromLines(lines = []) {
  /** @type {Map<string, Pattern>} */
  const out = new Map();

  for (const line of lines || []) {
    const pid = line?.product_id;
    const level = line?.sale_level;
    if (!pid || !SALE_LEVELS.includes(level)) continue;
    // ========================================================================
    // A LEVEL THIS MECHANISM FILLED IN IS NOT EVIDENCE AT ALL.
    // ========================================================================
    // Not strong, not weak — discarded. Without this there is a feedback loop
    // with a memory: an auto-filled level is saved on the order, is read back
    // as history, becomes an anchor, and from then on defends itself. One
    // early wrong match would entrench permanently and look better supported
    // every time it recurred.
    const source = line.sale_level_source;
    if (source && source !== "confirmed") continue;

    const price = num(line.unit_price);
    if (price === null || price <= 0) continue;

    // STRONG only when the line says the owner answered. Everything else is a
    // hint: kept, shown, never acted on.
    const strong = source === "confirmed";

    let p = out.get(pid);
    if (!p) { p = emptyPattern(); out.set(pid, p); }
    const bag = strong ? p.levels : p.hints;
    let slot = bag[level];
    if (!slot) { slot = { anchor: null, prices: [], quantities: [], n: 0 }; bag[level] = slot; }
    slot.n += 1;
    if (slot.prices.length < ANCHOR_SAMPLE) slot.prices.push(price);
    const qty = num(line.quantity);
    if (qty !== null && slot.quantities.length < ANCHOR_SAMPLE) slot.quantities.push(qty);
    if (strong) p.confirmations += 1; else p.observations += 1;
  }

  for (const p of out.values()) {
    for (const slot of Object.values(p.levels)) slot.anchor = anchorFrom(slot.prices);
    for (const slot of Object.values(p.hints)) slot.anchor = anchorFrom(slot.prices);
  }
  return out;
}

/**
 * Learn from saved documents, newest first.
 *
 * ============================================================================
 * ONLY CANCELLED DOCUMENTS ARE EXCLUDED
 * ============================================================================
 * Drafts used to be excluded too, and that was wrong for this purpose. What is
 * being read is not a price anyone agreed to — it is the owner's statement
 * about WHAT A PRICE REFERS TO, and that statement is just as true on an
 * unapproved order as on a completed one. Production makes the point: all 14
 * labelled lines in the whole database sit in orders with status
 * "ממתין לאישור". Excluding unapproved documents would discard every label
 * there is.
 *
 * A CANCELLED order stays out. It was withdrawn in full, and nothing on it
 * should carry weight afterwards.
 */
export function learnPatterns(documents = [], {
  excludeStatuses = ["בוטל"],
} = {}) {
  const excluded = new Set(excludeStatuses);
  const ordered = [...(documents || [])]
    .filter(d => !excluded.has(d?.status))
    .sort((a, b) => {
      const d = String(b?.date || "").localeCompare(String(a?.date || ""));
      if (d !== 0) return d;
      return String(b?.created_date || "").localeCompare(String(a?.created_date || ""));
    });
  const lines = [];
  for (const doc of ordered) for (const it of doc?.items || []) lines.push(it);
  return learnFromLines(lines);
}

/** Fold `b` into `a` without mutating either. `b`'s samples come first, so the
 *  caller can put the newer evidence there. */
export function mergePatterns(a, b) {
  const out = new Map();
  const ids = new Set([...(a?.keys?.() ?? []), ...(b?.keys?.() ?? [])]);
  for (const id of ids) {
    const pa = a?.get?.(id), pb = b?.get?.(id);
    if (!pa) { out.set(id, pb); continue; }
    if (!pb) { out.set(id, pa); continue; }
    const merged = emptyPattern();
    merged.confirmations = pa.confirmations + pb.confirmations;
    merged.observations = (pa.observations ?? 0) + (pb.observations ?? 0);
    for (const bag of ["levels", "hints"]) {
      for (const level of SALE_LEVELS) {
        const sa = pa[bag]?.[level], sb = pb[bag]?.[level];
        if (!sa && !sb) continue;
        const prices = [...(sb?.prices ?? []), ...(sa?.prices ?? [])].slice(0, ANCHOR_SAMPLE);
        const quantities = [...(sb?.quantities ?? []), ...(sa?.quantities ?? [])].slice(0, ANCHOR_SAMPLE);
        merged[bag][level] = {
          prices, quantities,
          n: (sa?.n ?? 0) + (sb?.n ?? 0),
          anchor: anchorFrom(prices),
        };
      }
    }
    out.set(id, merged);
  }
  return out;
}

/**
 * The widest factor allowed around one anchor: capped, and never past the
 * geometric midpoint to its nearest neighbour.
 *
 * sqrt(ratio) IS that midpoint in log space, which is what makes the bands
 * provably disjoint: two anchors a < b each reach at most sqrt(b/a), so the
 * highest price a accepts equals the lowest price b accepts, and no price can
 * satisfy both strictly.
 */
function bandFor(anchor, otherAnchors) {
  let band = PRICE_BAND_MAX;
  for (const other of otherAnchors) {
    if (!(other > 0) || other === anchor) continue;
    const ratio = other > anchor ? other / anchor : anchor / other;
    band = Math.min(band, Math.sqrt(ratio));
  }
  return band;
}

/**
 * Which level a price means for this product.
 *
 * @returns {{
 *   level: string|null,
 *   status: 'unambiguous'|'ambiguous'|'unknown',
 *   candidates: string[], anchors: Record<string, number>
 * }}
 *
 *   'unambiguous' — exactly one learned level's band contains this price. Safe
 *                   to use without asking.
 *   'ambiguous'   — two or more could. Cannot happen through the bands above,
 *                   and is reported rather than resolved if it ever does.
 *   'unknown'     — nothing learned, or the price is near nothing learned. The
 *                   owner is asked, exactly as before any of this existed.
 */
export function matchLevel({ unitPrice, pattern, packaging } = {}) {
  let anchors = {};
  for (const level of SALE_LEVELS) {
    const a = pattern?.levels?.[level]?.anchor;
    if (num(a) !== null && a > 0) anchors[level] = a;
  }
  // Anchors that contradict the product's own packaging are dropped before any
  // of them is used. See `consistentAnchors`.
  anchors = consistentAnchors(anchors, packaging);
  const none = (status) => ({ level: null, status, candidates: [], anchors, tier: null });

  const price = num(unitPrice);
  if (price === null || price <= 0) return none("unknown");
  const keys = Object.keys(anchors);
  if (keys.length === 0) return none("unknown");

  const all = keys.map(k => anchors[k]);
  const ratioTo = (a) => (price > a ? price / a : a / price);

  // ========================================================================
  // NOTHING IS DECIDED FOR A PRODUCT WHOSE LEVELS ARE PRICED TOO CLOSE.
  // ========================================================================
  // This is the hard limit of identifying a level from a price, and it applies
  // to both tiers below. If a pack is priced `sep` times a unit, then a pack
  // discounted by (1 - 1/sep) costs EXACTLY the unit price, and no rule reading
  // only the price can tell the two apart — the number means both things.
  //
  // Requiring sep >= 6.25 means the collision needs an 84% discount, which is
  // not a commercial price. Below it the product is asked about instead:
  //
  //   sep  2x  -> a 50% discount collides   -> asked
  //   sep  3x  -> 67%                       -> asked
  //   sep  6x  -> 83%                       -> asked
  //   sep 6.25x-> 84%                       -> decided
  //   sep 24x  -> 96%                       -> decided
  //
  // A product with only ONE confirmed level has no neighbour and no collision,
  // so it is decided normally — which is most products most of the time.
  const wellSeparated = keys.filter(level => separation(anchors[level], all) >= MIN_WIDE_SEPARATION);
  if (wellSeparated.length === 0) {
    const nearSomething = keys.some(level => ratioTo(anchors[level]) < PRICE_BAND_MAX);
    return none(nearSomething ? "ambiguous" : "unknown");
  }

  // ---- TIER 1: this IS a price the owner has labelled -------------------
  const exact = wellSeparated.filter(level => ratioTo(anchors[level]) < NEAR_EXACT);
  if (exact.length === 1) {
    return { level: exact[0], status: "unambiguous", candidates: exact, anchors, tier: "near_exact" };
  }
  if (exact.length > 1) {
    return { level: null, status: "ambiguous", candidates: exact, anchors, tier: "near_exact" };
  }

  // ---- TIER 2: near a labelled price, and nothing else is close --------
  // Only where the nearest other anchor is far enough that a real price of one
  // level provably cannot reach the other's side of the midpoint.
  const candidates = wellSeparated.filter((level) => {
    // Strictly inside, so a price sitting exactly on a midpoint belongs to
    // neither band rather than to both.
    return ratioTo(anchors[level]) < bandFor(anchors[level], all);
  });

  if (candidates.length === 1) {
    return { level: candidates[0], status: "unambiguous", candidates, anchors, tier: "band" };
  }
  if (candidates.length === 0) {
    // Distinguish "nowhere near anything" from "near something, but the levels
    // are too close together to tell them apart". The second is the audited
    // discount case, and it must ask rather than pick.
    const nearSomething = keys.some(level => ratioTo(anchors[level]) < bandFor(anchors[level], all));
    return none(nearSomething ? "ambiguous" : "unknown");
  }
  return { level: null, status: "ambiguous", candidates, anchors, tier: "band" };
}

/** The ratio from `a` to its nearest neighbour among `all`, or Infinity. */
function separation(a, all) {
  let sep = Infinity;
  for (const other of all) {
    if (!(other > 0) || other === a) continue;
    sep = Math.min(sep, other > a ? other / a : a / other);
  }
  return sep;
}

/**
 * Drop anchors that the product's own packaging says cannot all be true.
 *
 * ============================================================================
 * THE HISTORY CAN CONTRADICT ITSELF, AND PACKAGING IS THE ARBITER
 * ============================================================================
 * Audited on the real failure: a product whose lines were saved as ₪186 = unit
 * (the #1197 bug) and ₪186 = carton. Both anchors then sit at 186, a genuine
 * carton price matches both, and the result was reported as ambiguous — safe,
 * but only by luck of the two being equal.
 *
 * The packaging settles it properly. Two levels of one product are separated by
 * a KNOWN factor: a carton of 350 units must cost about 350x a unit. Anchors
 * whose ratio is nowhere near that factor cannot both be right, so neither is
 * trusted and the owner is asked.
 *
 * Tolerance is PRICE_BAND_MAX either way, which is generous on purpose: a
 * carton is normally priced BELOW the unit price times its contents — that is
 * what buying a carton is for — and that discount must not read as a
 * contradiction.
 *
 * NOTE WHAT IS NOT USED HERE. The purchase price would also flag ₪186 = unit,
 * by implying a 650-fold markup. Deciding a level from an implied margin is
 * forbidden in this codebase and remains so: a margin band is an assumption
 * about pricing, and using it to overrule a recorded fact is how a clearance
 * sale becomes a wrong cost. Only packaging — a measured property of the
 * product — arbitrates.
 */
function consistentAnchors(anchors, packaging) {
  const levels = Object.keys(anchors);
  if (levels.length < 2) return anchors;

  const units = {};
  for (const level of levels) {
    const u = unitsPerLevel(packaging, level);
    if (u !== null) units[level] = u;
  }

  const bad = new Set();
  for (let i = 0; i < levels.length; i += 1) {
    for (let j = i + 1; j < levels.length; j += 1) {
      const a = levels[i], b = levels[j];
      if (units[a] === undefined || units[b] === undefined) continue;
      const expected = units[b] / units[a];
      if (!(expected > 0)) continue;
      const actual = anchors[b] / anchors[a];
      const off = actual > expected ? actual / expected : expected / actual;
      if (off > PRICE_BAND_MAX) { bad.add(a); bad.add(b); }
    }
  }
  if (bad.size === 0) return anchors;

  const kept = {};
  for (const level of levels) if (!bad.has(level)) kept[level] = anchors[level];
  return kept;
}

/** The packaging factors that separate one level from the next, above 1. */
function packagingSteps(packaging) {
  const perPack = num(packaging?.units_per_pack);
  const perCarton = num(packaging?.packs_per_carton);
  const steps = [];
  if (perPack > 1) steps.push(perPack);
  if (perCarton > 1) steps.push(perCarton);
  if (perPack > 0 && perCarton > 0 && perPack * perCarton > 1) steps.push(perPack * perCarton);
  return steps;
}

/**
 * Did this price edit RESCALE the line, rather than reprice it?
 *
 * Only ever used to drop a level that is now certainly wrong. It never picks
 * one, so the worst case is one extra question.
 *
 * The threshold is again a geometric midpoint — between "no level change" (1x)
 * and the smallest packaging step there is. For order #1197's 350-unit carton
 * that is sqrt(350) = 18.7x, and the actual edit moved the price 351x. A
 * customer-specific price that moved it 1.4x is nowhere near it.
 */
export function priceEditRescaled({ oldPrice, newPrice, packaging } = {}) {
  const a = num(oldPrice), b = num(newPrice);
  if (a === null || b === null || a <= 0 || b <= 0) return false;
  const ratio = b > a ? b / a : a / b;
  const steps = packagingSteps(packaging);
  const threshold = steps.length ? Math.sqrt(Math.min(...steps)) : RESCALE_RATIO_FLOOR;
  return ratio >= threshold;
}

/**
 * What to do with a line's level after its unit price was edited.
 *
 * ============================================================================
 * AN ORDINARY EDIT MUST NOT COST A CONFIRMED ANSWER
 * ============================================================================
 * The first fix for order #1197 cleared the level on every quantity or price
 * edit. That was safe and it was too blunt: typing a customer's price threw
 * away an answer that was still true, and asked for it again.
 *
 * The level survives an edit it is still consistent with, and only an edit it
 * cannot survive drops it:
 *
 *   keep  — the new price matches the level the line already has, or matches
 *           nothing and is too small a change to be a rescale
 *   set   — the new price unambiguously matches a DIFFERENT learned level, and
 *           the level being replaced was one this mechanism had filled in, not
 *           one the owner stated. This is order #1197 going right: ₪0.53 ->
 *           ₪186 moves the line from unit to carton by itself.
 *   ask   — the price says a different level, but the owner STATED the current
 *           one. Two things the owner said now disagree, and no code should
 *           pick the winner silently. One brief question settles it.
 *   clear — the price moved by a whole packaging factor, so the line was
 *           rescaled, but nothing says to what. Pending, and asked.
 *
 * THE QUANTITY IS NOT CONSULTED, and a quantity edit does not call this at all:
 * 1 -> 2 cartons is as ordinary as an edit gets, and no quantity has ever
 * implied a level.
 *
 * `currentSource` is what made the current level: "confirmed" means the owner
 * chose it on this line (the row selector, or the clarification dialog).
 * Anything else — "pattern", or nothing at all on a line that predates this —
 * is a default, and a default may be replaced without asking.
 *
 * @returns {{action: 'keep'|'set'|'ask'|'clear', level: string|null, reason: string}}
 */
export function levelForPriceEdit({
  currentLevel, currentSource, oldPrice, newPrice, pattern, packaging,
} = {}) {
  const held = SALE_LEVELS.includes(currentLevel) ? currentLevel : null;
  const confirmed = held && currentSource === "confirmed";
  const m = matchLevel({ unitPrice: newPrice, pattern, packaging });

  if (m.status === "unambiguous") {
    if (held === m.level) return { action: "keep", level: held, reason: "confirmed_by_pattern" };
    if (!held) return { action: "set", level: m.level, reason: "learned" };
    // AN EXPLICIT ANSWER IS NEVER OVERWRITTEN IN SILENCE.
    if (confirmed) return { action: "ask", level: null, reason: "contradicts_confirmed" };
    return { action: "set", level: m.level, reason: "relearned" };
  }

  if (!held) return { action: "keep", level: null, reason: "nothing_to_lose" };

  if (priceEditRescaled({ oldPrice, newPrice, packaging })) {
    // A rescale invalidates the level whoever set it: the old answer was about
    // different goods. Asked, not guessed.
    return { action: confirmed ? "ask" : "clear", level: null, reason: "rescaled" };
  }
  return { action: "keep", level: held, reason: "ordinary_price_edit" };
}

/**
 * The level for a line being ADDED, from what the product has taught us.
 *
 * This is the whole point of the feature: a product whose price is recognised
 * is not asked about. A product that is new, or priced unlike anything on
 * record, is asked about exactly as before.
 *
 * @returns {{level: string|null, source: 'pattern'|null, reason: string}}
 */
export function levelForNewLine({ unitPrice, pattern, packaging } = {}) {
  const m = matchLevel({ unitPrice, pattern, packaging });
  if (m.status === "unambiguous") {
    return { level: m.level, source: "pattern", reason: "matched_learned_price" };
  }
  return { level: null, source: null, reason: m.status };
}

/** A one-line explanation of a learned level, for the row's tooltip. */
export function patternHint(pattern, level) {
  const slot = pattern?.levels?.[level];
  if (!slot?.anchor) return null;
  const times = slot.n === 1 ? "פעם אחת" : `${slot.n} פעמים`;
  return `נלמד ממכירות קודמות: במחיר דומה (₪${slot.anchor.toFixed(2)}) נמכר כך ${times}`;
}

/**
 * WHAT THE UNVERIFIED RECORD SUGGESTS — to be SHOWN, never applied.
 *
 * ============================================================================
 * WHY THIS IS NOT PRE-SELECTED IN THE DIALOG
 * ============================================================================
 * It would be one less click, and it would make order #1197 self-perpetuating:
 * its label is exactly one of these, it is wrong, and an owner clicking
 * "אישור" past a pre-filled answer would confirm it into STRONG evidence —
 * promoting the original error to the status of verified fact.
 *
 * So it is offered as a sentence beside the question. The owner still chooses,
 * and the choice is informed rather than blind.
 *
 * Nothing is suggested when the unverified labels disagree with each other, or
 * when they contradict the product's packaging: a suggestion drawn from
 * self-contradictory records would be worse than silence.
 *
 * @returns {{level: string, price: number, n: number}|null}
 */
export function suggestLevel({ unitPrice, pattern, packaging } = {}) {
  const hints = pattern?.hints ?? {};
  let anchors = {};
  for (const level of SALE_LEVELS) {
    const a = hints[level]?.anchor;
    if (num(a) !== null && a > 0) anchors[level] = a;
  }
  anchors = consistentAnchors(anchors, packaging);

  const price = num(unitPrice);
  const keys = Object.keys(anchors);
  if (price === null || price <= 0 || keys.length === 0) return null;

  // The same two-tier test as a real match, so a suggestion is never offered
  // on evidence that would not have been good enough to act on had it been
  // verified. The only difference is what is done with the answer.
  const m = matchLevel({
    unitPrice: price,
    pattern: { levels: anchors && Object.fromEntries(keys.map(k => [k, { anchor: anchors[k] }])) },
    packaging,
  });
  if (m.status !== "unambiguous") return null;
  return { level: m.level, price: anchors[m.level], n: hints[m.level]?.n ?? 1 };
}
