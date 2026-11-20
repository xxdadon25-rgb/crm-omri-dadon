// Does the credit-note Finbot lifecycle migration hold the line it claims to?
//
// HOW TO RUN
//   npm i --no-save @electric-sql/pglite
//   node tests/credit-note-lifecycle.test.mjs
//
// The migration is applied VERBATIM to a throwaway PostgreSQL, on a table built
// with the 13 columns production actually has. No production database is
// touched and nothing here reads one.
//
// WHAT IT PROVES
//   1. Existing credit notes and invoices survive untouched — no backfill, no
//      classification, no write of any kind to a row that was already there.
//   2. 'confirmed' cannot be asserted without the Finbot document number that
//      proves the document exists.
//   3. 'uncertain' cannot be moved back to 'pending', which is what an
//      automatic retry is, and the one move that can produce a second credit
//      document in a customer's tax records.
//   4. One issuing operation produces one credit note, however many times it is
//      submitted — while an invoice may still receive several partial credits.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = resolve(REPO, "supabase/migrations/20261118120000_add_credit_note_finbot_lifecycle.sql");

let pass = 0, fail = 0;
const check = (n, c, d = "") => {
  c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  ${d}`));
};
/** Run SQL and report whether it was refused, and with what. */
async function attempt(db, sql) {
  try { await db.exec(sql); return { ok: true, error: null }; }
  catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
}

const db = new PGlite();
console.log("postgres:", (await db.query("select version()")).rows[0].version.split(",")[0]);

// ============================================================================
// The tables as production has them. credit_notes has no migration in this
// repository — it was created out of band — so its 13 columns are reproduced
// from what was verified in the Dashboard.
// ============================================================================
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key);
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
`);

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users (id) values ('${U1}'), ('${U2}');`);

// ---------------------------------------------------------------------------
// PRE-EXISTING DATA, exactly the shape reported: one invoice, two credit notes,
// one of which already carries a Finbot document number.
// ---------------------------------------------------------------------------
await db.exec(`
  insert into public.invoices (id, user_id, invoice_number, customer_name, total, paid_amount, payment_status, credited_at, finbot_serial)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '${U1}', 10073, 'שירה אלון', 840, 840, 'זוכה', '2026-10-01T10:00:00Z', 'SER-1');
  insert into public.credit_notes (id, user_id, credit_note_number, invoice_id, customer_id, total, reason, external_credit_note_number)
  values ('bbbbbbbb-0000-0000-0000-000000000001', '${U1}', 'זיכוי-10073',
          'aaaaaaaa-0000-0000-0000-000000000001', null, -840, 'זיכוי עבור חשבונית 10073', '20099');
  insert into public.credit_notes (id, user_id, credit_note_number, invoice_id, customer_id, total, reason)
  values ('bbbbbbbb-0000-0000-0000-000000000002', '${U1}', 'זיכוי-10074',
          'aaaaaaaa-0000-0000-0000-000000000001', null, -120, 'זיכוי חלקי ללא מסמך');
