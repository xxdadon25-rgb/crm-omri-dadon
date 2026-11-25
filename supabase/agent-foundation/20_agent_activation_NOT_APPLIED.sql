-- DEVELOPMENT ONLY. Apply ONLY after isolated E2E, backup and explicit rollout authorization.
-- Activation requires an existing, separately authenticated, DISABLED agent profile.
-- Managers alone may activate; a customer-portal or staff identity cannot be promoted.
begin;

create or replace function public.sales_agent_activate(
  p_agent_auth_id uuid
) returns boolean
language plpgsql security definer
set search_path = ''
as $activate$
declare
  v_owner uuid := auth.uid();
  v_agent public.sales_agent_profiles%rowtype;
begin
  if v_owner is null then raise exception 'not_authenticated'; end if;
  if not exists (
    select 1 from public.sales_agent_managers m
    where m.auth_user_id=v_owner and m.owner_auth_id=v_owner
  ) then raise exception 'not_manager'; end if;
  if p_agent_auth_id is null or p_agent_auth_id=v_owner then
    raise exception 'invalid_agent_identity'; end if;

  select * into v_agent
  from public.sales_agent_profiles ap
  where ap.auth_user_id=p_agent_auth_id and ap.owner_auth_id=v_owner
  for update;
  if not found then raise exception 'agent_not_found'; end if;

  if not exists (
    select 1 from auth.users u where u.id=p_agent_auth_id
  ) or exists (
    select 1 from public.sales_agent_managers m
    where m.auth_user_id=p_agent_auth_id
  ) or exists (
    select 1 from public.staff_members s
    where s.auth_user_id=p_agent_auth_id
  ) or exists (
    select 1 from public.customer_portal_access cp
    where cp.auth_user_id=p_agent_auth_id and cp.portal_deleted_at is null
  ) then raise exception 'agent_identity_conflict'; end if;

  if v_agent.is_active is true then return true; end if;
  update public.sales_agent_profiles
    set is_active=true
  where auth_user_id=p_agent_auth_id and owner_auth_id=v_owner;
  return true;
end;
$activate$;

revoke all on function public.sales_agent_activate(uuid)
  from public,anon,authenticated;
grant execute on function public.sales_agent_activate(uuid)
  to authenticated;
commit;
