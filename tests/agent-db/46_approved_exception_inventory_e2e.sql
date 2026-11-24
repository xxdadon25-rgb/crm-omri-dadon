-- Disposable DB: approved under-40% exception order must use the SAME
-- inventory-aware manager fulfillment path as an ordinary agent order.
-- Previous fixtures create order 3030... and manually reopen its alert.
reset role;
reset request.jwt.claim.sub;
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $approved_stock$
declare
 v_order public.orders;
 v_before numeric;
 v_after numeric;
 v_effect numeric;
 v_alerts integer;
 v_financial text;
begin
 select quantity into v_before from public.products
 where id='55555555-5555-4555-8555-555555555555';
 select status into v_financial from public.orders
 where id='30303030-3030-4030-8030-303030303030';

 v_order:=public.save_order_with_inventory(
  '30303030-3030-4030-8030-303030303030',
  '{"fulfilled":true}'::jsonb,false);
 select quantity into v_after from public.products
 where id='55555555-5555-4555-8555-555555555555';
 select public.test_agent_inventory_effect(v_order.id,
   '55555555-5555-4555-8555-555555555555') into v_effect;
 select count(*) into v_alerts from public.sales_agent_delivery_alerts
 where order_id=v_order.id and closed_at is null;
 if v_after is distinct from v_before-1 or v_effect<>1
    or v_order.inventory_deducted is distinct from true
    or v_order.status is distinct from v_financial or v_alerts<>0
 then raise exception 'approved exception fulfillment failed stock/payment/alert invariants'; end if;

 v_order:=public.save_order_with_inventory(
  '30303030-3030-4030-8030-303030303030',
  '{"fulfilled":true}'::jsonb,false);
 select quantity into v_after from public.products
 where id='55555555-5555-4555-8555-555555555555';
 if v_after<>v_before-1 then raise exception 'approved exception fulfillment deducted twice'; end if;

 v_order:=public.save_order_with_inventory(
  '30303030-3030-4030-8030-303030303030',
  '{"fulfilled":false}'::jsonb,false);
 select quantity into v_after from public.products
 where id='55555555-5555-4555-8555-555555555555';
 select count(*) into v_alerts from public.sales_agent_delivery_alerts
 where order_id=v_order.id and closed_at is null;
 if v_after<>v_before or v_order.inventory_deducted is distinct from false
    or v_alerts<>1 or v_order.status is distinct from v_financial
 then raise exception 'approved exception restore failed'; end if;
end $approved_stock$;
reset role;
reset request.jwt.claim.sub;
select 'approved exception -> manager fulfillment, financial isolation and restore PASS' as result;
