-- STAGED ONLY — NOT APPLIED TO PRODUCTION.
-- Production currently has public_read_quotes FOR SELECT TO public USING(true).
-- An agent can drop the JWT and query anonymously, bypassing the earlier
-- agent-only restrictive policy. No policy scoped only TO authenticated can
-- prevent anonymous access permitted by another public SELECT policy.
--
-- Replaces global anonymous quote reads with customer-scoped portal reads.
-- Owner and agent assigned-customer SELECT policies remain unchanged.
-- REQUIRES explicit release approval and portal/external-link compatibility
-- verification before applying: old public quote links may depend on anon.
begin;
drop policy if exists public_read_quotes on public.quotes;
create policy sales_agent_portal_quotes_read_own
on public.quotes for select to authenticated
using (
  quotes.customer_id is not null
  and exists (
    select 1 from public.customer_portal_access cpa
    where cpa.auth_user_id = (select auth.uid())
      and cpa.customer_id = quotes.customer_id
      and cpa.is_active is true
      and cpa.portal_deleted_at is null
  )
);
commit;
