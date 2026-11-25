-- Disposable PostgreSQL: full adjusted-order -> invoice -> actual partial
-- receipts -> 8% NET commission -> confirmed credit compensation lifecycle.
-- This uses exact source order created by test 88. All data is fictional.
reset role;
reset request.jwt.claim.sub;

insert into public.invoices
(id,user_id,customer_id,order_id,total,vat_rate,included_order_ids)
values(
 '68686868-6868-4868-8868-686868686868',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '65656565-6565-4565-8565-656565656565',
 106.20,18,'[]'::jsonb
);
insert into public.payments
(id,user_id,customer_id,invoice_id,amount,payment_date,status,payment_method)
values(
 '69696969-6969-4969-8969-696969696969',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '68686868-6868-4868-8868-686868686868',
 53.10,'2026-11-20','אושר','מזומן'
),(
 '70707070-7070-4070-8070-707070707070',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '68686868-6868-4868-8868-686868686868',
 53.10,'2026-11-21','אושר','העברה בנקאית'
);

set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $settlement$
declare
 n integer; receipts_net numeric; pct numeric; commissions numeric;
 r record; entries integer;
begin
 select count(*),sum(net_received),max(commission_pct),sum(commission_amount)
 into n,receipts_net,pct,commissions
 from public.sales_agent_commission_preview('cccccccc-cccc-4ccc-8ccc-cccccccccccc')
 where review_reason is null;
 if n<>2 or receipts_net<>90 or pct<>8 or commissions<>7.20
 then raise exception 'manual total invoice partial receipt preview wrong (%/%/%/%)',
 n,receipts_net,pct,commissions; end if;

 select * into r from public.sales_agent_reconcile_commissions(
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 if r.new_settlements<>2 or r.new_reversals<>0 then
  raise exception 'manual gross total partial receipts not reconciled'; end if;
 select count(*) into entries from public.sales_agent_commission_entries
 where agent_auth_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 if entries<>2 then raise exception 'wrong number of 8 percent settlements'; end if;

 select * into r from public.sales_agent_reconcile_commissions(
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 if r.new_settlements<>0 or r.new_reversals<>0
 then raise exception 'reconciliation repeated accrual'; end if;
end $settlement$;

-- Confirmed refund makes the entire invoice needs-review, reversing
-- both prior partial commission settlements, not leaving phantom earnings.
reset role;
insert into public.credit_notes
(id,user_id,customer_id,invoice_id,total,finbot_status,external_credit_note_number)
values(
 '71717171-7171-4171-8171-717171717171',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '68686868-6868-4868-8868-686868686868',
 -20,'confirmed','TEST-EXTERNAL-CREDIT-101'
);
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $reversal$
declare r record; n integer; total numeric;
begin
 select * into r from public.sales_agent_reconcile_commissions(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 if r.new_reversals<>2 or r.new_settlements<>0
 then raise exception 'credit failed to reverse adjusted-total commissions'; end if;
 select count(*),sum(commission_amount) into n,total
 from public.sales_agent_commission_entries
 where agent_auth_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 if n<>4 or total<>0
 then raise exception 'adjusted invoice credit ledger not zeroed: %/%',n,total; end if;
end $reversal$;
reset role;
reset request.jwt.claim.sub;
select 'manual total -> invoice -> two partial receipts -> 8% accrual -> credit reversal PASS' as result;
