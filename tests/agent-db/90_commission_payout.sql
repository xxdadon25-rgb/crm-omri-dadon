-- Disposable DB, no real transfers. Steps 60/70 already left net
-- commission entitlement 8.00 after compensating two credited receipts.
reset role;
reset request.jwt.claim.sub;
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

do $test$
declare denied boolean:=false;
begin
 begin
  perform public.sales_agent_record_commission_payout(
    '98989898-9898-4898-8898-989898989898',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '2026-11-01',5,'עומרי','fake agent payout attempt');
 exception when others then denied=(sqlerrm='not_manager'); end;
 if not denied then raise exception 'agent recorded own commission payout'; end if;
end $test$;

set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $test$
declare po public.sales_agent_commission_payouts; denied boolean; n integer;
begin
 po:=public.sales_agent_record_commission_payout(
    '98989898-9898-4898-8898-989898989898',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '2026-11-01',5,'בן','Already paid externally');
 if po.amount<>5 or po.recorded_by_label<>'בן' or po.recorded_by<>auth.uid()
 then raise exception 'payout record incorrect'; end if;

 po:=public.sales_agent_record_commission_payout(
    '98989898-9898-4898-8898-989898989898',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '2026-11-01',5,'בן','retry same transaction');
 select count(*) into n from public.sales_agent_commission_payouts;
 if n<>1 then raise exception 'idempotent payment double-recorded'; end if;

 denied:=false;
 begin
  perform public.sales_agent_record_commission_payout(
    '97979797-9797-4979-8979-979797979797',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '2026-11-01',4,'עומרי','should fail remaining 3');
 exception when others then denied=(sqlerrm='commission_payout_exceeds_available'); end;
 if not denied then raise exception 'excess commission payout accepted'; end if;

 po:=public.sales_agent_record_commission_payout(
    '96969696-9696-4969-8969-969696969696',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '2026-11-01',3,'עומרי','remaining 3 externally paid');
 if po.amount<>3 then raise exception 'remaining 3 not recorded'; end if;

 denied:=false;
 begin
  perform public.sales_agent_record_commission_payout(
    '95959595-9595-4959-8959-959595959595',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '2026-11-01',0.01,'עומרי','overpay');
 exception when others then denied=(sqlerrm='commission_payout_exceeds_available'); end;
 if not denied then raise exception 'payout above final available commission'; end if;

 select count(*) into n from public.sales_agent_commission_payouts;
 if n<>2 then raise exception 'unexpected payout count %',n; end if;
end $test$;

reset role;
reset request.jwt.claim.sub;
select 'commission payout ledger: manager only, no external money movement, duplicate/overpay protections PASS' as result;
