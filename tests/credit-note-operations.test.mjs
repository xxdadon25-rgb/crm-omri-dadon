// Do the three credit-note operations hold under retries, concurrency and
// every Finbot outcome?
//
// HOW TO RUN
//   npm i --no-save @electric-sql/pglite
//   node tests/credit-note-operations.test.mjs
//
// Both migrations are applied VERBATIM to a throwaway PostgreSQL. No production
// database is touched.
//
// WHAT IT PROVES
//   1. One operation produces one credit note however many times it is
//      submitted, and a repeat never re-runs a side effect.
//   2. Cumulative credits cannot pass the invoice total — and payments are not
//      part of that sum, so a fully paid invoice can still be credited.
//   3. Stock returns ONLY on confirmation, once, and never for a price-only
//      credit.
//   4. An uncertain attempt cannot be retried, and cannot be called failed
//      without recorded evidence.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIG_A = resolve(REPO, "supabase/migrations/20261118120000_add_credit_note_finbot_lifecycle.sql");
const MIG_B = resolve(REPO, "supabase/migrations/20261118130000_add_credit_note_operations.sql");

let pass = 0, fail = 0;
const check = (n, c, d = "") => {
  c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  ${d}`));
};
const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
async function attempt(sql, params) {
  try { return { ok: true, rows: await q(sql, params), error: null }; }
  catch (e) { return { ok: false, rows: null, error: String(e?.message ?? e) }; }
}
// A MIGRATION IS MANY STATEMENTS, so it goes through exec(), not query():
// query() prepares a single statement and rejects the rest with "cannot insert
// multiple commands into a prepared statement" — which is a harness error that
// looks nothing like a migration error.
async function execAttempt(sql) {
  try { await db.exec(sql); return { ok: true, error: null }; }
  catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
}

console.log("postgres:", (await db.query("select version()")).rows[0].version.split(",")[0]);

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";

// ============================================================================
// Production's shape, plus a stand-in for auth.uid() driven by a session GUC —
// the same thing Supabase's JWT does, so the functions are exercised exactly as
// written, including their user scoping.
// ============================================================================
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create role authenticated;

  create table public.products (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    name text not null,
    quantity numeric default 0
  );
  create table public.invoices (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    invoice_number integer,
    customer_id uuid,
    customer_name text not null,
    total numeric,
    paid_amount numeric default 0,
    payment_status text default 'ממתין לתשלום',
    credited_at timestamptz,
    credit_note_id uuid,
    finbot_serial text,
    items jsonb default '[]'
  );
  create table public.payments (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    invoice_id uuid not null,
    customer_id uuid not null,
    amount numeric not null,
    payment_method text not null,
    payment_date date not null
  );
  create table public.credit_notes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    credit_note_number text unique,
    invoice_id uuid references public.invoices(id),
    order_id uuid,
    customer_id uuid,
    items jsonb default '[]',
    total numeric,
    reason text,
    external_credit_note_number text,
    external_credit_note_url text,
    created_at timestamptz default now(),
    created_by text
  );
  insert into auth.users (id) values ('${U1}'), ('${U2}');
`);

// Generous line quantities ON PURPOSE: sections 1-8 were written to exercise
// the AMOUNT cap, and now that per-line quantities are enforced as well, a thin
// fixture would fail on the quantity instead and stop testing what it meant to.
// Section 10 covers the quantity limits specifically.
const GENEROUS_ITEMS = JSON.stringify([
  { product_id: "cccccccc-0000-0000-0000-00000000000a", name: "מוצר א",
    quantity: 500, unit_price: 50, total: 25000 },
  { product_id: "cccccccc-0000-0000-0000-00000000000b", name: "מוצר ב",
    quantity: 500, unit_price: 25, total: 12500 },
]);
const INV = "aaaaaaaa-0000-0000-0000-000000000001";
const P_A = "cccccccc-0000-0000-0000-00000000000a";
const P_B = "cccccccc-0000-0000-0000-00000000000b";
await db.exec(`
  insert into public.products (id, user_id, name, quantity)
  values ('${P_A}', '${U1}', 'מוצר א', 10), ('${P_B}', '${U1}', 'מוצר ב', 5);
  -- Generous quantities ON PURPOSE: sections 1-8 were written to exercise the
  -- AMOUNT cap, and now that per-line quantities are also enforced, thin
  -- fixtures would fail on the quantity instead and stop testing what they
  -- meant to. Section 10 covers the quantity limits specifically.
  insert into public.invoices (id, user_id, invoice_number, customer_id, customer_name, total, finbot_serial, items)
  values ('${INV}', '${U1}', 10073, '${"dddddddd-0000-0000-0000-000000000001"}', 'שירה אלון', 1000, 'SER-1',
          '${GENEROUS_ITEMS}'::jsonb);
`);
await db.query(`select set_config('test.uid', $1, false)`, [U1]);

console.log("\n0. BOTH MIGRATIONS APPLY");
for (const [label, path] of [["gate A", MIG_A], ["gate B", MIG_B]]) {
  const r = await execAttempt(readFileSync(path, "utf8"));
  check(`${label} applies cleanly`, r.ok, r.error);
}
{
  const r = await execAttempt(readFileSync(MIG_B, "utf8"));
  check("gate B is idempotent", r.ok, r.error);
}

// A zero-quantity RETURN is not a line, and a price adjustment carries no
// quantity at all — the validator refuses both, so the helper no longer emits
// them. No source_line_index: on the generous fixture each product appears
// exactly once, which exercises the resolve-by-product path.
const ITEMS = (aQty, bQty, kind = null) => JSON.stringify(
  [[P_A, "מוצר א", aQty, 50], [P_B, "מוצר ב", bQty, 25]]
    .filter(([, , qty]) => kind === "price_adjustment" || qty > 0)
    .map(([pid, name, qty, price]) => ({
      product_id: pid, name,
      quantity: kind === "price_adjustment" ? 0 : qty,
      unit_price: -price, total: -price * qty,
      ...(kind ? { kind } : {}),
    })));
