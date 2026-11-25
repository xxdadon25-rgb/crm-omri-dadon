-- Synthetic overpayment: extra customer credit is not eligible 8% sales.
reset role;
reset request.jwt.claim.sub;

update public.payments set amount=119
where id='22220000-3333-4333-8333-222200003333';

set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $test$
declare r record; reason text; n integer; total_due numeric;
begin
 select review_reason into reason
 from public.sales_agent_commission_preview(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
 where payment_id='22220000-3333-4333-8333-222200003333';
 if reason<>'invoice_overpaid_needs_allocation'
 then raise exception 'unallocated overpayment paid commission: %',reason; end if;

 select * into r from public.sales_agent_reconcile_commissions(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if r.new_settlements<>0 or r.new_reversals<>1
 then raise exception 'overpaid correction did not reverse historical accrual: %',row_to_json(r); end if;

 select coalesce(sum(commission_amount),0) into total_due
 from public.sales_agent_commission_entries
 where agent_auth_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 if total_due<>0 then raise exception 'overpaid invoice did not zero earned commission'; end if;

 select count(*) into n from public.sales_agent_commission_payouts
 where agent_auth_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 if n<>2 then raise exception 'previous real payout record was destroyed'; end if;
end $test$;

reset role;
reset request.jwt.claim.sub;
select 'overpaid receipt blocked; prior payout kept as negative future adjustment PASS' as result;
