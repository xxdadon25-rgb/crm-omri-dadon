-- Disposable PostgreSQL: agent cannot forge invoice-facing SKU, name, unit,
-- stock or monetary fields even with a direct RPC request (not UI).
reset role;
reset request.jwt.claim.sub;
update public.products set sku='TRUSTED-SKU',unit='חבילה',
  meters_per_roll=null
where id='44444444-4444-4444-8444-444444444444';

set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $test$
declare o public.orders; it jsonb; n integer;
begin
  o:=public.sales_agent_create_order(
    '35353535-3535-4535-8535-353535353535',
    '11111111-1111-4111-8111-111111111111',
    '[{
      "product_id":"44444444-4444-4444-8444-444444444444",
      "name":"FAKE PRODUCT","sku":"FAKE SKU","unit":"מטבע זהב",
      "quantity":10,"unit_price":10,"total":100,
      "discount":0,"buy_price":0.01,
      "stock_deducted":true,"owner_is_admin":true,
      "price_basis":"catalog_same_sold_unit_v1"
    }]'::jsonb,0,'immutable catalog test');

  it:=o.items->0;
  if it->>'name'<>'Test unit-priced product'
    or it->>'sku'<>'TRUSTED-SKU'
    or it->>'unit'<>'חבילה'
    or (it->>'buy_price')::numeric<>6
    or it ? 'stock_deducted'
    or it ? 'owner_is_admin'
  then raise exception 'client-supplied product fields leaked into owner order: %',it; end if;

  select count(*) into n from public.sales_agent_order_attributions
  where order_id=o.id;
  if n<>1 then raise exception 'no immutable attribution'; end if;

  select count(*) into n from public.sales_agent_delivery_alerts
  where order_id=o.id;
  if n<>1 then raise exception 'no delivery alert'; end if;
end $test$;
reset role;
reset request.jwt.claim.sub;
select 'agent order product identity comes from trusted catalogue only PASS' as result;