// credit_note_number is UNIQUE in production, so every fixture needs its own.
// Deriving it from the operation id does not work here: these ids differ only
// in their last digits.
let cnSeq = 0;
const reserve = (op, total, items = ITEMS(2, 1), num = null, inv = INV) =>
  attempt(`select public.credit_note_reserve($1,$2,$3,$4::jsonb,$5,$6,$7,$8) as r`,
          [op, inv, num ?? `cn-auto-${++cnSeq}`, items, total, "זיכוי", null, "tester"]);
const confirm = (id, num, url = null, src = "api", docDate = null) =>
  attempt(`select public.credit_note_confirm($1,$2,$3,$4,$5) as r`,
          [id, num, url, src, docDate]);
const resolveTo = (id, status, err = null, ev = null) =>
  attempt(`select public.credit_note_resolve($1,$2,$3,$4) as r`, [id, status, err, ev]);
const stock = async () => Object.fromEntries((await q(
  `select id, quantity from public.products where user_id = $1`, [U1]))
  .map(r => [r.id === P_A ? "a" : "b", Number(r.quantity)]));
const row = async (id) => (await q(`select * from public.credit_notes where id = $1`, [id]))[0];

console.log("\n1. RESERVE IS IDEMPOTENT, AND HAS NO SIDE EFFECTS");
const OP1 = "99999999-0000-0000-0000-000000000001";
let cn1;
{
  const s0 = await stock();
  const r = await reserve(OP1, 125);
  check("the first reservation succeeds", r.ok, r.error);
  const res = r.rows?.[0]?.r;
  cn1 = res?.credit_note_id;
  check("it reports that it created the credit note", res?.created === true,
    JSON.stringify(res));
  check("in state pending", res?.finbot_status === "pending", JSON.stringify(res));
  check("the amount is stored negative, as the table already does",
    Number(res?.total) === -125, `${res?.total}`);

  // NO SIDE EFFECTS. This is what makes a retry safe.
  const s1 = await stock();
  check("NO stock moved", s1.a === s0.a && s1.b === s0.b, JSON.stringify(s1));
  const inv = (await q(`select * from public.invoices where id = $1`, [INV]))[0];
  check("the invoice is untouched",
    inv.credited_at === null && inv.credit_note_id === null
    && inv.payment_status === "ממתין לתשלום", JSON.stringify(inv));

  // THE RETRY.
  const again = await reserve(OP1, 125);
  check("submitting the SAME operation again succeeds", again.ok, again.error);
  const res2 = again.rows?.[0]?.r;
  check("and reports it created nothing", res2?.created === false, JSON.stringify(res2));
  check("returning the same credit note", res2?.credit_note_id === cn1);
  const n = await q(`select count(*)::int as c from public.credit_notes where operation_id = $1`, [OP1]);
  check("exactly one credit note exists for that operation", n[0].c === 1, `${n[0].c}`);

  // A retry with a DIFFERENT amount is still the same operation and must not
  // create a second credit, nor change the first.
  const drift = await reserve(OP1, 900, ITEMS(9, 9), "cn-drift");
  check("a repeat carrying different data still creates nothing",
    drift.ok && drift.rows[0].r.created === false, JSON.stringify(drift.rows?.[0]?.r));
  check("and the stored amount is unchanged", Number((await row(cn1)).total) === -125);
}

console.log("\n2. THE CAP — AND PAYMENTS ARE NOT IN IT");
{
  // 125 of 1000 is committed. Several more partial credits are fine.
  const r2 = await reserve("99999999-0000-0000-0000-000000000002", 375);
  check("a second partial credit on the same invoice is allowed", r2.ok, r2.error);
  const r3 = await reserve("99999999-0000-0000-0000-000000000003", 500);
  void r2;
  check("a third that exactly reaches the total is allowed", r3.ok, r3.error);
  const used = await q(`select sum(abs(total)) as s from public.credit_notes where invoice_id = $1
                         and (finbot_status is null or finbot_status <> 'failed')`, [INV]);
  check("1000 of 1000 is now committed", Number(used[0].s) === 1000, `${used[0].s}`);

  const over = await reserve("99999999-0000-0000-0000-000000000004", 1);
  check("one agora more is REFUSED", !over.ok, "the invoice was over-credited");
  check("  and the refusal shows the arithmetic",
    /past its total/.test(over.error || "") && /1000/.test(over.error || ""), over.error);

  // A FULLY PAID invoice can still be credited. This is the case the rejected
  // invariant "credits + payments <= total" would have blocked.
  const INV2 = "aaaaaaaa-0000-0000-0000-000000000002";
  await db.exec(`
    insert into public.invoices (id, user_id, invoice_number, customer_name, total, paid_amount, payment_status, items)
    values ('${INV2}', '${U1}', 10074, 'לקוח ששילם', 500, 500, 'שולם', '${GENEROUS_ITEMS}'::jsonb);
    insert into public.payments (user_id, invoice_id, customer_id, amount, payment_method, payment_date)
    values ('${U1}', '${INV2}', '${"dddddddd-0000-0000-0000-000000000001"}', 500, 'מזומן', current_date);
  `);
  const paidCredit = await reserve("99999999-0000-0000-0000-000000000005", 200,
    ITEMS(1, 0), "cn-paid", INV2);
  check("a fully PAID invoice accepts a partial credit", paidCredit.ok, paidCredit.error);
  const pay = await q(`select count(*)::int as c, sum(amount) as s from public.payments where invoice_id = $1`, [INV2]);
  check("the payment is untouched", pay[0].c === 1 && Number(pay[0].s) === 500);
  const inv2 = (await q(`select paid_amount, payment_status from public.invoices where id = $1`, [INV2]))[0];
  check("and so is paid_amount and the payment status",
    Number(inv2.paid_amount) === 500 && inv2.payment_status === "שולם",
    JSON.stringify(inv2));
  // Credits are still bounded by the GOODS, not by what is unpaid.
  const overPaid = await reserve("99999999-0000-0000-0000-000000000006", 400,
    ITEMS(1, 0), "cn-paid-2", INV2);
  check("but the goods still bound it: 200 + 400 > 500 is refused", !overPaid.ok,
    "a paid invoice was credited past its total");

  // A FAILED credit frees its room again — nothing was ever issued.
  const r3id = r3.rows[0].r.credit_note_id;          // the 500 that filled the cap
  await resolveTo(r3id, "failed", "Finbot refused: invalid linkedDocument");
  const reuse = await reserve("99999999-0000-0000-0000-000000000007", 100);
  check("a failed credit releases its share of the cap", reuse.ok, reuse.error);
}

