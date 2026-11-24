-- Disposable PostgreSQL only: exercise real staged legacy stock RPC together
-- with agent-created order, attribution, and delivery-alert trigger.
-- Not a production-schema restore; never run against the live database.
reset role;
reset request.jwt.claim.sub;
insert into public.products(id,user_id,name,sku,unit,buy_price,sell_price,quantity)
values('91919191-9191-4919-8919-919191919191',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'Fulfillment regression item','TEST-ONLY','יחידה',6,10,20);
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $agent_create$
declare r public.orders; qty numeric;
begin
 r:=public.sales_agent_create_order(
    '92929292-9292-4929-8929-929292929292',
    '11111111-1111-4111-8111-111111111111',
    '[{"product_id":"91919191-9191-4919-8919-919191919191",
       "quantity":3,"unit_price":10,"discount":0,"total":30}]'::jsonb,
    0,'Agent fulfillment regression');
 if r.fulfilled is distinct from false or r.inventory_deducted is distinct from false
 then raise exception 'agent writer moved inventory on order creation'; end if;
 select quantity into qty from public.products
 where id='91919191-9191-4919-8919-919191919191';
 if qty<>20 then raise exception 'agent order creation changed stock'; end if;
end $agent_create$;

set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $manager_fulfill$
declare r public.orders; qty numeric; effect numeric; open_alerts integer;
begin
 r:=public.save_order_with_inventory(
    '92929292-9292-4929-8929-929292929292',
    '{"fulfilled":true}'::jsonb,false);
 select quantity into qty from public.products
 where id='91919191-9191-4919-8919-919191919191';
 select net_deducted into effect from public.order_inventory_effects
 where order_id=r.id and product_id='91919191-9191-4919-8919-919191919191';
 if r.fulfilled is distinct from true or r.inventory_deducted is distinct from true
    or qty<>17 or effect<>3
 then raise exception 'existing manager fulfilment did not deduct 3 units exactly'; end if;
 select count(*) into open_alerts from public.sales_agent_delivery_alerts
 where order_id=r.id and closed_at is null;
 if open_alerts<>0 then raise exception 'fulfillment did not close agent alert'; end if;
 if r.status<>'ממתין לאישור' then raise exception 'fulfillment changed payment status'; end if;

 -- A repeated manager request must not double-deduct stock.
 r:=public.save_order_with_inventory(
    '92929292-9292-4929-8929-929292929292',
    '{"fulfilled":true}'::jsonb,false);
 select quantity into qty from public.products
 where id='91919191-9191-4919-8919-919191919191';
 if qty<>17 then raise exception 'repeated fulfillment deducted twice'; end if;

 -- Explicit undo restores EXACT stock effect and reopens the delivery alert.
 r:=public.save_order_with_inventory(
    '92929292-9292-4929-8929-929292929292',
    '{"fulfilled":false}'::jsonb,false);
 select quantity into qty from public.products
 where id='91919191-9191-4919-8919-919191919191';
 select net_deducted into effect from public.order_inventory_effects
 where order_id=r.id and product_id='91919191-9191-4919-8919-919191919191';
 select count(*) into open_alerts from public.sales_agent_delivery_alerts
 where order_id=r.id and closed_at is null;
 if qty<>20 or effect<>0 or r.inventory_deducted is distinct from false
    or r.fulfilled is distinct from false or open_alerts<>1
 then raise exception 'undo fulfillment did not restore exact quantities and alert'; end if;
end $manager_fulfill$;
reset role;
reset request.jwt.claim.sub;
select 'agent -> manager stock fulfillment -> idempotent retry -> restore PASS' as result;
