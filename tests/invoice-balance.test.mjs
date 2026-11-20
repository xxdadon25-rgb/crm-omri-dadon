// Does an invoice's position come out right once credits and payments are two
// separate ledgers?
//
// HOW TO RUN
//   node tests/invoice-balance.test.mjs
//
// Pure modules; esbuild only resolves the "@/" alias. No database, no network.
//
// WHAT IT PROVES
//   1. Only a CONFIRMED credit reduces a receivable.
//   2. Payments are independent of credits — a fully paid invoice that is then
//      credited produces money owed BACK, and that figure is never discarded.
//   3. A partially credited invoice is still payable, up to what is left.
//   4. An invoice with a confirmed credit document cannot be deleted.
//   5. Legacy rows keep meaning what they meant.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(mkdtempSync(join(tmpdir(), "ib-")), "b.mjs");
const entry = join(dirname(out), "e.mjs");
writeFileSync(entry, `
  export * from "${resolve(REPO, "src/lib/invoiceBalance.js")}";
  export { isAllocatable, validateAllocation, autoAllocate } from "${resolve(REPO, "src/lib/paymentAllocation.js")}";
  export { creditedQuantities, creditableInvoice } from "${resolve(REPO, "src/lib/partialCredit.js")}";
  export { buildStatement } from "${resolve(REPO, "src/lib/customerStatement.js")}";
`);
await build({ entryPoints: [entry], outfile: out, bundle: true, format: "esm",
  platform: "node", alias: { "@": resolve(REPO, "src") } });
const M = await import(out);

