-- Disposable PostgreSQL only: protect against unverified packaging cost
-- and fractional-cent stored order line totals. Never mutate production.
reset role;
reset request.jwt.claim.sub;
insert into public.products(id,user_id,name,buy_price,sell_price,is_active,unit)
values (
 '66666666-6666-4666-8666-666666666666',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'Unverified zero-cost item',0,10,true,'חבילה'
);
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

do $test_margin_basis$
declare r record; blocked boolean;
begin
 -- Existing same-unit rule is still allowed on 40% exact threshold.
 select * into r from public.sales_agent_check_order_margin(
  '11111111-1111-4111-8111-111111111111',
  '[{"product_id":"44444444-4444-4444-8444-444444444444",
     "quantity":1,"unit_price":10,"total":10,"discount":0,
     "price_basis":"catalog_same_sold_unit_v1"}]'::jsonb,0
 );
 if r.allowed is distinct from true or r.net_cost<>6
 then raise exception 'valid same-sale-unit margin blocked'; end if;

 -- A supposed 1600% resale price may mean unit-vs-carton; browser may
 -- not suppress that review by forging a "confirmed" price_basis field.
 blocked:=false;
 begin
   perform public.sales_agent_check_order_margin(
     '11111111-1111-4111-8111-111111111111',
     '[{"product_id":"44444444-4444-4444-8444-444444444444",
        "quantity":1,"unit_price":100,"total":100,
        "price_basis":"catalog_same_sold_unit_v1"}]'::jsonb,0
   );
 exception when others then blocked=(sqlerrm='sale_unit_needs_clarification');
 end;
 if not blocked then raise exception 'forged high-margin carton conversion passed'; end if;

 blocked:=false;
 begin
   perform public.sales_agent_check_order_margin(
     '11111111-1111-4111-8111-111111111111',
     '[{"product_id":"44444444-4444-4444-8444-444444444444",
        "quantity":1,"unit_price":1,"total":1}]'::jsonb,0
   );
 exception when others then blocked=(sqlerrm='sale_unit_needs_clarification');
 end;
 if not blocked then raise exception 'unverified carton purchase cost not flagged'; end if;

 blocked:=false;
 begin
   perform public.sales_agent_check_order_margin(
     '11111111-1111-4111-8111-111111111111',
     '[{"product_id":"66666666-6666-4666-8666-666666666666",
        "quantity":1,"unit_price":10,"total":10}]'::jsonb,0
   );
 exception when others then blocked=(sqlerrm='cost_missing');
 end;
 if not blocked then raise exception 'unknown zero cost generated fake 100% margin'; end if;

 -- Even if cents match after rounding, stored third-decimal totals are
 -- NOT the canonical two-decimal figure checked against margin.
 blocked:=false;
 begin
   perform public.sales_agent_check_order_margin(
     '11111111-1111-4111-8111-111111111111',
     '[{"product_id":"44444444-4444-4444-8444-444444444444",
        "quantity":1,"unit_price":10,"total":10.004}]'::jsonb,0
   );
 exception when others then blocked=(sqlerrm='inconsistent_line_total');
 end;
 if not blocked then raise exception 'fractional-cent order total accepted'; end if;
end $test_margin_basis$;
reset role;
reset request.jwt.claim.sub;
select 'no inferred packaging, zero-cost fake margin, or fractional cents PASS' as result;
