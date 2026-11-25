-- REVIEW ONLY. DO NOT RUN WITHOUT EXPLICIT OWNER APPROVAL.
-- QuickStock sales-agent first-manager seed, for AFTER 01_schema_NOT_APPLIED.sql.
-- Do not run against production until a verified backup/recovery path exists.
-- Only links the existing owner Auth identity to the existing business owner.
-- Does not create users, agent profiles, permissions for agents or activate a feature.
begin;
do $seed$
declare
  v_owner uuid;
  v_matches integer;
begin
  select count(*), min(u.id)
    into v_matches, v_owner
  from auth.users u
  join public.business_settings b on b.user_id = u.id
  where lower(u.email) = 'xxdadon25@gmail.com';

  if v_matches <> 1 or v_owner is null then
    raise exception 'owner_auth_business_identity_not_unique';
  end if;

  if exists (
    select 1 from public.sales_agent_managers m
    where m.auth_user_id = v_owner and m.owner_auth_id <> v_owner
  ) then
    raise exception 'owner_manager_mapping_conflict';
  end if;

  insert into public.sales_agent_managers(auth_user_id,owner_auth_id)
  values(v_owner,v_owner)
  on conflict (auth_user_id) do nothing;

  if not exists (
    select 1 from public.sales_agent_managers m
    where m.auth_user_id=v_owner and m.owner_auth_id=v_owner
  ) then
    raise exception 'owner_manager_seed_not_verified';
  end if;
end
$seed$;
commit;
