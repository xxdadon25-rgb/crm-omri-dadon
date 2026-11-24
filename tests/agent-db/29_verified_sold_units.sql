-- Disposable SQL: pricing levels must be based on the *actual sold
-- catalogue unit*, not on assumptions that "carton" means 1 base item.
-- No production prices, packaging, blocks or inventory are altered.
reset role;
reset request.jwt.claim.sub;
insert into public.products(id,user_id,name,unit,buy_price,sell_price,quantity)
values
('85858585-8585-4858-8858-858585858581',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'Verified carton-priced product','קרטון',60,100,12),
('85858585-8585-4858-8858-858585858582',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'Verified pack-priced product','חבילה',6,10,240);
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $pack_same_unit$
declare r record;blocked boolean;
begin
 -- Both current prices refer to the *same sold carton*, not one piece.
 select * into r from public.sales_agent_check_order_margin(
  '11111111-1111-4111-8111-111111111111',
  '[{"product_id":"85858585-8585-4858-8858-858585858581",
  "quantity":2,"unit_price":100,"total":200,"discount":0,
  "price_basis":"catalog_same_sold_unit_v1","sale_level":"unit","buy_level":"unit"}]'::jsonb,0);
 if r.allowed is distinct from true or r.net_cost<>120
    or r.net_revenue<>200 or r.margin_percent<>40
 then raise exception 'verified carton as sold item computed incorrect cost'; end if;

 -- Another valid sale unit "חבילה" is not automatically an individual piece.
 select * into r from public.sales_agent_check_order_margin(
  '11111111-1111-4111-8111-111111111111',
  '[{"product_id":"85858585-8585-4858-8858-858585858582",
  "quantity":2,"unit_price":10,"total":20,"discount":0,
  "price_basis":"catalog_same_sold_unit_v1"}]'::jsonb,0);
 if r.net_cost<>12 or r.net_revenue<>20 or not r.allowed
 then raise exception 'verified pack as sold item computed incorrect cost'; end if;

 -- A browser assertion of a larger carton/pack size is not evidence
 -- the agent can use to convert current purchase prices.
 blocked:=false;
 begin
  perform public.sales_agent_check_order_margin(
  '11111111-1111-4111-8111-111111111111',
  '[{"product_id":"85858585-8585-4858-8858-858585858582",
  "quantity":10,"unit_price":10,"total":100,"discount":0,
  "price_basis":"catalog_same_sold_unit_v1",
  "sale_level":"carton","buy_level":"unit",
  "packaging":{"units_per_pack":24,"packs_per_carton":10}}]'::jsonb,0);
 exception when others then blocked=sqlerrm='sale_unit_needs_clarification'; end;
 if not blocked then raise exception 'forged mixed carton/unit was not rejected'; end if;

 blocked:=false;
 begin
  perform public.sales_agent_check_order_margin(
  '11111111-1111-4111-8111-111111111111',
  '[{"product_id":"85858585-8585-4858-8858-858585858582",
  "quantity":10,"unit_price":10,"total":100,"discount":0,
  "sale_level_review":true,"buy_level":"unit",
  "price_basis":"catalog_same_sold_unit_v1"}]'::jsonb,0);
 exception when others then blocked=sqlerrm='sale_unit_needs_clarification'; end;
 if not blocked then raise exception 'unconfirmed packaging survived margin check'; end if;
end $pack_same_unit$;
reset role;
reset request.jwt.claim.sub;
select 'existing carton/pack price units supported; mixed levels fail closed PASS' as result;
