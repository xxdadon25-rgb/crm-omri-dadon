// Does the receipts storage policy let ONLY CRM staff read a receipt?
//
// HOW TO RUN
//   npm i --no-save @electric-sql/pglite
//   node tests/storage-policy.test.mjs
//
// @electric-sql/pglite is deliberately NOT a dependency of this project: it is
// PostgreSQL compiled to WebAssembly, needed only to run this suite, and
// adding it to package.json would put it into every production install for no
// benefit at run time.
//
// WHAT THIS PROVES, AND WHY IT IS WORTH A WHOLE SUITE
//   The migration is applied VERBATIM to a throwaway PostgreSQL and the policy
//   is then exercised with RLS actually enforced, as three different callers:
//   anonymous, a signed-in PORTAL CUSTOMER, and CRM staff.
//
//   The portal-customer case is the reason this exists. A portal customer is
//   an `authenticated` user — they sign in through Supabase auth and are
//   recognised by customer_portal_access.auth_user_id — so a policy that only
//   checks the ROLE would hand them every receipt in the bucket: other
//   customers' names, amounts and payment dates. Section 5 puts that weakened
//   policy back and shows the leak happening, so the guard is demonstrably
//   protecting something real rather than expressing a preference.
//
// No production database is touched: everything runs in memory and is thrown
// away.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Resolved from this file, so the suite runs from any checkout.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = resolve(REPO,
  "supabase/migrations/20261106120000_add_payment_receipts_storage_policy.sql");

let pass = 0, fail = 0;
const check = (n, c, d = "") => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  ${d}`)); };

const db = new PGlite();
console.log("postgres:", (await db.query("select version()")).rows[0].version.split(",")[0]);

const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const STAFF = U(1), PORTAL = U(2), STRANGER = U(3);

// A miniature of the parts of Supabase this policy depends on.
await db.exec(`
  create role anon;
  create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $fn$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid $fn$;

  create schema storage;
  create table storage.buckets (
    id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id),
    name text, owner uuid, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select on storage.objects to anon, authenticated;
  grant select on storage.buckets to anon, authenticated;

  -- The two tables that decide WHO someone is, exactly as the project uses them.
  create table public.staff_members (
    id uuid primary key default gen_random_uuid(), auth_user_id uuid, name text
  );
  create table public.customer_portal_access (
    id uuid primary key default gen_random_uuid(), auth_user_id uuid,
    customer_id uuid, is_active boolean default true
  );
  insert into public.staff_members (auth_user_id, name) values ('${STAFF}', 'עומרי');
  insert into public.customer_portal_access (auth_user_id, customer_id)
    values ('${PORTAL}', gen_random_uuid());
  grant usage on schema public to anon, authenticated;
  grant select on public.staff_members, public.customer_portal_access to anon, authenticated;
`);

console.log("\n0. Applying the storage migration verbatim");
try {
  await db.exec(readFileSync(MIG, "utf8"));
  check("applies cleanly, including its verification block", true);
} catch (e) {
  check("applies cleanly", false, e.message);
  console.log(`\n==== ${pass} passed, ${fail} failed ====`); process.exit(1);
}

// A receipt, and a file in another bucket to prove the scoping.
await db.exec(`
  insert into storage.buckets (id, name, public) values ('logos','logos',true)
    on conflict (id) do nothing;
  insert into storage.objects (bucket_id, name)
    values ('payment-receipts', 'pay-1/receipt-20057.pdf'),
           ('payment-receipts', 'pay-2/receipt-20058.pdf'),
           ('logos', 'business-logo.png');
