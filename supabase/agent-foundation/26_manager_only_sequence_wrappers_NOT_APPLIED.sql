-- STAGED ONLY: security follow-up for legacy number generators.
-- Stage 24 blocked registered agents but kept legacy EXECUTE to anon and
-- authenticated, allowing a caller to omit JWT and advance nextval.
-- Only an explicit manager identity may allocate these legacy counters.
-- Agent orders use the separate owner settings row and remain unaffected.
-- Requires exact confirmation that no external anonymous portal/link calls
-- get_next_order_number/get_next_quote_number before production rollout.
begin;
-- Do not replace legacy counters unless every existing settings owner is
-- seeded as a manager; otherwise ordinary quote creation would break.
do $owner_seed_gate$
begin
  if not exists (select 1 from public.business_settings s)
     or exists (
       select 1 from public.business_settings s
       where not exists (
         select 1 from public.sales_agent_managers m
         where m.owner_auth_id=s.user_id and m.auth_user_id=s.user_id
       )
     )
  then raise exception 'owner_manager_identity_not_seeded'; end if;
end;
$owner_seed_gate$;
create or replace function public.get_next_order_number()
returns bigint language plpgsql security definer set search_path=''
as $order_manager_only$
begin
  if (select auth.uid()) is null or not exists(
    select 1 from public.sales_agent_managers m
    where m.auth_user_id=(select auth.uid())
      and m.owner_auth_id=(select auth.uid())
  ) then raise exception 'not_manager'; end if;
  return pg_catalog.nextval('public.order_number_seq'::regclass);
end;
$order_manager_only$;
create or replace function public.get_next_quote_number()
returns bigint language plpgsql security definer set search_path=''
as $quote_manager_only$
begin
  if (select auth.uid()) is null or not exists(
    select 1 from public.sales_agent_managers m
    where m.auth_user_id=(select auth.uid())
      and m.owner_auth_id=(select auth.uid())
  ) then raise exception 'not_manager'; end if;
  return pg_catalog.nextval('public.quote_number_seq'::regclass);
end;
$quote_manager_only$;
revoke all on function public.get_next_order_number() from public,anon,authenticated;
revoke all on function public.get_next_quote_number() from public,anon,authenticated;
grant execute on function public.get_next_order_number() to authenticated;
grant execute on function public.get_next_quote_number() to authenticated;
commit;
