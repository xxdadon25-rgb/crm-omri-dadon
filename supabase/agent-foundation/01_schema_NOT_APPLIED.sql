-- PREPARATION ONLY. DO NOT APPLY BEFORE order RPC, legacy RLS, route guards,
-- invoice linkage, and security tests have passed in an isolated environment.
-- No agents are activated or assigned by this schema.
-- Intentionally additive; does not change existing data, RLS, auth, or order flow.
begin;

create table if not exists public.sales_agent_profiles (
  auth_user_id uuid primary key references auth.users(id) on delete restrict,
  owner_auth_id uuid not null references auth.users(id) on delete restrict,
  display_name text not null check (length(trim(display_name)) > 0),
  commission_pct numeric(5,2) not null default 8 check (commission_pct between 0 and 100),
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists sales_agent_profiles_owner_idx on public.sales_agent_profiles(owner_auth_id);

-- Explicit manager accounts, not JWT/user_metadata or changeable email strings.
-- Manager records must be seeded only after verifying auth user IDs.
create table if not exists public.sales_agent_managers (
  auth_user_id uuid primary key references auth.users(id) on delete restrict,
  owner_auth_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists sales_agent_managers_owner_idx on public.sales_agent_managers(owner_auth_id);

create table if not exists public.sales_agent_customer_assignments (
  customer_id uuid not null references public.customers(id) on delete cascade,
  agent_auth_id uuid not null references public.sales_agent_profiles(auth_user_id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,
  primary key(customer_id, agent_auth_id)
);
create index if not exists sales_agent_assignments_agent_idx on public.sales_agent_customer_assignments(agent_auth_id);

-- Attribution never changes when customer ownership changes.
-- The order's legacy "agent" text is NOT an authorization or commission key.
create table if not exists public.sales_agent_order_attributions (
  order_id uuid primary key references public.orders(id) on delete restrict,
  agent_auth_id uuid not null references public.sales_agent_profiles(auth_user_id) on delete restrict,
  attributed_at timestamptz not null default now()
);
create index if not exists sales_agent_orders_agent_idx on public.sales_agent_order_attributions(agent_auth_id);

-- Pending exceptions must remain drafts, without stock/invoice side effects.
-- The binding hash must cover customer, quantities, item prices, discount, cost
-- evidence, and computed gross margin; trusted server code validates it again.
create table if not exists public.sales_agent_margin_exceptions (
  id uuid primary key default gen_random_uuid(),
  agent_auth_id uuid not null references public.sales_agent_profiles(auth_user_id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  order_payload jsonb not null,
  request_hash text not null,
  margin_pct numeric(9,4) not null,
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected','invalidated')),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete restrict,
  decided_at timestamptz,
  constraint agent_exception_decision_consistency check (
    (status = 'pending' and decided_by is null and decided_at is null) or
    (status <> 'pending' and decided_by is not null and decided_at is not null)
  )
);
create index if not exists sales_agent_exceptions_pending_idx on public.sales_agent_margin_exceptions(status,requested_at);

-- Readable alerts for new delivery orders, with one alert per source order.
create table if not exists public.sales_agent_delivery_alerts (
  order_id uuid primary key references public.orders(id) on delete cascade,
  agent_auth_id uuid not null references public.sales_agent_profiles(auth_user_id) on delete restrict,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

-- Immutable accounting allocations, not "commission = all payments by customer".
-- Each eligible receipt allocation is recognized once, with refunds as
-- negative adjustment entries; historical rate captured at accrual.
create table if not exists public.sales_agent_commission_entries (
  id uuid primary key default gen_random_uuid(),
  agent_auth_id uuid not null references public.sales_agent_profiles(auth_user_id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete restrict,
  entry_kind text not null check (entry_kind in ('settlement','reversal')),
  source_key text not null unique,
  settled_on date not null,
  net_collected numeric(14,2) not null,
  commission_pct numeric(5,2) not null check (commission_pct between 0 and 100),
  commission_amount numeric(14,2) not null,
  created_at timestamptz not null default now()
);
create index if not exists sales_agent_commissions_agent_date_idx on public.sales_agent_commission_entries(agent_auth_id,settled_on);

-- A separate payout log prevents double-payment of the same earned commission.
create table if not exists public.sales_agent_commission_payouts (
  id uuid primary key default gen_random_uuid(),
  agent_auth_id uuid not null references public.sales_agent_profiles(auth_user_id) on delete restrict,
  period_month date not null check (extract(day from period_month) = 1),
  amount numeric(14,2) not null check (amount >= 0),
  paid_at timestamptz not null,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists sales_agent_payouts_agent_period_idx on public.sales_agent_commission_payouts(agent_auth_id,period_month);

-- Default-deny: no browser write access until tested, narrowly scoped RPCs
-- are built. Existing owner/admin tables are intentionally untouched.
do $$
declare t text;
begin
  foreach t in array array[
    'sales_agent_profiles','sales_agent_managers','sales_agent_customer_assignments',
    'sales_agent_order_attributions','sales_agent_margin_exceptions',
    'sales_agent_delivery_alerts','sales_agent_commission_entries','sales_agent_commission_payouts'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
  end loop;
end $$;

-- New tables require explicit manager membership; no seed, no privileges.
-- This function only answers a question, cannot change records.
create or replace function public.sales_agent_is_manager(p_owner uuid)
returns boolean language sql stable security invoker
set search_path = '' as $$
 select exists (
   select 1 from public.sales_agent_managers m
   where m.auth_user_id = (select auth.uid()) and m.owner_auth_id = p_owner
 )
$$;
grant execute on function public.sales_agent_is_manager(uuid) to authenticated;

-- A manager sees only agents belonging to their business; an agent sees self.
create policy "agent_profile_read" on public.sales_agent_profiles
for select to authenticated using (
  auth_user_id = (select auth.uid()) or
  public.sales_agent_is_manager(owner_auth_id)
);
create policy "manager_membership_read_self" on public.sales_agent_managers
for select to authenticated using (auth_user_id = (select auth.uid()));
create policy "agent_assignment_read" on public.sales_agent_customer_assignments
for select to authenticated using (
  agent_auth_id = (select auth.uid()) or
  exists (select 1 from public.sales_agent_profiles p
    where p.auth_user_id = agent_auth_id and public.sales_agent_is_manager(p.owner_auth_id))
);
create policy "agent_order_attribution_read" on public.sales_agent_order_attributions
for select to authenticated using (
  agent_auth_id = (select auth.uid()) or
  exists (select 1 from public.sales_agent_profiles p
    where p.auth_user_id = agent_auth_id and public.sales_agent_is_manager(p.owner_auth_id))
);
create policy "agent_exception_read" on public.sales_agent_margin_exceptions
for select to authenticated using (
  agent_auth_id = (select auth.uid()) or
  exists (select 1 from public.sales_agent_profiles p
    where p.auth_user_id = agent_auth_id and public.sales_agent_is_manager(p.owner_auth_id))
);
create policy "agent_delivery_alert_read" on public.sales_agent_delivery_alerts
for select to authenticated using (
  agent_auth_id = (select auth.uid()) or
  exists (select 1 from public.sales_agent_profiles p
    where p.auth_user_id = agent_auth_id and public.sales_agent_is_manager(p.owner_auth_id))
);
create policy "agent_commission_read" on public.sales_agent_commission_entries
for select to authenticated using (
  agent_auth_id = (select auth.uid()) or
  exists (select 1 from public.sales_agent_profiles p
    where p.auth_user_id = agent_auth_id and public.sales_agent_is_manager(p.owner_auth_id))
);
create policy "agent_payout_read" on public.sales_agent_commission_payouts
for select to authenticated using (
  agent_auth_id = (select auth.uid()) or
  exists (select 1 from public.sales_agent_profiles p
    where p.auth_user_id = agent_auth_id and public.sales_agent_is_manager(p.owner_auth_id))
);
commit;
