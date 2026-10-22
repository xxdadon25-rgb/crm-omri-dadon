/**
 * Supplier quotation comparison — price, VAT and packaging arithmetic.
 *
 * PURE FUNCTIONS ONLY. No imports, no network, no database, no React. Every
 * rule that decides what a supplier's price actually IS lives here, so it can
 * be tested exhaustively without a browser or a server — and so there is one
 * place to look when a comparison disagrees with a paper document.
 *
 * TWO RULES GOVERN EVERYTHING BELOW
 *
 *   1. A figure printed on the document is a FACT. Quantities and line totals
 *      are copied, never recomputed to make arithmetic work. Only a derived
 *      figure (the unit price) may be corrected, and the correction is always
 *      reported rather than applied silently.
 *
 *   2. When the document does not say, the answer is "unknown" — never a
 *      plausible guess. An unknown VAT basis or an unparsed pack size blocks a
 *      price from being compared at all. An 18% error that looks reasonable on
 *      screen is far worse than a line the owner is asked about.
 */

/** Money tolerance, in shekels. Supplier documents round to the agora, so two
 *  figures within this are the same figure. */
const MONEY_EPSILON = 0.02;

/** Totals tolerance when deciding the VAT basis: the document's own stated
 *  total is rounded, and a long invoice accumulates a few agorot. */
const TOTALS_EPSILON = 0.05;

/** Above this relative gap, the lines do not add up to the document total and
 *  a line is probably MISSING — the independent truncation detector. */
const COMPLETENESS_TOLERANCE = 0.01;   // 1%

export const QUOTE_MATH_CONSTANTS = { MONEY_EPSILON, TOTALS_EPSILON, COMPLETENESS_TOLERANCE };

/** Lenient numeric parse: "" / null / undefined / "abc" -> null. Strips ₪ and
 *  thousands separators, which appear in extracted text often enough. */
