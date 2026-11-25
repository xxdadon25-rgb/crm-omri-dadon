-- STAGED ONLY — NOT APPLIED TO QUICKSTOCK PRODUCTION.
-- Live production has the permissive public_read_quotes USING(true) policy.
-- PostgreSQL ORs permissive SELECT policies: the new assigned-customer
-- policy alone does NOT restrict an agent from reading all quotes.
-- A RESTRICTIVE authenticated SELECT policy closes that agent-only path.
-- It leaves historical owner and non-agent portal/anonymous access
-- unchanged; any existing broad PUBLIC access is a separate legacy concern.
begin;
create policy sales_agent_quotes_restrict_assigned
  on public.quotes as restrictive for select to authenticated
  using (
    not exists (
      select 1 from public.sales_agent_profiles ap
      where ap.auth_user_id=(select auth.uid())
    )
    or (
      quotes.customer_id is not null
      and exists (
        select 1
        from public.sales_agent_customer_assignments ca
        join public.sales_agent_profiles ap
          on ap.auth_user_id=ca.agent_auth_id
        where ca.customer_id=quotes.customer_id
          and ca.agent_auth_id=(select auth.uid())
          and ap.owner_auth_id=quotes.user_id
          and ap.is_active is true
      )
    )
  );
commit;
