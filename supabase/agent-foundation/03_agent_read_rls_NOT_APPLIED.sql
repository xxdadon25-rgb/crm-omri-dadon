-- PREPARATION ONLY — DO NOT APPLY IN PRODUCTION.
-- Requires 01_schema_NOT_APPLIED.sql. Read-only agent access only.
-- Existing owner and portal SELECT policies remain unchanged; Postgres RLS
-- combines permissive policies with OR. Agent write access is NOT added here.
-- Agent profiles remain inactive until secure write RPCs are fully tested.
begin;

-- Restrict customer access to active, explicitly assigned agents of the same
-- business as the customer's legacy owner. No global user_id impersonation.
create policy "sales_agent_customers_read_assigned" on public.customers
  for select to authenticated using (
    exists (
      select 1
      from public.sales_agent_customer_assignments ca
      join public.sales_agent_profiles ap
        on ap.auth_user_id = ca.agent_auth_id
      where ca.customer_id = customers.id
        and ca.agent_auth_id = (select auth.uid())
        and ap.is_active = true
        and ap.owner_auth_id = customers.user_id
    )
  );

-- All business products may be visible to an active agent (cost + sale price
-- are explicitly requested). This does not grant supplier/stock write access.
create policy "sales_agent_products_read_owner_catalog" on public.products
  for select to authenticated using (
    exists (
      select 1 from public.sales_agent_profiles ap
      where ap.auth_user_id = (select auth.uid())
        and ap.is_active = true
        and ap.owner_auth_id = products.user_id
    )
  );

-- On ASSIGNED existing customers the agent can see historical orders and
-- invoices, even when created before assignment. Changing assignments
-- immediately revokes this read path. Attribution for commission is separate.
create policy "sales_agent_orders_read_assigned" on public.orders
  for select to authenticated using (
    orders.customer_id is not null
    and exists (
      select 1
      from public.sales_agent_customer_assignments ca
      join public.sales_agent_profiles ap
        on ap.auth_user_id = ca.agent_auth_id
      where ca.customer_id = orders.customer_id
        and ca.agent_auth_id = (select auth.uid())
        and ap.is_active = true
        and ap.owner_auth_id = orders.user_id
    )
  );

create policy "sales_agent_invoices_read_assigned" on public.invoices
  for select to authenticated using (
    invoices.customer_id is not null
    and exists (
      select 1
      from public.sales_agent_customer_assignments ca
      join public.sales_agent_profiles ap
        on ap.auth_user_id = ca.agent_auth_id
      where ca.customer_id = invoices.customer_id
        and ca.agent_auth_id = (select auth.uid())
        and ap.is_active = true
        and ap.owner_auth_id = invoices.user_id
    )
  );

create policy "sales_agent_payments_read_assigned" on public.payments
  for select to authenticated using (
    exists (
      select 1
      from public.sales_agent_customer_assignments ca
      join public.sales_agent_profiles ap
        on ap.auth_user_id = ca.agent_auth_id
      where ca.customer_id = payments.customer_id
        and ca.agent_auth_id = (select auth.uid())
        and ap.is_active = true
        and ap.owner_auth_id = payments.user_id
    )
  );

create policy "sales_agent_quotes_read_assigned" on public.quotes
  for select to authenticated using (
    quotes.customer_id is not null
    and exists (
      select 1
      from public.sales_agent_customer_assignments ca
      join public.sales_agent_profiles ap
        on ap.auth_user_id = ca.agent_auth_id
      where ca.customer_id = quotes.customer_id
        and ca.agent_auth_id = (select auth.uid())
        and ap.is_active = true
        and ap.owner_auth_id = quotes.user_id
    )
  );

create policy "sales_agent_credit_notes_read_assigned" on public.credit_notes
  for select to authenticated using (
    exists (
      select 1
      from public.sales_agent_customer_assignments ca
      join public.sales_agent_profiles ap
        on ap.auth_user_id = ca.agent_auth_id
      where ca.customer_id = credit_notes.customer_id
        and ca.agent_auth_id = (select auth.uid())
        and ap.is_active = true
        and ap.owner_auth_id = credit_notes.user_id
    )
  );

create policy "sales_agent_customer_prices_read_assigned" on public.customer_product_prices
  for select to authenticated using (
    exists (
      select 1
      from public.sales_agent_customer_assignments ca
      join public.sales_agent_profiles ap
        on ap.auth_user_id = ca.agent_auth_id
      join public.customers c
        on c.id = ca.customer_id
      where ca.customer_id = customer_product_prices.customer_id
        and ca.agent_auth_id = (select auth.uid())
        and ap.is_active = true
        and ap.owner_auth_id = c.user_id
    )
  );

commit;

-- MANDATORY AFTER STAGING, BEFORE PRODUCTION:
-- Verify policy access in a restored isolated database using four accounts:
-- owner, active agent, portal customer, unrelated authenticated user.
-- Assert cross-tenant and unassigned reads return 0 rows. Direct REST/RPC
-- mutations must still be forbidden. Disable agent => reads immediately 0.
-- Run regression checks for legacy owner/portal visibility.
