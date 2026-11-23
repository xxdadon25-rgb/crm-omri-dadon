-- Ephemeral PostgreSQL only. Uses synthetic records inserted by step 60.
-- The rate in the agent profile was changed 8 -> 5; original orders stay 8.
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $test$
declare denied boolean:=false;
begin
  begin
    perform public.sales_agent_reconcile_commissions(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  exception when others then denied=(sqlerrm='not_authorized'); end;
  if not denied then raise exception 'agent posted own commission'; end if;
end $test$;

set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $test$
declare r record; entries integer; total numeric; commission numeric;
begin
 select * into r from public.sales_agent_reconcile_commissions(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if r.new_settlements<>3 or r.new_reversals<>0 or r.needs_review<>2
 then raise exception 'unexpected first sync: %',row_to_json(r); end if;

 select count(*),sum(net_collected),sum(commission_amount)
 into entries,total,commission
 from public.sales_agent_commission_entries;
 if entries<>3 or total<>200 or commission<>16 then
   raise exception 'ledger mismatch %/%/%',entries,total,commission; end if;

 -- Repeated reconciliation is idempotent; no new rows or duplicate payouts.
 select * into r from public.sales_agent_reconcile_commissions(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if r.new_settlements<>0 or r.new_reversals<>0
 then raise exception 'duplicate settlement: %',row_to_json(r); end if;
end $test$;

reset role;
-- Confirmed credit on the first invoice invalidates BOTH of its received
-- partial/grouped payments, without affecting another invoice's commission.
insert into public.credit_notes
  (id,user_id,customer_id,invoice_id,total,finbot_status)
values (
 '34343434-3434-4434-8434-343434343434',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '11110000-1111-4111-8111-111100001111',50,'confirmed'
);

set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $test$
declare r record; n integer; v numeric;
begin
 select * into r from public.sales_agent_reconcile_commissions(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if r.new_settlements<>0 or r.new_reversals<>2
 then raise exception 'confirmed credit did not reverse earlier commission: %',row_to_json(r); end if;

 select count(*),sum(commission_amount) into n,v
 from public.sales_agent_commission_entries;
 if n<>5 or v<>8 then raise exception 'reversal total mismatch %/%',n,v; end if;

 select * into r from public.sales_agent_reconcile_commissions(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if r.new_reversals<>0 then raise exception 'second reversal duplicated'; end if;

 -- No manager or agent can rewrite an immutable accrual row.
 begin
   update public.sales_agent_commission_entries
   set commission_amount=0 where entry_kind='settlement';
   raise exception 'immutable entry update succeeded';
 exception when others then
   if sqlerrm='immutable entry update succeeded' then raise; end if;
 end;
end $test$;

reset role;
delete from public.credit_notes
where id='34343434-3434-4434-8434-343434343434';

set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $test$
declare r record; c integer;
begin
 select * into r from public.sales_agent_reconcile_commissions(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if r.new_settlements<>0 or r.new_reversals<>0 or r.needs_review<2
 then raise exception 'previously reversed commission was silently re-earned: %',row_to_json(r); end if;
 select count(*) into c from public.sales_agent_commission_entries;
 if c<>5 then raise exception 'refund edit duplicated ledger'; end if;
end $test$;

reset role;
reset request.jwt.claim.sub;
select 'immutable 8% ledger and one-time compensating reversals PASS' as result;
