-- Disposable PostgreSQL only: manager-equivalent manual total IS atomic with
-- order creation, bound to agent/line/cost/VAT and under-40% approval.
reset role;
reset request.jwt.claim.sub;
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $activate$
begin
 perform public.sales_agent_activate('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
end $activate$;
set request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';

do $new_order$
declare r public.orders; n integer; before_qty numeric;
begin
 select quantity into before_qty from public.products
 where id='44444444-4444-4444-8444-444444444444';

 r:=public.sales_agent_create_order_with_total(
  '62626262-6262-4262-8262-626262626262',
  '11111111-1111-4111-8111-111111111111',
  '[{"product_id":"44444444-4444-4444-8444-444444444444",
     "quantity":10,"unit_price":10,"total":100,"discount":0}]'::jsonb,
  0,'Manual total with 40 pct margin',118);
 if r.total<>118 or r.total_override<>118 or r.subtotal<>100
    or r.vat_amount<>18 or r.discount_amount<>0
    or r.inventory_deducted or r.fulfilled
 then raise exception 'manual total writer stored wrong accounting fields'; end if;

 r:=public.sales_agent_create_order_with_total(
  '62626262-6262-4262-8262-626262626262',
  '11111111-1111-4111-8111-111111111111',
  '[{"product_id":"44444444-4444-4444-8444-444444444444",
     "quantity":10,"unit_price":10,"total":100,"discount":0}]'::jsonb,
  0,'Manual total with 40 pct margin',118);
 if r.total<>118 then raise exception 'manual total idempotency failed'; end if;

 begin
  perform public.sales_agent_create_order_with_total(
   '62626262-6262-4262-8262-626262626262',
   '11111111-1111-4111-8111-111111111111',
   '[{"product_id":"44444444-4444-4444-8444-444444444444",
      "quantity":10,"unit_price":10,"total":100,"discount":0}]'::jsonb,
   0,'Manual total with 40 pct margin',119);
  raise exception 'changed manual total silently accepted';
 exception when others then
  if sqlerrm<>'order_request_payload_changed' then raise; end if;
 end;

 begin
  perform public.sales_agent_create_order_with_total(
   '63636363-6363-4363-8363-636363636363',
   '11111111-1111-4111-8111-111111111111',
   '[{"product_id":"44444444-4444-4444-8444-444444444444",
      "quantity":10,"unit_price":10,"total":100,"discount":0}]'::jsonb,
   0,null,106.20);
  raise exception 'below 40 manual total was saved without approval';
 exception when others then
  if sqlerrm<>'margin_below_minimum_request_exception' then raise; end if;
 end;
 select quantity into n from public.products
 where id='44444444-4444-4444-8444-444444444444';
 if n is distinct from before_qty then raise exception 'manual total order moved stock'; end if;
end $new_order$;

do $exception_request$
declare e public.sales_agent_margin_exceptions;
begin
 e:=public.sales_agent_request_total_exception(
  '64646464-6464-4464-8464-646464646464',
  '11111111-1111-4111-8111-111111111111',
  '[{"product_id":"44444444-4444-4444-8444-444444444444",
     "quantity":10,"unit_price":10,"total":100,"discount":0}]'::jsonb,
  106.20,'Manual discount below 40 percent');
 if e.status<>'pending' or e.margin_pct>=40 or
    (e.order_payload->>'total_override')::numeric<>106.20
 then raise exception 'manual exception snapshot missing gross total'; end if;
end $exception_request$;

set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $manager_approve$
begin
 if public.sales_agent_decide_exception(
   '64646464-6464-4464-8464-646464646464','approved','בן'
 ) is distinct from true then raise exception 'manager total exception approval failed'; end if;
end $manager_approve$;

set request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $materialize$
declare r public.orders;
begin
 r:=public.sales_agent_create_approved_exception_order(
  '64646464-6464-4464-8464-646464646464',
  '65656565-6565-4565-8565-656565656565');
 if r.total<>106.20 or r.total_override<>106.20 or
    r.subtotal<>100 or r.vat_amount<>16.20 or
    r.fulfilled or r.inventory_deducted
 then raise exception 'approved manual-total exception stored wrong order'; end if;

 r:=public.sales_agent_create_approved_exception_order(
  '64646464-6464-4464-8464-646464646464',
  '65656565-6565-4565-8565-656565656565');
 if r.total_override<>106.20 then raise exception 'approved manual total retry changed order'; end if;
end $materialize$;

-- Approval is bound to original VAT and net revenue, not just
-- the gross total chosen in the browser.
do $vat_snapshot_request$
declare e public.sales_agent_margin_exceptions;
begin
 e:=public.sales_agent_request_total_exception(
  '66666666-6666-4666-8666-666666666666',
  '11111111-1111-4111-8111-111111111111',
  '[{"product_id":"44444444-4444-4444-8444-444444444444",
     "quantity":10,"unit_price":10,"total":100,"discount":0}]'::jsonb,
  106.20,'VAT snapshot test');
 if e.status<>'pending' then raise exception 'VAT snapshot setup failed'; end if;
end $vat_snapshot_request$;

set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $vat_approve$
begin
 if public.sales_agent_decide_exception(
   '66666666-6666-4666-8666-666666666666','approved','עומרי'
 ) is distinct from true then raise exception 'VAT snapshot approval failed'; end if;
end $vat_approve$;

reset role;
update public.business_settings set vat_rate=19
 where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set role authenticated;
set request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $vat_drift$
declare blocked boolean:=false; n integer;
begin
 begin
  perform public.sales_agent_create_approved_exception_order(
   '66666666-6666-4666-8666-666666666666',
   '67676767-6767-4767-8767-676767676767');
 exception when others then
  blocked=(sqlerrm='exception_payload_or_prices_changed');
 end;
 if not blocked then raise exception 'manager approval survived changed tax split'; end if;
 select count(*) into n from public.orders
  where id='67676767-6767-4767-8767-676767676767';
 if n<>0 then raise exception 'stale VAT approval created order'; end if;
end $vat_drift$;
reset role;
update public.business_settings set vat_rate=18
 where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set role authenticated;

set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $disable$
begin
 perform public.sales_agent_disable('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
end $disable$;
reset role;
reset request.jwt.claim.sub;
select 'atomic manual-total order write and manager exception consumption PASS' as result;
