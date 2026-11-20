// Does the partial-credit builder get the money, the VAT and the cumulative
// limits right — and refuse everything it cannot justify?
//
// HOW TO RUN
//   node tests/partial-credit.test.mjs
//
// Pure module; esbuild only resolves the "@/" alias. Nothing is written, no
// credit note is created, and Finbot is never called — by construction, since
// this module cannot do any of those things.
//
// WHAT IT PROVES
//   1. A return credits the price it was sold at and brings goods back.
//   2. A price difference credits the delta and moves NO stock.
//   3. VAT is added once, on the net sum.
//   4. Cumulative quantities and amounts are enforced across EVERY earlier
//      credit note, and a failed one releases its share.
import { build } from "esbuild";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(mkdtempSync(join(tmpdir(), "pc-")), "b.mjs");
const entry = join(dirname(out), "e.mjs");
writeFileSync(entry, `
  export * from "${resolve(REPO, "src/lib/partialCredit.js")}";
  export * from "${resolve(REPO, "src/lib/finbotCreditPayload.js")}";
  export * from "${resolve(REPO, "src/lib/featureFlags.js")}";
  export { invoicePosition, customerPosition } from "${resolve(REPO, "src/lib/invoiceBalance.js")}";
`);
await build({ entryPoints: [entry], outfile: out, bundle: true, format: "esm",
  platform: "node", alias: { "@": resolve(REPO, "src") } });
const M = await import(out);