let pass = 0, fail = 0;
const check = (n, c, d = "") => {
  c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  ${d}`));
};
const near = (a, b, eps = 0.005) => a !== null && Math.abs(a - b) < eps;

const INV = (o = {}) => ({
  id: "inv-1", total: 1000, paid_amount: 0, payment_status: "ממתין לתשלום",
  credited_at: null, credit_note_id: null, ...o,
});
/** A credit note. `st` is the Finbot lifecycle state; undefined = legacy. */
const CN = (amount, st, extra = {}) => ({
  id: `cn-${Math.random().toString(16).slice(2, 8)}`, invoice_id: "inv-1",
  total: -Math.abs(amount),
  ...(st === undefined ? {} : { finbot_status: st }),
  ...extra,
});
const bal = (inv, cns = [], pays = null) => M.invoiceBalance(inv, cns, pays);

console.log("\n1. ONLY A CONFIRMED CREDIT REDUCES A RECEIVABLE");
{
  const inv = INV();
  check("no credits: the whole total is owed",
    bal(inv, []).outstanding === 1000 && bal(inv, []).state === "none");

  for (const st of ["pending", "uncertain", "failed"]) {
    const b = bal(inv, [CN(300, st)]);
    check(`a ${st} credit reduces NOTHING`, b.outstanding === 1000, `${b.outstanding}`);
    check(`  and is reported separately as unsettled`, b.unsettled === 300, `${b.unsettled}`);
    check(`  the invoice is not shown as credited`, b.state === "none", b.state);
  }

  const c = bal(inv, [CN(300, "confirmed", { external_credit_note_number: "20200" })]);
  check("a confirmed credit reduces the receivable", c.outstanding === 700, `${c.outstanding}`);
  check("  and is reported as partial", c.state === "partial", c.state);
  check("  with nothing unsettled", c.unsettled === 0);

  // Mixed: one confirmed, one still unknown.
  const m = bal(inv, [CN(300, "confirmed", { external_credit_note_number: "1" }),
                      CN(200, "uncertain")]);
  check("only the confirmed one counts", m.outstanding === 700, `${m.outstanding}`);
  check("the unknown one is visible but not netted", m.unsettled === 200);
  check("counts are reported", m.confirmedCount === 1 && m.unsettledCount === 1);
}

console.log("\n2. PAYMENTS ARE A SEPARATE LEDGER, AND THE SIGN IS KEPT");
{
  // The case that the rejected invariant would have blocked: paid in full,
  // then credited. The business owes money back.
  const inv = INV({ paid_amount: 1000, payment_status: "שולם" });
  const b = bal(inv, [CN(200, "confirmed", { external_credit_note_number: "20201" })]);
  check("net receivable is 800", b.netReceivable === 800, `${b.netReceivable}`);
  check("paid is 1000", b.paid === 1000);
  check("outstanding is MINUS 200 — a refund owed", b.outstanding === -200, `${b.outstanding}`);
  check("the debt side is zero", b.debt === 0);
  check("and the refund side is 200", b.refundDue === 200, `${b.refundDue}`);
  check("the state is partial", b.state === "partial");

  // Fully paid, fully credited.
  const full = bal(INV({ paid_amount: 1000 }),
    [CN(1000, "confirmed", { external_credit_note_number: "20202" })]);
  check("paid and fully credited owes the whole lot back",
    full.outstanding === -1000 && full.refundDue === 1000, `${full.outstanding}`);
  check("and reads as fully credited", full.state === "full");

  // Partly paid, partly credited — both sides move.
  const part = bal(INV({ paid_amount: 400 }),
    [CN(200, "confirmed", { external_credit_note_number: "20203" })]);
  check("1000 − 200 credit − 400 paid = 400 still owed",
    part.outstanding === 400, `${part.outstanding}`);

  // Payment ROWS instead of the denormalised mirror.
  const rows = [{ invoice_id: "inv-1", amount: 250 }, { invoice_id: "inv-1", amount: 150 },
                { invoice_id: "other", amount: 999 }];
  const fromRows = bal(INV(), [CN(200, "confirmed", { external_credit_note_number: "2" })], rows);
  check("payment rows are summed, and another invoice's are ignored",
    fromRows.paid === 400 && fromRows.outstanding === 400, `${fromRows.paid}`);

  // A credit larger than its invoice is a data error, not money owed back.
  const over = bal(INV({ total: 100 }),
    [CN(500, "confirmed", { external_credit_note_number: "3" })]);
  check("a credit bigger than the invoice is clamped at the total",
    over.credited === 100 && over.outstanding === 0, `${over.credited}/${over.outstanding}`);
}

console.log("\n3. A PARTIALLY CREDITED INVOICE IS STILL PAYABLE");
{
  const inv = INV();
  const partial = [CN(200, "confirmed", { external_credit_note_number: "20300" })];
  const fully = [CN(1000, "confirmed", { external_credit_note_number: "20301" })];

  check("partially credited: allocatable", M.isAllocatable(inv, partial) === true);
  check("fully credited: NOT allocatable", M.isAllocatable(inv, fully) === false);
  check("uncredited: allocatable", M.isAllocatable(inv, []) === true);
  check("an unconfirmed credit does not block payment",
    M.isAllocatable(inv, [CN(200, "uncertain")]) === true);
  check("already paid in full: not allocatable",
    M.isAllocatable(INV({ paid_amount: 1000 }), []) === false);

  // Validation: 800 may be paid, 801 may not.
  let v = M.validateAllocation({
    invoices: [inv], creditNotes: partial, amounts: { "inv-1": 800 }, paymentAmount: 800 });
  check("paying the remaining 800 validates", v.errors.length === 0, JSON.stringify(v.errors));
  v = M.validateAllocation({
    invoices: [inv], creditNotes: partial, amounts: { "inv-1": 801 }, paymentAmount: 801 });
  check("paying 801 is an overpayment",
    v.errors.some(e => e.code === "overpayment"), JSON.stringify(v.errors));
  v = M.validateAllocation({
    invoices: [inv], creditNotes: fully, amounts: { "inv-1": 1 }, paymentAmount: 1 });
  check("paying anything on a fully credited invoice is refused",
    v.errors.some(e => e.code === "invoice_credited"), JSON.stringify(v.errors));

  // WITHOUT credit notes the old, cruder signal still applies — a caller that
  // has not loaded them is no worse off than before.
  check("no credit notes in hand: credited_at still blocks",
    M.isAllocatable(INV({ credited_at: "2026-01-01" })) === false);
  check("and an uncredited invoice still passes", M.isAllocatable(INV()) === true);
  const vOld = M.validateAllocation({
    invoices: [INV({ credited_at: "2026-01-01" })], amounts: { "inv-1": 10 }, paymentAmount: 10 });
  check("validation without credit notes behaves as before",
    vOld.errors.some(e => e.code === "invoice_credited"));
}

console.log("\n4. AN INVOICE WITH A CONFIRMED CREDIT CANNOT BE DELETED");
{
  const inv = INV();
  let g = M.canDeleteInvoice(inv, []);
  check("no credits: deletable", g.allowed === true);
  // A credit that MAY exist blocks it: unknown is not permission, and deleting
  // would destroy the only record that the question was ever open.
  g = M.canDeleteInvoice(inv, [CN(200, "pending")]);
  check("a PENDING credit blocks deletion",
    g.allowed === false && g.reason === "credit_may_exist", `${g.reason}`);
  g = M.canDeleteInvoice(inv, [CN(200, "uncertain")]);
  check("an UNCERTAIN credit blocks deletion",
    g.allowed === false && g.reason === "credit_may_exist", `${g.reason}`);
  check("  and says to check Finbot first",
    /בדוק בפינבוט/.test(M.canDeleteInvoice(inv, [CN(200, "uncertain")]).message || ""));
  // A FAILED credit is the one proven state: nothing was created.
  g = M.canDeleteInvoice(inv, [CN(200, "failed")]);
  check("a FAILED credit does NOT block deletion — no document exists",
    g.allowed === true, `${g.reason}`);

  g = M.canDeleteInvoice(inv, [CN(200, "confirmed", { external_credit_note_number: "20400" })]);
  check("a CONFIRMED credit blocks deletion", g.allowed === false);
  check("  with the reason", g.reason === "confirmed_credit_exists");
  check("  naming the document", /20400/.test(g.message || ""), g.message);
  check("  and counting them", g.confirmedCount === 1);

  g = M.canDeleteInvoice(inv, [
    CN(200, "confirmed", { external_credit_note_number: "20401" }),
    CN(300, "confirmed", { external_credit_note_number: "20402" }),
    CN(100, "uncertain"),
  ]);
  check("several confirmed credits all block it",
    g.allowed === false && g.confirmedCount === 2, `${g.confirmedCount}`);
  check("  and all are named", /20401/.test(g.message) && /20402/.test(g.message));

  // A legacy credit note with provider evidence blocks it too.
  g = M.canDeleteInvoice(inv, [CN(200, undefined, { external_credit_note_number: "20099" })]);
  check("a legacy credit with a document number blocks deletion", g.allowed === false);
  // Another invoice's credit note is irrelevant.
  g = M.canDeleteInvoice(inv, [{ id: "x", invoice_id: "other", total: -500,
                                 finbot_status: "confirmed",
                                 external_credit_note_number: "20500" }]);
  check("another invoice's credit does not block this one", g.allowed === true);
}

console.log("\n5. LEGACY ROWS KEEP MEANING WHAT THEY MEANT");
{
  // A credit note from before the lifecycle column: its document number is the
  // evidence, because that column is only ever written from a success.
  const withEvidence = bal(INV(), [CN(400, undefined, { external_credit_note_number: "20099" })]);
  check("a legacy credit WITH a document number counts",
    withEvidence.outstanding === 600 && withEvidence.state === "partial",
    `${withEvidence.outstanding}`);
  const without = bal(INV(), [CN(400, undefined)]);
  check("a legacy credit WITHOUT one counts for nothing",
    without.outstanding === 1000 && without.state === "none", `${without.outstanding}`);
  check("  and is not even listed as unsettled — it is unclassified",
    without.unsettled === 0);

  // An invoice marked credited before credit notes were tracked at all.
  const marked = bal(INV({ credited_at: "2026-05-01T00:00:00Z" }), []);
  check("credited_at with no credit note means FULLY credited",
    marked.credited === 1000 && marked.outstanding === 0 && marked.state === "full",
    JSON.stringify([marked.credited, marked.outstanding, marked.state]));
  check("  and it is flagged as the legacy reading", marked.legacyFull === true);

  // But once a real confirmed credit exists, IT is the truth, not credited_at.
  const both = bal(INV({ credited_at: "2026-05-01T00:00:00Z" }),
    [CN(250, "confirmed", { external_credit_note_number: "20600" })]);
  check("a tracked credit overrides the legacy flag",
    both.credited === 250 && both.outstanding === 750, `${both.credited}`);
  check("  and it is no longer the legacy reading", both.legacyFull === false);
}

console.log("\n6. A CUSTOMER'S TWO SIDES ARE NEVER NETTED INTO ONE");
{
  const invoices = [
    INV({ id: "a", total: 1000, paid_amount: 0 }),           // owes 1000
    INV({ id: "b", total: 1000, paid_amount: 1000 }),         // credited below
    INV({ id: "c", total: 500, paid_amount: 500 }),           // settled
  ];
  const cns = [
    { id: "cn-b", invoice_id: "b", total: -1000, finbot_status: "confirmed",
      external_credit_note_number: "20700" },
  ];
  const p = M.customerPosition(invoices, cns);
  check("one invoice owes 1000", p.debt === 1000, `${p.debt}`);
  check("another is owed 1000 back", p.refundDue === 1000, `${p.refundDue}`);
  check("the net is zero — and that is NOT the whole story", p.net === 0);
  check("both sides are reported, so the net cannot hide them",
    p.debt === 1000 && p.refundDue === 1000);
  check("every invoice is accounted for", p.perInvoice.length === 3);

  // A settled invoice contributes to neither side.
  const settled = p.perInvoice.find(x => x.invoice.id === "c").position;
  check("a settled invoice is on neither side",
    settled.debtAg === 0 && settled.refundDueAg === 0);

  // Unsettled credits are surfaced at the customer level too.
  const q = M.customerPosition([INV({ id: "d", total: 800 })],
    [{ id: "u", invoice_id: "d", total: -300, finbot_status: "uncertain" }]);
  check("an unsettled credit is reported but not netted",
    q.debt === 800 && q.unsettled === 300, `${q.debt}/${q.unsettled}`);
}

console.log("\n7. ROUNDING: MONEY IS INTEGER AGOROT");
{
  const b = bal(INV({ total: 185.99, paid_amount: 0 }),
    [CN(62.00, "confirmed", { external_credit_note_number: "1" })]);
  check("185.99 − 62.00 = 123.99 exactly", near(b.outstanding, 123.99), `${b.outstanding}`);
  const thirds = bal(INV({ total: 100 }), [
    CN(33.33, "confirmed", { external_credit_note_number: "1" }),
    CN(33.33, "confirmed", { external_credit_note_number: "2" }),
    CN(33.34, "confirmed", { external_credit_note_number: "3" }),
  ]);
  check("three credits of a third each leave exactly zero",
    thirds.outstanding === 0 && thirds.state === "full", `${thirds.outstanding}`);
  check("and the credited figure is exactly the total", thirds.credited === 100);
}


console.log("\n8. INTEGRATION — every screen must give the SAME answer");
{
  // One customer, one invoice of 1,000, paid 400, credited 200 (confirmed) and
  // 150 more awaiting Finbot. The true position: 1000 − 200 = 800 receivable,
  // 400 paid, so 400 still owed. The 150 moves nothing.
  const inv = INV({ id: "inv-1", customer_id: "cust-1", date: "2026-11-01",
                    total: 1000, paid_amount: 400 });
  const cns = [
    { id: "c1", invoice_id: "inv-1", total: -200, finbot_status: "confirmed",
      external_credit_note_number: "20800", created_at: "2026-11-05T00:00:00Z",
      credit_note_number: "זיכוי-1" },
    { id: "c2", invoice_id: "inv-1", total: -150, finbot_status: "uncertain",
      created_at: "2026-11-06T00:00:00Z", credit_note_number: "זיכוי-2" },
  ];
  const pays = [{ id: "p1", invoice_id: "inv-1", amount: 400,
                  payment_date: "2026-11-03", payment_method: "מזומן" }];

  // (1) debt summary / customer balance
  const cust = M.customerPosition([inv], cns, pays);
  check("debt summary: 400 owed", cust.debt === 400, `${cust.debt}`);
  check("  nothing owed back", cust.refundDue === 0);
  check("  and 150 flagged as awaiting Finbot", cust.unsettled === 150, `${cust.unsettled}`);

  // (3) invoice list / details
  const b = bal(inv, cns, pays);
  check("invoice list: shows partial", b.state === "partial");
  check("  credited 200 of 1000", b.credited === 200);
  check("  outstanding 400", b.outstanding === 400);

  // (4) payment allocation
  check("payment dialog: the invoice is payable", M.isAllocatable(inv, cns) === true);
  let v = M.validateAllocation({ invoices: [inv], creditNotes: cns,
    amounts: { "inv-1": 400 }, paymentAmount: 400 });
  check("  paying the remaining 400 validates", v.errors.length === 0, JSON.stringify(v.errors));
  check("  and the line reports 400 as what was left",
    v.lines[0].remainingAgorot === 40000, `${v.lines?.[0]?.remainingAgorot}`);
  v = M.validateAllocation({ invoices: [inv], creditNotes: cns,
    amounts: { "inv-1": 401 }, paymentAmount: 401 });
  check("  401 is an overpayment", v.errors.some(e => e.code === "overpayment"));

  // automatic allocation sweeps the same figure
  const auto = M.autoAllocate({ invoices: [inv], totalAgorot: 40000, creditNotes: cns });
  check("auto allocation: 400 is exactly the eligible amount",
    auto.eligibleAgorot === 40000, `${auto.eligibleAgorot}`);
  check("  and it allocates all of it", auto.allocatedAgorot === 40000 && auto.ok !== false);
  const over = M.autoAllocate({ invoices: [inv], totalAgorot: 50000, creditNotes: cns });
  check("  500 exceeds what is outstanding and is refused",
    over.ok === false, JSON.stringify(over.code));
  // Credit-blind, the old behaviour would have thought 600 was available.
  const blind = M.autoAllocate({ invoices: [inv], totalAgorot: 40000 });
  check("  without credit notes it would have believed 600 was open",
    blind.eligibleAgorot === 60000, `${blind.eligibleAgorot}`);

  // (2) ledger / statement
  const st = M.buildStatement({ invoices: [inv], payments: pays, creditNotes: cns });
  const kinds = st.rows.map(r => r.kind);
  check("statement: the confirmed credit is a row", kinds.filter(k => k === "credit_note").length === 1,
    JSON.stringify(kinds));
  check("  the UNCERTAIN credit is NOT a row", st.rows.every(r => r.id !== "c2"));
  check("  closing balance is 400 — the same figure as the debt summary",
    st.allTime.closing === 40000, `${st.allTime.closing}`);
  check("  and the uncertain credit is named as a cause",
    (st.reconciliation.causes || []).some(c => c.code === "credits_awaiting_finbot"
      && c.amount === 15000),
    JSON.stringify(st.reconciliation.causes));

  // THE PROPERTY: four screens, one number.
  check("debt summary === invoice list === statement closing",
    cust.debtAg === b.outstandingAg && b.outstandingAg === st.allTime.closing,
    `${cust.debtAg}/${b.outstandingAg}/${st.allTime.closing}`);
}

console.log("\n9. INTEGRATION — paid in full, then partially credited");
{
  const inv = INV({ id: "inv-2", customer_id: "c", date: "2026-11-01",
                    total: 500, paid_amount: 500, payment_status: "שולם" });
  const cns = [{ id: "r1", invoice_id: "inv-2", total: -200, finbot_status: "confirmed",
                 external_credit_note_number: "20900", created_at: "2026-11-10T00:00:00Z",
                 credit_note_number: "זיכוי-ר" }];
  const pays = [{ id: "p", invoice_id: "inv-2", amount: 500,
                  payment_date: "2026-11-02", payment_method: "מזומן" }];

  const cust = M.customerPosition([inv], cns, pays);
  check("the customer owes nothing", cust.debt === 0);
  check("and is owed 200 BACK", cust.refundDue === 200, `${cust.refundDue}`);
  check("the net is minus 200", cust.net === -200);

  const st = M.buildStatement({ invoices: [inv], payments: pays, creditNotes: cns });
  check("the statement closes at minus 200, with the sign kept",
    st.allTime.closing === -20000, `${st.allTime.closing}`);
  check("which the statement reads as a customer credit balance",
    st.allTime.closing < 0, `${st.allTime.closing}`);
  check("no further payment may be allocated to it",
    M.isAllocatable(inv, cns) === false);
  const v = M.validateAllocation({ invoices: [inv], creditNotes: cns,
    amounts: { "inv-2": 10 }, paymentAmount: 10 });
  check("and attempting one is refused",
    v.errors.some(e => e.code === "invoice_credited"), JSON.stringify(v.errors));
}

console.log("\n10. INTEGRATION — several partial credits on one invoice");
{
  const inv = INV({ id: "inv-3", customer_id: "c", date: "2026-11-01", total: 1000 });
  const mk = (n, amt, st) => ({
    id: `m${n}`, invoice_id: "inv-3", total: -amt,
    finbot_status: st, credit_note_number: `זיכוי-${n}`,
    created_at: `2026-11-0${n}T00:00:00Z`,
    ...(st === "confirmed" ? { external_credit_note_number: `209${n}` } : {}),
  });
  const cns = [mk(1, 100, "confirmed"), mk(2, 250, "confirmed"),
               mk(3, 150, "uncertain"), mk(4, 300, "failed")];

  const b = bal(inv, cns);
  check("two confirmed credits sum to 350", b.credited === 350, `${b.credited}`);
  check("the failed and uncertain ones are not credited", b.credited === 350);
  check("650 is outstanding", b.outstanding === 650, `${b.outstanding}`);
  check("the state is partial", b.state === "partial");
  check("150 is flagged unsettled — the failed one is not",
    b.unsettled === 450, `${b.unsettled}`);
  check("counts: 2 confirmed, 2 unsettled",
    b.confirmedCount === 2 && b.unsettledCount === 2);

  check("it is still payable, up to 650", M.isAllocatable(inv, cns) === true);
  let v = M.validateAllocation({ invoices: [inv], creditNotes: cns,
    amounts: { "inv-3": 650 }, paymentAmount: 650 });
  check("  650 validates", v.errors.length === 0, JSON.stringify(v.errors));
  v = M.validateAllocation({ invoices: [inv], creditNotes: cns,
    amounts: { "inv-3": 651 }, paymentAmount: 651 });
  check("  651 does not", v.errors.some(e => e.code === "overpayment"));

  const st = M.buildStatement({ invoices: [inv], payments: [], creditNotes: cns });
  check("the statement shows exactly the two confirmed credits",
    st.rows.filter(r => r.kind === "credit_note").length === 2);
  check("and closes at 650, agreeing with the invoice list",
    st.allTime.closing === 65000, `${st.allTime.closing}`);

  // Credits reaching the total exactly.
  const full = bal(inv, [mk(1, 400, "confirmed"), mk(2, 600, "confirmed")]);
  check("credits summing to the total read as FULLY credited",
    full.state === "full" && full.outstanding === 0);
  check("and the invoice is no longer payable",
    M.isAllocatable(inv, [mk(1, 400, "confirmed"), mk(2, 600, "confirmed")]) === false);
}

console.log("\n11. INTEGRATION — legacy full credits, untouched");
{
  // The pre-Gate-A shape: invoice marked credited, one credit note with a
  // document number and no lifecycle column at all.
  const inv = INV({ id: "inv-4", customer_id: "c", date: "2026-05-01", total: 840,
                    paid_amount: 840, payment_status: "זוכה",
                    credited_at: "2026-05-10T00:00:00Z", credit_note_id: "old" });
  const cns = [{ id: "old", invoice_id: "inv-4", total: -840,
                 external_credit_note_number: "20099",
                 credit_note_number: "זיכוי-10073",
                 created_at: "2026-05-10T00:00:00Z" }];
  const pays = [{ id: "p", invoice_id: "inv-4", amount: 840,
                  payment_date: "2026-05-02", payment_method: "שיק" }];

  const b = bal(inv, cns, pays);
  check("the legacy credit counts in full", b.credited === 840 && b.state === "full");
  check("and the 840 paid is owed back", b.outstanding === -840 && b.refundDue === 840,
    `${b.outstanding}`);
  check("it is not payable", M.isAllocatable(inv, cns) === false);
  check("and it cannot be deleted", M.canDeleteInvoice(inv, cns).allowed === false);

  const st = M.buildStatement({ invoices: [inv], payments: pays, creditNotes: cns });
  check("the statement includes it as a credit",
    st.rows.filter(r => r.kind === "credit_note").length === 1);
  check("closing minus 840, matching the invoice list",
    st.allTime.closing === -84000, `${st.allTime.closing}`);

  // An invoice marked credited with NO credit note at all — the oldest shape.
  const bare = INV({ id: "inv-5", total: 300, paid_amount: 0,
                     credited_at: "2026-01-01T00:00:00Z" });
  const bb = bal(bare, []);
  check("credited_at alone still means fully credited",
    bb.state === "full" && bb.outstanding === 0 && bb.legacyFull === true);
  check("and it is not payable", M.isAllocatable(bare, []) === false);
  check("but it CAN be deleted — no document is on record",
    M.canDeleteInvoice(bare, []).allowed === true);
}


console.log("\n12. SAFEGUARD — a FAILED credit affects no figure at all");
{
  const inv = INV({ id: "f-1", total: 1000, paid_amount: 300 });
  const failed = [{ id: "fc", invoice_id: "f-1", total: -400, finbot_status: "failed",
                    finbot_error: "Finbot HTTP 400: bad linkedDocument" }];

  const b = bal(inv, failed);
  check("it does not reduce the receivable", b.netReceivable === 1000, `${b.netReceivable}`);
  check("the debt is the full 700", b.outstanding === 700, `${b.outstanding}`);
  check("the invoice is NOT shown as credited", b.state === "none", b.state);
  check("it is NOT counted as awaiting verification", b.pending === 0, `${b.pending}`);
  check("it IS visible for audit", b.failed === 400 && b.failedCount === 1,
    `${b.failed}/${b.failedCount}`);

  const cust = M.customerPosition([inv], failed);
  check("the customer balance is untouched by it", cust.debt === 700 && cust.refundDue === 0);
  check("nothing is reported as awaiting Finbot", cust.pending === 0, `${cust.pending}`);
  check("and the failure is reported apart", cust.failed === 400, `${cust.failed}`);

  check("the invoice stays fully payable", M.isAllocatable(inv, failed) === true);
  let v = M.validateAllocation({ invoices: [inv], creditNotes: failed,
    amounts: { "f-1": 700 }, paymentAmount: 700 });
  check("  the whole 700 may be allocated", v.errors.length === 0, JSON.stringify(v.errors));
  v = M.validateAllocation({ invoices: [inv], creditNotes: failed,
    amounts: { "f-1": 701 }, paymentAmount: 701 });
  check("  and 701 is still an overpayment", v.errors.some(e => e.code === "overpayment"));
  const auto = M.autoAllocate({ invoices: [inv], totalAgorot: 70000, creditNotes: failed });
  check("  automatic allocation sees the full 700", auto.eligibleAgorot === 70000,
    `${auto.eligibleAgorot}`);

  const st = M.buildStatement({ invoices: [INV({ id: "f-1", total: 1000, date: "2026-11-01" })],
    payments: [], creditNotes: failed });
  check("the statement shows NO credit row for it",
    st.rows.filter(r => r.kind === "credit_note").length === 0);
  check("the closing balance is the full 1000", st.allTime.closing === 100000,
    `${st.allTime.closing}`);
  check("it is NOT a 'awaiting Finbot' cause",
    !(st.reconciliation.causes || []).some(c => c.code === "credits_awaiting_finbot"),
    JSON.stringify(st.reconciliation.causes));
  check("it IS an audit cause, marked as such",
    (st.reconciliation.causes || []).some(c => c.code === "credits_refused_by_finbot"
      && c.amount === 40000 && c.audit === true),
    JSON.stringify(st.reconciliation.causes));

  // And it still appears in the queue a person works through, because it
  // invites a retry — a different question from whether a document exists.
  check("it is still in the reconciliation queue",
    M.isUnsettledCredit(failed[0]) === true);
  check("while 'may exist' is false for it", M.mayExistCredit(failed[0]) === false);
}

console.log("\n13. SAFEGUARD — nothing with an issued external document is deletable");
{
  const bare = INV({ id: "d-1", total: 100 });
  check("a plain local invoice is deletable",
    M.canDeleteInvoice(bare, []).allowed === true);

  // The invoice's OWN Finbot document, by each of the three columns that can
  // carry it.
  for (const [key, val] of [["external_invoice_number", "10073"],
                            ["finbot_serial", "SER-1"],
                            ["external_pdf_url", "https://x.test/inv.pdf"]]) {
    const g = M.canDeleteInvoice(INV({ id: "d-1", total: 100, [key]: val }), []);
    check(`${key} blocks deletion`, g.allowed === false, `${g.reason}`);
    check("  with the right reason", g.reason === "invoice_issued_externally", g.reason);
    check("  and it points at issuing a credit instead",
      /זיכוי/.test(g.message || ""), g.message);
  }
  check("an empty string is not a document",
    M.canDeleteInvoice(INV({ id: "d-1", external_invoice_number: "  " }), []).allowed === true);

  // Precedence: a confirmed credit is reported before the invoice's own
  // document, because it is the more specific problem.
  const both = M.canDeleteInvoice(
    INV({ id: "d-1", total: 100, external_invoice_number: "10073" }),
    [CN(100, "confirmed", { invoice_id: "d-1", external_credit_note_number: "20999" })]);
  check("a confirmed credit takes precedence in the message",
    both.allowed === false && both.reason === "confirmed_credit_exists", both.reason);

  // LEGACY: the oldest shape of all — credited_at, a credit note with a
  // document number and no lifecycle column, and an externally issued invoice.
  const legacy = M.canDeleteInvoice(
    INV({ id: "d-1", total: 840, credited_at: "2026-05-01", credit_note_id: "old",
          external_invoice_number: "10073", finbot_serial: "SER-9" }),
    [{ id: "old", invoice_id: "d-1", total: -840,
       external_credit_note_number: "20099" }]);
  check("a legacy credited invoice is not deletable", legacy.allowed === false);
  check("  recognised through its document number",
    legacy.reason === "confirmed_credit_exists" && legacy.confirmedCount === 1);

  // A legacy invoice with NO external document and no credit note stays
  // deletable — the guard adds no friction where nothing was issued.
  check("a purely local legacy invoice is still deletable",
    M.canDeleteInvoice(INV({ id: "d-1", credited_at: "2026-01-01" }), []).allowed === true);
}


console.log("\n14. FINAL READINESS — the four fixes");
{
  const readFile = (rel) => readFileSync(resolve(REPO, rel), "utf8");

  // ---- 1. migration B refuses to run without A ------------------------
  const B = readFile("supabase/migrations/20261118130000_add_credit_note_operations.sql");
  check("B has a Gate A dependency block", /\$require_a\$/.test(B));
  check("  it checks every column A adds",
    ["finbot_status", "finbot_error", "finbot_attempted_at",
     "finbot_confirmed_source", "operation_id"]
      .every(c => new RegExp(`'${c}'`).test(B)));
  check("  and the guard A installs",
    /credit_notes_finbot_status_guard[\s\S]{0,400}RAISE EXCEPTION/.test(B));
  check("  naming the file to apply first",
    /20261118120000_add_credit_note_finbot_lifecycle\.sql/.test(B));
  check("  and the block runs BEFORE anything is altered",
    B.indexOf("$require_a$") < B.indexOf("ADD COLUMN IF NOT EXISTS finbot_resolution_note"));

  // ---- 2. a full credit attributes its lines --------------------------
  const btn = readFile("src/components/invoices/CreditNoteButton.jsx");
  check("the full-credit path records source_line_index",
    /source_line_index: index/.test(btn));
  check("  from the item's own position", /items\.map\(\(item, index\)/.test(btn));

  // And it is then attributable, which is the point.
  const invoice = { id: "inv-1", total: 1180, vat_rate: 18, items: [
    { product_id: "p-a", name: "a", quantity: 4, unit_price: 100, total: 400, discount: 0 },
    { product_id: "p-b", name: "b", quantity: 6, unit_price: 100, total: 600, discount: 0 },
  ] };
  const fullCreditLines = invoice.items.map((item, index) => ({
    ...item, total: -Math.abs(item.total), unit_price: -Math.abs(item.unit_price),
    kind: "return", source_line_index: index,
  }));
  const after = M.creditedQuantities([{ id: "f", invoice_id: "inv-1",
    finbot_status: "pending", items: fullCreditLines }]);
  check("a pending FULL credit is attributed to both lines",
    after.get(0) === 4 && after.get(1) === 6,
    `${after.get(0)}/${after.get(1)}`);
  // Which is what stops the partial screen offering lines that are taken.
  const info = M.creditableInvoice(invoice, [{ id: "f", invoice_id: "inv-1",
    finbot_status: "pending", total: -1180, items: fullCreditLines }]);
  check("  so the partial screen shows nothing left on either line",
    info.lines[0].remainingQty === 0 && info.lines[1].remainingQty === 0);
  check("  and offers no return control for them",
    !info.lines[0].canReturn && !info.lines[1].canReturn);

  // ---- 3. the global alert ------------------------------------------
  const inv = readFile("src/pages/Invoices.jsx");
  check("the invoices page imports the reconciliation screen",
    /CreditNoteReconcileDialog/.test(inv) && /unsettledCreditNotes/.test(inv));
  check("  mounts it with EVERY credit note, not one customer's",
    /creditNotes=\{creditNotes \|\| \[\]\}[\s\S]{0,80}\/>/.test(inv)
    || /<CreditNoteReconcileDialog[\s\S]{0,220}creditNotes=\{creditNotes \|\| \[\]\}/.test(inv));
  check("  and distinguishes awaiting-check from refused",
    /finbot_status !== "failed"/.test(inv) && /נדחו|נדחה/.test(inv));

  // ---- 4. order-based and invoice-based figures stay apart ----------
  const rep = readFile("src/pages/Reports.jsx");
  check("Reports computes an invoice-based net revenue", /invoicedNet/.test(rep));
  check("  netting only CONFIRMED credits", /isConfirmedCredit/.test(rep));
  check("  reporting unverified ones separately, un-netted",
    /isUnsettledCredit/.test(rep) && /טרם אומתו/.test(rep));
  check("  in its own block, NOT in the order-based stats row",
    /invoicedStats/.test(rep) && !/stats = \[[\s\S]{0,400}invoicedNet/.test(rep));
  check("  and says so on the screen", /נפרד ממכירות לפי הזמנות/.test(rep));
  // The order-based figures are untouched.
  check("the order-based sales figures still come from orders only",
    /salesToday = useMemo[\s\S]{0,400}orders\n?\s*\.filter/.test(rep));
  check("  and no credit arithmetic was put into them",
    !/salesToday[\s\S]{0,600}creditNote/i.test(rep));
}


console.log("\n15. A CREDIT BELONGS TO ITS OWN PERIOD, NOT THE INVOICE'S");
{
  // The date a credit document counts in is its OWN. Backdating it into the
  // invoice's period restates a period that is already filed.
  check("the verified `date` column is used",
    M.creditDocumentDate({ date: "2026-03-05", created_at: "2026-03-09" })
      .toISOString().startsWith("2026-03-05"));
  // created_at is a SYSTEM TIMESTAMP, not an accounting date. They usually
  // agree, which is what makes the gap dangerous rather than visible: a
  // document dated 31 March written at 00:40 on 1 April would be reported in
  // April, and a filed period would be wrong by one document.
  check("created_at is NOT accepted as the accounting date",
    M.creditDocumentDate({ created_at: "2026-03-09T10:00:00Z" }) === null);
  check("nor created_date",
    M.creditDocumentDate({ created_date: "2026-03-11T10:00:00Z" }) === null);
  check("and a confirmed credit with no date is flagged for review",
    M.needsDateReview({ finbot_status: "confirmed",
                        external_credit_note_number: "50100",
                        created_at: "2026-03-09T10:00:00Z" }) === true);
  check("  while a dated one is not",
    M.needsDateReview({ finbot_status: "confirmed",
                        external_credit_note_number: "50100",
                        date: "2026-03-09" }) === false);
  check("  and an UNVERIFIED credit is not a date problem",
    M.needsDateReview({ finbot_status: "uncertain" }) === false
    && M.needsDateReview({ finbot_status: "failed" }) === false);

  // AND NEVER THE INVOICE'S. A credit note always carries invoice_id, so the
  // invoice's date is always reachable — and must not be reached for.
  for (const cn of [{ invoice_id: "inv-1" },
                    { invoice_id: "inv-1", date: null, created_at: null },
                    { invoice_id: "inv-1", created_at: "" },
                    { invoice_id: "inv-1", created_at: "not a date" },
                    {}]) {
    check(`${JSON.stringify(cn)} -> null, not a guess`,
      M.creditDocumentDate(cn) === null, String(M.creditDocumentDate(cn)));
  }

  // The reporting arithmetic, as Reports does it: a January invoice credited
  // in March reduces MARCH.
  const jan = { id: "i-jan", date: "2026-01-20", total: 1000 };
  const creditInMarch = { id: "c", invoice_id: "i-jan", total: -300,
    finbot_status: "confirmed", external_credit_note_number: "50100",
    date: "2026-03-05", created_at: "2026-03-05T00:00:00Z" };

  const inRange = (d, from, to) => d instanceof Date
    && d >= new Date(from) && d <= new Date(to);
  const report = (from, to) => {
    const invs = [jan].filter(i => inRange(new Date(i.date), from, to));
    const gross = invs.reduce((s2, i) => s2 + i.total, 0);
    const billedIds = new Set(invs.map(i => i.id));
    const confirmed = [creditInMarch].filter(M.isConfirmedCredit);
    const credited = confirmed
      .filter(cn => inRange(M.creditDocumentDate(cn), from, to))
      .reduce((s2, cn) => s2 + Math.abs(cn.total), 0);
    const against = confirmed.filter(cn => billedIds.has(cn.invoice_id))
      .reduce((s2, cn) => s2 + Math.abs(cn.total), 0);
    return { gross, credited, net: gross - credited,
             againstPeriodSales: against, salePeriodNet: gross - against };
  };

  const janR = report("2026-01-01", "2026-01-31");
  check("January's REVENUE is the full 1000 — not reduced retroactively",
    janR.gross === 1000 && janR.credited === 0 && janR.net === 1000,
    `${janR.net}`);
  check("  while the sale-period ANALYSIS does show the 300",
    janR.againstPeriodSales === 300 && janR.salePeriodNet === 700,
    `${janR.salePeriodNet}`);
  check("  so the two concepts give different answers, as they must",
    janR.net !== janR.salePeriodNet);

  const marR = report("2026-03-01", "2026-03-31");
  check("March's revenue carries the credit: 0 billed, 300 credited",
    marR.gross === 0 && marR.credited === 300 && marR.net === -300,
    `${marR.net}`);
  check("  and March's analysis shows nothing, no invoice of its own",
    marR.againstPeriodSales === 0);

  // Across the whole year both agree, which is the check that the credit is
  // counted exactly once.
  const yearR = report("2026-01-01", "2026-12-31");
  check("over the full year both readings agree at 700",
    yearR.net === 700 && yearR.salePeriodNet === 700,
    `${yearR.net}/${yearR.salePeriodNet}`);

  // Only VERIFIED documents count, in either reading.
  for (const st of ["pending", "uncertain", "failed"]) {
    const unver = { ...creditInMarch, finbot_status: st,
                    external_credit_note_number: null };
    check(`a ${st} credit is in neither figure`,
      !M.isConfirmedCredit(unver));
  }
  // A legacy credit with a provider number but no lifecycle still counts, and
  // still by its own date.
  const legacy = { id: "l", invoice_id: "i-jan", total: -100,
                   external_credit_note_number: "20050",
                   created_at: "2026-02-02T00:00:00Z" };
  check("a legacy credit with a document number is verified",
    M.isConfirmedCredit(legacy) === true);
  // But it has no accounting date — nothing was ever recorded, because Finbot's
  // reply carries none. It is flagged, not placed in February on the strength
  // of a system timestamp.
  check("  yet it is NOT attributed to a period",
    M.creditDocumentDate(legacy) === null);
  check("  and it is flagged for a date", M.needsDateReview(legacy) === true);

  // The source, so the two concepts cannot be quietly merged later.
  const rep = readFileSync(resolve(REPO, "src/pages/Reports.jsx"), "utf8");
  check("Reports dates credits by their own document date",
    /credited \+= amount\(cn\)/.test(rep) && /inRange\(own\)/.test(rep));
  check("  reports undated confirmed credits instead of placing them",
    /undated \+= amount\(cn\)/.test(rep) && /ללא תאריך מסמך/.test(rep));
  check("  keeps the sale-period view separate",
    /againstPeriodSales/.test(rep) && /salePeriodNet/.test(rep));
  check("  and labels it as unfit for filing", /אינו מתאים לדיווח/.test(rep));
}


console.log("\n16. THE DATE COLUMN, END TO END");
{
  const read = (rel) => readFileSync(resolve(REPO, rel), "utf8");
  const B = read("supabase/migrations/20261118130000_add_credit_note_operations.sql");

  check("migration B adds a nullable DATE column",
    /ADD COLUMN IF NOT EXISTS date DATE,/.test(B));
  check("  with no DEFAULT", !/ADD COLUMN IF NOT EXISTS date DATE DEFAULT/.test(B));
  // No backfill: the only write to `date` is inside credit_note_confirm, where
  // a repeat confirmation may supply a date that was missing on ONE row. The
  // DDL section itself touches no row — and the migration's own verification
  // block proves it, which the PGlite suite executes.
  check("  and no write to `date` outside the confirm function",
    B.slice(0, B.indexOf("CREATE OR REPLACE FUNCTION")).indexOf("SET date") === -1);
  check("  and verifies that nothing was dated",
    /credit_notes WHERE date IS NOT NULL/.test(B)
    && /were given a date/.test(B));
  check("  and that it is a DATE, not a timestamp",
    /column_name = 'date' AND data_type = 'date'/.test(B));
  check("confirm takes the document date", /p_document_date  DATE DEFAULT NULL/.test(B));
  check("  and never overwrites one already there",
    /date = COALESCE\(date, p_document_date\)/.test(B));
  check("  the old 4-argument overload is dropped",
    /DROP FUNCTION IF EXISTS public\.credit_note_confirm\(UUID, TEXT, TEXT, TEXT\);/.test(B));
  check("  and the grant names the new signature",
    /credit_note_confirm\(UUID, TEXT, TEXT, TEXT, DATE\) TO authenticated/.test(B));
  check("B still refuses to run before A",
    B.indexOf("$require_a$") < B.indexOf("ADD COLUMN IF NOT EXISTS date DATE"));

  const btn = read("src/components/invoices/CreditNoteButton.jsx");
  check("the client sends the date it asked Finbot for",
    /const documentDate = new Date\(\)/.test(btn)
    && /date: documentDate/.test(btn)
    && /p_document_date: documentDate/.test(btn));
  check("  and it is the SAME value in both places, not two clocks",
    (btn.match(/documentDate/g) || []).length === 3,
    `${(btn.match(/documentDate/g) || []).length}`);

  const dlg = read("src/components/invoices/CreditNoteReconcileDialog.jsx");
  check("the reconciliation screen asks for the document's date",
    /type="date"/.test(dlg) && /תאריך המסמך/.test(dlg));
  check("  passing it on confirmation", /p_document_date: docDate/.test(dlg));
  check("  and says it is not the system's record date",
    /לא תאריך הרישום במערכת/.test(dlg));
  check("  it lists confirmed-but-undated documents separately",
    /creditNotesNeedingDate/.test(dlg) && /חסר תאריך/.test(dlg));
  check("  stating that they are in no reporting period",
    /אינם משויכים לשום תקופה/.test(dlg));

  const inv = read("src/pages/Invoices.jsx");
  check("the global banner counts undated documents too",
    /creditNotesNeedingDate/.test(inv) && /לא משויך/.test(inv));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
