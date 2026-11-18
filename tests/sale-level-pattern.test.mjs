// Does the system learn what a product's prices mean, and refuse to learn the
// wrong thing?
//
// HOW TO RUN
//   node tests/sale-level-pattern.test.mjs
//
// The module under test is pure, so it is bundled with esbuild (only to
// resolve the "@/" alias) and exercised directly. No database, no network, no
// production data.
//
// WHAT IT PROVES
//   1. ORDER #1197, both halves of it: the line saved as 350 units at ₪0.53
//      and edited to 1 at ₪186 ends up as a CARTON, costing ₪100 for a profit
//      of ₪86 and a 46.24% margin — and does so without anyone being asked,
//      because ₪186 has meant a carton for that product before.
//   2. Mixed unit/carton selling of the SAME product, in both of the
//      conventions this business uses (a carton as quantity 1, and a carton as
//      its 350 individual units).
//   3. An ordinary price edit — a customer-specific price — never costs a
//      confirmed level.
//   4. Bad evidence, including #1197's own mislabelled saved line, produces NO
//      anchor rather than a wrong one.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(mkdtempSync(join(tmpdir(), "slp-")), "bundle.mjs");
const entry = join(dirname(out), "entry.mjs");
writeFileSync(entry, `
  export * from "${resolve(REPO, "src/lib/saleLevelPattern.js")}";
  export { lineProfit } from "${resolve(REPO, "src/lib/packagingMath.js")}";
  export { documentProfit } from "${resolve(REPO, "src/lib/documentProfit.js")}";
`);
await build({
  entryPoints: [entry], outfile: out, bundle: true, format: "esm", platform: "node",
  alias: { "@": resolve(REPO, "src") },
});
const M = await import(out);

