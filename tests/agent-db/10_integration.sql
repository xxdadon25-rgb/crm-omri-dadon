-- Synthetic integration checks for staged schemas/RPCs.
-- Required in this order: fixture, staged SQL 01/02/03/04/05/06/07/08,
-- then this file. Executed only in disposable GitHub Actions PostgreSQL.
insert into public.sales_agent_managers(auth_user_id,owner_auth_id)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.sales_agent_profiles(auth_user_id,owner_auth_id,display_name,is_active)
values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Test Agent',true);
insert into public.sales_agent_customer_assignments(customer_id,agent_auth_id)
values('11111111-1111-4111-8111-111111111111',
'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

do $$
declare n integer;
begin
 select count(*) into n from public.customers;
 if n <> 1 then raise exception 'agent customer isolation: got %',n; end if;
 select count(*) into n from public.orders;
 if n <> 1 then raise exception 'agent order history isolation: got %',n; end if;
 select count(*) into n from public.invoices;
 if n <> 1 then raise exception 'agent invoice history isolation: got %',n; end if;
 select count(*) into n from public.products;
 if n <> 2 then raise exception 'agent catalog isolation: got %',n; end if;
end $$;

-- A made-up purchase price in the client payload must not affect results.
do $$
declare r record;
begin
 select * into r from public.sales_agent_check_order_margin(
 '11111111-1111-4111-8111-111111111111',
 '[{"product_id":"44444444-4444-4444-8444-444444444444",
 "quantity":10,"unit_price":10,"total":100,"discount":0,
 "buy_price":0.001}]'::jsonb,0);
 if not r.allowed or r.net_cost<>60 or r.net_revenue<>100 or r.margin_percent<>40
 then raise exception '40 percent margin mismatch: %',row_to_json(r); end if;

 select * into r from public.sales_agent_check_order_margin(
 '11111111-1111-4111-8111-111111111111',
 '[{"product_id":"55555555-5555-4555-8555-555555555555",
 "quantity":1,"unit_price":10,"total":10,"discount":0}]'::jsonb,0);
 if r.allowed or not r.needs_manager_exception or r.margin_percent<>30
 then raise exception 'below 40 margin must request approval: %',row_to_json(r); end if;
end $$;

do $$
declare r public.orders; n integer;
begin
 r := public.sales_agent_create_order(
 'aaaaaaaa-1111-4111-8111-111111111111',
 '11111111-1111-4111-8111-111111111111',
 '[{"product_id":"44444444-4444-4444-8444-444444444444",
 "quantity":10,"unit_price":10,"total":100,"discount":0,
 "buy_price":0.001}]'::jsonb,0,'test only');
 if r.order_number<>1001 or r.fulfilled is distinct from false
   or r.inventory_deducted is distinct from false or r.agent<>'Test Agent'
 then raise exception 'new agent order fields wrong'; end if;
 select count(*) into n from public.sales_agent_order_attributions
 where order_id=r.id and agent_auth_id=auth.uid();
 if n<>1 then raise exception 'missing attribution'; end if;
 select count(*) into n from public.sales_agent_delivery_alerts where order_id=r.id;
 if n<>1 then raise exception 'missing delivery alert'; end if;

 -- Idempotent retry, no second counter increment or alert.
 r := public.sales_agent_create_order(
 'aaaaaaaa-1111-4111-8111-111111111111',
 '11111111-1111-4111-8111-111111111111',
 '[{"product_id":"44444444-4444-4444-8444-444444444444",
 "quantity":10,"unit_price":10,"total":100,"discount":0}]'::jsonb,0,'retry');
 if r.order_number<>1001 then raise exception 'duplicate order'; end if;
 select count(*) into n from public.sales_agent_delivery_alerts
 where order_id=r.id;
 if n<>1 then raise exception 'duplicate delivery alert'; end if;
end $$;

do $$
declare r public.customers; n integer;
begin
 r:= public.sales_agent_create_customer(
 'abababab-abab-4bab-8bab-abababababab',
 '{"name":"New Agent Customer","phone":"0500000000"}'::jsonb
 );
 if r.name<>'New Agent Customer'
 or r.user_id<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
 then raise exception 'agent customer ownership failed'; end if;
 select count(*) into n from public.sales_agent_customer_assignments
 where customer_id=r.id and agent_auth_id=auth.uid();
 if n<>1 then raise exception 'new customer not assigned'; end if;
end $$;

-- Agent cannot bypass direct writes on owned rows despite original policy.
do $$
declare n integer;
begin
 update public.customers set name='HACK' where id='11111111-1111-4111-8111-111111111111';
 get diagnostics n=row_count;
 if n<>0 then raise exception 'agent direct customer write bypass'; end if;
 delete from public.products where id='44444444-4444-4444-8444-444444444444';
 get diagnostics n=row_count;
 if n<>0 then raise exception 'agent direct product delete bypass'; end if;
end $$;

-- Not assigned and not manager: reject.
do $$
declare failed boolean;
begin
 failed:=false;
 begin
 perform public.sales_agent_check_order_margin(
 '22222222-2222-4222-8222-222222222222','[]'::jsonb,0);
 exception when others then failed:=SQLERRM='customer_not_assigned';
 end;
 if not failed then raise exception 'unassigned customer margin bypass'; end if;
 failed:=false;
 begin
 perform public.sales_agent_create_order(
 'aaaaaaaa-2222-4222-8222-222222222222',
 '11111111-1111-4111-8111-111111111111',
 '[{"product_id":"55555555-5555-4555-8555-555555555555",
 "quantity":1,"unit_price":10,"total":10}]'::jsonb,0);
 exception when others then failed:=SQLERRM='margin_below_minimum_request_exception';
 end;
 if not failed then raise exception 'below-margin order was not blocked'; end if;
end $$;

-- One manager decision and no second, even under shared auth identity.
reset role;
insert into public.sales_agent_margin_exceptions
(agent_auth_id,customer_id,order_payload,request_hash,margin_pct,reason)
values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
'11111111-1111-4111-8111-111111111111','{}','hash',30,'Below minimum');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$
declare req uuid;ok boolean;
begin
 select id into req from public.sales_agent_margin_exceptions limit 1;
 select public.sales_agent_decide_exception(req,'approved','בן') into ok;
 if not ok then raise exception 'manager approval failed'; end if;
 select public.sales_agent_decide_exception(req,'rejected','עומרי') into ok;
 if ok then raise exception 'duplicate manager decision accepted'; end if;
end $$;

-- Portal-identity isolation (without granting a fake customer portal link).
set request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $$
declare n integer;
begin
 select count(*) into n from public.customers;
 if n<>0 then raise exception 'portal customer leaked contacts'; end if;
 select count(*) into n from public.sales_agent_margin_exceptions;
 if n<>0 then raise exception 'portal customer leaked approvals'; end if;
end $$;
reset role;
reset request.jwt.claim.sub;
select 'agent ephemeral DB integration PASS' as result;
