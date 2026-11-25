-- DEVELOPMENT ONLY. Apply after staged 01..21, verified guards and explicit release approval.
-- This extends agent order writes for manager-equivalent manual gross TOTALS.
-- No change to legacy manager RPCs or existing 5-argument agent order RPC.
-- Separate manual-total writer retains strict idempotency with total_override.
begin;
create or replace function public.sales_agent_create_order_with_total(
  p_request_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_document_discount_net numeric default 0,
  p_notes text default null,
  p_total_gross numeric default null
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
  if p_total_gross is null then raise exception 'invalid_manual_total'; end if;
  if p_request_id is null or p_customer_id is null then
    raise exception 'invalid_order';
  end if;
  -- Document-wide discounts remain unsupported; manual total adjustments
  -- are separately recalculated from verified goods and current VAT by
  -- sales_agent_preview_manual_total. Per-line discounts are supported.
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
    if not public.sales_agent_same_order_request(
      v_order,p_customer_id,p_items,p_document_discount_net,p_notes
    ) or v_order.total_override is distinct from p_total_gross
    then raise exception 'order_request_payload_changed'; end if;
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
    if not public.sales_agent_same_order_request(
      v_order,p_customer_id,p_items,p_document_discount_net,p_notes
    ) or v_order.total_override is distinct from p_total_gross
    then raise exception 'order_request_payload_changed'; end if;
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
  from public.sales_agent_preview_manual_total(
    p_customer_id,p_items,p_total_gross
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

  v_subtotal := v_margin.goods_subtotal_net;
  v_vat := v_margin.vat_amount;
  v_total := v_margin.total_gross;

  select greatest(
    coalesce(v_settings.order_counter,1000),
    coalesce(max(o.order_number),1000)
  )+1 into v_number
  from public.orders o where o.user_id=v_owner;

  insert into public.orders(
    id,user_id,order_number,customer_id,customer_name,customer_tax_id,
    date,items,subtotal,gross_total,discount_amount,vat_rate,vat_amount,total,
    total_override,notes,status,fulfilled,inventory_deducted,agent
  ) values(
    p_request_id,v_owner,v_number,p_customer_id,v_customer.name,
    v_customer.tax_id,current_date,v_new_items,v_subtotal,v_subtotal,
    p_document_discount_net,v_settings.vat_rate,v_vat,v_total,
    p_total_gross,p_notes,'ממתין לאישור',false,false,v_agent_name
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
revoke all on function public.sales_agent_create_order_with_total(uuid,uuid,jsonb,numeric,text,numeric)
 from public,anon,authenticated;
grant execute on function public.sales_agent_create_order_with_total(uuid,uuid,jsonb,numeric,text,numeric)
 to authenticated;

create or replace function public.sales_agent_request_total_exception(
  p_request_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_total_gross numeric,
  p_reason text
)
returns public.sales_agent_margin_exceptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := auth.uid();
  v_owner uuid;
  v_result public.sales_agent_margin_exceptions%rowtype;
  v_calc record;
  v_cost_snapshot jsonb;
  v_hash text;
begin
  if v_agent is null then raise exception 'not_authenticated'; end if;
  if p_total_gross is null then raise exception 'invalid_manual_total'; end if;
  if p_request_id is null or p_customer_id is null
     or nullif(btrim(p_reason),'') is null
     or length(p_reason)>1000
  then raise exception 'invalid_exception_request'; end if;

  select owner_auth_id into v_owner
  from public.sales_agent_profiles
  where auth_user_id=v_agent and is_active=true for share;
  if v_owner is null then raise exception 'agent_not_active'; end if;

  select * into v_calc from public.sales_agent_preview_manual_total(
    p_customer_id,p_items,p_total_gross
  );
  if v_calc.needs_manager_exception is distinct from true then
    raise exception 'margin_exception_not_required';
  end if;

  -- Validation has already rejected missing or malformed line/product data.
  -- Use CURRENT SERVER-SIDE purchase prices for cost binding.
  select jsonb_agg(
    jsonb_build_object('product_id',p.id,'buy_price',p.buy_price,
      'active',p.is_active)
    order by i.ord
  ) into v_cost_snapshot
  from jsonb_array_elements(p_items) with ordinality i(value,ord)
  join public.products p on p.id=(i.value->>'product_id')::uuid
    and p.user_id=v_owner;

  if v_cost_snapshot is null
     or jsonb_array_length(v_cost_snapshot)<>jsonb_array_length(p_items)
  then raise exception 'cost_snapshot_missing'; end if;

  v_hash:=encode(extensions.digest(
    convert_to(jsonb_build_object(
      'agent',v_agent,'owner',v_owner,
      'customer',p_customer_id,'items',p_items,
      'total_override',p_total_gross,
      'vat_amount',v_calc.vat_amount,
      'effective_net_revenue',v_calc.effective_net_revenue,
      'prices',v_cost_snapshot,'margin',v_calc.margin_percent
    )::text,'UTF8'),
    'sha256'
  ),'hex');

  select * into v_result from public.sales_agent_margin_exceptions e
  where e.id=p_request_id for update;

  if found then
    if v_result.agent_auth_id<>v_agent
      or v_result.customer_id<>p_customer_id
      or v_result.request_hash<>v_hash
    then raise exception 'exception_request_id_in_use'; end if;
    return v_result;
  end if;

  insert into public.sales_agent_margin_exceptions(
    id,agent_auth_id,customer_id,order_payload,request_hash,
    margin_pct,reason,status
  ) values (
    p_request_id,v_agent,p_customer_id,
    jsonb_build_object('items',p_items,'cost_snapshot',v_cost_snapshot,
      'total_override',p_total_gross),
    v_hash,v_calc.margin_percent,p_reason,'pending'
  ) returning * into v_result;

  -- Intentionally no INSERT into public.orders, no delivery alert,
  -- inventory movement, customer price write, invoice or payment.
  return v_result;
end;
$$;
revoke all on function public.sales_agent_request_total_exception(uuid,uuid,jsonb,numeric,text)
 from public,anon,authenticated;
grant execute on function public.sales_agent_request_total_exception(uuid,uuid,jsonb,numeric,text)
 to authenticated;

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
  v_total numeric;
  v_override numeric;
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

  -- A manual total belongs to the manager-reviewed request snapshot.
  -- It is never supplied by the agent during order materialization.
  if v_request.order_payload ? 'total_override' then
    if jsonb_typeof(v_request.order_payload->'total_override') <> 'number'
    then raise exception 'exception_payload_invalid'; end if;
    v_override:=(v_request.order_payload->>'total_override')::numeric;
    select * into v_calc from public.sales_agent_preview_manual_total(
      v_customer.id,v_items,v_override);
  else
    v_override:=null;
    select * into v_calc from public.sales_agent_check_order_margin(
      v_customer.id,v_items,0);
  end if;

  -- Recompute from the trusted catalogue using the SAME 40%-rule as the
  -- normal order writer. Approved exception is only valid while still below
  -- 40% and pricing inputs are IDENTICAL to what manager reviewed.
  if v_calc.needs_manager_exception is distinct from true
  then raise exception 'exception_margin_changed'; end if;

  -- Verify the EXACT source cost snapshot reviewed and approved by manager.
  -- Do not include user-provided product labels in this hash.
  select jsonb_agg(
    jsonb_build_object(
      'product_id',p.id,'buy_price',p.buy_price,'active',p.is_active
    ) order by x.ord
  ) into v_prices
  from jsonb_array_elements(v_items) with ordinality x(value,ord)
  join public.products p
    on p.id=(x.value->>'product_id')::uuid and p.user_id=v_owner;

  if v_prices is null or jsonb_array_length(v_prices)<>jsonb_array_length(v_items)
  then raise exception 'exception_prices_changed'; end if;

  v_fresh_hash:=encode(extensions.digest(
    convert_to((jsonb_build_object(
      'agent',v_agent,'owner',v_owner,'customer',v_customer.id,
      'items',v_items,'prices',v_prices,'margin',v_calc.margin_percent
    ) || case when v_override is null then '{}'::jsonb
       else jsonb_build_object('total_override',v_override,
         'vat_amount',v_calc.vat_amount,
         'effective_net_revenue',v_calc.effective_net_revenue)
       end)::text,'UTF8'),
    'sha256'
  ),'hex');

  if v_fresh_hash is distinct from v_request.request_hash
  then raise exception 'exception_payload_or_prices_changed'; end if;

  -- Once the reviewed snapshot matches, construct ORDER line content using
  -- a whitelist and trusted catalogue identity, SKU and displayed unit.
  -- The browser cannot override downstream invoice/margin/stock metadata.
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
  ) into v_new_items
  from jsonb_array_elements(v_items) with ordinality x(value,ord)
  join public.products p
    on p.id=(x.value->>'product_id')::uuid
      and p.user_id=v_owner and p.is_active is true;

  if v_new_items is null
    or jsonb_array_length(v_new_items)<>jsonb_array_length(v_items)
  then raise exception 'product_not_found'; end if;

  if v_override is null then
    v_subtotal:=v_calc.net_revenue;
    v_vat:=round(v_subtotal*v_settings.vat_rate/100,2);
    v_total:=v_subtotal+v_vat;
  else
    v_subtotal:=v_calc.goods_subtotal_net;
    v_vat:=v_calc.vat_amount;
    v_total:=v_override;
  end if;
  select greatest(
    coalesce(v_settings.order_counter,1000),
    coalesce(max(o.order_number),1000)
  )+1 into v_number from public.orders o where o.user_id=v_owner;

  insert into public.orders (
    id,user_id,order_number,customer_id,customer_name,customer_tax_id,
    date,items,subtotal,gross_total,discount_amount,vat_rate,vat_amount,total,
    total_override,notes,status,fulfilled,inventory_deducted,agent
  ) values (
    p_order_id,v_owner,v_number,v_customer.id,v_customer.name,v_customer.tax_id,
    current_date,v_new_items,v_subtotal,v_subtotal,0,
    v_settings.vat_rate,v_vat,v_total,v_override,
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
