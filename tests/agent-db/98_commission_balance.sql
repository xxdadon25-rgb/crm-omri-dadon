-- Disposable database: includes 3 settlements (16), reversals (-16)
-- and two already-paid commissions (8), so remaining balance is -8.
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $test$
declare b record;
begin
 select * into b from public.sales_agent_commission_balance(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if b.total_commission_accrued<>0 or b.payouts_recorded<>8
   or b.current_balance<>-8
 then raise exception 'manager full ledger balance incorrect: %',row_to_json(b); end if;
end $test$;

set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $test$
declare denied boolean:=false;
begin
  -- The agent was disabled by stage 80. Direct RPC must respect revocation.
  begin
    perform public.sales_agent_commission_balance();
  exception when others then denied=(sqlerrm='agent_not_active'); end;
  if not denied then raise exception 'disabled agent read lifetime balance'; end if;
end $test$;

set request.jwt.claim.sub='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $test$
declare denied boolean:=false;
begin
 begin
  perform public.sales_agent_commission_balance(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 exception when others then denied=(sqlerrm='not_authorized'); end;
 if not denied then raise exception 'portal customer read agent commission balance'; end if;
end $test$;
reset role;
reset request.jwt.claim.sub;
select 'complete read-only commission balance incl later reversal and prior payout PASS' as result;
