-- PREPARATION ONLY — DO NOT APPLY TO PRODUCTION.
-- Manager-only bookkeeping for a commission payout ALREADY PAID externally.
-- NO bank transfers, checks, payment gateway or QuickStock payment changes.
-- Always reconcile immutable earnings first, lock agent + owner scope,
-- and refuse double payout / overpayment on collected funds.
begin;

alter table public.sales_agent_commission_payouts
  add column if not exists recorded_by_label text
  check (recorded_by_label in ('עומרי','בן'));

create or replace function public.sales_agent_record_commission_payout(
  p_payout_id uuid,
  p_agent_id uuid,
  p_period_month date,
  p_amount numeric,
  p_recorder_label text,
  p_notes text default null
)
returns public.sales_agent_commission_payouts
language plpgsql security definer
set search_path = ''
as $payout$
declare
  v_owner uuid:=auth.uid();
  v_profile public.sales_agent_profiles%rowtype;
  v_payout public.sales_agent_commission_payouts%rowtype;
  v_available numeric;
begin
 if v_owner is null or p_agent_id is null or p_payout_id is null
   or p_period_month is null or extract(day from p_period_month)<>1
   or p_amount is null or p_amount<=0
   or p_amount<>round(p_amount,2)
   or p_recorder_label not in ('עומרי','בן')
   or p_recorder_label is null
   or pg_catalog.length(coalesce(p_notes,''))>1000
 then raise exception 'invalid_commission_payout'; end if;

 if not exists (
   select 1 from public.sales_agent_managers m
   where m.auth_user_id=v_owner and m.owner_auth_id=v_owner
 ) then raise exception 'not_manager'; end if;

 select * into v_profile from public.sales_agent_profiles ap
 where ap.auth_user_id=p_agent_id and ap.owner_auth_id=v_owner
 for update;
 if not found then raise exception 'agent_not_found'; end if;

 select * into v_payout from public.sales_agent_commission_payouts po
 where po.id=p_payout_id for update;
 if found then
   if v_payout.agent_auth_id<>p_agent_id
     or v_payout.period_month<>p_period_month
     or v_payout.amount<>p_amount
     or v_payout.recorded_by_label<>p_recorder_label
   then raise exception 'payout_id_already_used'; end if;
   return v_payout;
 end if;

 -- Reconcile all approved, safely matched receipts in the SAME transaction,
 -- including compensating reversals, before calculating availability.
 perform public.sales_agent_reconcile_commissions(p_agent_id);

 select (
   coalesce((select sum(e.commission_amount)
     from public.sales_agent_commission_entries e
     where e.agent_auth_id=p_agent_id),0)
   -
   coalesce((select sum(po.amount)
     from public.sales_agent_commission_payouts po
     where po.agent_auth_id=p_agent_id),0)
 ) into v_available;

 if v_available<0 or p_amount>v_available
 then raise exception 'commission_payout_exceeds_available'; end if;

 insert into public.sales_agent_commission_payouts(
   id,agent_auth_id,period_month,amount,paid_at,recorded_by,
   recorded_by_label,notes
 ) values (
   p_payout_id,p_agent_id,p_period_month,p_amount,
   transaction_timestamp(),v_owner,p_recorder_label,p_notes
 ) returning * into v_payout;

 return v_payout;
end;
$payout$;

revoke all on function public.sales_agent_record_commission_payout(
  uuid,uuid,date,numeric,text,text)
from public,anon,authenticated;
grant execute on function public.sales_agent_record_commission_payout(
  uuid,uuid,date,numeric,text,text)
to authenticated;
commit;

-- This records a payout after external confirmation, not an authorization
-- to spend money. Historical disputed credits remain excluded. On later
-- reversals the ledger may show a negative next-period carried balance.
