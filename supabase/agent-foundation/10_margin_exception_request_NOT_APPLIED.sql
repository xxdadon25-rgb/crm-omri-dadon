-- PREPARATION ONLY — DO NOT APPLY TO PRODUCTION.
-- Requires 01,02,07 and pgcrypto installed in extensions schema.
-- This creates ONLY an inert manager exception request, never a live order.
-- Cost evidence and client payload are hashed together; a future explicit
-- fulfillment RPC MUST re-check SHA256, stock, customer assignment and margin
-- in the same transaction before creating a real order.
begin;

create or replace function public.sales_agent_request_margin_exception(
  p_request_id uuid,
  p_customer_id uuid,
  p_items jsonb,
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
  if p_request_id is null or p_customer_id is null
     or nullif(btrim(p_reason),'') is null
     or length(p_reason)>1000
  then raise exception 'invalid_exception_request'; end if;

  select owner_auth_id into v_owner
  from public.sales_agent_profiles
  where auth_user_id=v_agent and is_active=true for share;
  if v_owner is null then raise exception 'agent_not_active'; end if;

  select * into v_calc from public.sales_agent_check_order_margin(
    p_customer_id,p_items,0
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
    jsonb_build_object('items',p_items,'cost_snapshot',v_cost_snapshot),
    v_hash,v_calc.margin_percent,p_reason,'pending'
  ) returning * into v_result;

  -- Intentionally no INSERT into public.orders, no delivery alert,
  -- inventory movement, customer price write, invoice or payment.
  return v_result;
end;
$$;

revoke all on function public.sales_agent_request_margin_exception(uuid,uuid,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.sales_agent_request_margin_exception(uuid,uuid,jsonb,text)
  to authenticated;

commit;

-- Integration tests: 39.99% pending, above 40 denied, missing costs denied,
-- retry same request ID idempotent, altered payload retry denied,
-- wrong customer/wrong agent denied, no order/stock movement side effects.
-- A manager decision by itself NEVER turns the draft into an order.
