-- PREPARATION ONLY: DO NOT APPLY IN PRODUCTION.
-- Read-only trusted margin calculation for future sales-agent order RPC.
--
-- IMPORTANT: Product buy_price has heterogeneous unit/pack/carton bases;
-- neither a browser-supplied buy_price NOR a made-up multiplier can be
-- trusted. Only products whose cost PER SOLD UNIT was VERIFIED by management
-- may pass this particular gate. The current product purchase snapshot is
-- recorded and compared, making edited purchase prices fail closed until
-- re-verification. This table is initially empty and creates NO auto-approvals.
begin;

create table if not exists public.sales_agent_verified_unit_costs (
  product_id uuid primary key references public.products(id) on delete cascade,
  owner_auth_id uuid not null references auth.users(id) on delete restrict,
  cost_per_sold_unit_net numeric(16,6) not null
    check (cost_per_sold_unit_net >= 0),
  observed_buy_price numeric(16,6) not null
    check (observed_buy_price >= 0),
  verified_by uuid not null references auth.users(id) on delete restrict,
  verified_at timestamptz not null default now(),
  notes text
);
alter table public.sales_agent_verified_unit_costs enable row level security;
revoke all on public.sales_agent_verified_unit_costs from public,anon,authenticated;
grant select on public.sales_agent_verified_unit_costs to authenticated;
create policy "verified_unit_cost_read" on public.sales_agent_verified_unit_costs
for select to authenticated using (
  owner_auth_id = (select auth.uid()) or
  exists (
    select 1 from public.sales_agent_profiles ap
    where ap.auth_user_id = (select auth.uid())
      and ap.owner_auth_id = sales_agent_verified_unit_costs.owner_auth_id
      and ap.is_active = true
  )
);

-- A cost can be inserted/updated only through a subsequent audited manager
-- process. No direct client writes or administrator bulk auto-fill.

create or replace function public.sales_agent_check_order_margin(
  p_customer_id uuid,
  p_items jsonb,
  p_document_discount_net numeric default 0
)
returns table (
  allowed boolean,
  needs_manager_exception boolean,
  margin_percent numeric,
  net_revenue numeric,
  net_cost numeric,
  rejection_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := auth.uid();
  v_owner uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_cost public.sales_agent_verified_unit_costs%rowtype;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_line_total numeric;
  v_expected_total numeric;
  v_sum_sales numeric := 0;
  v_sum_cost numeric := 0;
  v_margin numeric;
begin
  -- This is an INFORMATIONAL read-only calculator; the future order write
  -- RPC MUST recalculate the margin in the same transaction as the insert.
  -- Calling this function does not create any permission to place orders.
  if v_agent is null then raise exception 'not_authenticated'; end if;
  select ap.owner_auth_id into v_owner
  from public.sales_agent_profiles ap
  where ap.auth_user_id = v_agent and ap.is_active = true;
  if v_owner is null then raise exception 'agent_not_active'; end if;

  if p_customer_id is null or not exists (
    select 1
    from public.sales_agent_customer_assignments ca
    join public.customers c on c.id=ca.customer_id
    where ca.agent_auth_id = v_agent and ca.customer_id=p_customer_id
      and c.user_id=v_owner
  ) then raise exception 'customer_not_assigned'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 250 then
    raise exception 'invalid_items';
  end if;
  if p_document_discount_net is null or p_document_discount_net < 0 then
    raise exception 'invalid_document_discount';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'invalid_line'; end if;

    -- Validate all provided numeric fields before coercion; client input
    -- cannot pretend a line has a different net total from its priced items.
    if coalesce(v_item->>'quantity','') !~ '^[0-9]+([.][0-9]+)?$'
      or coalesce(v_item->>'unit_price','') !~ '^[0-9]+([.][0-9]+)?$'
      or coalesce(v_item->>'total','') !~ '^[0-9]+([.][0-9]+)?$'
      or coalesce(v_item->>'discount','0') !~ '^[0-9]+([.][0-9]+)?$'
      or coalesce(v_item->>'product_id','') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then raise exception 'invalid_line'; end if;

    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_discount := coalesce((v_item->>'discount')::numeric,0);
    v_line_total := (v_item->>'total')::numeric;
    if v_quantity <= 0 or v_quantity > 1000000 or v_unit_price < 0
      or v_unit_price > 100000000 or v_discount < 0 or v_discount > 100
      or v_line_total < 0 then raise exception 'invalid_line'; end if;

    v_expected_total := round(v_quantity*v_unit_price*(1-v_discount/100),2);
    if abs(v_expected_total-v_line_total) > 0.01 then
      raise exception 'inconsistent_line_total';
    end if;

    select * into v_product from public.products p
    where p.id=(v_item->>'product_id')::uuid
      and p.user_id=v_owner and p.is_active is true;
    if not found then raise exception 'product_not_found'; end if;

    -- A server-trusted, still-current cost basis must exist. If an owner
    -- changes a product's buy_price, re-verify its unit cost first.
    select * into v_cost from public.sales_agent_verified_unit_costs vc
    where vc.product_id=v_product.id and vc.owner_auth_id=v_owner
      and vc.observed_buy_price=v_product.buy_price;
    if not found then raise exception 'cost_basis_unverified'; end if;

    -- The server must NOT use line.buy_price, line.price_basis,
    -- line.packaging, or any client-supplied cost evidence.
    v_sum_sales := v_sum_sales + v_line_total;
    v_sum_cost := v_sum_cost + round(v_quantity*v_cost.cost_per_sold_unit_net,2);
  end loop;

  v_sum_sales := round(v_sum_sales - p_document_discount_net,2);
  if v_sum_sales <= 0 then raise exception 'no_net_revenue'; end if;
  v_margin := round((v_sum_sales-v_sum_cost)/v_sum_sales*100,6);
  return query select
    (v_sum_sales-v_sum_cost)*100 >= 40*v_sum_sales,
    (v_sum_sales-v_sum_cost)*100 < 40*v_sum_sales,
    v_margin,v_sum_sales,v_sum_cost,
    case when (v_sum_sales-v_sum_cost)*100 >= 40*v_sum_sales
      then null::text else 'manager_exception_required'::text end;
end;
$$;

revoke all on function public.sales_agent_check_order_margin(uuid,jsonb,numeric)
  from public, anon, authenticated;
grant execute on function public.sales_agent_check_order_margin(uuid,jsonb,numeric)
  to authenticated;

commit;

-- IMPORTANT BEFORE ACTIVATION:
-- Ensure document-level discounts and editable final totals are handled in
-- the ATOMIC order writer. This read-only preview does not authorize any
-- final-total override or business-level charge adjustment.
-- Verify parity against documentProfit fixtures, including historical pack
-- conversions, VAT, discounts and rounding, before choosing a product's
-- verified unit cost; never bulk-approve unverified catalog products.