console.log("\n3. STOCK RETURNS ONLY ON CONFIRMATION, AND ONLY ONCE");
{
  const s0 = await stock();
  check("stock is still untouched after four reservations",
    s0.a === 10 && s0.b === 5, JSON.stringify(s0));

  // Confirming needs a document number — the evidence Gate A demands.
  let r = await confirm(cn1, "");
  check("confirming with no document number is refused", !r.ok, r.error);
  r = await confirm(cn1, "20200", "https://example.test/cn.pdf");
  check("confirming with one succeeds", r.ok, r.error);
  check("it reports both products restored", r.rows?.[0]?.r?.restored_products === 2,
    JSON.stringify(r.rows?.[0]?.r));

  const s1 = await stock();
  check("stock came back: 10 + 2 and 5 + 1", s1.a === 12 && s1.b === 6,
    JSON.stringify(s1));
  const cn = await row(cn1);
  check("the credit note is confirmed", cn.finbot_status === "confirmed");
  check("with the document number and source recorded",
    cn.external_credit_note_number === "20200" && cn.finbot_confirmed_source === "api");

  // THE DROPPED RESPONSE: confirming again with the same number.
  r = await confirm(cn1, "20200");
  check("confirming again with the same number succeeds", r.ok, r.error);
  check("  and reports it was already done", r.rows?.[0]?.r?.already === true);
  check("  restoring nothing a second time", r.rows?.[0]?.r?.restored_products === 0);
  const s2 = await stock();
  check("so the stock did not double", s2.a === 12 && s2.b === 6, JSON.stringify(s2));

  // A DIFFERENT number is a second document for one credit note.
  r = await confirm(cn1, "20201");
  check("attaching a DIFFERENT document is refused", !r.ok, "two documents on one credit note");
  check("  naming both numbers", /20200/.test(r.error || "") && /20201/.test(r.error || ""),
    r.error);

  // A PARTIAL credit must not mark the invoice credited.
  const inv = (await q(`select credited_at, payment_status from public.invoices where id = $1`, [INV]))[0];
  check("a 125-of-1000 credit leaves the invoice NOT marked credited",
    inv.credited_at === null && inv.payment_status === "ממתין לתשלום",
    JSON.stringify(inv));
}

console.log("\n4. A PRICE-ONLY CREDIT MOVES NO STOCK");
{
  const INV3 = "aaaaaaaa-0000-0000-0000-000000000003";
  await db.exec(`insert into public.invoices (id, user_id, invoice_number, customer_name, total, items)
                 values ('${INV3}', '${U1}', 10075, 'הפרש מחיר', 300, '${GENEROUS_ITEMS}'::jsonb);`);
  const r = await reserve("99999999-0000-0000-0000-00000000000a", 60,
    ITEMS(2, 1, "price_adjustment"), "cn-price", INV3);
  check("a price-adjustment credit reserves", r.ok, r.error);
  const before = await stock();
  const c = await confirm(r.rows[0].r.credit_note_id, "20300");
  check("and confirms", c.ok, c.error);
  check("restoring NOTHING", c.rows?.[0]?.r?.restored_products === 0,
    JSON.stringify(c.rows?.[0]?.r));
  const after = await stock();
  check("stock is unchanged — crediting an overcharge returns no goods",
    after.a === before.a && after.b === before.b, JSON.stringify(after));

  // A mixed credit: one line returned, one line a price adjustment.
  const INV4 = "aaaaaaaa-0000-0000-0000-000000000004";
  await db.exec(`insert into public.invoices (id, user_id, invoice_number, customer_name, total, items)
                 values ('${INV4}', '${U1}', 10076, 'מעורב', 300, '${GENEROUS_ITEMS}'::jsonb);`);
  // The price-adjustment line carries quantity 0: it reverses a price, not
  // goods, and the validator refuses one that claims stock.
  const mixed = JSON.stringify([
    { product_id: P_A, quantity: 3, kind: "return", total: -150 },
    { product_id: P_B, quantity: 0, kind: "price_adjustment", total: -50 },
  ]);
  const m = await reserve("99999999-0000-0000-0000-00000000000b", 200, mixed, "cn-mixed", INV4);
  check("a mixed credit reserves", m.ok, m.error);
  const mc = await confirm(m.rows[0].r.credit_note_id, "20301");
  check("a mixed credit restores only the returned line",
    mc.rows?.[0]?.r?.restored_products === 1, JSON.stringify(mc.rows?.[0]?.r));
  const s = await stock();
  check("product א gained 3, product ב gained nothing", s.a === 15 && s.b === 6,
    JSON.stringify(s));
}

console.log("\n5. A FULL CREDIT MARKS THE INVOICE — ON CONFIRMATION, NOT BEFORE");
{
  const INV5 = "aaaaaaaa-0000-0000-0000-000000000005";
  await db.exec(`insert into public.invoices (id, user_id, invoice_number, customer_name, total, items)
                 values ('${INV5}', '${U1}', 10077, 'זיכוי מלא', 400, '${GENEROUS_ITEMS}'::jsonb);`);
  const r = await reserve("99999999-0000-0000-0000-00000000000c", 400,
    ITEMS(1, 0), "cn-full", INV5);
  let inv = (await q(`select credited_at from public.invoices where id=$1`, [INV5]))[0];
  check("reserving a FULL credit still leaves the invoice open",
    inv.credited_at === null, JSON.stringify(inv));

  await confirm(r.rows[0].r.credit_note_id, "20400");
  inv = (await q(`select credited_at, credit_note_id, payment_status from public.invoices where id=$1`, [INV5]))[0];
  check("confirmation marks it credited", inv.credited_at !== null);
  check("links the credit note", inv.credit_note_id === r.rows[0].r.credit_note_id);
  check("and sets the status the application already reads",
    inv.payment_status === "זוכה", inv.payment_status);
}

