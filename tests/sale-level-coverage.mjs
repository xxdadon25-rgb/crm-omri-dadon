// HOW MUCH OF THE REAL CATALOGUE CAN BE IDENTIFIED AUTOMATICALLY?
//
// This is a REPORT, not a test. It answers one question against real data:
// for how many products does the confirmed order history already identify a
// price unambiguously, and for how many will the owner still be asked?
//
// ============================================================================
// WHY IT TAKES A FILE INSTEAD OF QUERYING
// ============================================================================
// The only key in this repository is the anon key, and every table is behind
// staff-only RLS, so it reads nothing (verified: `orders` returns [] and
// `supplier_quote_product_packages` returns 42501). Production is therefore
// read through the Dashboard, by hand, with the query below — which is a plain
// SELECT and changes nothing.
//
// STEP 1 — run this in Supabase → SQL Editor, and save the single JSON cell to
// a file:
//
//   select jsonb_build_object(
//     'orders', (
//       select coalesce(jsonb_agg(jsonb_build_object(
//                'id', o.id, 'date', o.date, 'status', o.status, 'items', o.items)), '[]'::jsonb)
//         from public.orders o
//        where o.date >= (current_date - interval '24 months')
//     ),
//     'packaging', (
//       select coalesce(jsonb_agg(jsonb_build_object(
//                'product_id', p.product_id,
//                'units_per_pack', p.units_per_pack,
//                'packs_per_carton', p.packs_per_carton,
//                'buy_price_level', p.buy_price_level)), '[]'::jsonb)
//         from public.supplier_quote_product_packages p
//     ),
//     'products', (
//       select coalesce(jsonb_agg(jsonb_build_object(
//                'id', pr.id, 'name', pr.name, 'buy_price', pr.buy_price)), '[]'::jsonb)
//         from public.products pr
//     )
//   ) as extract;
//
// STEP 2 — node tests/sale-level-coverage.mjs <that-file.json>
//
// The extract carries no customer, no address and no payment data: product
// ids, prices, levels and packaging only.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2];
if (!file) {
  console.error("usage: node tests/sale-level-coverage.mjs <extract.json>");
  console.error("the SQL to produce it is at the top of this file");
  process.exit(2);
}

const out = join(mkdtempSync(join(tmpdir(), "cov-")), "b.mjs");
const entry = join(dirname(out), "e.mjs");
writeFileSync(entry, `
  export * from "${resolve(REPO, "src/lib/saleLevelPattern.js")}";
  export { lineProfit, SALE_LEVELS } from "${resolve(REPO, "src/lib/packagingMath.js")}";
`);
await build({ entryPoints: [entry], outfile: out, bundle: true, format: "esm",
  platform: "node", alias: { "@": resolve(REPO, "src") } });
const M = await import(out);

const raw = JSON.parse(readFileSync(file, "utf8"));
const data = Array.isArray(raw) ? (raw[0]?.extract ?? raw[0]) : (raw.extract ?? raw);
const orders = data.orders ?? [];
const packaging = new Map((data.packaging ?? []).map(r => [r.product_id, r]));
const products = new Map((data.products ?? []).map(r => [r.id, r]));

// THE REAL MODULE, on the real history. Nothing is reimplemented here.
const patterns = M.learnPatterns(orders);

const soldProducts = new Set();
let lines = 0, linesWithLevel = 0, linesConfirmed = 0, linesFromPattern = 0;
for (const o of orders) {
  if (o.status === "בוטל") continue;
  for (const it of o.items ?? []) {
    if (!it?.product_id) continue;
    lines += 1;
    soldProducts.add(it.product_id);
    if (M.SALE_LEVELS.includes(it.sale_level)) {
      linesWithLevel += 1;
      if (it.sale_level_source === "confirmed") linesConfirmed += 1;
    }
    if (it.sale_level_source === "pattern") linesFromPattern += 1;
  }
}

const bucket = { decided: [], tooClose: [], contradictory: [], hintOnly: [], none: [] };

