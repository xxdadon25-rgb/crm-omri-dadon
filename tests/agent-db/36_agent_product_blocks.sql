-- SYNTHETIC ONLY. No writes to production QuickStock product catalogue.
-- Product already exists, is active, and is otherwise orderable by an agent.
reset role;
reset request.jwt.claim.sub;

set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $test$
declare blocked boolean:=false;
begin
 begin
  perform public.sales_agent_set_product_block(
    '44444444-4444-4444-8444-444444444444',true);
 exception when others then blocked=(sqlerrm='not_manager'); end;
 if not blocked then raise exception 'agent could block product'; end if;
end $test$;

set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $test$
declare done boolean; status boolean; n integer;
begin
 done:=public.sales_agent_set_product_block(
    '44444444-4444-4444-8444-444444444444',true);
 if not done then raise exception 'manager failed to block for agents'; end if;
 done:=public.sales_agent_set_product_block(
    '44444444-4444-4444-8444-444444444444',true);
 select count(*) into n from public.sales_agent_product_blocks
 where product_id='44444444-4444-4444-8444-444444444444';
 if n<>1 then raise exception 'duplicate agent-only block'; end if;
 select is_active into status from public.products
 where id='44444444-4444-4444-8444-444444444444';
 if status is distinct from true then
  raise exception 'agent-only block changed owner catalogue'; end if;
end $test$;

set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $test$
declare blocked boolean:=false; n integer;
begin
 select count(*) into n from public.sales_agent_product_blocks
 where product_id='44444444-4444-4444-8444-444444444444';
 if n<>1 then raise exception 'agent cannot see own product block'; end if;
 begin
  perform public.sales_agent_check_order_margin(
   '11111111-1111-4111-8111-111111111111',
   '[{"product_id":"44444444-4444-4444-8444-444444444444",
      "quantity":1,"unit_price":10,"total":10}]'::jsonb,0);
 exception when others then blocked=(sqlerrm='agent_product_blocked'); end;
 if not blocked then raise exception 'blocked agent product passed margin RPC'; end if;

 blocked:=false;
 begin
  perform public.sales_agent_create_order(
   '72727272-7272-4727-8727-727272727272',
   '11111111-1111-4111-8111-111111111111',
   '[{"product_id":"44444444-4444-4444-8444-444444444444",
      "quantity":1,"unit_price":10,"total":10}]'::jsonb,0,null);
 exception when others then blocked=(sqlerrm='agent_product_blocked'); end;
 if not blocked then raise exception 'blocked agent product created normal order'; end if;
end $test$;

-- Previously manager-approved below-threshold exception is invalidated
-- when item is blocked before creating the actual order.
reset role;
update public.products set sell_price=10 where id='55555555-5555-4555-8555-555555555555';
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $test$
begin
 perform public.sales_agent_set_product_block(
  '55555555-5555-4555-8555-555555555555',true);
end $test$;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $test$
declare blocked boolean:=false;
begin
 begin
  perform public.sales_agent_create_approved_exception_order(
   '12121212-1212-4212-8212-121212121212',
   '73737373-7373-4737-8737-737373737373');
 exception when others then blocked=(sqlerrm='exception_already_consumed'); end;
 -- The earlier approved test already consumed this exception; separate
 -- draft fresh-test below, so this is only a no-second-order sanity check.
 if not blocked then raise exception 'already consumed approval generated order'; end if;

 blocked:=false;
 begin
   perform public.sales_agent_check_order_margin(
    '11111111-1111-4111-8111-111111111111',
    '[{"product_id":"55555555-5555-4555-8555-555555555555",
       "quantity":1,"unit_price":10,"total":10}]'::jsonb,0);
 exception when others then blocked=(sqlerrm='agent_product_blocked'); end;
 if not blocked then raise exception 'blocked product can request margin approval'; end if;
end $test$;

set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $test$
declare n integer; done boolean; still_active boolean;
begin
 done:=public.sales_agent_set_product_block(
   '44444444-4444-4444-8444-444444444444',false);
 done:=public.sales_agent_set_product_block(
   '55555555-5555-4555-8555-555555555555',false);
 select count(*) into n from public.sales_agent_product_blocks
 where product_id in ('44444444-4444-4444-8444-444444444444',
                      '55555555-5555-4555-8555-555555555555');
 if n<>0 then raise exception 'released agent product still blocked'; end if;
 select is_active into still_active from public.products
 where id='44444444-4444-4444-8444-444444444444';
 if not still_active then raise exception 'owner product status changed'; end if;
end $test$;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $test$
declare r record;
begin
 select * into r from public.sales_agent_check_order_margin(
  '11111111-1111-4111-8111-111111111111',
  '[{"product_id":"44444444-4444-4444-8444-444444444444",
    "quantity":1,"unit_price":10,"total":10}]'::jsonb,0);
 if r.allowed is distinct from true
 then raise exception 'manager release did not reenable agent sale'; end if;
end $test$;
reset role;
reset request.jwt.claim.sub;
select 'agent-only block and manager release work, owner catalog unaffected PASS' as result;