console.log("\n6. UNCERTAIN: NO RETRY, AND NO 'FAILED' WITHOUT EVIDENCE");
{
  const INV6 = "aaaaaaaa-0000-0000-0000-000000000006";
  await db.exec(`insert into public.invoices (id, user_id, invoice_number, customer_name, total, items)
                 values ('${INV6}', '${U1}', 10078, 'לא ודאי', 200, '${GENEROUS_ITEMS}'::jsonb);`);
  const r = await reserve("99999999-0000-0000-0000-00000000000d", 200,
    ITEMS(1, 0), "cn-unc", INV6);
  const id = r.rows[0].r.credit_note_id;

  // The timeout.
  let x = await resolveTo(id, "uncertain", "fetch timed out after 30s");
  check("an unknown outcome is recorded as uncertain", x.ok, x.error);
  check("  with the provider error kept", (await row(id)).finbot_error === "fetch timed out after 30s");

  // THE AUTOMATIC RETRY, through the function and around it.
  x = await resolveTo(id, "failed");
  check("calling it failed with NO evidence is REFUSED", !x.ok, "a retry was unlocked");
  check("  and says what is needed",
    /evidence/.test(x.error || ""), x.error);
  x = await resolveTo(id, "failed", "err", "   ");
  check("whitespace is not evidence", !x.ok);
  x = await attempt(`update public.credit_notes set finbot_status='failed' where id=$1`, [id]);
  check("a direct UPDATE around the function is refused too", !x.ok, x.error);
  x = await attempt(`update public.credit_notes set finbot_status='pending' where id=$1`, [id]);
  check("and uncertain -> pending stays impossible", !x.ok, x.error);

  // Reserving again under a NEW operation is the other way someone might
  // retry. The cap stops it: the uncertain credit still counts.
  const dup = await reserve("99999999-0000-0000-0000-00000000000e", 200,
    ITEMS(1, 0), "cn-unc-2", INV6);
  check("a fresh operation cannot re-credit the same goods either", !dup.ok,
    "an uncertain credit did not hold its room in the cap");

  // WITH evidence, a human may resolve it.
  x = await resolveTo(id, "failed", null,
    "חיפוש במסמכי פינבוט 18/11/2026 — אין זיכוי מול חשבונית 10078");
  check("with recorded evidence it may be called failed", x.ok, x.error);
  const cn = await row(id);
  check("the evidence is stored", /10078/.test(cn.finbot_resolution_note || ""),
    cn.finbot_resolution_note);
  check("and when it was resolved", cn.finbot_resolved_at !== null);

  // Only now is a retry possible, and the cap has room again.
  x = await resolveTo(id, "uncertain", "second attempt timed out");
  check("failed -> uncertain is allowed (a retry that itself timed out)", x.ok, x.error);

  // The other resolution: the document existed after all.
  const INV7 = "aaaaaaaa-0000-0000-0000-000000000007";
  await db.exec(`insert into public.invoices (id, user_id, invoice_number, customer_name, total, items)
                 values ('${INV7}', '${U1}', 10079, 'נמצא', 100, '${GENEROUS_ITEMS}'::jsonb);`);
  const r7 = await reserve("99999999-0000-0000-0000-00000000000f", 100,
    ITEMS(1, 0), "cn-found", INV7);
  const id7 = r7.rows[0].r.credit_note_id;
  await resolveTo(id7, "uncertain", "502 from provider");
  const s0 = await stock();
  const c7 = await confirm(id7, "20500", null, "manual");
  check("an uncertain credit can be confirmed from the number read off Finbot",
    c7.ok, c7.error);
  check("  marked as established by a person, not by the API",
    (await row(id7)).finbot_confirmed_source === "manual");
  const s1 = await stock();
  check("and the stock returns only then", s1.a === s0.a + 1, `${s0.a} -> ${s1.a}`);
}

console.log("\n7. SCOPING: ONE USER CANNOT REACH ANOTHER'S ROWS");
{
  await db.query(`select set_config('test.uid', $1, false)`, [U2]);
  const r = await reserve("99999999-0000-0000-0000-000000000011", 10,
    ITEMS(1, 0), "cn-other");
  check("another user cannot credit this user's invoice", !r.ok, "cross-tenant credit");
  check("  reporting it as not found", /not found/.test(r.error || ""), r.error);
  const c = await confirm(cn1, "20600");
  check("nor confirm their credit note", !c.ok, c.error);
  const x = await resolveTo(cn1, "uncertain", "x");
  check("nor resolve it", !x.ok, x.error);
  await db.query(`select set_config('test.uid', $1, false)`, [U1]);

  await db.query(`select set_config('test.uid', '', false)`);
  const none = await attempt(
    `select public.credit_note_reserve($1,$2,$3,'[]'::jsonb,5,null,null,null) as r`,
    ["99999999-0000-0000-0000-000000000012", INV, "cn-anon"]);
  check("an unauthenticated call is refused", !none.ok, none.error);
  await db.query(`select set_config('test.uid', $1, false)`, [U1]);
}

console.log("\n8. HISTORY PRESERVED");
{
  const orphans = await q(`select count(*)::int as c from public.credit_notes
                            where finbot_status is null`);
  check("no row was left in an unclassified state by these functions",
    orphans[0].c === 0, `${orphans[0].c}`);
  // Only the FULL credits that were CONFIRMED: invoice 10077 (400 of 400) and
  // 10079 (100 of 100, confirmed from a number read off Finbot). Every partial
  // credit, and the full credit that stayed uncertain, left its invoice alone.
  const marked = await q(`select invoice_number from public.invoices
                           where credited_at is not null order by invoice_number`);
  check("only the confirmed FULL credits marked their invoice",
    marked.length === 2 && marked[0].invoice_number === 10077
    && marked[1].invoice_number === 10079, JSON.stringify(marked));
  const unmarked = await q(`select count(*)::int as c from public.invoices i
                             where i.credited_at is null
                               and exists (select 1 from public.credit_notes c
                                            where c.invoice_id = i.id)`);
  check("every partially credited invoice is still open", unmarked[0].c >= 3,
    `${unmarked[0].c}`);
  const pay = await q(`select count(*)::int as c from public.payments`);
  check("no payment row was created or removed by any of this", pay[0].c === 1);
  // Nothing anywhere set a negative stock figure.
  const neg = await q(`select count(*)::int as c from public.products where quantity < 0`);
  check("no product ended with negative stock", neg[0].c === 0);
}


