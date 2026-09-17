-- ─────────────────────────────────────────────────────────────────────────────
-- PUBLIC PRODUCT CATALOG
--
-- PURELY ADDITIVE. Creates ONE schema, ONE function and ONE view. It creates no
-- table, alters no table, and does not add, drop or modify a single RLS policy
-- on public.products. The CRM and the customer portal are untouched.
--
-- THE PROBLEM THIS SHAPE SOLVES
--   The obvious implementation is a plain view over products. Since PostgreSQL
--   15 a view defaults to security_invoker = false, which makes it run with its
--   OWNER's privileges — that is what lets anon read it without any grant on
--   products, and it is also exactly what Supabase's Security Advisor reports
--   as the `security_definer_view` error for any view in an exposed schema.
--
--   Switching that view to security_invoker = true silences the advisor but
--   moves every permission check onto the CALLER. If the view read products
--   directly, anon would then need its own SELECT privilege on public.products
--   plus a SELECT policy allowing it — which means anon could query
--   /rest/v1/products directly. That is precisely what must not happen.
--
-- THE SHAPE USED INSTEAD
--   A SECURITY DEFINER function in a NON-EXPOSED schema does the privileged
--   read, and a plain security_invoker = true view in public selects from it.
--
--     anon ──SELECT──▶ public.public_catalog        (view, security_invoker = TRUE)
--                           │
--                           └──EXECUTE──▶ catalog_internal.public_catalog_rows()
--                                             │        (SECURITY DEFINER)
--                                             └──reads──▶ public.products
--
--   Because the view is security_invoker = true, the Security Advisor has
--   nothing to report about it. The privileged read happens one level down,
--   inside the function, as the function's OWNER. anon therefore needs — and
--   receives — NO privilege whatsoever on public.products.
--
--   The five-column projection and the owner/is_active filter live inside the
--   function, which takes no parameters, so a caller cannot widen the column
--   list or switch the filter off.
--
-- WHY THE FUNCTION LIVES IN catalog_internal
--   PostgREST only serves objects in the schemas configured as EXPOSED
--   (Supabase: API Settings → Exposed schemas, normally `public`). A function
--   in catalog_internal therefore has no REST endpoint: a request to
--   /rest/v1/rpc/public_catalog_rows does not resolve, even though anon holds
--   EXECUTE on the function. The grants below are what the VIEW needs in order
--   to run; they are not an API surface.
--
--   anon must hold those privileges precisely BECAUSE the view is
--   security_invoker = true: with that setting PostgreSQL checks access to the
--   view's underlying objects as the invoking role, and the function is the
--   only underlying object. USAGE on the schema plus EXECUTE on the function is
--   the complete minimum, and nothing else in catalog_internal is granted.
--
-- WRITE SURFACE: NONE, STRUCTURALLY
--   A view over a single table is auto-updatable in PostgreSQL, so a plain-view
--   design would carry a real INSERT/UPDATE/DELETE path into products that had
--   to be closed by hand. A view over a SET-RETURNING FUNCTION is NOT
--   auto-updatable: there is no write path to close and no grant could
--   accidentally reopen one. The REVOKEs below are belt and braces.
--
-- REQUIREMENTS THIS RELIES ON, BOTH VERIFIED AGAINST THE REPO
--   * public.products has no FORCE ROW LEVEL SECURITY, so the function's owner
--     (the migration role, which owns products) reads it without needing a
--     policy. If FORCE RLS is ever enabled on products this function stops
--     returning rows and would need a policy of its own — it fails closed,
--     never open.
--   * The function must be owned by a role that can read products, i.e. created
--     by the migration runner. Do not recreate it as a lesser role.
--
-- is_active IS TRUE, not = true: the column is nullable and a NULL must not be
-- published. `is true` excludes NULL and states that intent explicitly.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Idempotent teardown ──────────────────────────────────────────────────────
-- The view depends on the function, so it goes first. The public-schema
-- function is from an earlier draft of this migration and is removed if a
-- previous version was ever applied.
drop view if exists public.public_catalog;
drop function if exists public.public_catalog_rows();

-- ── The private schema ───────────────────────────────────────────────────────
-- Never added to the API's exposed schemas. It exists only to keep the
-- privileged function off the REST surface.
create schema if not exists catalog_internal;

comment on schema catalog_internal is
  'Internal, NON-EXPOSED schema. Must never be added to the PostgREST exposed-schema list. Holds the privileged read behind public.public_catalog.';

drop function if exists catalog_internal.public_catalog_rows();

-- Default-deny the schema itself, then grant only the USAGE the view needs in
-- order to reach the function as the invoking role.
revoke all on schema catalog_internal from public;
grant usage on schema catalog_internal to anon;
grant usage on schema catalog_internal to authenticated;

-- Any function created here later must not inherit the PUBLIC execute default.
alter default privileges in schema catalog_internal revoke execute on functions from public;

-- ── The privileged read, fixed and parameterless ─────────────────────────────
create function catalog_internal.public_catalog_rows()
returns table (
  id          uuid,
  name        text,
  category    text,
  image_url   text,
  description text
)
language sql
stable
security definer
-- An EMPTY search_path is the strictest setting available: nothing is resolved
-- implicitly, so no temp table or same-named object in another schema can be
-- substituted for `products`. Every reference in the body is fully qualified,
-- which is what makes the empty path workable.
set search_path = ''
as $$
  select
    p.id,
    p.name,
    p.category,
    p.image_url,
    p.description
  from public.products p
  where p.user_id = 'd959c2cc-d212-475d-bf85-35cb3090f6dd'::uuid
    and p.is_active is true;
$$;

comment on function catalog_internal.public_catalog_rows() is
  'Privileged read behind public.public_catalog. Returns five safe columns of one owner''s active products. No price, stock, supplier, notes or any other internal field is selected. Not reachable over REST: this schema is not exposed.';

-- EXECUTE is granted to PUBLIC by default for new functions; take it back first,
-- then grant only to the two roles that read the view.
revoke all on function catalog_internal.public_catalog_rows() from public;
grant execute on function catalog_internal.public_catalog_rows() to anon;
grant execute on function catalog_internal.public_catalog_rows() to authenticated;

-- ── The one public relation the frontend queries ─────────────────────────────
-- security_invoker = true keeps the Security Advisor quiet. It is safe here
-- precisely because the view touches no base table: its only underlying object
-- is the function above, and EXECUTE on that is the only privilege it needs.
create view public.public_catalog
with (security_invoker = true)
as
select
  id,
  name,
  category,
  image_url,
  description
from catalog_internal.public_catalog_rows();

comment on view public.public_catalog is
  'Read-only public catalogue, and the only public catalogue relation. Active products of one owner, five safe columns only: id, name, category, image_url, description. Reads catalog_internal.public_catalog_rows(), never public.products directly, so no caller needs any privilege on that table.';

-- Default-deny, then the single privilege the catalogue actually needs.
revoke all on public.public_catalog from public;
revoke all on public.public_catalog from anon;
revoke all on public.public_catalog from authenticated;

grant select on public.public_catalog to anon;
grant select on public.public_catalog to authenticated;