`);

/** Read the receipts bucket as a given auth user, with RLS enforced. */
async function readAs(uid, role = "authenticated", bucket = "payment-receipts") {
  await db.exec("begin");
  try {
    await db.query(`select set_config('request.jwt.claims',$1,true)`,
      [uid ? JSON.stringify({ sub: uid, role }) : ""]);
    await db.exec(`set local role ${role}`);
    const r = await db.query(
      `select name from storage.objects where bucket_id = $1 order by name`, [bucket]);
    await db.exec("rollback");
    return r.rows.map(x => x.name);
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
}

console.log("\n1. The bucket is private");
{
  const b = (await db.query(
    `select public, allowed_mime_types, file_size_limit
       from storage.buckets where id='payment-receipts'`)).rows[0];
  check("it exists", !!b);
  check("and is NOT public", b.public === false, `${b.public}`);
  check("only PDFs are accepted",
    (b.allowed_mime_types || []).join(",") === "application/pdf",
    JSON.stringify(b.allowed_mime_types));
  check("with a size ceiling", Number(b.file_size_limit) > 0);
}

console.log("\n2. Who can read a receipt");
{
  const staff = await readAs(STAFF);
  check("CRM staff can read the receipts",
    Array.isArray(staff) && staff.length === 2, JSON.stringify(staff));
  check("and see them by name",
    Array.isArray(staff) && staff[0] === "pay-1/receipt-20057.pdf");

  // THE CASE THAT MATTERS.
  const portal = await readAs(PORTAL);
  check("A SIGNED-IN PORTAL CUSTOMER CANNOT READ ANY RECEIPT",
    Array.isArray(portal) && portal.length === 0, JSON.stringify(portal));
  check("not even one belonging to someone else",
    Array.isArray(portal) && !portal.includes("pay-2/receipt-20058.pdf"));

  const stranger = await readAs(STRANGER);
  check("an authenticated user who is neither staff nor a portal customer cannot",
    Array.isArray(stranger) && stranger.length === 0, JSON.stringify(stranger));

  const anonymous = await readAs(null, "anon");
  check("anonymous cannot", Array.isArray(anonymous) && anonymous.length === 0,
    JSON.stringify(anonymous));
}

console.log("\n3. The policy is scoped, and SELECT-only");
{
  const logosAsStaff = await readAs(STAFF, "authenticated", "logos");
  check("the policy grants nothing in another bucket",
    Array.isArray(logosAsStaff) && logosAsStaff.length === 0, JSON.stringify(logosAsStaff));

  const pols = (await db.query(
    `select policyname, cmd, roles, qual from pg_policies
      where schemaname='storage' and tablename='objects'`)).rows;
  check("exactly one policy was added", pols.length === 1, JSON.stringify(pols.map(p => p.policyname)));
  check("it is SELECT only", pols[0].cmd === "SELECT", pols[0].cmd);
  // pg_policies.roles comes back as an array or as its text form depending on
  // the driver, so this normalises before asserting.
  const roles = [].concat(pols[0].roles ?? [])
    .join(",").replace(/[{}"]/g, "").split(",").filter(Boolean);
  check("granted to authenticated, and to nothing else",
    roles.length === 1 && roles[0] === "authenticated", JSON.stringify(pols[0].roles));
  check("never to public or anon",
    !roles.includes("public") && !roles.includes("anon") && !roles.includes("-"));
  check("and it requires staff membership — not merely the role",
    /staff_members/.test(pols[0].qual), pols[0].qual);
  check("scoped to this bucket", /payment-receipts/.test(pols[0].qual));

  // Writes: staff must not be able to add or remove objects through the API.
  for (const [label, sql] of [
    ["insert", `insert into storage.objects (bucket_id, name) values ('payment-receipts','x.pdf')`],
    ["update", `update storage.objects set name='y.pdf' where bucket_id='payment-receipts'`],
    ["delete", `delete from storage.objects where bucket_id='payment-receipts'`],
  ]) {
    await db.exec("begin");
    let refused = false;
    try {
      await db.query(`select set_config('request.jwt.claims',$1,true)`,
        [JSON.stringify({ sub: STAFF, role: "authenticated" })]);
      await db.exec("set local role authenticated");
      await db.query(sql);
    } catch { refused = true; }
    await db.exec("rollback");
    check(`even staff cannot ${label} a receipt object through the API`, refused);
  }
}

console.log("\n4. Re-applying the migration is safe");
try {
  await db.exec(readFileSync(MIG, "utf8"));
  const pols = (await db.query(
    `select count(*) n from pg_policies
      where schemaname='storage' and tablename='objects'`)).rows[0];
  check("re-applies cleanly", true);
  check("and does not duplicate the policy", Number(pols.n) === 1, `${pols.n}`);
  const objs = (await db.query(
    `select count(*) n from storage.objects where bucket_id='payment-receipts'`)).rows[0];
  check("no stored receipt was lost", Number(objs.n) === 2, `${objs.n}`);
} catch (e) { check("re-applies cleanly", false, e.message); }

console.log("\n5. The guard rails actually fire");
{
  // A bucket flipped to public must be caught by the migration's own check.
  await db.exec(`update storage.buckets set public = true where id='payment-receipts'`);
  let raised = null;
  try { await db.exec(readFileSync(MIG, "utf8")); } catch (e) { raised = e.message; }
  check("a public receipts bucket is refused by the verification",
    /is PUBLIC/.test(raised || ""), raised);
  await db.exec(`update storage.buckets set public = false where id='payment-receipts'`);

  // A policy weakened to "any authenticated user" must be caught too.
  await db.exec(`drop policy "Staff read payment receipts" on storage.objects`);
  await db.exec(`create policy "Staff read payment receipts" on storage.objects
                   for select to authenticated using (bucket_id = 'payment-receipts')`);
  let raised2 = null;
  try { await db.exec(readFileSync(MIG, "utf8")); } catch (e) { raised2 = e.message; }
  check("a role-only policy is refused, naming the portal-customer risk",
    /does not require staff membership/.test(raised2 || ""), raised2);

  // And prove the weakened policy really would have leaked, so the check is
  // guarding something real rather than a style preference.
  const portalUnderWeakPolicy = await readAs(PORTAL);
  check("under that weakened policy a portal customer DOES see every receipt",
    Array.isArray(portalUnderWeakPolicy) && portalUnderWeakPolicy.length === 2,
    JSON.stringify(portalUnderWeakPolicy));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
await db.close();
process.exit(fail ? 1 : 0);
