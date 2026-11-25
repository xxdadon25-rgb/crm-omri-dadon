-- PREPARATION ONLY — DO NOT APPLY TO PRODUCTION BEFORE RESTORE TEST.
-- Verified legacy policies on 2026-11-23:
--   customers_delete FOR DELETE TO public USING (true)
--   products_delete  FOR DELETE TO public USING (true)
-- Those policies permit broad deletes and must not be inherited by sales agents.
--
-- No data deletion here. The owner keeps the existing ownership-based delete
-- behavior. Agent accounts and portal customers are not granted DELETE.
begin;

drop policy if exists "customers_delete" on public.customers;
create policy "customers_delete" on public.customers
  for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "products_delete" on public.products;
create policy "products_delete" on public.products
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- The two tables must remain SELECT-protected by existing owner/portal RLS.
-- This also stops anon users via the policy's TO authenticated restriction.
-- Note: legacy RPCs running SECURITY DEFINER still need separate audit.
commit;

-- Verification checklist against restored snapshot:
-- [ ] Owner can delete a *throwaway* row they own (rollback test transaction).
-- [ ] Owner cannot delete another owner's row.
-- [ ] Agent cannot delete any customer's/product's row, even if assigned.
-- [ ] Portal user cannot delete own/any row.
-- [ ] Anonymous user cannot delete any row.
-- [ ] Existing invoice/order/item/stock behavior unchanged.
