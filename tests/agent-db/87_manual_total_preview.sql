-- Disposable PostgreSQL only. One trusted product: 10 sale, 6 cost.
set role authenticated;
-- Previous registry tests intentionally disabled both agent identities.
-- Reactivate the clean non-staff test agent through the manager RPC only.
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $activate_for_test$
begin
 perform public.sales_agent_activate('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 perform public.sales_agent_set_customer_assignment(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '11111111-1111-4111-8111-111111111111',true);
end $activate_for_test$;
set request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $manual_test$
declare r record; blocked boolean;
begin
 select * into r from public.sales_agent_preview_manual_total(
  '11111111-1111-4111-8111-111111111111',
  '[{"product_id":"44444444-4444-4444-8444-444444444444","quantity":10,"unit_price":10,"total":100,"discount":0}]'::jsonb,
  118);
 if r.allowed is distinct from true or r.needs_manager_exception or
  r.margin_percent<>40 or r.effective_net_revenue<>100 or r.net_cost<>60 or
  r.vat_amount<>18 or r.taxable_adjustment_net<>0
 then raise exception 'unchanged manual total failed 40-percent parity'; end if;

 select * into r from public.sales_agent_preview_manual_total(
  '11111111-1111-4111-8111-111111111111',
  '[{"product_id":"44444444-4444-4444-8444-444444444444","quantity":10,"unit_price":10,"total":100,"discount":0}]'::jsonb,
  106.20);
 if r.allowed or r.needs_manager_exception is distinct from true
    or r.effective_net_revenue<>90 or r.vat_amount<>16.20
    or r.taxable_adjustment_net<>-10
 then raise exception 'manual discount bypassed 40 percent margin'; end if;

 select * into r from public.sales_agent_preview_manual_total(
  '11111111-1111-4111-8111-111111111111',
  '[{"product_id":"44444444-4444-4444-8444-444444444444","quantity":10,"unit_price":10,"total":100,"discount":0}]'::jsonb,
  120);
 if r.allowed is distinct from true or r.goods_subtotal_net<>100
    or r.taxable_adjustment_net<>1.69 or r.vat_amount<>18.31
    or r.effective_net_revenue<>101.69
 then raise exception 'positive adjustment did not match owner QuickStock'; end if;

 blocked:=false;
 begin
  perform public.sales_agent_preview_manual_total(
   '11111111-1111-4111-8111-111111111111',
   '[{"product_id":"44444444-4444-4444-8444-444444444444","quantity":10,"unit_price":10,"total":100,"discount":0}]'::jsonb,
   118.001);
 exception when others then blocked=(sqlerrm='invalid_manual_total'); end;
 if not blocked then raise exception 'fractional agorot total was accepted'; end if;

 blocked:=false;
 begin
  perform public.sales_agent_preview_manual_total(
   '22222222-2222-4222-8222-222222222222',
   '[{"product_id":"44444444-4444-4444-8444-444444444444","quantity":10,"unit_price":10,"total":100,"discount":0}]'::jsonb,
   118);
 exception when others then blocked=(sqlerrm='customer_not_assigned'); end;
 if not blocked then raise exception 'unassigned customer margin preview accepted'; end if;
end $manual_test$;

set request.jwt.claim.sub='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $deny_portal$
declare blocked boolean:=false;
begin
 begin
  perform public.sales_agent_preview_manual_total(
   '11111111-1111-4111-8111-111111111111',
   '[{"product_id":"44444444-4444-4444-8444-444444444444","quantity":10,"unit_price":10,"total":100,"discount":0}]'::jsonb,
   118);
 exception when others then blocked=(sqlerrm='agent_not_active'); end;
 if not blocked then raise exception 'portal identity could preview agent costs'; end if;
end $deny_portal$;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $cleanup$
begin
 perform public.sales_agent_disable('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
end $cleanup$;
reset role;
reset request.jwt.claim.sub;
select 'trusted manual total calculation + margin/auth guards PASS' as result;