let pass = 0, fail = 0;
const check = (n, c, d = "") => {
  c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  ${d}`));
};
const codes = (r) => r.errors.map(e => e.code).join(",");

// An invoice of 3 lines, net lines and a gross total, as the app stores them.
//   A: 10 x 100 = 1000 net
//   B:  5 x  50 =  250 net
//   C:  2 x  25 =   50 net, 10% discount -> 45 net
// net 1295, VAT 17% = 220.15, gross 1515.15
const INV = (o = {}) => ({
  id: "inv-1", invoice_number: 10073, total: 1515.15, vat_rate: 17,
  items: [
    { product_id: "p-a", name: "מוצר א", quantity: 10, unit_price: 100, total: 1000, discount: 0 },
    { product_id: "p-b", name: "מוצר ב", quantity: 5, unit_price: 50, total: 250, discount: 0 },
    { product_id: "p-c", name: "מוצר ג", quantity: 2, unit_price: 25, total: 45, discount: 10 },
  ],
  ...o,
});
const CN = (lines, st = "confirmed", total = null) => ({
  id: `cn-${Math.random().toString(16).slice(2, 8)}`, invoice_id: "inv-1",
  finbot_status: st, items: lines,
  total: -(total ?? lines.reduce((s, l) => s + Math.abs(l.total || 0), 0)),
  ...(st === "confirmed" ? { external_credit_note_number: "20900" } : {}),
});
const ret = (index, qty, total) => ({
  kind: "return", source_line_index: index, quantity: qty, total: -total,
});
const b = (selections, creditNotes = [], invoice = INV()) =>
  M.buildPartialCredit({ invoice, creditNotes, selections });

console.log("\n1. A RETURN CREDITS WHAT WAS CHARGED");
{
  let r = b({ 0: { kind: "return", quantity: 3 } });
  check("3 of 10 at ₪100 = ₪300 net", r.net === 300, `${r.net}`);
  check("VAT 17% = ₪51", r.vat === 51, `${r.vat}`);
  check("gross ₪351", r.gross === 351, `${r.gross}`);
  check("it is valid", r.ok === true, codes(r));
  check("one line", r.lines.length === 1);
  check("marked as a return", r.lines[0].kind === "return");
  check("carrying the source line index", r.lines[0].source_line_index === 0);
  check("and the product id", r.lines[0].product_id === "p-a");
  check("money stored negative, quantity positive",
    r.lines[0].total === -300 && r.lines[0].quantity === 3);
  check("stock will move", r.restoresStock === true && r.stockLines === 1);

  // The discounted line: the credit follows the discount that was charged.
  r = b({ 2: { kind: "return", quantity: 2 } });
  check("2 of 2 at ₪25 less 10% = ₪45 net", r.net === 45, `${r.net}`);
  check("  which is exactly the line's recorded total", r.net === 45);

  // Several lines at once.
  r = b({ 0: { kind: "return", quantity: 10 },
          1: { kind: "return", quantity: 5 },
          2: { kind: "return", quantity: 2 } });
  check("the whole invoice selected is ₪1,295 net", r.net === 1295, `${r.net}`);
  check("  VAT ₪220.15", Math.abs(r.vat - 220.15) < 0.005, `${r.vat}`);
  check("  gross ₪1,515.15 — the invoice total exactly",
    Math.abs(r.gross - 1515.15) < 0.005, `${r.gross}`);
  check("  and it is flagged as a full credit", r.isFullCredit === true);
  check("  three stock lines", r.stockLines === 3);
}

console.log("\n2. A PRICE DIFFERENCE MOVES NO STOCK");
{
  let r = b({ 0: { kind: "price_adjustment", correctedUnitPrice: 90 } });
  check("₪100 corrected to ₪90 across 10 = ₪100 net", r.net === 100, `${r.net}`);
  check("VAT ₪17, gross ₪117", r.vat === 17 && r.gross === 117);
  check("it is valid", r.ok === true, codes(r));
  check("the line records both prices",
    r.lines[0].original_unit_price === 100 && r.lines[0].corrected_unit_price === 90);
  check("and the quantity it was priced across", r.lines[0].priced_quantity === 10);
  check("QUANTITY IS ZERO — nothing comes back", r.lines[0].quantity === 0);
  check("so no stock moves", r.restoresStock === false && r.stockLines === 0);

  // The discount applies to the difference, because it applied to the charge.
  r = b({ 2: { kind: "price_adjustment", correctedUnitPrice: 20 } });
  check("₪25 -> ₪20 on 2 units less 10% = ₪9 net", r.net === 9, `${r.net}`);

  // Refusals.
  r = b({ 0: { kind: "price_adjustment", correctedUnitPrice: 100 } });
  check("the same price credits nothing and is refused",
    !r.ok && codes(r).includes("price_not_lower"), codes(r));
  r = b({ 0: { kind: "price_adjustment", correctedUnitPrice: 150 } });
  check("a HIGHER price is refused — a credit reduces a charge",
    !r.ok && codes(r).includes("price_not_lower"), codes(r));
  r = b({ 0: { kind: "price_adjustment", correctedUnitPrice: -5 } });
  check("a negative price is refused", !r.ok && codes(r).includes("price_negative"));
  r = b({ 0: { kind: "price_adjustment", correctedUnitPrice: "" } });
  check("a missing price is refused", !r.ok && codes(r).includes("price_required"));
  r = b({ 0: { kind: "price_adjustment", correctedUnitPrice: 0 } });
  check("correcting to zero credits the whole line", r.ok && r.net === 1000, `${r.net}`);

  // A return AND a price adjustment, on different lines, in one credit.
  r = b({ 0: { kind: "return", quantity: 2 },
          1: { kind: "price_adjustment", correctedUnitPrice: 40 } });
  check("mixed: ₪200 returned + ₪50 repriced = ₪250 net", r.net === 250, `${r.net}`);
  check("  only the return moves stock", r.stockLines === 1 && r.restoresStock === true);
}

console.log("\n3. VAT IS ADDED ONCE, ON THE SUM");
{
  // Three lines whose individual VATs would each round up. Per-line rounding
  // would drift; one rounding on the sum does not.
  const odd = INV({ total: 11.7, items: [
    { product_id: "x", name: "x", quantity: 1, unit_price: 3.33, total: 3.33, discount: 0 },
    { product_id: "y", name: "y", quantity: 1, unit_price: 3.33, total: 3.33, discount: 0 },
    { product_id: "z", name: "z", quantity: 1, unit_price: 3.34, total: 3.34, discount: 0 },
  ] });
  const r = b({ 0: { kind: "return", quantity: 1 },
                1: { kind: "return", quantity: 1 },
                2: { kind: "return", quantity: 1 } }, [], odd);
  check("net is exactly 10.00", r.net === 10, `${r.net}`);
  check("VAT on the sum is 1.70, not 3 x 0.57", r.vat === 1.7, `${r.vat}`);
  check("gross 11.70", r.gross === 11.7, `${r.gross}`);

  // A different rate is honoured from the invoice itself.
  const at18 = b({ 0: { kind: "return", quantity: 1 } }, [], INV({ vat_rate: 18 }));
  check("an 18% invoice gets 18% VAT", at18.vat === 18 && at18.vatRate === 18,
    `${at18.vat}`);
  const at0 = b({ 0: { kind: "return", quantity: 1 } }, [], INV({ vat_rate: 0 }));
  check("a 0% invoice gets none", at0.vat === 0 && at0.gross === 100);
}

console.log("\n4. CUMULATIVE QUANTITIES, ACROSS EVERY EARLIER CREDIT");
{
  const earlier = [CN([ret(0, 4, 400)], "confirmed")];
  const info = M.creditableInvoice(INV(), earlier);
  check("line A shows 4 already credited", info.lines[0].creditedQty === 4);
  check("and 6 remaining", info.lines[0].remainingQty === 6);
  check("the other lines are untouched",
    info.lines[1].remainingQty === 5 && info.lines[2].remainingQty === 2);

  let r = b({ 0: { kind: "return", quantity: 6 } }, earlier);
  check("crediting the remaining 6 is allowed", r.ok === true, codes(r));
  r = b({ 0: { kind: "return", quantity: 7 } }, earlier);
  check("7 is refused", !r.ok && codes(r).includes("quantity_exceeds"), codes(r));
  check("  and the message states the arithmetic",
    /עד 6/.test(r.errors[0].message) && /זוכו כבר 4/.test(r.errors[0].message),
    r.errors[0]?.message);

  // Two earlier credits on the same line accumulate.
  const twice = [CN([ret(0, 4, 400)], "confirmed"), CN([ret(0, 3, 300)], "confirmed")];
  check("4 + 3 leaves 3", M.creditableInvoice(INV(), twice).lines[0].remainingQty === 3);
  check("  and 4 is refused",
    !b({ 0: { kind: "return", quantity: 4 } }, twice).ok);

  // A line credited to exhaustion can no longer be selected.
  const done = [CN([ret(1, 5, 250)], "confirmed")];
  const dinfo = M.creditableInvoice(INV(), done);
  check("an exhausted line has nothing left",
    dinfo.lines[1].remainingQty === 0 && dinfo.lines[1].canReturn === false);
  check("  and selecting it is refused",
    !b({ 1: { kind: "return", quantity: 1 } }, done).ok);

  // PENDING and UNCERTAIN credits hold their share; FAILED releases it.
  check("a pending credit holds its quantity",
    M.creditableInvoice(INV(), [CN([ret(0, 4, 400)], "pending")]).lines[0].remainingQty === 6);
  check("an uncertain one too",
    M.creditableInvoice(INV(), [CN([ret(0, 4, 400)], "uncertain")]).lines[0].remainingQty === 6);
  check("a FAILED one releases it",
    M.creditableInvoice(INV(), [CN([ret(0, 4, 400)], "failed")]).lines[0].remainingQty === 10);

  // Legacy credit lines with no index cannot be attributed to a line — and are
  // not silently attributed to the first one.
  const legacy = [CN([{ kind: "return", quantity: 4, total: -400 }], "confirmed")];
  check("a credit line with no source index attributes to no line",
    M.creditableInvoice(INV(), legacy).lines[0].remainingQty === 10);
  check("but its MONEY still counts against the invoice",
    M.creditableInvoice(INV(), legacy).creditedGrossAg === 40000,
    `${M.creditableInvoice(INV(), legacy).creditedGrossAg}`);
}

console.log("\n5. THE CUMULATIVE AMOUNT, IN GROSS");
{
  // The cap is gross, because credit_notes.total and invoices.total are gross.
  const info = M.creditableInvoice(INV(), []);
  check("the whole gross total is creditable at first",
    info.remainingGrossAg === 151515, `${info.remainingGrossAg}`);

  const big = [CN([], "confirmed", 1400)];      // ₪1,400 gross already credited
  const left = M.creditableInvoice(INV(), big);
  check("after ₪1,400 only ₪115.15 is left",
    left.remainingGrossAg === 11515, `${left.remainingGrossAg}`);

  // ₪100 net + ₪17 VAT = ₪117 gross, which is more than ₪115.15.
  let r = b({ 0: { kind: "return", quantity: 1 } }, big);
  check("a ₪117 gross credit is refused against a ₪115.15 remainder",
    !r.ok && codes(r).includes("amount_exceeds"), codes(r));
  check("  and the message shows all three figures",
    /117/.test(r.errors.at(-1).message) && /115\.15/.test(r.errors.at(-1).message)
    && /1515\.15/.test(r.errors.at(-1).message), r.errors.at(-1)?.message);

  // Just inside: ₪98.42 net + 16.73 VAT = 115.15.
  r = b({ 1: { kind: "price_adjustment", correctedUnitPrice: 50 - 98.42 / 5 } }, big);
  check("a credit that exactly reaches the remainder is allowed",
    r.ok === true, `${r.gross} :: ${codes(r)}`);

  // A failed credit releases its money too.
  const failedBig = [CN([], "failed", 1400)];
  check("after a FAILED ₪1,400 the whole invoice is creditable again",
    M.creditableInvoice(INV(), failedBig).remainingGrossAg === 151515);
  check("  so a ₪117 credit passes", b({ 0: { kind: "return", quantity: 1 } }, failedBig).ok);
}

console.log("\n6. WHAT IS REFUSED, AND NOTHING IS BUILT FROM IT");
{
  let r = b({});
  check("an empty selection is refused",
    !r.ok && codes(r).includes("nothing_selected"), codes(r));
  check("  and builds no lines", r.lines.length === 0);
  check("  with zero money", r.net === 0 && r.vat === 0 && r.gross === 0);

  r = b({ 0: { kind: "return", quantity: 0 } });
  check("a zero quantity is refused", !r.ok && codes(r).includes("quantity_required"));
  r = b({ 0: { kind: "return", quantity: -2 } });
  check("a negative quantity is refused", !r.ok && codes(r).includes("quantity_required"));
  r = b({ 0: { kind: "return", quantity: "abc" } });
  check("a non-numeric quantity is refused", !r.ok && codes(r).includes("quantity_required"));
  r = b({ 99: { kind: "return", quantity: 1 } });
  check("a line that is not on the invoice is refused",
    !r.ok && codes(r).includes("unknown_line"));
  r = b({ 0: { kind: "something_else", quantity: 1 } });
  check("an unknown kind is refused", !r.ok && codes(r).includes("unknown_kind"));

  // A fractional quantity is legitimate — goods are sold by weight and metre.
  r = b({ 0: { kind: "return", quantity: 2.5 } });
  check("a fractional return is allowed", r.ok && r.net === 250, `${r.net}`);

  // One bad line does not silence the others: every error is reported.
  r = b({ 0: { kind: "return", quantity: 99 },
          1: { kind: "price_adjustment", correctedUnitPrice: 999 } });
  check("both lines report their own error", r.errors.length >= 2, codes(r));
  check("  each against its own line index",
    r.errors.some(e => e.index === 0) && r.errors.some(e => e.index === 1));

  // An invoice with no lines at all.
  const empty = b({ 0: { kind: "return", quantity: 1 } }, [], INV({ items: [] }));
  check("an invoice with no lines refuses everything", !empty.ok);
}

console.log("\n7. NOTHING HERE CAN WRITE OR SEND");
{
  // Comments are stripped first: both files DISCUSS Finbot and the reserve
  // function at length, and the claim being tested is about executable code,
  // not about what the prose mentions.
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "")
                        .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const src = strip(readFileSync(resolve(REPO, "src/lib/partialCredit.js"), "utf8"));
  // Not a bare "finbot": the builder legitimately READS finbot_status to
  // decide which credits hold their share of the invoice. What must be absent
  // is any way to send or write.
  for (const forbidden of ["supabase", "rpc(", "functions.invoke", "fetch(",
                           "credit_note_reserve"]) {
    check(`the builder's CODE contains no "${forbidden}"`, !src.includes(forbidden));
  }
  const uiRaw = readFileSync(resolve(REPO, "src/components/invoices/PartialCreditDialog.jsx"), "utf8");
  const ui = strip(uiRaw);
  // The dialog issues credits now — section 7 used to assert it could not,
  // which was a statement about unfinished work, not about safety. The safety
  // property is the flag, asserted below and in section 11.
  // The gating itself is asserted in section 11, against the feature flag.
  // Here: the screen must still SAY all three reasons, which it now does by
  // deriving them from the flag module rather than restating them.
  check("the dialog derives its reasons from the flag module",
    /SUBMISSION_BLOCKED = PARTIAL_CREDIT_BLOCKERS/.test(uiRaw));
  check("and renders every one of them", /SUBMISSION_BLOCKED.map\(/.test(uiRaw));
}


