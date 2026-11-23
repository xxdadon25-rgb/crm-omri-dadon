-- STAGED ONLY — DO NOT APPLY TO PRODUCTION.
-- Manager registers EXISTING Supabase Auth identities as disabled agents,
-- and assigns only customers belonging to the manager's business.
-- Provisioning Auth itself needs a separate audited setup; this RPC cannot
-- create Auth users or impersonate them. No automatic activation here.
begin;
create or replace function public.sales_agent_register_disabled(
 p_auth_user_id uuid,
 p_display_name text,
 p_commission_pct numeric default 8
)
returns public.sales_agent_profiles
language plpgsql security definer
set search_path = ''
as $register$
declare v_owner uuid:=auth.uid();
 v_agent public.sales_agent_profiles%rowtype;
begin
 if v_owner is null then raise exception 'not_authenticated'; end if;
 if not exists (
   select 1 from public.sales_agent_managers m
   where m.auth_user_id=v_owner and m.owner_auth_id=v_owner
 ) then raise exception 'not_manager'; end if;
 if p_auth_user_id is null or p_auth_user_id=v_owner
   or not exists(select 1 from auth.users u where u.id=p_auth_user_id)
 then raise exception 'invalid_agent_identity'; end if;
 if exists(select 1 from public.sales_agent_managers m
   where m.auth_user_id=p_auth_user_id)
 then raise exception 'manager_cannot_be_agent'; end if;
 if exists(select 1 from public.customer_portal_access cp
   where cp.auth_user_id=p_auth_user_id
     and cp.portal_deleted_at is null)
 then raise exception 'portal_identity_cannot_be_agent'; end if;
 if nullif(pg_catalog.btrim(p_display_name),'') is null
   or pg_catalog.length(p_display_name)>100
   or p_commission_pct is null or p_commission_pct<0 or p_commission_pct>100
 then raise exception 'invalid_agent_profile'; end if;

 select * into v_agent from public.sales_agent_profiles ap
 where ap.auth_user_id=p_auth_user_id for update;
 if found then
   if v_agent.owner_auth_id is distinct from v_owner
   then raise exception 'agent_identity_in_other_business'; end if;
   -- Repeated exact registration is idempotent, but never turns active on.
   return v_agent;
 end if;
 insert into public.sales_agent_profiles(
   auth_user_id,owner_auth_id,display_name,commission_pct,is_active)
 values(p_auth_user_id,v_owner,pg_catalog.btrim(p_display_name),p_commission_pct,false)
 returning * into v_agent;
 return v_agent;
end;
$register$;

create or replace function public.sales_agent_set_customer_assignment(
 p_agent_auth_id uuid,
 p_customer_id uuid,
 p_assign boolean
)
returns boolean
language plpgsql security definer
set search_path = ''
as $assign$
declare v_owner uuid:=auth.uid();
begin
 if v_owner is null or p_agent_auth_id is null or p_customer_id is null
   or p_assign is null then raise exception 'invalid_assignment'; end if;
 if not exists(select 1 from public.sales_agent_managers m
   where m.auth_user_id=v_owner and m.owner_auth_id=v_owner)
 then raise exception 'not_manager'; end if;

 perform 1 from public.sales_agent_profiles ap
 where ap.auth_user_id=p_agent_auth_id
   and ap.owner_auth_id=v_owner for share;
 if not found then raise exception 'agent_not_found'; end if;

 perform 1 from public.customers c
 where c.id=p_customer_id and c.user_id=v_owner for share;
 if not found then raise exception 'customer_not_owned'; end if;

 if p_assign then
   insert into public.sales_agent_customer_assignments(
     customer_id,agent_auth_id,assigned_by)
   values (p_customer_id,p_agent_auth_id,v_owner)
   on conflict(customer_id,agent_auth_id) do nothing;
 else
   delete from public.sales_agent_customer_assignments ca
   where ca.customer_id=p_customer_id and ca.agent_auth_id=p_agent_auth_id;
 end if;
 return true;
end;
$assign$;

-- Pause an existing agent without modifying order attributions or past
-- commission rates. Turning ON remains gated until production go-live.
create or replace function public.sales_agent_disable(
 p_agent_auth_id uuid
)
returns boolean
language plpgsql security definer
set search_path = ''
as $disable$
declare v_owner uuid:=auth.uid();
begin
 if v_owner is null or not exists(
   select 1 from public.sales_agent_managers m
   where m.auth_user_id=v_owner and m.owner_auth_id=v_owner)
 then raise exception 'not_manager'; end if;
 update public.sales_agent_profiles ap set is_active=false
 where ap.auth_user_id=p_agent_auth_id and ap.owner_auth_id=v_owner;
 if not found then raise exception 'agent_not_found'; end if;
 return true;
end;
$disable$;

revoke all on function public.sales_agent_register_disabled(uuid,text,numeric)
  from public,anon,authenticated;
revoke all on function public.sales_agent_set_customer_assignment(uuid,uuid,boolean)
  from public,anon,authenticated;
revoke all on function public.sales_agent_disable(uuid)
  from public,anon,authenticated;
grant execute on function public.sales_agent_register_disabled(uuid,text,numeric)
  to authenticated;
grant execute on function public.sales_agent_set_customer_assignment(uuid,uuid,boolean)
  to authenticated;
grant execute on function public.sales_agent_disable(uuid)
  to authenticated;
commit;
