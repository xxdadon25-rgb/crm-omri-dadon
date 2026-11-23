-- PREPARATION ONLY — DO NOT APPLY TO PRODUCTION.
-- Requires staged SQL 01, 03, 05, 07 and real RLS/transaction tests.
-- Creates one UNFULFILLED order with a single delivery alert + attribution.
-- Margin calculated by the server using current catalog net buy prices on matched sale units.
-- No direct stock decrement, invoice creation or payment modification.
begin;

create or replace function public.sales_agent_create_order(
  p_request_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_document_discount_net numeric default 0,
  p_notes text default null
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
  v_customer public.customers%rowtype;
  v_settings public.business_settings%rowtype;
  v_order public.orders%rowtype;
  v_margin record;
  v_new_items jsonb;
  v_subtotal numeric;
  v_vat numeric;
  v_total numeric;
  v_number integer;
begin
  if v_agent is null then raise exception 'not_authenticated'; end if;
  if p_request_id is null or p_customer_id is null then
    raise exception 'invalid_order';
  end if;
  -- Document-wide discounts and edited final totals need end-to-end
  -- reconciliation with documentProfit before agents may use them.
  -- Per-line discounts are supported by the trusted margin check.
  if p_document_discount_net is distinct from 0 then
    raise exception 'document_discount_not_yet_supported';
  end if;

  -- Lock profile and assignment to serialize deactivation/unassignment.
  select ap.owner_auth_id, ap.display_name, ap.commission_pct
    into v_owner,v_agent_name,v_commission_pct
  from public.sales_agent_profiles ap
  where ap.auth_user_id=v_agent and ap.is_active=true
  for share;
  if v_owner is null then raise exception 'agent_not_active'; end if;

  select * into v_customer from public.customers c
  where c.id=p_customer_id and c.user_id=v_owner
  for share;
  if not found then raise exception 'customer_not_found'; end if;

  perform 1 from public.sales_agent_customer_assignments ca
  where ca.agent_auth_id=v_agent and ca.customer_id=p_customer_id
  for share;
  if not found then raise exception 'customer_not_assigned'; end if;

  -- Idempotency is scoped to the original agent and business.
  select * into v_order from public.orders o where o.id=p_request_id;
  if found then
    if v_order.user_id <> v_owner or v_order.customer_id <> p_customer_id
       or not exists(
         select 1 from public.sales_agent_order_attributions a
         where a.order_id=v_order.id and a.agent_auth_id=v_agent
       ) then raise exception 'order_id_in_use'; end if;
    return v_order;
  end if;

  -- Serialize order number allocation with existing legacy owner RPC.
  select * into v_settings
  from public.business_settings s where s.user_id=v_owner
  order by s.created_date limit 1 for update;
  if not found or v_settings.vat_rate is null
     or v_settings.vat_rate < 0 or v_settings.vat_rate > 100 then
    raise exception 'business_settings_invalid';
  end if;

  -- After the exclusive owner counter lock, check idempotency again.
  select * into v_order from public.orders o where o.id=p_request_id;
  if found then
    if v_order.user_id <> v_owner or v_order.customer_id <> p_customer_id
       or not exists(
         select 1 from public.sales_agent_order_attributions a
         where a.order_id=v_order.id and a.agent_auth_id=v_agent
       ) then raise exception 'order_id_in_use'; end if;
    return v_order;
  end if;

  -- Lock the actual catalogue rows; never trust client buy_price.
  if p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) not between 1 and 250
  then raise exception 'invalid_items'; end if;
  perform 1 from public.products p
  where p.user_id = v_owner
    and p.id in (
      select (x.value->>'product_id')::uuid
      from jsonb_array_elements(p_items) x(value)
      where (x.value->>'product_id') ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    )
  order by p.id for share;

  select * into v_margin
  from public.sales_agent_check_order_margin(
    p_customer_id,p_items,p_document_discount_net
  );
  if v_margin.allowed is distinct from true then
    raise exception 'margin_below_minimum_request_exception';
  end if;

  -- Snapshot product cost from catalogue, not browser.
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
  from jsonb_array_elements(p_items) with ordinality x(value,ord)
  join public.products p
    on p.id=(x.value->>'product_id')::uuid
   and p.user_id=v_owner and p.is_active is true;

  if v_new_items is null
    or jsonb_array_length(v_new_items) <> jsonb_array_length(p_items)
  then raise exception 'product_not_found'; end if;

  v_subtotal := v_margin.net_revenue;
  v_vat := round(v_subtotal * v_settings.vat_rate / 100,2);
  v_total := v_subtotal+v_vat;

  select greatest(
    coalesce(v_settings.order_counter,1000),
    coalesce(max(o.order_number),1000)
  )+1 into v_number
  from public.orders o where o.user_id=v_owner;

  insert into public.orders(
    id,user_id,order_number,customer_id,customer_name,customer_tax_id,
    date,items,subtotal,gross_total,discount_amount,vat_rate,vat_amount,total,
    notes,status,fulfilled,inventory_deducted,agent
  ) values(
    p_request_id,v_owner,v_number,p_customer_id,v_customer.name,
    v_customer.tax_id,current_date,v_new_items,v_subtotal,v_subtotal,
    p_document_discount_net,v_settings.vat_rate,v_vat,v_total,
    p_notes,'ממתין לאישור',false,false,v_agent_name
  ) returning * into v_order;

  insert into public.sales_agent_order_attributions(order_id,agent_auth_id,commission_pct_attributed)
  values(v_order.id,v_agent,v_commission_pct);

  insert into public.sales_agent_delivery_alerts(order_id,agent_auth_id)
  values(v_order.id,v_agent)
  on conflict(order_id) do nothing;

  update public.business_settings
  set order_counter=v_number where id=v_settings.id;

  return v_order;
end;
$$;

revoke all on function public.sales_agent_create_order(uuid,uuid,jsonb,numeric,text)
  from public,anon,authenticated;
grant execute on function public.sales_agent_create_order(uuid,uuid,jsonb,numeric,text)
  to authenticated;
commit;

-- RESTORED-DB TEST GATES:
-- 1. Concurrent repeated request IDs create ONE order, ONE attribution,
--    ONE alert, and advance owner counter once.
-- 2. Agent assigned only to permitted customer; wrong owner/disabled agent
--    denied even on forged HTTP calls.
-- 3. Missing cost, edited buy_price, invalid packaging/quantity/discount,
--    39.99% margin and tampered line totals all denied.
-- 4. 40% exactly accepted; multi-product blended gross margin accepted.
-- 5. No stock movements, invoice/payment changes, or manual prices modified.
-- 6. Owner's preexisting create_order_with_inventory RPC behavior unchanged.
-- 7. Future update RPC must enforce 40% AGAIN, not permit bypass by edits.
-- 8. Future exception-approved order requires exact same hash and costs,
--    not a bypass through this routine.
