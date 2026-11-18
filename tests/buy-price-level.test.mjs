// Does the buy_price_level migration record the purchase packaging basis, and
// refuse anything that is not one of the three levels?
//
// HOW TO RUN
//   npm i --no-save @electric-sql/pglite
//   node tests/buy-price-level.test.mjs
//
// The migration is applied VERBATIM to a throwaway PostgreSQL. No production
// database is touched.
//
// WHAT IT PROVES
//   NULL must stay legal, because "we have not been told what buy_price is
//   per" is a real state the application depends on representing — it is what
//   makes the margin read "pending" instead of assuming per-unit and
//   overstating a carton's cost twenty-four fold.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = resolve(REPO, "supabase/migrations/20261116120000_add_buy_price_packaging_level.sql");

let pass = 0, fail = 0;
const check = (n, c, d = "") => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  ${d}`)); };

const db = new PGlite();
console.log("postgres:", (await db.query("select version()")).rows[0].version.split(",")[0]);

// The table as it exists before this migration.
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key);
  create table public.products (id uuid primary key default gen_random_uuid(), name text);
  create table public.supplier_quote_product_packages (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    product_id uuid not null,
    units_per_pack numeric check (units_per_pack is null or units_per_pack > 0),
    packs_per_carton numeric check (packs_per_carton is null or packs_per_carton > 0),
    updated_at timestamptz not null default now(),
    unique (user_id, product_id)
  );
`);

const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OWNER = U(1);
await db.query(
  `insert into public.supplier_quote_product_packages (user_id, product_id, units_per_pack, packs_per_carton)
   values ($1,$2,6,4)`, [OWNER, U(10)]);

console.log("\n0. Applying the migration verbatim");
try {
  await db.exec(readFileSync(MIG, "utf8"));
  check("applies cleanly, including its verification block", true);
} catch (e) {
  check("applies cleanly", false, e.message);
  console.log(`\n==== ${pass} passed, ${fail} failed ====`); process.exit(1);
}

console.log("\n1. The column, and what it accepts");
{
  const col = (await db.query(
    `select data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name='supplier_quote_product_packages'
        and column_name='buy_price_level'`)).rows[0];
  check("it exists", !!col);
  check("it is text", col.data_type === "text", col.data_type);
  check("it is NULLABLE — 'not known' must be representable",
    col.is_nullable === "YES", col.is_nullable);
  check("and has no default, so nothing is assumed",
    col.column_default === null, `${col.column_default}`);

  const existing = (await db.query(
    `select buy_price_level from public.supplier_quote_product_packages`)).rows[0];
  check("an existing row is left as NOT KNOWN, not guessed as 'unit'",
    existing.buy_price_level === null, `${existing.buy_price_level}`);
}

console.log("\n2. Only the three levels, and NULL");
{
  for (const level of ["unit", "pack", "carton"]) {
    try {
      await db.query(
        `update public.supplier_quote_product_packages set buy_price_level=$1 where product_id=$2`,
        [level, U(10)]);
      check(`'${level}' is accepted`, true);
    } catch (e) { check(`'${level}' is accepted`, false, e.message); }
  }
  try {
    await db.query(
      `update public.supplier_quote_product_packages set buy_price_level=null where product_id=$1`,
      [U(10)]);
    check("NULL is accepted — the product can go back to 'not known'", true);
  } catch (e) { check("NULL is accepted", false, e.message); }

  for (const bad of ["box", "UNIT", "", "units", "1"]) {
    try {
      await db.query(
        `update public.supplier_quote_product_packages set buy_price_level=$1 where product_id=$2`,
        [bad, U(10)]);
      check(`'${bad}' is REFUSED`, false, "it was accepted");
    } catch (e) {
      check(`'${bad}' is REFUSED`, /buy_price_level_check/.test(e.message), e.message);
    }
  }
}

console.log("\n3. The queue of products that cannot be costed yet");
{
  const idx = (await db.query(
    `select indexdef from pg_indexes where schemaname='public'
      and indexname='supplier_quote_product_packages_needs_buy_level_idx'`)).rows[0];
  check("the partial index exists", !!idx);
  check("and covers exactly the unknown ones",
    /buy_price_level IS NULL/.test(idx.indexdef), idx.indexdef);
}

console.log("\n4. Nothing else was touched");
{
  const cols = (await db.query(
    `select column_name from information_schema.columns
      where table_schema='public' and table_name='supplier_quote_product_packages'
      order by column_name`)).rows.map(r => r.column_name);
  check("the pre-existing columns all survive",
    ["id","packs_per_carton","product_id","units_per_pack","updated_at","user_id"]
      .every(c => cols.includes(c)), JSON.stringify(cols));
  const row = (await db.query(
    `select units_per_pack, packs_per_carton from public.supplier_quote_product_packages`)).rows[0];
  check("and the packaging already recorded is unchanged",
    Number(row.units_per_pack) === 6 && Number(row.packs_per_carton) === 4,
    JSON.stringify(row));
}

console.log("\n5. Backward compatibility — old code keeps working");
{
  // The application that is live right now knows nothing about this column.
  // Its inserts and updates name the old columns only, and they must keep
  // working unchanged — otherwise applying the migration before deploying the
  // frontend would break the running system.
  try {
    await db.query(
      `insert into public.supplier_quote_product_packages (user_id, product_id, units_per_pack)
       values ($1,$2,12)`, [OWNER, U(11)]);
    check("an insert that does not mention the column still works", true);
  } catch (e) { check("an insert that does not mention the column still works", false, e.message); }

  const row = (await db.query(
    `select units_per_pack, buy_price_level from public.supplier_quote_product_packages
      where product_id=$1`, [U(11)])).rows[0];
  check("and the new column defaults to NOT KNOWN",
    row.buy_price_level === null && Number(row.units_per_pack) === 12, JSON.stringify(row));

  try {
    await db.query(
      `update public.supplier_quote_product_packages set packs_per_carton=3 where product_id=$1`,
      [U(11)]);
    check("an old-style update still works", true);
  } catch (e) { check("an old-style update still works", false, e.message); }

  // And the upsert the application performs, on the same conflict target.
  try {
    await db.query(
      `insert into public.supplier_quote_product_packages (user_id, product_id, units_per_pack)
       values ($1,$2,24)
       on conflict (user_id, product_id) do update set units_per_pack = excluded.units_per_pack`,
      [OWNER, U(11)]);
    const after = (await db.query(
      `select units_per_pack, packs_per_carton, buy_price_level
         from public.supplier_quote_product_packages where product_id=$1`, [U(11)])).rows[0];
    check("the application's upsert still works", Number(after.units_per_pack) === 24);
    check("and leaves the other columns alone",
      Number(after.packs_per_carton) === 3 && after.buy_price_level === null,
      JSON.stringify(after));
  } catch (e) { check("the application's upsert still works", false, e.message); }

  const n = (await db.query(
    `select count(*) n from public.supplier_quote_product_packages`)).rows[0];
  check("no row was lost anywhere in this suite", Number(n.n) === 2, `${n.n}`);
}

console.log("\n6. Re-applying is safe");
try {
  await db.exec(readFileSync(MIG, "utf8"));
  check("re-applies cleanly", true);
  const n = (await db.query(
    `select count(*) n from pg_constraint
      where conname='supplier_quote_product_packages_buy_price_level_check'`)).rows[0];
  check("without duplicating the constraint", Number(n.n) === 1, `${n.n}`);
} catch (e) { check("re-applies cleanly", false, e.message); }

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
await db.close();
process.exit(fail ? 1 : 0);