console.log("\n8. THE FINBOT PAYLOAD — read off the edge function, not assumed");
{
  const inv = INV({ finbot_serial: "SER-9" });
  const req = (sel, cns = [], invoice = inv) => M.buildFinbotCreditRequest({
    invoice, credit: b(sel, cns, invoice), reason: "בדיקה" });

  // ---- ONE CREDITED PRODUCT ---------------------------------------------
  let r = req({ 1: { kind: "return", quantity: 5 } });
  check("the request builds", r.ok === true, JSON.stringify(r.blockers));
  check("type 4", r.body.overrides.type === "4");
  check("linked to the ORIGINAL serial", r.body.overrides.linkedDocument === "SER-9");
  check("only the three honoured override keys are sent",
    Object.keys(r.body.overrides).sort().join(",") === "credit,linkedDocument,type",
    Object.keys(r.body.overrides).join(","));
  check("one item", r.body.invoice.items.length === 1);
  check("  with the quantity credited", r.body.invoice.items[0].quantity === 5);
  check("  at the NET unit price", r.body.invoice.items[0].unit_price === 50);
  check("the item sum equals the computed net", r.itemsNet === 250, `${r.itemsNet}`);
  check("credit is the GROSS, as the working full-credit flow sends it",
    r.body.overrides.credit === 292.5, `${r.body.overrides.credit}`);
  check("and the basis is declared", M.CREDIT_FIELD_BASIS === "gross");
  check("has_manual_total is NOT set — no adjustment line may be appended",
    !("has_manual_total" in r.body.invoice));
  check("payments is not sent at all", !("payments" in r.body.invoice)
    && !("payments" in r.body.overrides));

  // ---- PARTIAL QUANTITY -------------------------------------------------
  r = req({ 0: { kind: "return", quantity: 3 } });
  check("3 of 10 goes out as 3 units", r.body.invoice.items[0].quantity === 3);
  check("  at ₪100 net", r.body.invoice.items[0].unit_price === 100);
  check("  items sum 300, credit 351 gross", r.itemsNet === 300
    && r.body.overrides.credit === 351, `${r.itemsNet}/${r.body.overrides.credit}`);

  // A discounted line: the unit price is backed out of the line total so the
  // document matches our figure exactly.
  r = req({ 2: { kind: "return", quantity: 2 } });
  check("the discounted line goes out at its effective net price",
    r.body.invoice.items[0].unit_price === 22.5, `${r.body.invoice.items[0].unit_price}`);
  check("  and the item sum is the ₪45 we computed", r.itemsNet === 45, `${r.itemsNet}`);

  // ---- PRICE DIFFERENCE: the quantity-0 trap ----------------------------
  // buildItems drops any line with quantity <= 0, so a price adjustment MUST
  // NOT go out as it is stored.
  const stored = b({ 0: { kind: "price_adjustment", correctedUnitPrice: 90 } }).lines[0];
  check("the STORED line has quantity 0", stored.quantity === 0);
  const edge = readFileSync(resolve(REPO, "supabase/functions/finbot-invoice/index.ts"), "utf8");
  check("and buildItems would drop exactly that",
    /Number\(i\.quantity\) > 0/.test(edge), "the filter changed — recheck this adapter");

  r = req({ 0: { kind: "price_adjustment", correctedUnitPrice: 90 } });
  check("so it is sent as ONE unit", r.body.invoice.items[0].quantity === 1);
  check("  priced at the credit itself", r.body.invoice.items[0].unit_price === 100);
  check("  and it survives the filter", r.body.invoice.items[0].quantity > 0);
  check("the name explains what it is",
    /הפרש מחיר 100→90 × 10/.test(r.body.invoice.items[0].name),
    r.body.invoice.items[0].name);
  check("the item sum still equals the net", r.itemsNet === 100 && r.creditNet === 100);

  // ---- MIXED, and the sum must reconcile -------------------------------
  r = req({ 0: { kind: "return", quantity: 2 },
            1: { kind: "price_adjustment", correctedUnitPrice: 40 } });
  check("two items go out", r.body.invoice.items.length === 2);
  check("  the return keeps its quantity", r.body.invoice.items[0].quantity === 2);
  check("  the adjustment is one unit", r.body.invoice.items[1].quantity === 1);
  check("the item sum equals the computed net", r.itemsNet === r.creditNet
    && r.itemsNet === 250, `${r.itemsNet}/${r.creditNet}`);

  // ---- NAMES ARE CAPPED -------------------------------------------------
  const longName = INV({ finbot_serial: "S", items: [{ product_id: "x",
    name: "מ".repeat(300), quantity: 1, unit_price: 10, total: 10, discount: 0 }] });
  r = req({ 0: { kind: "return", quantity: 1 } }, [], longName);
  check("a long name is truncated to the provider's limit",
    r.body.invoice.items[0].name.length <= M.NAME_MAX,
    `${r.body.invoice.items[0].name.length}`);

  // ---- BLOCKED WITHOUT THE PARENT SERIAL -------------------------------
  r = req({ 0: { kind: "return", quantity: 1 } }, [], INV({ finbot_serial: null }));
  check("no parent serial blocks the request", r.ok === false);
  check("  with no body at all", r.body === null);
  check("  naming the reason", r.blockers.some(x => x.code === "no_finbot_serial"));
  r = req({}, [], inv);
  check("an invalid selection blocks it too",
    r.ok === false && r.blockers.some(x => x.code === "credit_invalid"));

  // ---- THE UNCERTAINTY IS CARRIED, NOT HIDDEN -------------------------
  r = req({ 0: { kind: "return", quantity: 1 } });
  // Document 50026 settled the gross/net question and the payments question.
  // One presentation unknown is left, and it is reported as such.
  check("one uncertainty remains", r.uncertainties.length === 1,
    r.uncertainties.map(u => u.code).join(","));
  check("  and it is about the line DETAIL, not the money",
    r.uncertainties[0].code === "line_detail_rendering");
  check("  citing the document that settled the rest",
    /50026/.test(r.uncertainties[0].message));
}

