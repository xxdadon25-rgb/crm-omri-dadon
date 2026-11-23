-- STAGED ONLY. NOT APPLIED TO PRODUCTION.
-- Complete lifetime commission totals; never summarize a page-limited
-- browser listing. Read-only, scoped by original agent identity.
begin;
create or replace function public.sales_agent_commission_balance(
  p_agent_id uuid default null
)
returns table(
  agent_auth_id uuid,
  total_commission_accrued numeric,
  payouts_recorded numeric,
  current_balance numeric
)
language plpgsql stable security definer
set search_path = ''
as $balance$
declare v_caller uuid:=auth.uid();
 v_agent uuid:=coalesce(p_agent_id,auth.uid());
 v_owner uuid;
begin
 if v_caller is null then raise exception 'not_authenticated'; end if;
 select owner_auth_id into v_owner from public.sales_agent_profiles ap
 where ap.auth_user_id=v_agent;
 if v_owner is null then raise exception 'agent_not_found'; end if;
 if v_caller<>v_agent and not exists(
   select 1 from public.sales_agent_managers m
   where m.auth_user_id=v_caller and m.owner_auth_id=v_owner
 ) then raise exception 'not_authorized'; end if;

 return query select v_agent,
   coalesce((select sum(e.commission_amount)
     from public.sales_agent_commission_entries e
     where e.agent_auth_id=v_agent),0)::numeric,
   coalesce((select sum(p.amount)
     from public.sales_agent_commission_payouts p
     where p.agent_auth_id=v_agent),0)::numeric,
   (coalesce((select sum(e.commission_amount)
     from public.sales_agent_commission_entries e
     where e.agent_auth_id=v_agent),0)
    -coalesce((select sum(p.amount)
     from public.sales_agent_commission_payouts p
     where p.agent_auth_id=v_agent),0))::numeric;
end;
$balance$;
revoke all on function public.sales_agent_commission_balance(uuid)
 from public,anon,authenticated;
grant execute on function public.sales_agent_commission_balance(uuid)
 to authenticated;
commit;
