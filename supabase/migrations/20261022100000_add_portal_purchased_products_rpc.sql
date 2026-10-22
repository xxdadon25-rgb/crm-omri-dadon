-- Customer Portal: the products a customer has ordered before, most-ordered first.
--
-- ADDITIVE AND READ-ONLY. Creates ONE function. It adds no table, no column,
-- no trigger and no policy; it alters nothing that exists; it writes no row.
-- Dropping it restores today's behaviour exactly, because the portal treats an
-- empty result and a missing function identically (see ROLLBACK).
--
-- WHY A FUNCTION AND NOT A QUERY FROM THE BROWSER
--   Two reasons, and the first is the important one.
--
--   1. IDENTITY. The portal must never say WHICH customer is asking. This
--      project carries pre-existing broad "Internal users full access" policies
--      written as auth.role() = 'authenticated', so a signed-in portal customer
--      satisfies RLS on `orders`. A client-side
--        .from("orders").select("items").eq("customer_id", <id>)
--      would therefore return rows for ANY customer id the browser cared to
--      send. This function takes no customer id at all: it resolves one from
--      auth.uid() through customer_portal_access, the same chain the portal
--      itself trusts, and there is no parameter to tamper with. No active
--      access row means NO ROWS, never "all rows" — it fails closed.
--
--   2. SHAPE. orders.items is JSONB, so counting per product means
--      jsonb_array_elements. Client-side that would mean downloading every
--      order the customer ever placed just to count product ids.
--
--   It returns product ids and a count. No prices, totals, dates, order
--   numbers or customer names cross the boundary.
--
-- WHAT "FREQUENCY" MEANS HERE
--   The number of distinct ORDERS that contain the product — not the total
--   quantity. Ten units on one order counts once; one unit on ten orders counts
--   ten times. That is what "how often do I reorder this" means, and it keeps a
--   single bulk purchase from dominating the list.
--
-- THE DOUBLE-COUNTING TRAP
--   An approved portal order is COPIED into `orders` and the original keeps a
--   pointer: portal_orders.linked_order_id. Both rows then describe one event.
--   Counting both tables naively would score every approved portal order twice
--   and quietly rank portal-ordered products above CRM-ordered ones.
--
--   So portal_orders are counted ONLY while linked_order_id IS NULL — i.e. only
--   those not yet represented in `orders`. The CRM copy is authoritative the
--   moment it exists. Pending orders still count, because the customer did
--   order them; rejected ones do not.
create or replace function public.portal_my_purchased_products(p_limit int default 200)
returns table (product_id uuid, order_count bigint)
language plpgsql
security definer
-- Mandatory for SECURITY DEFINER: without it a caller-controlled search_path
-- could resolve `orders` or `products` to objects of their own choosing.
set search_path to public, pg_temp
as $$
declare
  v_customer_id uuid;
  v_limit       int;