let pass = 0, fail = 0;
const check = (n, c, d = "") => {
  c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  ${d}`));
};
const near = (a, b, eps = 0.005) => a !== null && Math.abs(a - b) < eps;

// ============================================================================
// The product from order #1197, as production actually holds it.
// ============================================================================
const PK = { units_per_pack: 350, packs_per_carton: 1 };
const P = "prod-1197";
/**
 * A line the OWNER CONFIRMED, which is what a strong anchor requires. The
 * `sale_level_source` field is what distinguishes it from the unverified
 * labels that are all production currently holds — section 15 covers those.
 */
const line = (o) => {
  const out = {
    product_id: P, name: "מוצר 1197", buy_price: 100, packaging: PK,
    buy_level: "carton", discount: 0, ...o,
  };
  if (out.sale_level && !("sale_level_source" in o)) out.sale_level_source = "confirmed";
  return out;
};
/** The same line as production actually holds it: labelled, with no provenance. */
const legacy = (o) => {
  const out = line(o);
  delete out.sale_level_source;
  return out;
};
/** A saved order, as orders rows look. */
const order = (date, items, status = "הושלם") => ({ id: date, date, status, items });

console.log("\n1. WHAT THE HISTORY TEACHES");
{
  // Three honest past orders: two sold by the unit, one by the carton.
  const history = [
    order("2026-10-02", [line({ quantity: 350, unit_price: 0.53, sale_level: "unit" })]),
    order("2026-09-15", [line({ quantity: 700, unit_price: 0.52, sale_level: "unit" })]),
    order("2026-08-01", [line({ quantity: 2, unit_price: 186, sale_level: "carton" })]),
  ];
  const pat = M.learnPatterns(history).get(P);
  check("a pattern was learned for the product", !!pat);
  check("three confirmations", pat.confirmations === 3, `${pat.confirmations}`);
  check("the unit anchor is the unit price", near(pat.levels.unit.anchor, 0.525),
    `${pat.levels.unit.anchor}`);
  check("the carton anchor is the carton price", near(pat.levels.carton.anchor, 186),
    `${pat.levels.carton.anchor}`);
  check("no pack was ever confirmed, so no pack anchor", !pat.levels.pack);

  // The two prices are 350x apart, so each band is capped at 2.5x and they
  // cannot overlap.
  check("₪186 means a carton", M.matchLevel({ unitPrice: 186, pattern: pat }).level === "carton");
  check("₪0.53 means a unit", M.matchLevel({ unitPrice: 0.53, pattern: pat }).level === "unit");
  check("and each is unambiguous",
    M.matchLevel({ unitPrice: 186, pattern: pat }).status === "unambiguous"
    && M.matchLevel({ unitPrice: 0.53, pattern: pat }).status === "unambiguous");

  // Customer-specific prices, which must not move the level.
  for (const [p, lvl] of [[172, "carton"], [199, "carton"], [0.48, "unit"], [0.62, "unit"]]) {
    const m = M.matchLevel({ unitPrice: p, pattern: pat });
    check(`a customer price of ₪${p} is still a ${lvl}`, m.level === lvl, `${m.level}/${m.status}`);
  }
  // A price near nothing known is NOT forced into the closest band.
  for (const p of [12, 40, 0.01, 900]) {
    const m = M.matchLevel({ unitPrice: p, pattern: pat });
    check(`₪${p} matches nothing learned, so it is asked about`, m.status === "unknown",
      `${m.status}/${m.level}`);
  }
  check("an empty pattern asks", M.matchLevel({ unitPrice: 186, pattern: M.emptyPattern() }).status === "unknown");
  check("a missing price asks", M.matchLevel({ unitPrice: 0, pattern: pat }).status === "unknown");
}

console.log("\n2. REGRESSION — order #1197 edited from 350 units to 1 carton");
{
  const history = [
    order("2026-10-02", [line({ quantity: 350, unit_price: 0.53, sale_level: "unit" })]),
    order("2026-09-15", [line({ quantity: 700, unit_price: 0.52, sale_level: "unit" })]),
    order("2026-08-01", [line({ quantity: 2, unit_price: 186, sale_level: "carton" })]),
  ];
  const pat = M.learnPatterns(history).get(P);

  // THE LINE AS SAVED, WRONG: 1 x 186 still labelled "unit".
  const broken = line({ quantity: 1, unit_price: 186, total: 186, sale_level: "unit" });
  const before = M.documentProfit([broken]);
  check("the bug: the stale level costs ₪0.29", near(before.totalCostNet, 0.29),
    `${before.totalCostNet}`);
  check("the bug: and shows a 99.8% margin", near(before.profitMargin, 99.8, 0.1),
    `${before.profitMargin}`);

  // THE EDIT: the price goes from 0.53 to 186. The level follows, by itself.
  const decided = M.levelForPriceEdit({
    currentLevel: "unit", oldPrice: 0.53, newPrice: 186, pattern: pat, packaging: PK,
  });
  check("the price edit SETS the level", decided.action === "set", decided.action);
  check("to carton", decided.level === "carton", `${decided.level}`);
  check("because it was relearned, not guessed", decided.reason === "relearned", decided.reason);

  const fixed = line({ quantity: 1, unit_price: 186, total: 186, sale_level: decided.level });
  const after = M.documentProfit([fixed]);
  check("cost is ₪100 — the whole carton", near(after.totalCostNet, 100), `${after.totalCostNet}`);
  check("profit is ₪86", near(after.totalProfit, 86), `${after.totalProfit}`);
  check("margin is 46.24% of the sale", near(after.profitMargin, 46.24, 0.01),
    `${after.profitMargin}`);
  check("and nothing is pending", after.pendingLines === 0 && after.ok);

  // The same edit with NOTHING learned: the level is dropped, not guessed.
  const blind = M.levelForPriceEdit({
    currentLevel: "unit", oldPrice: 0.53, newPrice: 186,
    pattern: M.emptyPattern(), packaging: PK,
  });
  check("with no history the edit CLEARS the level", blind.action === "clear", blind.action);
  check("as a rescale, and asks", blind.reason === "rescaled" && blind.level === null);
  const pend = M.documentProfit([line({ quantity: 1, unit_price: 186, total: 186, sale_level: null })]);
  check("so the popup withholds the percentage", pend.profitMargin === null);
  check("and says one line is pending", pend.pendingLines === 1);
}

console.log("\n3. ORDINARY EDITS KEEP A CONFIRMED LEVEL");
{
  const pat = M.learnPatterns([
    order("2026-10-02", [line({ quantity: 350, unit_price: 0.53, sale_level: "unit" })]),
    order("2026-09-15", [line({ quantity: 700, unit_price: 0.52, sale_level: "unit" })]),
    order("2026-08-01", [line({ quantity: 2, unit_price: 186, sale_level: "carton" })]),
  ]).get(P);

  for (const [from, to, lvl] of [[186, 172, "carton"], [186, 199, "carton"], [0.53, 0.49, "unit"]]) {
    const d = M.levelForPriceEdit({
      currentLevel: lvl, oldPrice: from, newPrice: to, pattern: pat, packaging: PK,
    });
    check(`₪${from} -> ₪${to} keeps ${lvl}`, d.action === "keep" && d.level === lvl,
      `${d.action}/${d.level}`);
    check(`  and says the pattern confirmed it`, d.reason === "confirmed_by_pattern", d.reason);
  }

  // ₪120 is well inside the carton band (186 / 120 = 1.55), so the pattern
  // actively confirms it rather than merely tolerating it.
  const c = M.levelForPriceEdit({
    currentLevel: "carton", oldPrice: 186, newPrice: 120, pattern: pat, packaging: PK,
  });
  check("a 1.55x price cut is still recognised as a carton",
    c.action === "keep" && c.reason === "confirmed_by_pattern", `${c.action}/${c.reason}`);

  // ₪40 is outside every band (4.6x from the carton anchor, 76x from the unit
  // one), but 4.6x is far short of this product's 18.7x rescale threshold. The
  // level is the owner's answer and nothing contradicts it, so it stands.
  const d = M.levelForPriceEdit({
    currentLevel: "carton", oldPrice: 186, newPrice: 40, pattern: pat, packaging: PK,
  });
  check("an unrecognised but modest price keeps the level",
    d.action === "keep" && d.level === "carton", `${d.action}/${d.level}`);
  check("  as an ordinary price edit", d.reason === "ordinary_price_edit", d.reason);

  // With no pattern at all, an ordinary edit still must not cost the answer.
  const e = M.levelForPriceEdit({
    currentLevel: "carton", oldPrice: 186, newPrice: 172,
    pattern: M.emptyPattern(), packaging: PK,
  });
  check("and that holds with nothing learned at all",
    e.action === "keep" && e.level === "carton", `${e.action}/${e.level}`);
}

console.log("\n4. WHAT COUNTS AS A RESCALE");
{
  // The threshold is the geometric midpoint to the smallest packaging step.
  check("a 351x price jump on a 350-unit carton is a rescale",
    M.priceEditRescaled({ oldPrice: 0.53, newPrice: 186, packaging: PK }));
  check("a 1.08x change is not",
    !M.priceEditRescaled({ oldPrice: 186, newPrice: 172, packaging: PK }));
  check("nor is a 2x change on that product",
    !M.priceEditRescaled({ oldPrice: 186, newPrice: 372, packaging: PK }));

  // A product with a small pack: the threshold scales down with it.
  const small = { units_per_pack: 6, packs_per_carton: 4 };
  check("a 6x jump on a 6-unit pack is a rescale",
    M.priceEditRescaled({ oldPrice: 10, newPrice: 60, packaging: small }));
  check("a 1.5x change is not",
    !M.priceEditRescaled({ oldPrice: 10, newPrice: 15, packaging: small }));

  // No packaging known at all: the declared floor applies.
  check("with no packaging, a 4x jump is a rescale",
    M.priceEditRescaled({ oldPrice: 10, newPrice: 40, packaging: null }));
  check("and a 3x one is not",
    !M.priceEditRescaled({ oldPrice: 10, newPrice: 30, packaging: null }));
  check("a missing price is never a rescale",
    !M.priceEditRescaled({ oldPrice: 0, newPrice: 186, packaging: PK })
    && !M.priceEditRescaled({ oldPrice: 186, newPrice: null, packaging: PK }));
}

console.log("\n5. MIXED unit/carton SELLING OF THE SAME PRODUCT");
{
  // Both conventions in the history at once: a carton entered as 1, and the
  // same carton entered as its 350 individual units.
  const history = [
    order("2026-10-10", [line({ quantity: 1, unit_price: 186, sale_level: "carton" })]),
    order("2026-10-09", [line({ quantity: 350, unit_price: 0.53, sale_level: "unit" })]),
    order("2026-10-08", [line({ quantity: 3, unit_price: 184, sale_level: "carton" })]),
    order("2026-10-07", [line({ quantity: 120, unit_price: 0.55, sale_level: "unit" })]),
  ];
  const pat = M.learnPatterns(history).get(P);
  check("both levels are learned side by side",
    !!pat.levels.unit?.anchor && !!pat.levels.carton?.anchor);

  // A new order of each kind, added with no level: both are recognised.
  const byCarton = M.levelForNewLine({ unitPrice: 186, pattern: pat });
  const byUnit = M.levelForNewLine({ unitPrice: 0.54, pattern: pat });
  check("1 x ₪186 is recognised as a carton", byCarton.level === "carton");
  check("350 x ₪0.54 is recognised as units", byUnit.level === "unit");
  check("both are marked as coming from the pattern",
    byCarton.source === "pattern" && byUnit.source === "pattern");

  // And both cost correctly: 350 units must cost the same as one carton.
  const asCarton = M.documentProfit([
    line({ quantity: 1, unit_price: 186, total: 186, sale_level: "carton" }),
  ]);
  const asUnits = M.documentProfit([
    line({ quantity: 350, unit_price: 0.53, total: 185.5, sale_level: "unit" }),
  ]);
  check("one carton costs ₪100", near(asCarton.totalCostNet, 100), `${asCarton.totalCostNet}`);
  check("and its 350 units cost ₪100 too", near(asUnits.totalCostNet, 100),
    `${asUnits.totalCostNet}`);
  check("so the two conventions give the same margin",
    Math.abs(asCarton.profitMargin - asUnits.profitMargin) < 0.3,
    `${asCarton.profitMargin} vs ${asUnits.profitMargin}`);

  // A MIXED order: both lines in one document, each costed at its own level.
  const mixed = M.documentProfit([
    line({ quantity: 2, unit_price: 186, total: 372, sale_level: "carton" }),
    line({ quantity: 50, unit_price: 0.60, total: 30, sale_level: "unit" }),
  ]);
  check("a mixed order costs 2 cartons + 50 units = ₪214.29",
    near(mixed.totalCostNet, 214.29), `${mixed.totalCostNet}`);
  check("revenue is ₪402", near(mixed.totalSalesNet, 402), `${mixed.totalSalesNet}`);
  check("profit is ₪187.71", near(mixed.totalProfit, 187.71), `${mixed.totalProfit}`);
  check("and the margin is shown", mixed.ok && mixed.profitMargin !== null);
}

console.log("\n6. DIFFERENT PRODUCTS, DIFFERENT CONVENTIONS");
{
  const A = "prod-a", B = "prod-b";
  const history = [
    order("2026-10-05", [
      // A is sold by the carton at ~₪48.
      { product_id: A, quantity: 1, unit_price: 48, sale_level: "carton", sale_level_source: "confirmed" },
      // B is sold by the pack at ~₪48 as well — the same NUMBER, a different
      // level, on a different product. Patterns are per product, so these
      // cannot contaminate each other.
      { product_id: B, quantity: 10, unit_price: 48, sale_level: "pack", sale_level_source: "confirmed" },
    ]),
    order("2026-10-04", [
      { product_id: A, quantity: 2, unit_price: 47, sale_level: "carton", sale_level_source: "confirmed" },
      { product_id: B, quantity: 4, unit_price: 49, sale_level: "pack", sale_level_source: "confirmed" },
    ]),
  ];
  const pats = M.learnPatterns(history);
  check("₪48 is a carton for product A",
    M.matchLevel({ unitPrice: 48, pattern: pats.get(A) }).level === "carton");
  check("and a pack for product B",
    M.matchLevel({ unitPrice: 48, pattern: pats.get(B) }).level === "pack");
  check("A learned no pack level", !pats.get(A).levels.pack);
  check("B learned no carton level", !pats.get(B).levels.carton);
}

console.log("\n7. WHAT IS REFUSED, AND WHY");
{
  // #1197's OWN saved line, read back as evidence. ₪186 labelled "unit"
  // against the product's genuine ₪0.53 unit price.
  const poisoned = M.learnPatterns([
    order("2026-11-18", [line({ quantity: 1, unit_price: 186, sale_level: "unit" })]),
    order("2026-10-02", [line({ quantity: 350, unit_price: 0.53, sale_level: "unit" })]),
    order("2026-09-15", [line({ quantity: 700, unit_price: 0.52, sale_level: "unit" })]),
  ]).get(P);
  check("the mislabelled ₪186 does NOT become the unit anchor",
    near(poisoned.levels.unit.anchor, 0.525), `${poisoned.levels.unit.anchor}`);
  check("so ₪186 is not learned as a unit",
    M.matchLevel({ unitPrice: 186, pattern: poisoned }).level !== "unit",
    `${M.matchLevel({ unitPrice: 186, pattern: poisoned }).level}`);

  // Two confirmations that flatly disagree, with no majority either way.
  const split = M.learnPatterns([
    order("2026-11-18", [line({ quantity: 1, unit_price: 186, sale_level: "unit" })]),
    order("2026-10-02", [line({ quantity: 350, unit_price: 0.53, sale_level: "unit" })]),
  ]).get(P);
  check("a tie teaches nothing", split.levels.unit.anchor === null,
    `${split.levels.unit.anchor}`);
  check("so the owner is asked", M.matchLevel({ unitPrice: 186, pattern: split }).status === "unknown");

  // A CANCELLED order is not evidence: it was withdrawn in full.
  check("a cancelled order teaches nothing",
    !M.learnPatterns([
      order("2026-11-01", [line({ quantity: 1, unit_price: 186, sale_level: "carton" })], "בוטל"),
    ]).get(P));
  // An UNAPPROVED or draft order IS. The level is a statement about what a
  // price refers to, and that is as true before approval as after — and in
  // production every labelled line there is sits in an unapproved order.
  for (const status of ["ממתין לאישור", "טיוטה", "אושר", "בהכנה", "הושלם"]) {
    check(`status "${status}" is eligible evidence`,
      M.learnPatterns([
        order("2026-11-02", [line({ quantity: 1, unit_price: 186, sale_level: "carton" })], status),
      ]).get(P)?.levels.carton.anchor === 186);
  }

  // Legacy lines with no level, and lines with no price.
  const legacy = M.learnPatterns([
    order("2026-10-01", [line({ quantity: 350, unit_price: 0.53 })]),
    order("2026-10-02", [line({ quantity: 1, unit_price: 0, sale_level: "carton" })]),
    order("2026-10-03", [{ quantity: 1, unit_price: 186, sale_level: "carton" }]),
  ]);
  check("a line with no level teaches nothing", !legacy.get(P));
  check("a line with no product id teaches nothing", legacy.size === 0);

  // An invalid level string is not one of the three.
  const bogus = M.learnPatterns([
    order("2026-10-01", [line({ quantity: 1, unit_price: 186, sale_level: "box" })]),
  ]);
  check("an unknown level string is ignored", !bogus.get(P));
}

console.log("\n8. IN-DOCUMENT LEARNING, AND NO SELF-REINFORCEMENT");
{
  const confirmed = [
    { product_id: P, quantity: 1, unit_price: 186, sale_level: "carton", sale_level_source: "confirmed" },
  ];
  const guessed = [
    { product_id: P, quantity: 1, unit_price: 186, sale_level: "carton", sale_level_source: "pattern" },
  ];
  check("an answer in the current document teaches immediately",
    M.learnFromLines(confirmed).get(P)?.levels.carton.anchor === 186);
  check("a level this mechanism filled in teaches nothing",
    !M.learnFromLines(guessed).get(P));
  check("and is excluded by DEFAULT, in saved history as much as here",
    !M.learnFromLines(guessed).get(P));
  check("and there is no option to count it",
    !M.learnFromLines(guessed, { excludePatternSource: false }).get(P));

  // Merging: the document's own answer joins the history.
  const merged = M.mergePatterns(
    M.learnPatterns([order("2026-10-02", [line({ quantity: 350, unit_price: 0.53, sale_level: "unit" })])]),
    M.learnFromLines(confirmed),
  );
  const pat = merged.get(P);
  check("the merged pattern knows both levels",
    near(pat.levels.unit.anchor, 0.53) && near(pat.levels.carton.anchor, 186));
  check("and counts both confirmations", pat.confirmations === 2, `${pat.confirmations}`);
  check("merging with nothing is a no-op",
    M.mergePatterns(merged, new Map()).get(P).confirmations === 2);
  check("merging into an empty map keeps the other side",
    M.mergePatterns(new Map(), merged).get(P).confirmations === 2);
}

console.log("\n9. THE BANDS CANNOT OVERLAP");
{
  // Two anchors closer together than PRICE_BAND_MAX squared: the bands must
  // stop at the midpoint rather than both claiming the middle.
  // Anchors only 3x apart: closer than PRICE_BAND_MAX^2, so the WIDE band is
  // refused outright and only a near-exact price decides. See section 11.
  const tight = { levels: { unit: { anchor: 10 }, pack: { anchor: 30 } }, confirmations: 2 };
  const mid = Math.sqrt(10 * 30);                   // 17.32
  for (const p of [mid, mid * 0.98, mid * 1.02]) {
    check(`₪${p.toFixed(2)} between two close anchors picks neither`,
      M.matchLevel({ unitPrice: p, pattern: tight }).level === null,
      `${M.matchLevel({ unitPrice: p, pattern: tight }).level}`);
  }
  check("and the anchor price itself decides nothing either, at 3x apart",
    M.matchLevel({ unitPrice: 30, pattern: tight }).level === null);
  check("a product priced that close is asked about, not guessed",
    M.matchLevel({ unitPrice: 30, pattern: tight }).status === "ambiguous");

  // No price anywhere can ever match two levels, for any pair of anchors.
  let overlaps = 0, matched = 0;
  for (const a of [0.1, 0.53, 3, 10, 48, 186, 1200]) {
    for (const b of [0.2, 1.1, 7, 24, 96, 350, 5000]) {
      const pattern = { levels: { unit: { anchor: a }, carton: { anchor: b } }, confirmations: 2 };
      for (let p = a / 10; p < b * 10; p *= 1.03) {
        const m = M.matchLevel({ unitPrice: p, pattern });
        if (m.candidates.length > 1) overlaps += 1;
        if (m.status === "unambiguous") matched += 1;
      }
    }
  }
  check("no price matched two levels across 49 anchor pairs", overlaps === 0, `${overlaps}`);
  check("and the bands did match plenty of prices", matched > 1000, `${matched}`);
}

console.log("\n10. PACKAGING AND buy_price_level ARE NOT TOUCHED");
{
  // A learned level is useless on its own: the cost still needs the product's
  // packaging and purchase level, and still reports pending without them.
  const pat = M.learnPatterns([
    order("2026-10-01", [line({ quantity: 1, unit_price: 186, sale_level: "carton" })]),
  ]).get(P);
  check("the level is matched", M.matchLevel({ unitPrice: 186, pattern: pat }).level === "carton");

  const noBuyLevel = M.lineProfit({
    unitPrice: 186, quantity: 1, buyPrice: 100, packaging: PK,
    saleLevel: "carton", buyLevel: null,
  });
  check("but with no purchase level there is still no margin",
    !noBuyLevel.ok && noBuyLevel.pending === "no_buy_level", noBuyLevel.pending);

  const noPackaging = M.lineProfit({
    unitPrice: 186, quantity: 1, buyPrice: 100, packaging: null,
    saleLevel: "carton", buyLevel: "carton",
  });
  check("and with no packaging there is still no margin",
    !noPackaging.ok && noPackaging.pending === "no_packaging", noPackaging.pending);

  // Nothing in a pattern names a packaging field.
  check("a pattern carries no packaging data",
    !JSON.stringify(pat).includes("units_per_pack")
    && !JSON.stringify(pat).includes("buy_price_level"));
}


// ============================================================================
// THE PRE-DEPLOYMENT AUDIT. Each of these reproduces a way the first version
// of this feature could have produced a confident wrong level.
// ============================================================================
console.log("\n11. AUDIT — a customer-specific price must not cross into the next level");
{
  // Measured on the first version: a 2-pack misread a 30% discount, a 3-pack a
  // 45% one, a 6-pack a 60% one, a 12-pack an 80% one.
  for (const [factor, label] of [[2, "2-pack"], [3, "3-pack"], [6, "6-pack"], [12, "12-pack"],
                                 [24, "24-carton"], [350, "350-carton"]]) {
    const pat = {
      levels: { unit: { anchor: 10 }, pack: { anchor: 10 * factor } }, confirmations: 4,
    };
    // THE DOCUMENTED BOUND: no discount up to 60% off a learned price is ever
    // read as the neighbouring level, at any separation.
    const wrong = [];
    for (let d = 0; d <= 60; d += 5) {
      const m = M.matchLevel({ unitPrice: 10 * factor * (1 - d / 100), pattern: pat });
      if (m.level && m.level !== "pack") wrong.push(`${d}%`);
    }
    check(`${label}: no discount up to 60% is read as the neighbouring level`,
      wrong.length === 0, wrong.join(","));
  }
  // A markup, the other way.
  for (const factor of [2, 3, 6, 12, 350]) {
    const pat = { levels: { unit: { anchor: 10 }, pack: { anchor: 10 * factor } }, confirmations: 4 };
    const wrong = [];
    for (let up = 0; up <= 60; up += 10) {
      const m = M.matchLevel({ unitPrice: 10 * (1 + up / 100), pattern: pat });
      if (m.level && m.level !== "unit") wrong.push(`+${up}%`);
    }
    check(`sep=${factor}x: no markup up to 60% on a unit price is read as a pack`,
      wrong.length === 0, wrong.join(","));
  }
  // Exhaustive: across every separation and every price, nothing is ever
  // matched to a level whose anchor is not the nearest one.
  let misordered = 0, decided = 0;
  for (const sep of [1.5, 2, 2.6, 3, 6, 6.25, 7, 12, 24, 100, 350]) {
    const pat = { levels: { unit: { anchor: 10 }, pack: { anchor: 10 * sep } }, confirmations: 4 };
    for (let p = 0.5; p < 10 * sep * 5; p *= 1.02) {
      const m = M.matchLevel({ unitPrice: p, pattern: pat });
      if (!m.level) continue;
      decided += 1;
      const nearer = Math.abs(Math.log(p / 10)) <= Math.abs(Math.log(p / (10 * sep)))
        ? "unit" : "pack";
      if (m.level !== nearer) misordered += 1;
    }
  }
  check("no price is ever matched to the further anchor", misordered === 0, `${misordered}`);
  check("and prices still are decided", decided > 300, `${decided}`);

  // What the guard costs: close levels are asked about instead of guessed.
  const close = { levels: { unit: { anchor: 10 }, pack: { anchor: 20 } }, confirmations: 4 };
  check("a 35%-discounted 2-pack price is now ASKED about, not misread",
    M.matchLevel({ unitPrice: 13, pattern: close }).status === "ambiguous",
    JSON.stringify(M.matchLevel({ unitPrice: 13, pattern: close })));
  check("and so is its exact list price — 2x apart is not evidence",
    M.matchLevel({ unitPrice: 20, pattern: close }).level === null);
  // What is NOT lost: a product with only ONE confirmed level has no
  // neighbour, so it is decided normally. That is most products.
  const single = { levels: { carton: { anchor: 186 } }, confirmations: 3 };
  check("one confirmed level alone is still decided",
    M.matchLevel({ unitPrice: 186, pattern: single }).level === "carton");
  check("via the near-exact tier",
    M.matchLevel({ unitPrice: 186, pattern: single }).tier === "near_exact");
  check("and so is a price 40% off it, through the wide band",
    M.matchLevel({ unitPrice: 112, pattern: single }).level === "carton");
  check("the wide tier only applies past 6.25x separation",
    M.matchLevel({ unitPrice: 300, pattern: { levels: { unit: { anchor: 10 }, pack: { anchor: 200 } }, confirmations: 4 } }).tier === "band");
}

console.log("\n12. AUDIT — contradictory history must not decide");
{
  // ₪186 saved as a unit AND as a carton, on a product whose carton holds 350.
  // The packaging says the two cannot both be true.
  const contradictory = {
    levels: { unit: { anchor: 186 }, carton: { anchor: 186 } }, confirmations: 2,
  };
  const m = M.matchLevel({ unitPrice: 186, pattern: contradictory, packaging: PK });
  check("both anchors are discarded", Object.keys(m.anchors).length === 0,
    JSON.stringify(m.anchors));
  check("so the owner is asked", m.status === "unknown" && m.level === null);

  // The same, less symmetric: a carton anchor only 2x the unit anchor when the
  // carton holds 350 of them.
  const skewed = { levels: { unit: { anchor: 0.53 }, carton: { anchor: 1.1 } }, confirmations: 2 };
  check("a carton priced at twice a unit is a contradiction, not a bargain",
    Object.keys(M.matchLevel({ unitPrice: 1.1, pattern: skewed, packaging: PK }).anchors).length === 0);

  // A GENUINE carton discount must survive: a carton of 350 sold at 186 when
  // the unit price is 0.60 is 11% below the linear 210 — normal, not a
  // contradiction.
  const genuine = { levels: { unit: { anchor: 0.60 }, carton: { anchor: 186 } }, confirmations: 2 };
  const g = M.matchLevel({ unitPrice: 186, pattern: genuine, packaging: PK });
  check("a real carton discount is kept", Object.keys(g.anchors).length === 2,
    JSON.stringify(g.anchors));
  check("and still resolves to carton", g.level === "carton");
  // Even a steep one: half the linear price.
  const steep = { levels: { unit: { anchor: 1.0 }, carton: { anchor: 175 } }, confirmations: 2 };
  check("so is a carton at half the linear price",
    M.matchLevel({ unitPrice: 175, pattern: steep, packaging: PK }).level === "carton");

  // With no packaging there is no arbiter, and nothing is invented.
  const noPk = M.matchLevel({ unitPrice: 186, pattern: contradictory, packaging: null });
  check("with no packaging the contradiction is reported, not resolved",
    noPk.status === "ambiguous" && noPk.level === null, JSON.stringify(noPk));

  // The majority-cluster case the audit flagged: two mislabelled lines outvote
  // one correct one WITHIN a level. The system cannot out-vote the record, and
  // says so by refusing the opposite reading rather than inventing one.
  const outvoted = M.learnPatterns([
    order("2026-11-18", [line({ quantity: 1, unit_price: 186, sale_level: "unit" })]),
    order("2026-11-17", [line({ quantity: 1, unit_price: 186, sale_level: "unit" })]),
    order("2026-10-02", [line({ quantity: 350, unit_price: 0.53, sale_level: "unit" })]),
  ]).get(P);
  check("two mislabelled lines do become the unit anchor",
    outvoted.levels.unit.anchor === 186, `${outvoted.levels.unit.anchor}`);
  check("...but the product's REAL unit price is then unrecognised, not relabelled",
    M.matchLevel({ unitPrice: 0.53, pattern: outvoted, packaging: PK }).status === "unknown");
  // And as soon as one carton sale is recorded, the packaging check fires and
  // the contradiction suppresses both.
  const plusCarton = M.learnPatterns([
    order("2026-11-18", [line({ quantity: 1, unit_price: 186, sale_level: "unit" })]),
    order("2026-11-17", [line({ quantity: 1, unit_price: 186, sale_level: "unit" })]),
    order("2026-11-16", [line({ quantity: 1, unit_price: 186, sale_level: "carton" })]),
  ]).get(P);
  check("one correctly labelled carton sale disarms the whole product",
    Object.keys(M.matchLevel({ unitPrice: 186, pattern: plusCarton, packaging: PK }).anchors).length === 0);
}

console.log("\n13. AUDIT — an explicit confirmation is never overwritten in silence");
{
  const pat = M.learnPatterns([
    order("2026-10-02", [line({ quantity: 350, unit_price: 0.53, sale_level: "unit" })]),
    order("2026-09-15", [line({ quantity: 700, unit_price: 0.52, sale_level: "unit" })]),
    order("2026-08-01", [line({ quantity: 2, unit_price: 186, sale_level: "carton" })]),
  ]).get(P);

  // The owner stated CARTON on this line. The price is then edited to a unit
  // price. The pattern is sure it is a unit — and is not allowed to act on it.
  const confirmed = M.levelForPriceEdit({
    currentLevel: "carton", currentSource: "confirmed",
    oldPrice: 186, newPrice: 0.53, pattern: pat, packaging: PK,
  });
  check("a confirmed level is not silently replaced", confirmed.action === "ask",
    confirmed.action);
  check("and no level is assumed in the meantime", confirmed.level === null);
  check("the reason names the contradiction",
    confirmed.reason === "contradicts_confirmed", confirmed.reason);

  // The same edit on a level this mechanism filled in: replaced without a
  // question, because nothing the owner said is being discarded.
  const auto = M.levelForPriceEdit({
    currentLevel: "carton", currentSource: "pattern",
    oldPrice: 186, newPrice: 0.53, pattern: pat, packaging: PK,
  });
  check("a learned default IS replaced silently", auto.action === "set" && auto.level === "unit",
    `${auto.action}/${auto.level}`);

  // A line that predates the provenance field — order #1197 itself — is
  // treated as a default, so the fix still lands without a question.
  const legacy = M.levelForPriceEdit({
    currentLevel: "unit", currentSource: undefined,
    oldPrice: 0.53, newPrice: 186, pattern: pat, packaging: PK,
  });
  check("order #1197's own line is corrected with no question",
    legacy.action === "set" && legacy.level === "carton", `${legacy.action}/${legacy.level}`);

  // A rescale of a CONFIRMED level asks rather than clearing silently.
  const rescaled = M.levelForPriceEdit({
    currentLevel: "unit", currentSource: "confirmed",
    oldPrice: 0.53, newPrice: 186, pattern: M.emptyPattern(), packaging: PK,
  });
  check("a rescale of a confirmed level asks", rescaled.action === "ask", rescaled.action);
  check("a rescale of a default just clears",
    M.levelForPriceEdit({
      currentLevel: "unit", currentSource: "pattern",
      oldPrice: 0.53, newPrice: 186, pattern: M.emptyPattern(), packaging: PK,
    }).action === "clear");

  // And an ordinary edit still costs nothing, confirmed or not.
  for (const src of ["confirmed", "pattern", undefined]) {
    const d = M.levelForPriceEdit({
      currentLevel: "carton", currentSource: src,
      oldPrice: 186, newPrice: 172, pattern: pat, packaging: PK,
    });
    check(`a ₪186 -> ₪172 edit keeps a ${src ?? "legacy"} level`,
      d.action === "keep" && d.level === "carton", `${d.action}/${d.level}`);
  }
}

console.log("\n14. AUDIT — learned defaults never become evidence");
{
  // The loop that would otherwise have a memory: auto-fill, save, read back,
  // become an anchor, defend itself for ever.
  const saved = [
    order("2026-11-10", [line({ quantity: 1, unit_price: 186, sale_level: "carton" })]),
  ];
  saved[0].items[0].sale_level_source = "pattern";
  check("an auto-filled level on a SAVED order teaches nothing",
    !M.learnPatterns(saved).get(P));

  const mixed = [
    order("2026-11-10", [line({ quantity: 1, unit_price: 186, sale_level: "carton", sale_level_source: "pattern" })]),
    order("2026-11-09", [line({ quantity: 1, unit_price: 184, sale_level: "carton", sale_level_source: "confirmed" })]),
  ];
  const pat = M.learnPatterns(mixed).get(P);
  check("only the confirmed line of the two counts", pat.confirmations === 1,
    `${pat.confirmations}`);
  check("and the anchor is its price", pat.levels.carton.anchor === 184,
    `${pat.levels.carton.anchor}`);
}


console.log("\n15. THE REAL DATABASE — 416 lines, 181 products, 14 unverified labels");
{
  // Production, as measured: 416 order lines over 181 distinct products; 14
  // labelled lines on 14 distinct products; every one of those orders has
  // status "ממתין לאישור"; no product has two labelled examples; and not one
  // label carries sale_level_source, because the field has never been saved.
  const orders = [];
  for (let i = 0; i < 14; i += 1) {
    orders.push(order(`2026-11-${String(10 + i).padStart(2, "0")}`,
      [{ product_id: `P${i}`, name: `מוצר ${i}`, quantity: 1, unit_price: 100 + i,
         sale_level: "carton", buy_price: 50, packaging: { units_per_pack: 24, packs_per_carton: 1 } }],
      "ממתין לאישור"));
  }
  for (let i = 0; i < 402; i += 1) {
    orders.push(order(`2026-10-${String(1 + (i % 28)).padStart(2, "0")}`,
      [{ product_id: `P${i % 181}`, quantity: 3, unit_price: 20 }]));
  }
  const pats = M.learnPatterns(orders);

  check("every labelled product is recognised as having a record", pats.size === 14,
    `${pats.size}`);
  let strong = 0, hinted = 0;
  for (const pat of pats.values()) {
    if (Object.values(pat.levels).some(s2 => s2.anchor > 0)) strong += 1;
    if (Object.values(pat.hints).some(s2 => s2.anchor > 0)) hinted += 1;
  }
  check("NONE of them is strong evidence", strong === 0, `${strong}`);
  check("all 14 are kept as hints", hinted === 14, `${hinted}`);

  const pat = pats.get("P3");
  const pk = { units_per_pack: 24, packs_per_carton: 1 };
  check("so nothing is identified automatically",
    M.matchLevel({ unitPrice: 103, pattern: pat, packaging: pk }).status === "unknown");
  check("and no level is filled in on a new line",
    M.levelForNewLine({ unitPrice: 103, pattern: pat, packaging: pk }).level === null);

  // What the owner DOES get: the question says what the old record claims.
  const sug = M.suggestLevel({ unitPrice: 103, pattern: pat, packaging: pk });
  check("the question carries the unverified record as a hint",
    sug?.level === "carton" && sug.price === 103, JSON.stringify(sug));
  check("a price unlike the record suggests nothing",
    M.suggestLevel({ unitPrice: 4, pattern: pat, packaging: pk }) === null);

  // ONE answer, and that product never asks again — at that price or near it.
  const answered = M.mergePatterns(pats, M.learnFromLines([
    { product_id: "P3", quantity: 1, unit_price: 103, sale_level: "carton",
      sale_level_source: "confirmed" },
  ]));
  const p3 = answered.get("P3");
  check("one answer makes it strong evidence", p3.levels.carton.anchor === 103,
    `${p3.levels.carton.anchor}`);
  check("the same price is then identified automatically",
    M.matchLevel({ unitPrice: 103, pattern: p3, packaging: pk }).level === "carton");
  check("so is the same price on a later order",
    M.levelForNewLine({ unitPrice: 103, pattern: p3, packaging: pk }).source === "pattern");
  check("and a customer-specific ₪95 too",
    M.levelForNewLine({ unitPrice: 95, pattern: p3, packaging: pk }).level === "carton");
  check("the hint is no longer needed, the answer outranks it",
    M.matchLevel({ unitPrice: 103, pattern: p3, packaging: pk }).tier === "near_exact");
  check("the other 13 products are untouched",
    M.matchLevel({ unitPrice: 104, pattern: answered.get("P4"), packaging: pk }).status === "unknown");

  // A SINGLE confirmation is enough — there is no second-confirmation
  // requirement anywhere, which is what makes "asked once" true.
  check("one confirmation, no repeat question", p3.confirmations === 1, `${p3.confirmations}`);
}

console.log("\n16. ORDER #1197 AS PRODUCTION HOLDS IT — an unverified wrong label");
{
  // #1197's saved line: 1 x ₪186, labelled "unit", no provenance. Wrong.
  const asStored = M.learnPatterns([
    order("2026-11-18", [legacy({ quantity: 1, unit_price: 186, sale_level: "unit" })]),
  ]).get(P);
  check("the wrong label is NOT strong evidence",
    !Object.values(asStored.levels).some(x => x.anchor > 0));
  check("it is kept only as a hint", asStored.hints.unit.anchor === 186);
  check("so ₪186 is never auto-identified as a unit",
    M.matchLevel({ unitPrice: 186, pattern: asStored, packaging: PK }).level === null);
  check("and nothing is filled in from it",
    M.levelForNewLine({ unitPrice: 186, pattern: asStored, packaging: PK }).level === null);

  // THE EDIT, with only that unverified label on record. 0.53 -> 186 is a
  // whole packaging factor, so the stale level goes and the owner is asked.
  const d = M.levelForPriceEdit({
    currentLevel: "unit", currentSource: undefined,
    oldPrice: 0.53, newPrice: 186, pattern: asStored, packaging: PK,
  });
  check("the price edit drops the stale level", d.action === "clear" && d.level === null,
    `${d.action}/${d.level}`);
  const pend = M.documentProfit([
    line({ quantity: 1, unit_price: 186, total: 186, sale_level: null }),
  ]);
  check("the popup shows no margin rather than 99.8%", pend.profitMargin === null);
  check("and reports the line as pending", pend.pendingLines === 1);

  // The hint shown with the question is the OLD WRONG label — and it is shown
  // as unverified, never selected, precisely so a click cannot promote it.
  const sug = M.suggestLevel({ unitPrice: 186, pattern: asStored, packaging: PK });
  check("the hint offered is the old label", sug?.level === "unit");
  check("but it is only a suggestion, not a match",
    M.matchLevel({ unitPrice: 186, pattern: asStored, packaging: PK }).level === null);

  // The owner answers CARTON. From then on the product is automatic, and the
  // wrong hint is outranked.
  const fixed = M.mergePatterns(
    M.learnPatterns([order("2026-11-18", [legacy({ quantity: 1, unit_price: 186, sale_level: "unit" })])]),
    M.learnFromLines([{ product_id: P, quantity: 1, unit_price: 186,
                        sale_level: "carton", sale_level_source: "confirmed" }]),
  ).get(P);
  check("the answer becomes the strong anchor", fixed.levels.carton.anchor === 186);
  check("the wrong label stays a hint and decides nothing",
    fixed.hints.unit.anchor === 186
    && M.matchLevel({ unitPrice: 186, pattern: fixed, packaging: PK }).level === "carton");

  const after = M.documentProfit([
    line({ quantity: 1, unit_price: 186, total: 186, sale_level: "carton" }),
  ]);
  check("cost ₪100", near(after.totalCostNet, 100), `${after.totalCostNet}`);
  check("profit ₪86", near(after.totalProfit, 86), `${after.totalProfit}`);
  check("margin 46.24%", near(after.profitMargin, 46.24, 0.01), `${after.profitMargin}`);
  check("and the next order of it asks nothing",
    M.levelForNewLine({ unitPrice: 186, pattern: fixed, packaging: PK }).level === "carton");
}


console.log("\n17. PRE-COMMIT GATE — the five claims, each proved or denied");
{
  const pk = { units_per_pack: 24, packs_per_carton: 1 };
  const prod = (o) => ({ product_id: "G", buy_price: 48, packaging: pk,
                         buy_level: "carton", discount: 0, ...o });

  // ---- 1. ONLY EXPLICIT OWNER CONFIRMATIONS BECOME STRONG EVIDENCE -------
  const sources = [
    ["confirmed", true],            // the owner answered
    [undefined, false],             // a legacy label, unverified
    ["pattern", false],             // this mechanism filled it in
    ["", false], ["imported", false], ["CONFIRMED", false],
  ];
  for (const [src, shouldBeStrong] of sources) {
    const l = prod({ quantity: 1, unit_price: 100, sale_level: "carton" });
    if (src !== undefined) l.sale_level_source = src;
    const pat = M.learnFromLines([l]).get("G");
    const strong = !!pat?.levels?.carton?.anchor;
    check(`source ${JSON.stringify(src)} -> ${shouldBeStrong ? "STRONG" : "not strong"}`,
      strong === shouldBeStrong, `strong=${strong}`);
  }
  check("and only a strong anchor can be matched",
    M.matchLevel({ unitPrice: 100, packaging: pk,
      pattern: M.learnFromLines([prod({ quantity: 1, unit_price: 100, sale_level: "carton" })]).get("G"),
    }).level === null);

  // ---- 2. AMBIGUOUS PRICES NEVER PRODUCE AUTOMATIC GUESSES --------------
  const confirmed = (price, level) => {
    const l = prod({ quantity: 1, unit_price: price, sale_level: level });
    l.sale_level_source = "confirmed";
    return l;
  };
  // Two levels priced 2x apart: below the separation floor, so nothing decides.
  const tooClose = M.learnFromLines([confirmed(10, "unit"), confirmed(20, "pack")]).get("G");
  for (const p of [10, 13, 15, 20, 24]) {
    const m = M.matchLevel({ unitPrice: p, pattern: tooClose, packaging: { units_per_pack: 2 } });
    check(`₪${p} on levels 2x apart produces no guess`, m.level === null, `${m.level}`);
  }
  // Contradicting the packaging: both anchors dropped.
  const contra = M.learnFromLines([confirmed(186, "unit"), confirmed(186, "carton")]).get("G");
  check("anchors that contradict the packaging produce no guess",
    M.matchLevel({ unitPrice: 186, pattern: contra, packaging: PK }).level === null);
  // A price near nothing at all.
  const far = M.learnFromLines([confirmed(100, "carton")]).get("G");
  check("a price unlike anything confirmed produces no guess",
    M.matchLevel({ unitPrice: 7, pattern: far, packaging: pk }).level === null);
  check("and no level is filled in on a new line",
    M.levelForNewLine({ unitPrice: 7, pattern: far, packaging: pk }).level === null);
  // An empty pattern: the state of 167 of the 181 products.
  check("no pattern at all produces no guess",
    M.levelForNewLine({ unitPrice: 100, pattern: M.emptyPattern() }).level === null);

  // ---- 3. CHANGING THE QUANTITY PRESERVES THE SELECTED LEVEL ------------
  // Proved at the source: the quantity is not an input to any decision here.
  // levelForPriceEdit takes no quantity, and ItemsEditor calls it only for
  // unit_price. Section 4 of wire.mjs drives the real component.
  check("no decision function accepts a quantity",
    !/quantity/.test(M.levelForPriceEdit.toString())
    && !/quantity/.test(M.levelForNewLine.toString())
    && !/quantity/.test(M.matchLevel.toString()));
  const src2 = readFileSync(resolve(REPO, "src/components/documents/ItemsEditor.jsx"), "utf8");
  check("the editor re-decides only on a unit_price edit",
    /field === "unit_price" && String\(before\?\.unit_price/.test(src2));
  check("and nothing in it clears a level on a quantity edit",
    !/field === "quantity"[\s\S]{0,200}sale_level = null/.test(src2));

  // ---- 4. CONFIRMED LEVELS ARE NEVER SILENTLY OVERRIDDEN ---------------
  const pat4 = M.learnFromLines([confirmed(100, "carton"), confirmed(4, "unit")]).get("G");
  const over = M.levelForPriceEdit({
    currentLevel: "carton", currentSource: "confirmed",
    oldPrice: 100, newPrice: 4, pattern: pat4, packaging: pk,
  });
  check("a confirmed level is never replaced silently", over.action === "ask", over.action);
  check("and no level is assumed while it is asked", over.level === null);
  // Exhaustive: no price, and no pattern, can make a confirmed level change
  // without asking.
  let silentOverrides = 0;
  for (const p of [0.5, 2, 4, 10, 48, 100, 240, 1000, 5000]) {
    const d = M.levelForPriceEdit({
      currentLevel: "carton", currentSource: "confirmed",
      oldPrice: 100, newPrice: p, pattern: pat4, packaging: pk,
    });
    if (d.action === "set" || (d.action === "clear")) silentOverrides += 1;
    if (d.action === "keep" && d.level !== "carton") silentOverrides += 1;
  }
  check("across every price, a confirmed level is kept or asked about — never set",
    silentOverrides === 0, `${silentOverrides}`);

  // ---- 5. NEW CONFIRMATIONS PERSIST AND ARE REUSABLE -------------------
  // orders.items is JSONB and the entity layer is a passthrough
  // (src/api/entities.js: insert({...payload})), so a new field on a line is
  // stored verbatim. Proved through an actual JSON round-trip.
  const answered = prod({ quantity: 1, unit_price: 100, total: 100,
                          sale_level: "carton" });
  answered.sale_level_source = "confirmed";
  const stored = JSON.parse(JSON.stringify({ items: [answered] }));   // what JSONB keeps
  check("the provenance survives the round trip",
    stored.items[0].sale_level_source === "confirmed");
  check("so does the level", stored.items[0].sale_level === "carton");

  const future = M.learnPatterns([
    { id: "saved", date: "2026-11-19", status: "ממתין לאישור", items: stored.items },
  ]).get("G");
  check("a saved answer is strong evidence on the NEXT order",
    future.levels.carton.anchor === 100, `${future?.levels?.carton?.anchor}`);
  check("and that order asks nothing",
    M.levelForNewLine({ unitPrice: 100, pattern: future, packaging: pk }).source === "pattern");
  check("one confirmation is enough — no second is required",
    future.confirmations === 1, `${future.confirmations}`);
  check("the entity layer writes items without a field whitelist",
    /insert\(\{ \.\.\.payload/.test(readFileSync(resolve(REPO, "src/api/entities.js"), "utf8")));
  check("and orders.items is JSONB",
    /items\s+JSONB/.test(readFileSync(resolve(REPO, "supabase/schema.sql"), "utf8")));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