for (const pid of soldProducts) {
  const pat = patterns.get(pid);
  const pk = packaging.get(pid) ?? null;
  if (!pat) { bucket.none.push(pid); continue; }

  const levels = Object.entries(pat.levels)
    .filter(([, s]) => s.anchor > 0).map(([l, s]) => [l, s.anchor]);
  if (levels.length === 0) {
    // No CONFIRMED answer. An unverified label may still exist, and is shown
    // beside the question — it never decides. This is where production sits
    // today for all 14 of its labelled products.
    const hints = Object.entries(pat.hints ?? {})
      .filter(([, s]) => s.anchor > 0).map(([l, s]) => [l, s.anchor]);
    (hints.length ? bucket.hintOnly : bucket.none).push({ pid, levels: hints });
    continue;
  }

  // Would each level's OWN learned price be recognised? That is the question
  // the operator meets: they retype the price they used last time.
  const recognised = levels.filter(([, a]) =>
    M.matchLevel({ unitPrice: a, pattern: pat, packaging: pk }).status === "unambiguous");

  if (recognised.length === levels.length) {
    bucket.decided.push({ pid, levels, confirmations: pat.confirmations });
  } else if (levels.length >= 2) {
    const anchors = levels.map(([, a]) => a).sort((x, y) => x - y);
    let minSep = Infinity;
    for (let i = 1; i < anchors.length; i += 1) minSep = Math.min(minSep, anchors[i] / anchors[i - 1]);
    const m = M.matchLevel({ unitPrice: levels[0][1], pattern: pat, packaging: pk });
    (Object.keys(m.anchors).length === 0 ? bucket.contradictory : bucket.tooClose)
      .push({ pid, levels, minSep: minSep.toFixed(2) });
  } else {
    bucket.tooClose.push({ pid, levels, minSep: "n/a" });
  }
}

const name = (pid) => products.get(pid)?.name ?? pid;
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : "0.0") + "%";
const sold = soldProducts.size;

console.log(`\n================ SALE-LEVEL LEARNING COVERAGE ================`);
console.log(`orders read               ${orders.length}`);
console.log(`order lines               ${lines}`);
console.log(`  with a sale level       ${linesWithLevel}  (${pct(linesWithLevel, lines)})`);
console.log(`  OWNER-CONFIRMED         ${linesConfirmed}  (${pct(linesConfirmed, lines)})  <- what decides`);
console.log(`  auto-filled previously  ${linesFromPattern}  (excluded from learning by design)`);
console.log(`products ever sold        ${sold}`);
console.log(`products with packaging   ${packaging.size}`);
console.log(`\n-- identified automatically ------------------------------------`);
console.log(`  ${bucket.decided.length}  (${pct(bucket.decided.length, sold)})`);
for (const r of bucket.decided.slice(0, 25)) {
  console.log(`    ${name(r.pid)}  ${r.levels.map(([l, a]) => `${l}=₪${a}`).join("  ")}  (${r.confirmations} confirmations)`);
}
if (bucket.decided.length > 25) console.log(`    … and ${bucket.decided.length - 25} more`);

console.log(`\n-- asked: levels priced too close to tell apart ---------------`);
console.log(`  ${bucket.tooClose.length}  (${pct(bucket.tooClose.length, sold)})`);
for (const r of bucket.tooClose.slice(0, 25)) {
  console.log(`    ${name(r.pid)}  ${r.levels.map(([l, a]) => `${l}=₪${a}`).join("  ")}  separation ${r.minSep}x`);
}

console.log(`\n-- asked: history contradicts itself --------------------------`);
console.log(`  ${bucket.contradictory.length}  (${pct(bucket.contradictory.length, sold)})`);
for (const r of bucket.contradictory.slice(0, 25)) {
  const pid = r.pid ?? r;
  console.log(`    ${name(pid)}  ${r.levels ? r.levels.map(([l, a]) => `${l}=₪${a}`).join("  ") : "(no usable anchor)"}`);
}

console.log(`\n-- asked once: an unverified label exists, shown as a hint ----`);
console.log(`  ${bucket.hintOnly.length}  (${pct(bucket.hintOnly.length, sold)})`);
for (const r of bucket.hintOnly.slice(0, 25)) {
  console.log(`    ${name(r.pid)}  ${r.levels.map(([l, a]) => `${l}=₪${a}`).join("  ")}  (not confirmed)`);
}
console.log(`\n-- asked once: no label at all --------------------------------`);
console.log(`  ${bucket.none.length}  (${pct(bucket.none.length, sold)})`);

// How many products could show a margin at all, which is a separate gap.
let noBuyLevel = 0, noPackaging = 0, noCost = 0;
for (const pid of soldProducts) {
  const pk = packaging.get(pid);
  const pr = products.get(pid);
  if (pr && (pr.buy_price === null || pr.buy_price === undefined)) noCost += 1;
  else if (!pk?.buy_price_level) noBuyLevel += 1;
  else if (!pk?.units_per_pack) noPackaging += 1;
}
console.log(`\n-- separate gaps, unaffected by this feature ------------------`);
console.log(`  no purchase price              ${noCost}`);
console.log(`  no buy_price_level recorded    ${noBuyLevel}`);
console.log(`  no units_per_pack recorded     ${noPackaging}`);
console.log(`\n(a level identified automatically still shows no margin until the`);
console.log(` product's packaging and purchase level are known.)`);
console.log(`==============================================================\n`);