begin
  -- Clamped rather than trusted. The caller uses this to bound the id list it
  -- will send back in a URL, so an absurd value is a client problem, not a
  -- reason to scan without limit.
  v_limit := least(greatest(coalesce(p_limit, 200), 1), 500);

  -- ---- Who is asking -----------------------------------------------------
  -- auth.uid() is not client-settable. Every condition here is also enforced
  -- by the portal before it shows a catalogue at all, so a row that fails any
  -- of them has no business receiving a personalised list.
  select cpa.customer_id
    into v_customer_id
    from public.customer_portal_access cpa
   where cpa.auth_user_id = auth.uid()
     and cpa.is_active = true
     and cpa.customer_id is not null
     and cpa.portal_deleted_at is null
   limit 1;

  -- Not a portal customer (staff demo users included): no history, no rows.
  -- The portal then renders exactly the catalogue it renders today.
  if v_customer_id is null then
    return;
  end if;

  return query
  with crm_raw as (
    -- One row per order line. `items` is client-supplied JSONB, so the
    -- product_id is read as TEXT here and validated before it is ever cast.
    select o.id as order_id,
           e ->> 'product_id' as pid_text
      from public.orders o
      cross join lateral jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) as e
     where o.customer_id = v_customer_id
       -- Same exclusions the CRM's own last-price tracking uses: a cancelled or
       -- draft order is not a purchase.
       and coalesce(o.status, '') not in ('בוטל', 'טיוטה')
  ),
  crm_lines as (
    -- DISTINCT (order, product): a product listed twice on one order is still
    -- one order. The cast sits inside CASE on purpose — CASE guarantees the
    -- branch is only evaluated when the pattern matched, so a malformed
    -- product_id in legacy JSONB yields NULL instead of raising 22P02 and
    -- failing the whole call.
    select distinct
           order_id,
           case
             when pid_text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
               then pid_text::uuid
           end as pid
      from crm_raw
     where nullif(pid_text, '') is not null
  ),
  portal_lines as (
    -- Portal orders NOT yet converted into a CRM order. See "the
    -- double-counting trap" above: linked_order_id IS NULL is the whole guard.
    select distinct
           po.id as order_id,
           poi.product_id as pid
      from public.portal_orders po
      join public.portal_order_items poi
        on poi.portal_order_id = po.id
     where po.customer_id = v_customer_id
       and po.linked_order_id is null
       and coalesce(po.status, '') <> 'rejected'
       and poi.product_id is not null
  ),
  every_line as (
    -- UNION ALL, not UNION: the two sides are already distinct within
    -- themselves and cannot overlap, because an order id comes from exactly
    -- one of the two tables and a linked portal order is excluded above.
    select order_id, pid from crm_lines
    union all
    select order_id, pid from portal_lines
  )
  select l.pid, count(*)::bigint
    from every_line l
    -- Inner join: a deleted or deactivated product must not occupy a slot in
    -- the prioritised list, since the catalogue would never render it.
    join public.products p
      on p.id = l.pid
     and p.is_active = true
   where l.pid is not null
   group by l.pid
   -- pid as the tiebreaker so equal counts cannot shuffle between calls and
   -- reorder the customer's first screen on every page load.
   order by count(*) desc, l.pid
   limit v_limit;
end;
$$;

-- Only signed-in callers, and nothing is granted to anon or to PUBLIC. The
-- REVOKE is explicit because a freshly created function is executable by
-- PUBLIC by default.
revoke all on function public.portal_my_purchased_products(int) from public;
revoke all on function public.portal_my_purchased_products(int) from anon;
grant execute on function public.portal_my_purchased_products(int) to authenticated;

comment on function public.portal_my_purchased_products(int) is
  'Customer Portal: product ids this customer has ordered before, with the number of distinct orders containing each, most-ordered first. Customer resolved from auth.uid() via customer_portal_access; takes no customer id. Counts CRM orders plus portal orders that have no linked_order_id, so an approved portal order is never counted twice. Returns no rows for a caller without an active, linked, non-deleted portal access row.';

-- ---------------------------------------------------------------------------
-- VERIFICATION — raises if the function is not in the expected state, so a
-- partial apply is visible now rather than at the next portal login.
-- ---------------------------------------------------------------------------
do $check$
declare
  v_secdef  boolean;
  v_config  text[];
  v_public  boolean;
begin
  select p.prosecdef, p.proconfig
    into v_secdef, v_config
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'portal_my_purchased_products';

  if v_secdef is null then
    raise exception 'verification failed: function was not created';
  end if;
  if not v_secdef then
    raise exception 'verification failed: function is not SECURITY DEFINER';
  end if;
  if v_config is null or not ('search_path=public, pg_temp' = any (v_config)) then
    raise exception 'verification failed: search_path is not pinned (proconfig=%)', v_config;
  end if;

  -- PUBLIC is ACL grantee oid 0, not a role, so aclexplode is the only
  -- reliable way to ask this. A null proacl would mean the default
  -- EXECUTE-to-PUBLIC, which the REVOKE above is there to remove.
  select exists (
           select 1
             from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where n.nspname = 'public'
              and p.proname = 'portal_my_purchased_products'
              and a.grantee = 0
              and a.privilege_type = 'EXECUTE'
         )
    into v_public;

  if v_public then
    raise exception 'verification failed: EXECUTE is still granted to PUBLIC';
  end if;
end
$check$;

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- DROP FUNCTION IF EXISTS public.portal_my_purchased_products(int);
--
-- Safe at any time and loses nothing: the function stores no state and writes
-- no row. The portal treats an RPC error as "no history" and falls back to the
-- existing alphabetical catalogue, so dropping this mid-session degrades the
-- ordering and breaks nothing.
-- ---------------------------------------------------------------------------