export function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[₪,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Round to the agora. Half-up, matching how the documents themselves round. */
export function round2(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Reconcile one line's arithmetic: unit_price x quantity should equal the line
 * total.
 *
 * ONLY unit_price may be corrected. Quantity and total are facts printed on the
 * document — "fixing" either to satisfy the equation is how a real product
 * quietly becomes the wrong amount of stock. When quantity is missing or zero
 * there is nothing to divide by, so the stated unit price stands.
 *
 * Returns the price to use, whether it was corrected, and why — the caller
 * surfaces `adjusted` for review rather than hiding it.
 */
export function reconcileLinePrice({ quantity, unit_price, line_total } = {}) {
  const qty = toNumber(quantity);
  const stated = toNumber(unit_price);
  const total = toNumber(line_total);

  if (qty === null || qty <= 0 || total === null) {
    return { unit_price: stated, adjusted: false, reason: "insufficient_data" };
  }

  const derived = round2(total / qty);
  if (stated === null) {
    return { unit_price: derived, adjusted: true, reason: "derived_from_total" };
  }
  if (Math.abs(stated * qty - total) <= MONEY_EPSILON) {
    return { unit_price: stated, adjusted: false, reason: "consistent" };
  }
  return { unit_price: derived, adjusted: true, reason: "price_recomputed_from_total" };
}

/**
 * Cross-check a stated discount. NEVER corrects anything: a disagreement
 * between the printed list price, the printed discount and the printed net
 * price is something a human must look at, because any of the three could be
 * the mis-read one.
 */
export function checkDiscount({ list_price, discount_percent, discount_amount, unit_price } = {}) {
  const list = toNumber(list_price);
  const pct = toNumber(discount_percent);
  const amount = toNumber(discount_amount);
  const net = toNumber(unit_price);

  if (list === null || net === null || (pct === null && amount === null)) {
    return { ok: true, checked: false, expected: null };
  }

  const expected = pct !== null
    ? round2(list * (1 - pct / 100))
    : round2(list - amount);

  const ok = expected !== null && Math.abs(expected - net) <= MONEY_EPSILON;
  return { ok, checked: true, expected, stated: net };
}

/**
 * Decide whether the line prices on a document are pre-VAT or VAT-inclusive.
 *
 * This is the most consequential function in the file. Treat a gross price as
 * net and every comparison involving that supplier is ~18% wrong while looking
 * entirely normal. So the decision is made from the document's own totals, and
 * when they do not decide it, the answer is "unknown" and the line is excluded
 * from comparison until a human says which it is.
 *
 * Method:
 *   1. If net + vat = gross (within a rounding epsilon), the triangle is
 *      trustworthy and the rate is vat / net.
 *   2. Compare the SUM OF THE LINES against each total. Matching the net total
 *      means the lines are pre-VAT; matching the gross total means they carry
 *      VAT. Only one may match — if both do (a zero-VAT document) the basis is
 *      'excluded', since dividing by 1 + 0 changes nothing either way.
 *   3. Anything else is 'unknown'.
 */
export function resolveVatBasis({ amount_net, vat_amount, amount_gross, line_total_sum, default_vat_rate = null } = {}) {
  const net = toNumber(amount_net);
  const vat = toNumber(vat_amount);
  const gross = toNumber(amount_gross);
  const sum = toNumber(line_total_sum);

  let rate = null;
  let triangleOk = false;
  if (net !== null && vat !== null && gross !== null) {
    triangleOk = Math.abs(net + vat - gross) <= TOTALS_EPSILON;
  }
  if (net !== null && vat !== null && net > 0) {
    rate = round2((vat / net) * 100);
  } else if (net !== null && gross !== null && net > 0) {
    rate = round2(((gross - net) / net) * 100);
  }
  if (rate === null) rate = toNumber(default_vat_rate);

  if (sum === null) {
    return { basis: "unknown", vat_rate: rate, triangle_ok: triangleOk, reason: "no_line_sum" };
  }

  const matchesNet = net !== null && Math.abs(sum - net) <= Math.max(TOTALS_EPSILON, Math.abs(net) * 0.002);
  const matchesGross = gross !== null && Math.abs(sum - gross) <= Math.max(TOTALS_EPSILON, Math.abs(gross) * 0.002);

  // A zero-VAT document: both totals are the same number, and the distinction
  // is meaningless. 'excluded' is correct because the divisor would be 1.
  if (matchesNet && matchesGross) {
    return { basis: "excluded", vat_rate: rate ?? 0, triangle_ok: triangleOk, reason: "net_equals_gross" };
  }
  if (matchesNet) {
    return { basis: "excluded", vat_rate: rate, triangle_ok: triangleOk, reason: "lines_match_net_total" };
  }
  if (matchesGross) {
    return { basis: "included", vat_rate: rate, triangle_ok: triangleOk, reason: "lines_match_gross_total" };
  }
  return { basis: "unknown", vat_rate: rate, triangle_ok: triangleOk, reason: "lines_match_no_total" };
}

/**
 * The pre-VAT price for one pack.
 *
 * 'unknown' returns null ON PURPOSE. A null price is excluded from the
 * comparison views, which is exactly the intended behaviour: better a gap the
 * owner is asked to fill than a confident wrong number.
 */
export function priceBeforeVat({ unit_price, vat_basis, vat_rate } = {}) {
  const price = toNumber(unit_price);
  if (price === null) return null;
  if (vat_basis === "excluded") return round2(price);
  if (vat_basis === "included") {
    const rate = toNumber(vat_rate);
    if (rate === null || rate <= -100) return null;
    return round2(price / (1 + rate / 100));
  }
  return null;
}

// ── Packaging ───────────────────────────────────────────────────────────────
// Hebrew unit words, mapped to the four base units everything is compared in.
// A unit not listed here is NOT guessed — it comes back null and the line is
// flagged, because inventing a unit silently makes two different things look
// comparable.
const UNIT_WORDS = [
  // [pattern, base unit, multiplier to one base unit]
  [/^(ק"?ג|קג|קילו(גרם)?|kg)$/i, "kg", 1],
  [/^(גרם|גר'?|gr?|g)$/i, "kg", 0.001],
  [/^(טון|ton)$/i, "kg", 1000],
  [/^(ליטר|ל'?|lt?r?|l)$/i, "liter", 1],
  [/^(מ"?ל|מיליליטר|ml)$/i, "liter", 0.001],
  [/^(קוב|מ"?ק)$/i, "liter", 1000],
  [/^(מטר|מ'?|meter|m)$/i, "meter", 1],
  [/^(ס"?מ|סמ|cm)$/i, "meter", 0.01],
  [/^(יחידה|יח'?|יח"?י|unit|pcs?|ea)$/i, "unit", 1],
];

/** Container words that mean "a pack of N", carrying no unit of their own. */
const CONTAINER_WORDS = /^(ארגז|קרטון|חבילה|חב'?|שק|מארז|מגש|גליל|סלסלה|דלי|צרור|box|case|pack)$/i;

function matchUnitWord(word) {
  const w = String(word || "").trim().replace(/[.,:;]+$/, "");
  for (const [re, base, mult] of UNIT_WORDS) {
    if (re.test(w)) return { base, mult };
  }
  return null;
}

/**
 * Work out how many base units one purchasable pack contains.
 *
 * Handles the shapes that actually appear on Israeli supplier documents:
 *   "6x1.5 ליטר"        -> 9 liter
 *   "24 * 330 מ\"ל"     -> 7.92 liter
 *   "ארגז 12"           -> 12 unit
 *   "גליל 50 מ'"        -> 50 meter
 *   "500 גרם"           -> 0.5 kg
 *   "יחידה"             -> 1 unit
 *
 * `pack_size` and `unit` (the columns the extractor fills from the document's
 * own columns) take precedence over free text, because they were read from a
 * dedicated field rather than parsed out of a product name.
 *
 * Returns { base_unit, base_qty_per_pack, confident, source }. When the text
 * cannot be read confidently, base_unit is null — and a null base unit keeps
 * the line out of every comparison view by design.
 */
export function parsePackaging({ unit, pack_size, text } = {}) {
  const explicitQty = toNumber(pack_size);
  const explicitUnit = matchUnitWord(unit);

  // 1. Both fields present and understood: nothing to infer.
  if (explicitUnit && explicitQty !== null && explicitQty > 0) {
    return {
      base_unit: explicitUnit.base,
      base_qty_per_pack: round2(explicitQty * explicitUnit.mult) || explicitQty * explicitUnit.mult,
      confident: true,
      source: "columns",
    };
  }

  const raw = String(text ?? "").trim();

  // 2. "N x M <unit>" — a multipack. The multiplication is the whole point.
  const multi = raw.match(/(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*([^\d\s]+)?/);
  if (multi) {
    const a = toNumber(multi[1].replace(",", "."));
    const b = toNumber(multi[2].replace(",", "."));
    const u = multi[3] ? matchUnitWord(multi[3]) : null;
    if (a !== null && b !== null && a > 0 && b > 0) {
      if (u) return { base_unit: u.base, base_qty_per_pack: a * b * u.mult, confident: true, source: "multipack" };
      // No unit word: a count of countable things.
      return { base_unit: "unit", base_qty_per_pack: a * b, confident: true, source: "multipack_count" };
    }
  }

  // 3. "<number> <unit>" anywhere in the text.
  const numUnit = raw.match(/(\d+(?:[.,]\d+)?)\s*([^\d\s]+)/);
  if (numUnit) {
    const n = toNumber(numUnit[1].replace(",", "."));
    const u = matchUnitWord(numUnit[2]);
    if (n !== null && n > 0 && u) {
      return { base_unit: u.base, base_qty_per_pack: n * u.mult, confident: true, source: "number_unit" };
    }
  }

  // 4. "<container> <number>" — a box of twelve.
  const container = raw.match(/([^\d\s]+)\s*(\d+(?:[.,]\d+)?)/);
  if (container && CONTAINER_WORDS.test(container[1])) {
    const n = toNumber(container[2].replace(",", "."));
    if (n !== null && n > 0) {
      return { base_unit: "unit", base_qty_per_pack: n, confident: true, source: "container_count" };
    }
  }

  // 5. A bare unit word means one of it.
  const bare = matchUnitWord(raw) || explicitUnit;
  if (bare) {
    return { base_unit: bare.base, base_qty_per_pack: bare.mult, confident: true, source: "bare_unit" };
  }

  // 6. A number with no unit at all: countable, but say so with low confidence.
  if (explicitQty !== null && explicitQty > 0) {
    return { base_unit: "unit", base_qty_per_pack: explicitQty, confident: false, source: "qty_without_unit" };
  }

  // Unknown. Deliberately NOT a default of "1 unit".
  return { base_unit: null, base_qty_per_pack: null, confident: false, source: "unparsed" };
}

/** Price per ONE base unit — the only figure suppliers may be ranked by. Must
 *  agree with the database's generated `comparable_price` column. */
export function comparablePrice({ price_before_vat, base_qty_per_pack } = {}) {
  const price = toNumber(price_before_vat);
  const qty = toNumber(base_qty_per_pack);
  if (price === null || qty === null || qty <= 0) return null;
  return price / qty;
}

/** Two offers may be compared only in the same base unit. Called before any
 *  ranking; a null unit on either side is never comparable. */
export function unitsAreComparable(a, b) {
  if (!a || !b) return false;
  return a === b;
}

/**
 * Do the lines add up to the document's own total?
 *
 * An independent check that no line was lost — it does not rely on the
 * extractor noticing that it truncated. A gap beyond 1% means the document is
 * probably missing a product, which is the single most dangerous silent
 * failure in this whole feature.
 */
export function documentCompleteness({ line_total_sum, amount_net, amount_gross, vat_basis } = {}) {
  const sum = toNumber(line_total_sum);
  const expected = vat_basis === "included" ? toNumber(amount_gross) : toNumber(amount_net);
  if (sum === null || expected === null || expected === 0) {
    return { ok: true, checked: false, gap: null, gap_ratio: null };
  }
  const gap = round2(sum - expected);
  const ratio = Math.abs(gap) / Math.abs(expected);
  return { ok: ratio <= COMPLETENESS_TOLERANCE, checked: true, gap, gap_ratio: ratio };
}

/**
 * Every reason this line is not yet usable. The same list the
 * supplier_quote_items_needing_review_v view produces, so the screen and the
 * database agree about what "needs review" means.
 */
export function reviewFlags({ item = {}, quote = {} } = {}) {
  const flags = [];
  if (item.match_status !== "approved") flags.push("match_not_approved");
  if (!item.product_id) flags.push("no_canonical_product");
  if (!item.supplier_sku || !String(item.supplier_sku).trim()) flags.push("sku_missing");
  if (!item.base_unit || toNumber(item.base_qty_per_pack) === null) flags.push("packaging_unknown");
  if (quote.vat_basis !== "excluded" && quote.vat_basis !== "included") flags.push("vat_basis_unknown");
  if (item.confidence === "low") flags.push("low_confidence");
  if (toNumber(item.price_before_vat) === null) flags.push("price_missing");
  return flags;
}

/** Is this line eligible for price selection? Must mirror the WHERE clause of
 *  supplier_quote_price_candidates_v exactly. */
export function isSelectable({ item = {}, quote = {} } = {}) {
  return (
    item.match_status === "approved" &&
    !!item.product_id &&
    !!item.base_unit &&
    comparablePrice(item) !== null &&
    (quote.vat_basis === "excluded" || quote.vat_basis === "included")
  );
}

/**
 * The SKU to print on a purchasing list, and whether it may be trusted.
 *
 * Returns the SKU of the SELECTED line and nothing else. There is no fallback
 * to another line, another pack size or the mapping table's own value: a code
 * from a different packaging variant is a wrong code, and wrong is worse than
 * absent. A missing or mismatched SKU is reported as needing verification and
 * is never substituted.
 */
export function purchaseListSku({ selected = {}, approvedMatch = null } = {}) {
  const sku = selected.supplier_sku == null ? "" : String(selected.supplier_sku).trim();
  if (!sku) return { sku: null, status: "needs_verification", reason: "sku_missing" };

  if (!approvedMatch) return { sku, status: "needs_verification", reason: "no_approved_mapping" };

  const mapped = approvedMatch.supplier_sku == null ? "" : String(approvedMatch.supplier_sku).trim();
  // Case-sensitive: '0012b' and '0012B' are different codes in a supplier
  // catalogue, and leading zeros are significant.
  if (mapped !== sku) return { sku, status: "needs_verification", reason: "mapping_sku_mismatch" };

  if (approvedMatch.status !== "approved") {
    return { sku, status: "needs_verification", reason: "mapping_not_approved" };
  }
  // The mapping must describe the SAME packaging as the selected line.
  if (approvedMatch.base_unit && selected.base_unit && approvedMatch.base_unit !== selected.base_unit) {
    return { sku, status: "needs_verification", reason: "mapping_unit_mismatch" };
  }
  const mq = toNumber(approvedMatch.base_qty_per_pack);
  const sq = toNumber(selected.base_qty_per_pack);
  if (mq !== null && sq !== null && Math.abs(mq - sq) > 1e-9) {
    return { sku, status: "needs_verification", reason: "mapping_pack_size_mismatch" };
  }
  return { sku, status: "confirmed", reason: null };
}

/**
 * May a remembered match be applied to a newly extracted line without asking?
 *
 * Deliberately narrow. Identical names are NOT enough: the same description
 * with a different size, brand or pack is a different product, and
 * auto-approving it would put the wrong price against the wrong goods. Only an
 * exact SKU plus identical packaging qualifies.
 */
export function canAutoApplyMatch({ line = {}, match = null } = {}) {
  if (!match || match.status !== "approved" || !match.product_id) {
    return { apply: false, reason: "no_approved_match" };
  }
  const lineSku = line.supplier_sku == null ? "" : String(line.supplier_sku).trim();
  const matchSku = match.supplier_sku == null ? "" : String(match.supplier_sku).trim();
  if (!lineSku || !matchSku) return { apply: false, reason: "sku_missing" };
  if (lineSku !== matchSku) return { apply: false, reason: "sku_mismatch" };

  if (!line.base_unit || !match.base_unit || line.base_unit !== match.base_unit) {
    return { apply: false, reason: "unit_mismatch" };
  }
  const lq = toNumber(line.base_qty_per_pack);
  const mq = toNumber(match.base_qty_per_pack);
  if (lq === null || mq === null || Math.abs(lq - mq) > 1e-9) {
    return { apply: false, reason: "pack_size_mismatch" };
  }
  return { apply: true, reason: null };
}

/**
 * Which price applies, override or historical low. Mirrors
 * supplier_product_selected_price_v so the UI can compute the same answer
 * without a round trip — and so a disagreement between the two is a test
 * failure rather than a production surprise.
 */
export function selectPrice({ lowest = null, override = null, today = null } = {}) {
  const active = override && !override.removed_at ? override : null;
  const low = lowest && toNumber(lowest.price_before_vat) !== null ? lowest : null;

  if (!active && !low) return null;

  const base = {
    price_source: active ? "manual_override" : "historical_low",
    price_before_vat: toNumber(active ? active.price_before_vat : low.price_before_vat),
    historical_low_price: low ? toNumber(low.price_before_vat) : null,
    // Provenance is carried even when an override wins, so the screen can
    // always show what the documents actually said.
    supplier_sku: low ? low.supplier_sku ?? null : null,
    base_unit: (active && active.base_unit) || (low && low.base_unit) || null,
    base_qty_per_pack: low ? toNumber(low.base_qty_per_pack) : null,
    supplier_quote_id: low ? low.supplier_quote_id ?? null : null,
    document_number: low ? low.document_number ?? null : null,
    quote_date: low ? low.quote_date ?? null : null,
    valid_until: low ? low.valid_until ?? null : null,
    override_id: active ? active.id ?? null : null,
    override_by: active ? active.created_by ?? null : null,
    override_at: active ? active.created_at ?? null : null,
  };

  const ref = today ? new Date(today) : new Date();
  base.quote_expired = !!(low?.valid_until && new Date(low.valid_until) < ref);
  base.price_age_days = low?.quote_date
    ? Math.max(0, Math.round((ref - new Date(low.quote_date)) / 86400000))
    : null;
  return base;
}