console.log("\n9. MULTIPLE CREDITS ON ONE INVOICE — same linkage, cumulative limits");
{
  const inv = INV({ finbot_serial: "SER-9" });
  // First credit: 4 of line A.
  const first = b({ 0: { kind: "return", quantity: 4 } });
  const r1 = M.buildFinbotCreditRequest({ invoice: inv, credit: first });
  check("the first credit links to SER-9", r1.body.overrides.linkedDocument === "SER-9");
  check("  for ₪400 net / ₪468 gross",
    r1.itemsNet === 400 && r1.body.overrides.credit === 468, `${r1.body.overrides.credit}`);

  // It is recorded, confirmed, and a second credit follows on the SAME invoice.
  const recorded = [CN(first.lines.map(l => ({ ...l })), "confirmed", first.gross)];
  const left = M.creditableInvoice(inv, recorded);
  check("6 of line A remain", left.lines[0].remainingQty === 6);
  const second = b({ 0: { kind: "return", quantity: 6 } }, recorded);
  const r2 = M.buildFinbotCreditRequest({ invoice: inv, credit: second });
  check("the second credit links to THE SAME parent document",
    r2.body.overrides.linkedDocument === "SER-9");
  check("  and is a separate document for ₪600 net", r2.itemsNet === 600);
  check("neither credit spans two invoices — linkedDocument is one string",
    typeof r1.body.overrides.linkedDocument === "string"
    && typeof r2.body.overrides.linkedDocument === "string");

  // A third that would exceed the invoice is refused before any payload.
  const third = b({ 1: { kind: "return", quantity: 5 },
                    2: { kind: "return", quantity: 2 } },
                  [...recorded, CN(second.lines.map(l => ({ ...l })), "confirmed", second.gross)]);
  const r3 = M.buildFinbotCreditRequest({ invoice: inv, credit: third });
  check("a third credit that fits is allowed", r3.ok === true, JSON.stringify(r3.blockers));
  check("  and the three together reach the invoice total",
    Math.abs(first.gross + second.gross + r3.creditGross - 1515.15) < 0.02,
    `${first.gross + second.gross + r3.creditGross}`);
}