console.log("\n9. THE CREDIT DOCUMENT'S ACCOUNTING DATE");
{
  // A DATE column comes back as a JS Date from this driver, so it is compared
  // as an ISO day rather than by its locale string.
  const day = (v) => (v == null ? null
    : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)));

  // The column is additive and NOTHING was dated by the migration — the
  // verification block inside it asserts that too.
  let r = await q(`select count(*)::int as c from public.credit_notes where date is not null`);
  check("no existing credit note was given a date", r[0].c === 0, `${r[0].c}`);
  r = await q(`select data_type from information_schema.columns
                where table_schema='public' and table_name='credit_notes' and column_name='date'`);
  check("it is a DATE, not a timestamp", r[0]?.data_type === "date", `${r[0]?.data_type}`);

  const INVD = "aaaaaaaa-0000-0000-0000-00000000000d";
  await db.exec(`insert into public.invoices (id, user_id, invoice_number, customer_name, total, items)
                 values ('${INVD}', '${U1}', 10200, 'תאריך', 500, '${GENEROUS_ITEMS}'::jsonb);`);

  // Confirmed WITH a date: it is recorded as given.
  let res = await reserve("99999999-0000-0000-0000-0000000000d1", 100,
    ITEMS(1, 0), "cn-dated", INVD);
  const dated = res.rows[0].r.credit_note_id;
  let c = await confirm(dated, "50100", null, "api", "2026-03-31");
  check("confirming with a document date succeeds", c.ok, c.error);
  check("  and reports that it was recorded", c.rows[0].r.date_recorded === true);
  let row2 = await row(dated);
  check("the date is stored as sent", day(row2.date) === "2026-03-31", `${day(row2.date)}`);
  check("  as its own column, independent of created_at",
    row2.date !== null && row2.created_at !== null);

  // Confirmed WITHOUT one: the credit is still confirmed, and stays undated.
  res = await reserve("99999999-0000-0000-0000-0000000000d2", 100,
    ITEMS(1, 0), "cn-undated", INVD);
  const undated = res.rows[0].r.credit_note_id;
  c = await confirm(undated, "50101");
  check("confirming without a date still succeeds", c.ok, c.error);
  check("  and says no date was recorded", c.rows[0].r.date_recorded === false);
  row2 = await row(undated);
  check("the row is confirmed", row2.finbot_status === "confirmed");
  check("  but has NO date — not created_at, not anything", row2.date === null,
    `${row2.date}`);

  // A later confirmation may supply the missing date, and only the date.
  c = await confirm(undated, "50101", null, "manual", "2026-04-02");
  check("a repeat confirmation fills the missing date", c.ok, c.error);
  check("  reporting that it did", c.rows[0].r.date_recorded === true);
  check("  and says it was already confirmed", c.rows[0].r.already === true);
  row2 = await row(undated);
  check("the date is now there", day(row2.date) === "2026-04-02", `${day(row2.date)}`);
  check("  the document number is untouched", row2.external_credit_note_number === "50101");
  check("  and no stock moved a second time", c.rows[0].r.restored_products === 0);

  // An existing date is NOT re-stated by a later confirmation.
  c = await confirm(dated, "50100", null, "api", "2026-12-31");
  check("a date already on the row is not overwritten", c.ok, c.error);
  check("  it still reads 2026-03-31",
    day((await row(dated)).date) === "2026-03-31", `${day((await row(dated)).date)}`);

  // And a wrong document number is still refused, date or no date.
  c = await confirm(dated, "59999", null, "api", "2026-03-31");
  check("a different document is still refused", !c.ok, c.error);
}


