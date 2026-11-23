-- PREPARATION ONLY — DO NOT APPLY TO PRODUCTION.
-- Requires 01_schema_NOT_APPLIED.sql and restored-database RLS tests.
--
-- Existing direct owner-scoped INSERT/UPDATE/DELETE policies must not allow a
-- sales agent to create records with their own auth.uid() as user_id and bypass
-- manager review, inventory, invoices, and minimum margin.
--
-- RESTRICTIVE policies combine with the existing permissive policies using
-- AND; they do not add access and do not restrict SELECT. Existing manager
-- account has no sales_agent_profiles record and retains legacy write paths.
begin;

do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'orders', 'products', 'invoices', 'payments',
    'quotes', 'credit_notes'
  ] loop
    execute format(
      'create policy sales_agent_no_direct_insert on public.%I as restrictive for insert to authenticated with check (not exists (select 1 from public.sales_agent_profiles ap where ap.auth_user_id = (select auth.uid())))',
      t
    );
    execute format(
      'create policy sales_agent_no_direct_update on public.%I as restrictive for update to authenticated using (not exists (select 1 from public.sales_agent_profiles ap where ap.auth_user_id = (select auth.uid()))) with check (not exists (select 1 from public.sales_agent_profiles ap where ap.auth_user_id = (select auth.uid())))',
      t
    );
    execute format(
      'create policy sales_agent_no_direct_delete on public.%I as restrictive for delete to authenticated using (not exists (select 1 from public.sales_agent_profiles ap where ap.auth_user_id = (select auth.uid())))',
      t
    );
  end loop;
end $$;

-- No modifications here to authenticated SELECT or other portal read policies.
-- 04_legacy_delete_hardening_NOT_APPLIED.sql separately removes broad PUBLIC
-- customer/product delete policies, which RESTRICTIVE authenticated policies
-- do not protect against anon calls.

commit;

-- CRITICAL LIMITATION: SECURITY DEFINER RPCs bypass RLS.
-- Before enabling agents, separately audit EVERY callable definer routine
-- (not just create_order_with_inventory and save_order_with_inventory) so no
-- agent can mutate client records or grant itself privileges via another RPC.
-- Manager/portal and unrelated user regression tests are mandatory.