console.log("\n10. LEDGER CONSISTENCY AND A FULLY PAID INVOICE");
{
  const inv = INV({ id: "inv-1", finbot_serial: "SER-9", total: 1515.15,
                    paid_amount: 1515.15, payment_status: "שולם" });
  const credit = b({ 0: { kind: "return", quantity: 3 } });      // ₪351 gross
  // Recorded but NOT yet confirmed: the balance must not move.
  const pending = [CN(credit.lines.map(l => ({ ...l })), "pending", credit.gross)];
  let pos = M.invoicePosition(inv, pending, null);
  check("a pending partial credit moves no balance",
    pos.outstandingAg === 0, `${pos.outstandingAg}`);
  check("  and is reported as awaiting verification",
    pos.pendingAg === 35100, `${pos.pendingAg}`);

  // Confirmed: the paid invoice now owes money BACK.
  const confirmed = [CN(credit.lines.map(l => ({ ...l })), "confirmed", credit.gross)];
  pos = M.invoicePosition(inv, confirmed, null);
  check("once confirmed, ₪351 is owed back",
    pos.refundDueAg === 35100 && pos.debtAg === 0, `${pos.refundDueAg}`);
  check("  the invoice reads as partially credited", pos.state === "partial");
  const cust = M.customerPosition([inv], confirmed, null);
  check("the customer position says the same", cust.refundDue === 351 && cust.debt === 0,
    `${cust.refundDue}`);

  // A FAILED partial credit changes nothing at all.
  const failed = [CN(credit.lines.map(l => ({ ...l })), "failed", credit.gross)];
  pos = M.invoicePosition(inv, failed, null);
  check("a failed partial credit moves nothing", pos.outstandingAg === 0
    && pos.refundDueAg === 0 && pos.pendingAg === 0);
  check("  and releases its share of the cap",
    M.creditableInvoice(inv, failed).lines[0].remainingQty === 10);

  // The ORIGINAL INVOICE IS UNTOUCHED by any of this.
  check("the invoice object was never mutated",
    inv.total === 1515.15 && inv.paid_amount === 1515.15
    && !inv.credited_at && inv.items.length === 3);
  check("  and its items still carry their original quantities",
    inv.items[0].quantity === 10 && inv.items[0].unit_price === 100);
}