console.log("\n10. UNTRUSTED ITEMS — the fix");
{
  const day = (v) => (v == null ? null
    : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)));
  const INVX = "aaaaaaaa-0000-0000-0000-0000000000f1";
  const OTHER = "cccccccc-0000-0000-0000-0000000000ff";
  await db.exec(`
    insert into public.products (id, user_id, name, quantity)
      values ('${OTHER}', '${U1}', 'מוצר שלא בחשבונית', 7);
    insert into public.invoices (id, user_id, invoice_number, customer_name, total, items)
      values ('${INVX}', '${U1}', 10400, 'אימות פריטים', 1000, '[
        {"product_id":"${P_A}","name":"א","quantity":10,"unit_price":50,"total":500},
        {"product_id":"${P_B}","name":"ב","quantity":4,"unit_price":125,"total":500}
      ]'::jsonb);
  `);
  const stockOf = async (id) => Number((await q(
    `select quantity from public.products where id=$1`, [id]))[0].quantity);
  const line = (o) => ({ kind: "return", ...o });
  const res = (op, items, total = 100) =>
    attempt(`select public.credit_note_reserve($1,$2,$3,$4::jsonb,$5,null,null,null) as r`,
            [op, INVX, `cn-v-${op.slice(-4)}`, JSON.stringify(items), total]);
  const before = { a: await stockOf(P_A), b: await stockOf(P_B), o: await stockOf(OTHER) };

  // ---- THE ATTACK: a quantity nobody sold ----------------------------
  let r = await res("99999999-0000-0000-0000-0000000000f1",
    [line({ source_line_index: 0, product_id: P_A, quantity: 9999, total: -100 })]);
  check("9,999 of a line that sold 10 is REFUSED", !r.ok, "it was accepted");
  check("  the refusal states what was sold and what is already credited",
    /sold 10/.test(r.error || "") && /already credited 0/.test(r.error || ""), r.error);
  check("  and no credit note was created",
    (await q(`select count(*)::int c from public.credit_notes where invoice_id=$1`, [INVX]))[0].c === 0);

  // ---- a product that is not on the invoice at all -------------------
  r = await res("99999999-0000-0000-0000-0000000000f2",
    [line({ product_id: OTHER, quantity: 1, total: -100 })]);
  check("a product not on the invoice is REFUSED", !r.ok, "it was accepted");
  check("  saying so", /is not on invoice/.test(r.error || ""), r.error);

  // ---- a real line index, but someone else's product ----------------
  r = await res("99999999-0000-0000-0000-0000000000f3",
    [line({ source_line_index: 0, product_id: OTHER, quantity: 1, total: -100 })]);
  check("line 0 claimed to be a different product is REFUSED", !r.ok);
  check("  naming both products", /is product/.test(r.error || ""), r.error);

  // ---- an index off the end of the invoice --------------------------
  r = await res("99999999-0000-0000-0000-0000000000f4",
    [line({ source_line_index: 9, product_id: P_A, quantity: 1, total: -100 })]);
  check("a line index the invoice does not have is REFUSED", !r.ok);
  check("  saying so", /has no line 9/.test(r.error || ""), r.error);

  // ---- zero and negative quantities -------------------------------
  for (const qty of [0, -5]) {
    r = await res(`99999999-0000-0000-0000-0000000000${qty < 0 ? "f5" : "f6"}`,
      [line({ source_line_index: 0, product_id: P_A, quantity: qty, total: -100 })]);
    check(`a return of quantity ${qty} is REFUSED`, !r.ok);
  }

  // ---- A PRICE ADJUSTMENT MAY NOT CARRY STOCK ---------------------
  r = await res("99999999-0000-0000-0000-0000000000f7",
    [{ kind: "price_adjustment", source_line_index: 0, product_id: P_A,
       quantity: 5, total: -100 }]);
  check("a price_adjustment carrying quantity 5 is REFUSED", !r.ok, "it was accepted");
  check("  because a price credit returns no goods",
    /returns no goods/.test(r.error || ""), r.error);
  r = await res("99999999-0000-0000-0000-0000000000f8",
    [{ kind: "price_adjustment", source_line_index: 0, product_id: P_A,
       quantity: 0, total: -100 }]);
  check("with quantity 0 it is accepted", r.ok, r.error);

  // ---- an unknown kind ------------------------------------------
  r = await res("99999999-0000-0000-0000-0000000000f9",
    [{ kind: "free_money", source_line_index: 0, quantity: 1, total: -100 }]);
  check("an unknown line kind is REFUSED", !r.ok);

  // ---- NOTHING SO FAR TOUCHED STOCK ----------------------------
  check("no stock moved during any refusal",
    (await stockOf(P_A)) === before.a && (await stockOf(P_B)) === before.b
    && (await stockOf(OTHER)) === before.o,
    `${await stockOf(P_A)}/${await stockOf(P_B)}/${await stockOf(OTHER)}`);

  // ---- CUMULATIVE PER LINE, including pending and uncertain ----
  r = await res("99999999-0000-0000-0000-0000000000e1",
    [line({ source_line_index: 0, product_id: P_A, quantity: 6, total: -300 })], 300);
  check("6 of 10 is allowed", r.ok, r.error);
  const first = r.rows[0].r.credit_note_id;
  r = await res("99999999-0000-0000-0000-0000000000e2",
    [line({ source_line_index: 0, product_id: P_A, quantity: 5, total: -250 })], 250);
  check("a further 5 is REFUSED while the first is only PENDING", !r.ok,
    "a pending credit did not hold its quantity");
  check("  the arithmetic is in the message",
    /already credited 6/.test(r.error || ""), r.error);
  await resolveTo(first, "uncertain", "timeout");
  r = await res("99999999-0000-0000-0000-0000000000e3",
    [line({ source_line_index: 0, product_id: P_A, quantity: 5, total: -250 })], 250);
  check("still refused once it is UNCERTAIN — a document may exist", !r.ok);
  r = await res("99999999-0000-0000-0000-0000000000e4",
    [line({ source_line_index: 0, product_id: P_A, quantity: 4, total: -200 })], 200);
  check("the remaining 4 is allowed", r.ok, r.error);
  // Only a FAILED credit releases its quantity.
  await resolveTo(first, "failed", null, "checked Finbot: no document");
  r = await res("99999999-0000-0000-0000-0000000000e5",
    [line({ source_line_index: 0, product_id: P_A, quantity: 6, total: -300 })], 300);
  check("a failed credit releases its 6 again", r.ok, r.error);

  // ---- ONE REQUEST CANNOT SPLIT AN OVER-CREDIT ACROSS LINES ----
  const INVY = "aaaaaaaa-0000-0000-0000-0000000000f2";
  await db.exec(`insert into public.invoices (id, user_id, invoice_number, customer_name, total, items)
    values ('${INVY}', '${U1}', 10401, 'פיצול', 1000, '[
      {"product_id":"${P_A}","name":"א","quantity":10,"unit_price":100,"total":1000}]'::jsonb);`);
  r = await attempt(`select public.credit_note_reserve($1,$2,$3,$4::jsonb,$5,null,null,null) as r`,
    ["99999999-0000-0000-0000-0000000000d9", INVY, "cn-split", JSON.stringify([
      line({ source_line_index: 0, product_id: P_A, quantity: 6, total: -600 }),
      line({ source_line_index: 0, product_id: P_A, quantity: 6, total: -600 }),
    ]), 1000]);
  check("6 + 6 against a line of 10, in ONE request, is REFUSED", !r.ok,
    "the split slipped past");
  check("  counting the other line of the same request",
    /also in this request 6/.test(r.error || ""), r.error);

  // ---- TAMPERING BETWEEN RESERVE AND CONFIRM -------------------
  // RLS lets the owner UPDATE credit_notes, so this is reachable.
  const INVZ = "aaaaaaaa-0000-0000-0000-0000000000f3";
  await db.exec(`insert into public.invoices (id, user_id, invoice_number, customer_name, total, items)
    values ('${INVZ}', '${U1}', 10402, 'שינוי אחרי הזמנה', 500, '[
      {"product_id":"${P_A}","name":"א","quantity":2,"unit_price":250,"total":500}]'::jsonb);`);
  r = await attempt(`select public.credit_note_reserve($1,$2,$3,$4::jsonb,$5,null,null,null) as r`,
    ["99999999-0000-0000-0000-0000000000da", INVZ, "cn-tamper", JSON.stringify([
      line({ source_line_index: 0, product_id: P_A, quantity: 2, total: -500 })]), 500]);
  check("a legitimate reservation succeeds", r.ok, r.error);
  const tampered = r.rows[0].r.credit_note_id;
  const honest = JSON.stringify([line({ source_line_index: 0, product_id: P_A,
                                        quantity: 2, total: -500 })]);
  const tamper = JSON.stringify([line({ source_line_index: 0, product_id: P_A,
                                        quantity: 5000, total: -500 })]);
  // FIRST LINE OF DEFENCE: the rewrite is now refused outright.
  let u = await attempt(`update public.credit_notes set items = $2::jsonb where id = $1`,
                        [tampered, tamper]);
  check("rewriting the items of a RESERVED credit is REFUSED", !u.ok, "the items were rewritten");
  check("  saying why", /reserved/.test(u.error || ""), u.error);
  for (const [what, sql, val] of [
    ["the total", "total = $2", 1],
    ["the invoice", "invoice_id = $2", INVY],
    ["the operation id", "operation_id = $2", "99999999-0000-0000-0000-0000000000ff"],
  ]) {
    u = await attempt(`update public.credit_notes set ${sql} where id = $1`, [tampered, val]);
    check(`  and so is rewriting ${what}`, !u.ok, `${what} was rewritten`);
  }
  // What the client legitimately writes after Finbot answers still works.
  u = await attempt(`update public.credit_notes set external_credit_note_url = $2 where id = $1`,
                    [tampered, "https://example.invalid/d/1"]);
  check("  but the document link may still be written", u.ok, u.error);
  check("  and the items are intact",
    Number((await row(tampered)).items[0].quantity) === 2, "the stored items changed");

  // SECOND LINE OF DEFENCE: even if the freeze is bypassed, confirm re-validates.
  await db.exec(`alter table public.credit_notes disable trigger credit_notes_freeze_reserved_guard;`);
  await db.query(`update public.credit_notes set items = $2::jsonb where id = $1`,
                 [tampered, tamper]);
  await db.exec(`alter table public.credit_notes enable trigger credit_notes_freeze_reserved_guard;`);
  const stockBefore = await stockOf(P_A);
  const c = await confirm(tampered, "50900", null, "api", "2026-04-01");
  check("CONFIRM REFUSES the tampered quantities", !c.ok, "5,000 units were restored");
  check("  by the same validator", /exceed what was sold/.test(c.error || ""), c.error);
  check("  and the stock is untouched", (await stockOf(P_A)) === stockBefore,
    `${await stockOf(P_A)} vs ${stockBefore}`);
  // Put it back and confirm properly: the honest path still works.
  await db.exec(`alter table public.credit_notes disable trigger credit_notes_freeze_reserved_guard;`);
  await db.query(`update public.credit_notes set items = $2::jsonb where id = $1`,
                 [tampered, honest]);
  await db.exec(`alter table public.credit_notes enable trigger credit_notes_freeze_reserved_guard;`);
  const c2 = await confirm(tampered, "50900", null, "api", "2026-04-01");
  check("the untampered credit confirms", c2.ok, c2.error);
  check("  restoring exactly 2", (await stockOf(P_A)) === stockBefore + 2,
    `${await stockOf(P_A)}`);
  check("  and the date recorded", day((await row(tampered)).date) === "2026-04-01");
}


