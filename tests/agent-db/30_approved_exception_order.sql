-- Disposable PostgreSQL integration only; no connection to production.
-- Run after staged SQL 11 and tests/agent-db/10_integration.sql.
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

do $$
declare o public.orders; n integer; counter_before integer;
begin
  -- The approval in 10_integration.sql was human-selected "עומרי".
  select s.order_counter into counter_before
  from public.business_settings s
  where s.user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  o:=public.sales_agent_create_approved_exception_order(
    '12121212-1212-4212-8212-121212121212',
    '30303030-3030-4030-8030-303030303030'
  );
  if o.id<>'30303030-3030-4030-8030-303030303030'::uuid
    or o.customer_id<>'11111111-1111-4111-8111-111111111111'::uuid
    or o.total<>11.80 or o.fulfilled is distinct from false
    or o.inventory_deducted is distinct from false
    or o.order_number<>counter_before+1
  then raise exception 'approved exception generated incorrect order'; end if;

  select count(*) into n from public.sales_agent_delivery_alerts
  where order_id=o.id;
  if n<>1 then raise exception 'approved exception delivery alert missing'; end if;
  select count(*) into n from public.sales_agent_order_attributions
  where order_id=o.id and agent_auth_id=auth.uid();
  if n<>1 then raise exception 'approved exception attribution missing'; end if;

  -- Replaying exact request/order id returns the original without adding rows.
  o:=public.sales_agent_create_approved_exception_order(
    '12121212-1212-4212-8212-121212121212',
    '30303030-3030-4030-8030-303030303030'
  );
  if o.order_number<>counter_before+1 then
    raise exception 'idempotent retry changed order number'; end if;
  select s.order_counter into n from public.business_settings s
  where s.user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if n<>counter_before+1 then
    raise exception 'idempotent retry changed global order counter'; end if;
end $$;

do $$
declare blocked boolean :=false;
begin
  begin
    perform public.sales_agent_create_approved_exception_order(
      '12121212-1212-4212-8212-121212121212',
      '31313131-3131-4131-8131-313131313131'
    );
  exception when others then
    blocked:=sqlerrm='exception_already_consumed';
  end;
  if not blocked then raise exception 'same approval created a second order'; end if;
end $$;

-- Request a fresh below-40% exception, approve, THEN change the product's
-- purchase cost. A previously authorized exception must NOT use that new cost.
do $$
declare d public.sales_agent_margin_exceptions;
begin
 d:=public.sales_agent_request_margin_exception(
  '41414141-4141-4141-8141-414141414141',
  '11111111-1111-4111-8111-111111111111',
  '[{"product_id":"55555555-5555-4555-8555-555555555555",
    "quantity":2,"unit_price":10,"total":20,"discount":0}]'::jsonb,
  'request at cost of 7');
 if d.margin_pct<>30 then raise exception 'cost-change setup invalid'; end if;
end $$;

set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
declare approved boolean;
begin
 select public.sales_agent_decide_exception(
  '41414141-4141-4141-8141-414141414141','approved','בן'
 ) into approved;
 if approved is distinct from true then raise exception 'approval setup failed'; end if;
end $$;

reset role;
update public.products set buy_price=8
where id='55555555-5555-4555-8555-555555555555';

set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
declare blocked boolean:=false; n integer;
begin
  begin
    perform public.sales_agent_create_approved_exception_order(
      '41414141-4141-4141-8141-414141414141',
      '42424242-4242-4242-8242-424242424242'
    );
  exception when others then
    blocked:=sqlerrm='exception_payload_or_prices_changed';
  end;
  if not blocked then raise exception 'stale approved exception used changed cost'; end if;
  select count(*) into n from public.orders
  where id='42424242-4242-4242-8242-424242424242';
  if n<>0 then raise exception 'stale exception created an order'; end if;
end $$;

-- A rejected request cannot create an order.
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
reset role;
insert into public.sales_agent_margin_exceptions
  (id,agent_auth_id,customer_id,order_payload,request_hash,margin_pct,reason,status,decided_by,decided_at,approved_by_label)
values
  ('43434343-4343-4343-8343-434343434343',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   '11111111-1111-4111-8111-111111111111',
   '{}'::jsonb,'placeholder',25,'Rejected by manager','rejected',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now(),'בן');

set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
declare blocked boolean:=false;
begin
  begin
    perform public.sales_agent_create_approved_exception_order(
      '43434343-4343-4343-8343-434343434343',
      '44444444-3333-4333-8333-333333333333'
    );
  exception when others then blocked:=sqlerrm='exception_not_approved';
  end;
  if not blocked then raise exception 'rejected exception created order'; end if;
end $$;

reset role;
reset request.jwt.claim.sub;
select 'approved exceptions are one-shot, cost-bound and inert until consumed' as result;