console.log("\n11. ISSUANCE IS HELD SHUT BY THE FLAG");
{
  check("the flag is false", M.PARTIAL_CREDIT_ISSUE_ENABLED === false);
  // Two reasons now, not three: document 50026 settled the gross/net question
  // and the payments question. What is left is whether the same semantics hold
  // when the items are a SUBSET, plus how the line detail is rendered.
  check("and it carries the two remaining reasons",
    M.PARTIAL_CREDIT_BLOCKERS.length === 2, `${M.PARTIAL_CREDIT_BLOCKERS.length}`);
  check("neither of which is about the money any more",
    M.PARTIAL_CREDIT_BLOCKERS.every(r => !/ברוטו או נטו/.test(r)),
    M.PARTIAL_CREDIT_BLOCKERS.join(" | "));

  // Neither the adapter nor the dialog can send anything.
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const adapter = strip(readFileSync(resolve(REPO, "src/lib/finbotCreditPayload.js"), "utf8"));
  // It names the endpoint as a STRING in its dry-run output, which is the
  // point of a dry run. The property is that it imports no client and makes no
  // call — not that the word never appears.
  check("the adapter imports no supabase client",
    !/import[^;]*supabase/i.test(adapter));
  // `.invoke(` is excluded deliberately: the dry-run label contains the text
  // `supabase.functions.invoke("finbot-invoice")`, which is a description of
  // where the body would go. The checks that matter are the import above and
  // the absence of a real request below.
  for (const call of ["fetch(", ".rpc("]) {
    check(`the adapter makes no ${call} call`, !adapter.includes(call));
  }
  check("and the only mention of invoke is inside a string literal",
    (adapter.match(/\.invoke\(/g) || []).length === 0
    || /"[^"]*functions\.invoke/.test(adapter), adapter.match(/.{0,40}\.invoke\(.{0,20}/)?.[0]);
  const ui = strip(readFileSync(resolve(REPO, "src/components/invoices/PartialCreditDialog.jsx"), "utf8"));
  // The dialog IS wired now; what holds it shut is the flag, not the absence
  // of code. Every path to a live document must be behind it.
  check("the issue handler returns immediately when the flag is false",
    /if \(!PARTIAL_CREDIT_ISSUE_ENABLED\) return;/.test(ui));
  check("  and the button is disabled by the same flag",
    /disabled=\{!PARTIAL_CREDIT_ISSUE_ENABLED/.test(ui));
  check("  so the guard is in the handler AND on the control, not one of them",
    (ui.match(/PARTIAL_CREDIT_ISSUE_ENABLED/g) || []).length >= 3,
    `${(ui.match(/PARTIAL_CREDIT_ISSUE_ENABLED/g) || []).length}`);
  check("the only Finbot call is the one inside that handler",
    (ui.match(/functions\.invoke/g) || []).length === 1);
  check("and it sends the body the dry run showed, not a second construction",
    /invoke\("finbot-invoice", \{ body: request\.body \}\)/.test(ui));
  check("the dialog's issue button is gated on the flag",
    /disabled=\{!PARTIAL_CREDIT_ISSUE_ENABLED/.test(ui));
  check("the preview is a dry run, built from the same adapter",
    /buildFinbotCreditRequest/.test(ui) && /describeFinbotCreditRequest/.test(ui));
}


console.log("\n12. THE VAT RATE COMES FROM THE INVOICE, NEVER A DEFAULT");
{
  for (const rate of [0, 15, 17, 18, 19.5]) {
    const r = b({ 0: { kind: "return", quantity: 1 } }, [], INV({ vat_rate: rate }));
    const expected = Math.round(100 * rate) / 100;
    check(`a ${rate}% invoice credits ${rate}% VAT`,
      Math.abs(r.vat - expected) < 0.005 && r.vatRate === rate, `${r.vat}`);
  }

  // NO silent 17. An invoice with no rate recorded cannot have its credit
  // computed, and says so instead of producing a plausible wrong figure.
  for (const missing of [null, undefined, "", "abc"]) {
    const r = b({ 0: { kind: "return", quantity: 1 } }, [], INV({ vat_rate: missing }));
    check(`vat_rate ${JSON.stringify(missing)} is refused, not defaulted`,
      !r.ok && r.errors.some(e => e.code === "vat_rate_unknown"), codes(r));
    check("  the rate is reported as unknown", r.vatRateKnown === false);
    check("  and no VAT is invented", r.vat === 0);
    check("  while the NET is still correct", r.net === 100, `${r.net}`);
  }
  // A negative rate is not a rate.
  const neg = b({ 0: { kind: "return", quantity: 1 } }, [], INV({ vat_rate: -5 }));
  check("a negative rate is refused", !neg.ok && neg.vatRateKnown === false);

  // The adapter carries the invoice's rate through to the payload.
  const req = M.buildFinbotCreditRequest({
    invoice: INV({ finbot_serial: "S", vat_rate: 18 }),
    credit: b({ 0: { kind: "return", quantity: 1 } }, [], INV({ vat_rate: 18 })) });
  check("the request carries the invoice's own rate", req.body.invoice.vat_rate === 18);
  check("  and its gross is computed at that rate", req.creditGross === 118,
    `${req.creditGross}`);
  check("no hardcoded 17 remains in the builder",
    !/\?\?\s*17/.test(readFileSync(resolve(REPO, "src/lib/partialCredit.js"), "utf8")));
}


console.log("\n13. VERIFIED FROM DOCUMENT 50026 — credit sets the gross");
{
  // What Finbot did: gross := credit, net := round(gross / (1 + rate)).
  // So our net survives only if that derivation lands back on it.
  const derive = (gross, rate) => Math.round((gross / (1 + rate / 100)) * 100) / 100;

  check("50026: 195.00 / 1.18 derives the 165.25 the document shows",
    derive(195, 18) === 165.25, `${derive(195, 18)}`);
  check("and that is NOT the 165.60 we sent as items", derive(195, 18) !== 165.6);

  // THE ROUND TRIP, swept rather than sampled. Our gross is net + VAT, so the
  // provider's back-derivation must return our net.
  for (const rate of [17, 18]) {
    let bad = 0, n = 0;
    for (let cents = 1; cents <= 200000; cents += 1) {
      const net = cents / 100;
      const gross = Math.round((net + Math.round(net * rate) / 100) * 100) / 100;
      if (derive(gross, rate) !== net) bad += 1;
      n += 1;
    }
    check(`VAT ${rate}%: every net from ₪0.01 to ₪2,000 round-trips`,
      bad === 0, `${bad} of ${n} failed`);
  }

  // And the guard refuses anything that would not.
  const inv = INV({ finbot_serial: "S", vat_rate: 18 });
  const credit = b({ 0: { kind: "return", quantity: 1 } }, [], inv);
  let r = M.buildFinbotCreditRequest({ invoice: inv, credit });
  check("a normal request passes the round-trip guard", r.ok === true,
    JSON.stringify(r.blockers));
  check("  net 100, gross 118", r.creditNet === 100 && r.creditGross === 118);
  check("  and the provider would derive our net back",
    derive(r.creditGross, 18) === r.creditNet);

  // A gross that does not correspond to the net is refused outright.
  r = M.buildFinbotCreditRequest({ invoice: inv,
    credit: { ...credit, gross: 150, net: 100, vatRate: 18 } });
  check("a mismatched gross is BLOCKED", r.ok === false,
    JSON.stringify(r.blockers));
  check("  by the round-trip guard",
    r.blockers.some(x => x.code === "gross_does_not_round_trip"));
  check("  naming the net the document would show",
    r.blockers.find(x => x.code === "gross_does_not_round_trip")
      .message.includes("127.12"),
    r.blockers[0]?.message);

  // The guard itself, directly.
  check("assertGrossRoundTrip accepts a consistent pair",
    M.assertGrossRoundTrip(100, 118, 18).ok === true);
  check("rejects an inconsistent one", M.assertGrossRoundTrip(100, 150, 18).ok === false);
  check("and refuses a nonsense rate", M.assertGrossRoundTrip(100, 118, -1).ok === false);

  // THE DIRECTION THAT IS HARD is the receipt one, and it is not this one.
  // Given a GROSS target, finding a two-decimal net whose round-trip returns it
  // fails for a sixth of amounts — which is what rejected receipt 722.
  let unreachable = 0;
  for (let cents = 1; cents <= 100000; cents += 1) {
    const grossTarget = cents / 100;
    const net = Math.round((grossTarget / 1.18) * 100) / 100;
    if (Math.round(net * 1.18 * 100) / 100 !== grossTarget) unreachable += 1;
  }
  check("the reverse direction really is the broken one",
    unreachable > 10000, `${unreachable} unreachable gross targets`);
  check("  which is why 722.00 was refused",
    Math.round(Math.round((722 / 1.18) * 100) / 100 * 1.18 * 100) / 100 !== 722);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
