-- STAGED ONLY, NEVER RUN ON LIVE QUICKSTOCK WITHOUT EXPLICIT APPROVAL.
-- Existing production explicitly grants sequence usage/update to anon and
-- authenticated. An agent can bypass the manager-only number RPC with raw
-- nextval unless the direct privileges are also revoked.
-- Existing application callers should use the SECURITY DEFINER wrappers;
-- verify compatibility of all old clients against restored DB before applying.
begin;

revoke usage,update on sequence public.order_number_seq,public.quote_number_seq
 from public,anon,authenticated;

create or replace function public.get_next_order_number()
returns bigint language plpgsql security definer set search_path=''
as $number_guard_order$
begin
 if exists (
   select 1 from public.sales_agent_profiles ap
   where ap.auth_user_id=(select auth.uid())
 ) then raise exception 'agent_legacy_rpc_forbidden'; end if;
 return pg_catalog.nextval('public.order_number_seq'::regclass);
end;
$number_guard_order$;

create or replace function public.get_next_quote_number()
returns bigint language plpgsql security definer set search_path=''
as $number_guard_quote$
begin
 if exists (
   select 1 from public.sales_agent_profiles ap
   where ap.auth_user_id=(select auth.uid())
 ) then raise exception 'agent_legacy_rpc_forbidden'; end if;
 return pg_catalog.nextval('public.quote_number_seq'::regclass);
end;
$number_guard_quote$;

-- Replacing functions retains grants in PostgreSQL; explicitly keep the
-- existing no-login remote invocation roles unchanged pending rollout audit.
revoke all on function public.get_next_order_number() from public;
revoke all on function public.get_next_quote_number() from public;
grant execute on function public.get_next_order_number() to authenticated,anon;
grant execute on function public.get_next_quote_number() to authenticated,anon;
commit;