console.log("\n11. LINES WITHOUT AN INDEX, RESOLVED THE SAME WAY EVERYWHERE");
{
  // The resolution rule (no index -> the product, when it is on the invoice
  // exactly once) was applied when FINDING the invoice line, but both quantity
  // sums still compared the raw index. An index-less line collapsed to -1,
  // matched nothing, and was invisible to the cumulative check.
  const INVN = "aaaaaaaa-0000-0000-0000-0000000000b1";
  await db.exec(`insert into public.invoices (id, user_id, invoice_number, customer_name, total, items)
    values ('${INVN}', '${U1}', 10500, 'ללא אינדקס', 1000, '[
      {"product_id":"${P_A}","name":"א","quantity":10,"unit_price":100,"total":1000}]'::jsonb);`);
  // No source_line_index on any of these — resolved by product.
  const bare = (qty) => ({ kind: "return", product_id: P_A, quantity: qty, total: -100 * qty });
  const resN = (op, items, total) =>
    attempt(`select public.credit_note_reserve($1,$2,$3,$4::jsonb,$5,null,null,null) as r`,
            [op, INVN, `cn-n-${op.slice(-4)}`, JSON.stringify(items), total]);

  // ---- TWO INDEX-LESS LINES IN ONE REQUEST --------------------------
  let r = await resN("99999999-0000-0000-0000-0000000000c1", [bare(6), bare(6)], 1000);
  check("6 + 6 of a line of 10, both WITHOUT an index, is REFUSED", !r.ok,
    "the index-less split slipped past");
  check("  and it counted the other line of the request",
    /also in this request 6/.test(r.error || ""), r.error);
  r = await resN("99999999-0000-0000-0000-0000000000c2", [bare(4), bare(6)], 1000);
  check("4 + 6 exactly reaching 10 is allowed", r.ok, r.error);
  const filled = r.rows[0].r.credit_note_id;

  // ---- A STORED INDEX-LESS CREDIT IS NOW VISIBLE -------------------
  r = await resN("99999999-0000-0000-0000-0000000000c3", [bare(1)], 100);
  check("one more unit is REFUSED against the index-less credit already stored",
    !r.ok, "a stored index-less credit was invisible to the cumulative check");
  check("  reporting the 10 it already holds",
    /already credited 10/.test(r.error || ""), r.error);

  // A FAILED one still releases its share.
  await resolveTo(filled, "failed", "Finbot refused");
  r = await resN("99999999-0000-0000-0000-0000000000c4", [bare(10)], 1000);
  check("and a failed index-less credit releases all 10 again", r.ok, r.error);

  // ---- MIXED: an indexed line and an index-less one, same invoice line ----
  const INVM = "aaaaaaaa-0000-0000-0000-0000000000b2";
  await db.exec(`insert into public.invoices (id, user_id, invoice_number, customer_name, total, items)
    values ('${INVM}', '${U1}', 10501, 'מעורב אינדקס', 500, '[
      {"product_id":"${P_A}","name":"א","quantity":5,"unit_price":100,"total":500}]'::jsonb);`);
  r = await attempt(`select public.credit_note_reserve($1,$2,$3,$4::jsonb,$5,null,null,null) as r`,
    ["99999999-0000-0000-0000-0000000000c5", INVM, "cn-mix1", JSON.stringify([
      { kind: "return", source_line_index: 0, product_id: P_A, quantity: 3, total: -300 },
      { kind: "return", product_id: P_A, quantity: 3, total: -300 },
    ]), 500]);
  check("an indexed 3 plus an index-less 3, against a line of 5, is REFUSED",
    !r.ok, "the two were counted as different lines");

  // ---- the honest path still works --------------------------------
  r = await attempt(`select public.credit_note_reserve($1,$2,$3,$4::jsonb,$5,null,null,null) as r`,
    ["99999999-0000-0000-0000-0000000000c6", INVM, "cn-mix2", JSON.stringify([
      { kind: "return", source_line_index: 0, product_id: P_A, quantity: 2, total: -200 },
      { kind: "return", product_id: P_A, quantity: 3, total: -300 },
    ]), 500]);
  check("an indexed 2 plus an index-less 3, reaching exactly 5, is allowed",
    r.ok, r.error);
  const mixCn = r.rows[0].r.credit_note_id;
  const stockBefore = Number((await q(
    `select quantity from public.products where id=$1`, [P_A]))[0].quantity);
  const c = await confirm(mixCn, "51000", null, "api", "2026-04-05");
  check("  it confirms", c.ok, c.error);
  check("  restoring all 5 units", Number((await q(
    `select quantity from public.products where id=$1`, [P_A]))[0].quantity)
    === stockBefore + 5, "stock");

  // ---- a price adjustment without an index is still not stock -----
  const INVP = "aaaaaaaa-0000-0000-0000-0000000000b3";
  await db.exec(`insert into public.invoices (id, user_id, invoice_number, customer_name, total, items)
    values ('${INVP}', '${U1}', 10502, 'התאמה ללא אינדקס', 200, '[
      {"product_id":"${P_B}","name":"ב","quantity":2,"unit_price":100,"total":200}]'::jsonb);`);
  r = await attempt(`select public.credit_note_reserve($1,$2,$3,$4::jsonb,$5,null,null,null) as r`,
    ["99999999-0000-0000-0000-0000000000c7", INVP, "cn-adj", JSON.stringify([
      { kind: "price_adjustment", product_id: P_B, quantity: 0, total: -50 }]), 50]);
  check("an index-less price adjustment reserves", r.ok, r.error);
  const bBefore = Number((await q(
    `select quantity from public.products where id=$1`, [P_B]))[0].quantity);
  const pc = await confirm(r.rows[0].r.credit_note_id, "51001", null, "api", "2026-04-05");
  check("  confirms restoring nothing", pc.ok && pc.rows[0].r.restored_products === 0,
    JSON.stringify(pc.rows?.[0]?.r));
  check("  and product ב is unchanged", Number((await q(
    `select quantity from public.products where id=$1`, [P_B]))[0].quantity) === bBefore);
}

