-- PREPARATION ONLY — DO NOT APPLY TO PRODUCTION.
-- Requires staged SQL 01,02,03,05,07,08,10 and pgcrypto.
-- After a manager approves an INERT below-40% exception, the originating
-- active agent can materialize it into exactly ONE owner-owned order.
-- The agent cannot supply replacement items, costs, customer or sale total.
-- Everything is rechecked against the original hashed snapshot.
begin;

alter table public.sales_agent_margin_exceptions
  add column if not exists created_order_id uuid
    unique references public.orders(id) on delete restrict,
  add column if not exists created_order_at timestamptz;

alter table public.sales_agent_margin_exceptions
  add constraint sales_agent_exception_creation_consistency
  check (
    (created_order_id is null and created_order_at is null) or
    (created_order_id is not null and created_order_at is not null
      and status='approved')
  );

create or replace function public.sales_agent_create_approved_exception_order(
  p_exception_id uuid,
  p_order_id uuid
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := auth.uid();
  v_owner uuid;
  v_agent_name text;
  v_commission_pct numeric;
  v_request public.sales_agent_margin_exceptions%rowtype;
  v_customer public.customers%rowtype;
  v_settings public.business_settings%rowtype;
  v_order public.orders%rowtype;
  v_items jsonb;
  v_prices jsonb;
  v_calc record;
  v_fresh_hash text;
  v_new_items jsonb;
  v_number integer;
  v_subtotal numeric;
  v_vat numeric;
begin
  if v_agent is null then raise exception 'not_authenticated'; end if;
  if p_exception_id is null or p_order_id is null then
    raise exception 'invalid_exception_order'; end if;

  select ap.owner_auth_id,ap.display_name,ap.commission_pct
    into v_owner,v_agent_name,v_commission_pct
  from public.sales_agent_profiles ap
  where ap.auth_user_id=v_agent and ap.is_active=true
  for share;
  if v_owner is null then raise exception 'agent_not_active'; end if;

  -- Concurrent approvals/consumptions serialize here.
  select * into v_request
  from public.sales_agent_margin_exceptions e
  where e.id=p_exception_id and e.agent_auth_id=v_agent
  for update;
  if not found then raise exception 'exception_not_found'; end if;

  if v_request.created_order_id is not null then
    if v_request.created_order_id<>p_order_id then
      raise exception 'exception_already_consumed'; end if;
    select * into v_order from public.orders o
    where o.id=v_request.created_order_id
      and o.user_id=v_owner
      and o.customer_id=v_request.customer_id;
    if not found then raise exception 'exception_order_missing'; end if;
    return v_order;
  end if;

  if v_request.status<>'approved'
    or v_request.decided_by is null
    or v_request.approved_by_label not in ('עומרי','בן')
  then raise exception 'exception_not_approved'; end if;

  select * into v_customer from public.customers c
  where c.id=v_request.customer_id and c.user_id=v_owner
  for share;
  if not found then raise exception 'customer_not_found'; end if;

  perform 1 from public.sales_agent_customer_assignments ca
  where ca.agent_auth_id=v_agent and ca.customer_id=v_customer.id
  for share;
  if not found then raise exception 'customer_not_assigned'; end if;

  v_items:=v_request.order_payload->'items';
  if v_items is null or jsonb_typeof(v_items)<>'array'
    or jsonb_array_length(v_items) not between 1 and 250
  then raise exception 'exception_payload_invalid'; end if;

  -- All paths generating a new owner order number take the same settings row
  -- lock as the existing legacy RPC.
  select * into v_settings
  from public.business_settings s
  where s.user_id=v_owner
  order by s.created_date limit 1 for update;
  if not found or v_settings.vat_rate is null
    or v_settings.vat_rate < 0 or v_settings.vat_rate > 100
  then raise exception 'business_settings_invalid'; end if;

  -- The requested order UUID must not refer to a different order.
  perform 1 from public.orders where id=p_order_id;
  if found then raise exception 'order_id_in_use'; end if;

  -- Reject bad UUIDs before casting, then lock current catalogue costs
  -- against simultaneous edits until the transaction commits.
  perform 1 from public.products p
  where p.user_id=v_owner and p.id in (
    select (x.value->>'product_id')::uuid
    from jsonb_array_elements(v_items) x(value)
    where (x.value->>'product_id') ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  )
  order by p.id for share;

  -- Recompute from the trusted catalogue using the SAME 40%-rule as the
  -- normal order writer. Approved exception is only valid while still below
  -- 40% and pricing inputs are IDENTICAL to what manager reviewed.
  select * into v_calc
  from public.sales_agent_check_order_margin(v_customer.id,v_items,0);
  if v_calc.needs_manager_exception is distinct from true
  then raise exception 'exception_margin_changed'; end if;

  select jsonb_agg(
    jsonb_build_object(
      'product_id',p.id,
      'name',p.name,
      'sku',p.sku,
      'unit',p.unit,
      'meters_per_roll',p.meters_per_roll,
      'quantity',(x.value->>'quantity')::numeric,
      'unit_price',(x.value->>'unit_price')::numeric,
      'discount',coalesce((x.value->>'discount')::numeric,0),
      'total',(x.value->>'total')::numeric,
      'buy_price',p.buy_price,
      'buy_level','unit',
      'sale_level','unit',
      'price_basis','catalog_same_sold_unit_v1',
      'sale_level_source','confirmed',
      'packaging',null
    ) order by x.ord
  )into v_new_items
  from jsonb_array_elements(v_items) with ordinality x(value,ord)
  join public.products p
    on p.id=(x.value->>'product_id')::uuid
      and p.user_id=v_owner and p.is_active is true;

  if v_new_items is null
    or jsonb_array_length(v_new_items)<>jsonb_array_length(v_items)
  then raise exception 'product_not_found'; end if;

  v_subtotal:=v_calc.net_revenue;
  v_vat:=round(v_subtotal*v_settings.vat_rate/100,2);
  select greatest(
    coalesce(v_settings.order_counter,1000),
    coalesce(max(o.order_number),1000)
  )+1 into v_number from public.orders o where o.user_id=v_owner;

  insert into public.orders (
    id,user_id,order_number,customer_id,customer_name,customer_tax_id,
    date,items,subtotal,gross_total,discount_amount,vat_rate,vat_amount,total,
    notes,status,fulfilled,inventory_deducted,agent
  ) values (
    p_order_id,v_owner,v_number,v_customer.id,v_customer.name,v_customer.tax_id,
    current_date,v_new_items,v_subtotal,v_subtotal,0,
    v_settings.vat_rate,v_vat,v_subtotal+v_vat,
    'חריגת סוכן שאושרה על ידי '||v_request.approved_by_label,
    'ממתין לאישור',false,false,v_agent_name
  ) returning * into v_order;

  insert into public.sales_agent_order_attributions(order_id,agent_auth_id,commission_pct_attributed)
  values(v_order.id,v_agent,v_commission_pct);

  insert into public.sales_agent_delivery_alerts(order_id,agent_auth_id)
  values (v_order.id,v_agent)
  on conflict(order_id) do nothing;

  update public.sales_agent_margin_exceptions
  set created_order_id=v_order.id,
      created_order_at=transaction_timestamp()
  where id=v_request.id and status='approved'
    and created_order_id is null;
  if not found then raise exception 'exception_consumption_failed'; end if;

  update public.business_settings set order_counter=v_number
  where id=v_settings.id;

  return v_order;
end;
$$;

revoke all on function public.sales_agent_create_approved_exception_order(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sales_agent_create_approved_exception_order(uuid,uuid)
  to authenticated;
commit;

-- Restored-database gate:
-- * 30% request approved by named manager: exactly one order created
-- * an approved request cannot consume twice with a different order UUID
-- * after changing catalogue buy_price, snapshot mismatch => zero orders
-- * agent cannot override reviewed customer/items/discount/total
-- * stale/deactivated/unassigned agent denied
-- * denied request never creates an order, no stock deduction
-- * ensure manager audit and financial workflows remain unchanged.
