-- Disposable database: old manager payment-delete workflow must remain possible.
-- The commission ledger retains audit source_key even once payment FK is NULL.
reset role;
reset request.jwt.claim.sub;
insert into public.invoices(id,user_id,customer_id,order_id,total,vat_rate,included_order_ids)
values (
 '55550000-5555-4555-8555-555500005555',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 'aaaaaaaa-1111-4111-8111-111111111111',118,18,'[]'
);
insert into public.payments
 (id,user_id,customer_id,invoice_id,amount,payment_date,status,payment_method)
values (
 '55559999-5555-4555-8555-555599995555',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '55550000-5555-4555-8555-555500005555',118,
 '2026-11-23','אושר','מזומן'
);
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $test$
declare r record; n integer;
begin
 select * into r from public.sales_agent_reconcile_commissions(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if r.new_settlements<>1 then
  raise exception 'new real receipt did not accrue once: %',row_to_json(r); end if;

 delete from public.payments
 where id='55559999-5555-4555-8555-555599995555';
 get diagnostics n=row_count;
 if n<>1 then raise exception 'commission ledger blocked manager payment delete'; end if;

 select count(*) into n from public.sales_agent_commission_entries
 where source_key='settlement:55559999-5555-4555-8555-555599995555'
  and payment_id is null and commission_amount=8;
 if n<>1 then raise exception 'original ledger audit was lost on deletion'; end if;

 select * into r from public.sales_agent_reconcile_commissions(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if r.new_reversals<>1 then
  raise exception 'deleted payment not reversed exactly once: %',row_to_json(r); end if;

 select count(*) into n from public.sales_agent_commission_entries
 where source_key like 'reversal:%' and payment_id is null
  and commission_amount=-8;
 if n<1 then raise exception 'no immutable deletion reversal'; end if;

 select * into r from public.sales_agent_reconcile_commissions(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if r.new_reversals<>0 then
  raise exception 'deleted payment reversal duplicated'; end if;
end $test$;
reset role;
reset request.jwt.claim.sub;
select 'manager receipt deletion preserved; original commission offset by one reversal PASS' as result;