console.log("\n12. STOCK GOES BACK TO THE INVOICE LINE'S PRODUCT, NOT A CLIENT ID");
{
  // confirm used to restore to COALESCE(line->>'product_id', line->>'id').
  // The validator resolved the invoice line by its index and never looked at
  // that 'id', so a credit line carrying an id for ANOTHER product passed
  // validation and then moved the wrong product's stock.
  const INVQ = "aaaaaaaa-0000-0000-0000-0000000000b4";
  await db.exec(`insert into public.invoices (id, user_id, invoice_number, customer_name, total, items)
    values ('${INVQ}', '${U1}', 10503, 'מזהה חלופי', 500, '[
      {"product_id":"${P_A}","name":"א","quantity":2,"unit_price":250,"total":500}]'::jsonb);`);
  const before = async (pid) => Number((await q(
    `select quantity from public.products where id=$1`, [pid]))[0].quantity);
  const aBefore = await before(P_A), bBefore = await before(P_B);
  // Indexed line, no product_id, and an 'id' pointing at the OTHER product.
  let r = await attempt(`select public.credit_note_reserve($1,$2,$3,$4::jsonb,$5,null,null,null) as r`,
    ["99999999-0000-0000-0000-0000000000e9", INVQ, "cn-altid", JSON.stringify([
      { kind: "return", source_line_index: 0, id: P_B, quantity: 2, total: -500 }]), 500]);
  check("a line whose only product hint is an alternate id reserves", r.ok, r.error);
  const alt = r.rows[0].r.credit_note_id;
  const c = await confirm(alt, "51100", null, "api", "2026-04-06");
  check("  it confirms", c.ok, c.error);
  check("  and product א — the invoice line's product — got the 2 back",
    (await before(P_A)) === aBefore + 2, `${await before(P_A)} vs ${aBefore}`);
  check("  while product ב, named only by the client id, is untouched",
    (await before(P_B)) === bBefore, `${await before(P_B)} vs ${bBefore}`);
  check("  and exactly one product moved", c.rows[0].r.restored_products === 1,
    JSON.stringify(c.rows[0].r));

  // The same line cannot be credited twice just by changing the id.
  r = await attempt(`select public.credit_note_reserve($1,$2,$3,$4::jsonb,$5,null,null,null) as r`,
    ["99999999-0000-0000-0000-0000000000ea", INVQ, "cn-altid2", JSON.stringify([
      { kind: "return", source_line_index: 0, id: P_B, quantity: 2, total: -500 }]), 500]);
  check("  and a second 2 on the same line is still REFUSED", !r.ok, "it credited twice");

  // A LEGACY row — never reserved — stays editable. The freeze only guards
  // rows that an operation put on record.
  const LEG = "515d73f0-d9c9-4016-aac3-cb2214209999";
  await db.exec(`insert into public.credit_notes (id, user_id, invoice_id, total, items)
    values ('${LEG}', '${U1}', '${INVQ}', 100, '[]'::jsonb);`);
  const u = await attempt(
    `update public.credit_notes set items = $2::jsonb, total = 120 where id = $1`,
    [LEG, JSON.stringify([{ kind: "return", product_id: P_A, quantity: 1, total: -120 }])]);
  check("  a legacy credit with no operation_id is still editable", u.ok, u.error);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