`);
// The 13 original columns, named ONE BY ONE on purpose. Hashing whole rows
// (t::text) would compare different shapes before and after, since the
// migration adds columns — it would report a difference that is not one, and
// hide a real change behind the noise.
const ORIG = `id, user_id, credit_note_number, invoice_id, order_id, customer_id,
              items, total, reason, external_credit_note_number,
              external_credit_note_url, created_at, created_by`;
const fingerprint = async () => (await db.query(`
  select md5(string_agg(row(${ORIG})::text, '|' order by id::text)) as h,
         count(*) as n
    from public.credit_notes`)).rows[0];

const before = { ...(await fingerprint()) };
const beforeInv = await db.query(`
  select md5(string_agg(t::text, '|' order by t.id::text)) as h from public.invoices t`);

console.log("\n1. THE MIGRATION APPLIES, AND TOUCHES NOTHING THAT WAS THERE");
const sql = readFileSync(MIG, "utf8");
const applied = await attempt(db, sql);
check("the migration applies cleanly", applied.ok, applied.error);
// Its own verification block runs inside it; reaching here means it passed.

const after = await fingerprint();
check("both existing credit notes are still there",
  Number(after.n) === 2 && Number(before.n) === 2);
check("every value in the 13 original columns is unchanged — nothing was classified",
  after.h === before.h, `${before.h} -> ${after.h}`);
const afterInv = await db.query(`
  select md5(string_agg(t::text, '|' order by t.id::text)) as h from public.invoices t`);
check("the invoice is byte-identical too", afterInv.rows[0].h === beforeInv.rows[0].h);
const legacy = await db.query(`select finbot_status, external_credit_note_number
  from public.credit_notes order by credit_note_number`);
check("both legacy rows hold NULL, not a guessed state",
  legacy.rows.every(r => r.finbot_status === null), JSON.stringify(legacy.rows));
check("and the one with provider evidence still carries it",
  legacy.rows.some(r => r.external_credit_note_number === "20099"));

console.log("\n2. APPLYING IT TWICE IS A NO-OP");
const again = await attempt(db, sql);
check("the migration is idempotent", again.ok, again.error);

console.log("\n3. CONFIRMED REQUIRES VERIFIED FINBOT EVIDENCE");
{
  const mk = async (id, num, extra = "") => attempt(db, `
    insert into public.credit_notes (id, user_id, credit_note_number, invoice_id, total ${extra ? "," + extra.split("=")[0] : ""})
    values ('${id}', '${U1}', '${num}', 'aaaaaaaa-0000-0000-0000-000000000001', -50
            ${extra ? ", " + extra.split("=")[1] : ""});`);

  let r = await mk("cccccccc-0000-0000-0000-000000000001", "cn-1", "finbot_status='confirmed'");
  check("confirmed with NO document number is refused", !r.ok, "it was accepted");
  check("  and the refusal names the constraint",
    /confirmed_needs_evidence/.test(r.error || ""), r.error);

  r = await mk("cccccccc-0000-0000-0000-000000000002", "cn-2", "finbot_status='pending'");
  check("pending with no number is fine", r.ok, r.error);

  r = await attempt(db, `
    insert into public.credit_notes (id, user_id, credit_note_number, invoice_id, total,
                                     finbot_status, external_credit_note_number)
    values ('cccccccc-0000-0000-0000-000000000003', '${U1}', 'cn-3',
            'aaaaaaaa-0000-0000-0000-000000000001', -50, 'confirmed', '20100');`);
  check("confirmed WITH a number is accepted", r.ok, r.error);

  // An empty string is not evidence.
  r = await attempt(db, `
    insert into public.credit_notes (id, user_id, credit_note_number, invoice_id, total,
                                     finbot_status, external_credit_note_number)
    values ('cccccccc-0000-0000-0000-000000000004', '${U1}', 'cn-4',
            'aaaaaaaa-0000-0000-0000-000000000001', -50, 'confirmed', '   ');`);
  check("whitespace is not evidence either", !r.ok, "blank was accepted as evidence");

  // Promoting an existing pending row needs the number in the same statement.
  r = await attempt(db, `update public.credit_notes set finbot_status='confirmed'
                          where credit_note_number='cn-2';`);
  check("promoting to confirmed without a number is refused", !r.ok, r.error);
  r = await attempt(db, `update public.credit_notes
                            set finbot_status='confirmed', external_credit_note_number='20101',
                                finbot_confirmed_source='manual'
                          where credit_note_number='cn-2';`);
  check("promoting WITH a number is accepted", r.ok, r.error);

  // Only the four states exist.
  r = await attempt(db, `update public.credit_notes set finbot_status='maybe'
                          where credit_note_number='cn-3';`);
  check("an invented state is refused", !r.ok);
  r = await attempt(db, `update public.credit_notes set finbot_confirmed_source='guess'
                          where credit_note_number='cn-3';`);
  check("an invented evidence source is refused", !r.ok);
}

console.log("\n4. UNCERTAIN IS NEVER RETRIED — THE MOVE ITSELF IS IMPOSSIBLE");
{
  await db.exec(`
    insert into public.credit_notes (id, user_id, credit_note_number, invoice_id, total,
                                     finbot_status, finbot_error, finbot_attempted_at)
    values ('dddddddd-0000-0000-0000-000000000001', '${U1}', 'cn-unc',
            'aaaaaaaa-0000-0000-0000-000000000001', -70,
            'uncertain', 'timeout after 30s', now());`);

  // THE AUTOMATIC RETRY. This is the single move that can put a second credit
  // document into a customer's tax records.
  let r = await attempt(db, `update public.credit_notes set finbot_status='pending'
                              where credit_note_number='cn-unc';`);
  check("uncertain -> pending is REFUSED", !r.ok, "an auto-retry was allowed");
  check("  and the refusal explains what to do instead",
    /Check Finbot/.test(r.error || "") && /confirmed/.test(r.error || ""), r.error);

  // The two human resolutions both work.
  r = await attempt(db, `update public.credit_notes
                            set finbot_status='failed', finbot_error='checked Finbot: no document'
                          where credit_note_number='cn-unc';`);
  check("uncertain -> failed is allowed (a human checked)", r.ok, r.error);
  r = await attempt(db, `update public.credit_notes set finbot_status='pending'
                          where credit_note_number='cn-unc';`);
  check("failed -> pending is allowed (no document exists, so retrying is safe)",
    r.ok, r.error);

  // The other resolution: the document was there.
  await db.exec(`update public.credit_notes set finbot_status='uncertain'
                  where credit_note_number='cn-unc';`);
  r = await attempt(db, `update public.credit_notes
                            set finbot_status='confirmed', external_credit_note_number='20102',
                                finbot_confirmed_source='manual'
                          where credit_note_number='cn-unc';`);
  check("uncertain -> confirmed with the number read off Finbot is allowed", r.ok, r.error);

  // Terminal.
  r = await attempt(db, `update public.credit_notes set finbot_status='failed'
                          where credit_note_number='cn-unc';`);
  check("confirmed -> failed is REFUSED: the document is issued and reported",
    !r.ok, "a confirmed document was un-confirmed");
  check("  and says how to correct it",
    /issuing another credit document/.test(r.error || ""), r.error);
  r = await attempt(db, `update public.credit_notes set finbot_status=null
                          where credit_note_number='cn-3';`);
  check("a finding cannot be erased to NULL", !r.ok);

  // Everything that is NOT the status stays freely editable.
  r = await attempt(db, `update public.credit_notes
                            set external_credit_note_url='https://example.test/cn.pdf',
                                reason='תוקן'
                          where credit_note_number='cn-unc';`);
  check("other columns on a confirmed row are still updatable", r.ok, r.error);

  // A legacy NULL row can be classified when the owner gets to it.
  r = await attempt(db, `update public.credit_notes set finbot_status='uncertain'
                          where credit_note_number='זיכוי-10074';`);
  check("a legacy NULL row can still be classified", r.ok, r.error);
}

console.log("\n5. ONE OPERATION, ONE CREDIT NOTE — AND STILL MANY PER INVOICE");
{
  const OP = "99999999-0000-0000-0000-000000000001";
  const INV = "aaaaaaaa-0000-0000-0000-000000000001";
  const ins = (id, num, op, user = U1, inv = INV) => attempt(db, `
    insert into public.credit_notes (id, user_id, credit_note_number, invoice_id, total, operation_id, finbot_status)
    values ('${id}', '${user}', '${num}', '${inv}', -30, ${op ? `'${op}'` : "null"}, 'pending');`);

  let r = await ins("eeeeeeee-0000-0000-0000-000000000001", "op-1", OP);
  check("the first submission of an operation succeeds", r.ok, r.error);
  r = await ins("eeeeeeee-0000-0000-0000-000000000002", "op-2", OP);
  check("a SECOND submission of the same operation is refused", !r.ok,
    "a double-click created a second credit note");
  check("  by the idempotency index",
    /operation_idempotency/.test(r.error || ""), r.error);

  // The same operation id belonging to a different user is a different
  // operation: the index is scoped by user_id, as RLS is.
  await db.exec(`insert into public.invoices (id, user_id, customer_name, total)
                 values ('aaaaaaaa-0000-0000-0000-000000000002', '${U2}', 'לקוח אחר', 100);`);
  r = await ins("eeeeeeee-0000-0000-0000-000000000003", "op-3", OP, U2,
                "aaaaaaaa-0000-0000-0000-000000000002");
  check("another user's identical operation id is unaffected", r.ok, r.error);

  // MULTIPLE PARTIAL CREDITS PER INVOICE remain possible — this is what a
  // unique invoice_id would have broken.
  r = await ins("eeeeeeee-0000-0000-0000-000000000004", "part-1",
                "99999999-0000-0000-0000-000000000002");
  check("a second partial credit on the SAME invoice is allowed", r.ok, r.error);
  r = await ins("eeeeeeee-0000-0000-0000-000000000005", "part-2",
                "99999999-0000-0000-0000-000000000003");
  check("and a third", r.ok, r.error);
  const n = await db.query(`select count(*)::int as c from public.credit_notes
                             where invoice_id='${INV}'`);
  check("that invoice now carries several credit notes", n.rows[0].c >= 4,
    `${n.rows[0].c}`);

  // Rows with no operation_id at all (every legacy row) do not collide.
  r = await ins("eeeeeeee-0000-0000-0000-000000000006", "noop-1", null);
  check("two rows with no operation id do not collide", r.ok, r.error);
  r = await ins("eeeeeeee-0000-0000-0000-000000000007", "noop-2", null);
  check("nor do three", r.ok, r.error);
}

console.log("\n6. ONE FINBOT DOCUMENT CANNOT BE RECORDED TWICE");
{
  const r = await attempt(db, `
    insert into public.credit_notes (id, user_id, credit_note_number, invoice_id, total,
                                     finbot_status, external_credit_note_number)
    values ('ffffffff-0000-0000-0000-000000000001', '${U1}', 'dup-1',
            'aaaaaaaa-0000-0000-0000-000000000001', -10, 'confirmed', '20100');`);
  check("reusing a document number already on another credit note is refused",
    !r.ok, "the same Finbot document was recorded twice");
  check("  by the external-number index",
    /external_number/.test(r.error || ""), r.error);

  // Including the legacy one, which is the likeliest reconciliation slip.
  const r2 = await attempt(db, `
    update public.credit_notes
       set finbot_status='confirmed', external_credit_note_number='20099',
           finbot_confirmed_source='manual'
     where credit_note_number='noop-1';`);
  check("entering a legacy row's number against a different row is refused",
    !r2.ok, "20099 was attached to two credit notes");
}

console.log("\n7. THE RECONCILIATION QUEUE IS INDEXED");
{
  const q = await db.query(`
    select indexdef from pg_indexes
     where schemaname='public' and indexname='credit_notes_finbot_attention_idx'`);
  const def = q.rows[0]?.indexdef || "";
  check("the attention index exists", !!def);
  check("it is partial, covering only the rows a human must look at",
    /WHERE/i.test(def) && /uncertain/.test(def) && /failed/.test(def)
    && /pending/.test(def), def);
  check("and it does NOT index confirmed rows", !/confirmed/.test(def), def);

  const pending = await db.query(`
    select count(*)::int as c from public.credit_notes
     where finbot_status in ('pending','failed','uncertain')`);
  check("the queue is non-empty in this fixture", pending.rows[0].c > 0,
    `${pending.rows[0].c}`);
}

console.log("\n8. ROLLBACK LEAVES THE ORIGINAL TABLE");
{
  const rollback = sql
    .split("-- ROLLBACK")[1]
    .split("\n")
    .filter(l => l.trim().startsWith("-- ") && /^\s*--\s+(DROP|ALTER)/.test(l))
    .map(l => l.replace(/^\s*--\s?/, ""))
    .join("\n");
  // The commented block is several statements across lines; join and run.
  const r = await attempt(db, rollback);
  check("the documented rollback runs", r.ok, r.error);
  const cols = await db.query(`
    select count(*)::int as c from information_schema.columns
     where table_schema='public' and table_name='credit_notes'`);
  check("credit_notes is back to its 13 columns", cols.rows[0].c === 13,
    `${cols.rows[0].c}`);
  const rows = await db.query(`select count(*)::int as c from public.credit_notes`);
  check("and every credit note is still there", rows.rows[0].c > 0, `${rows.rows[0].c}`);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
