-- Disposable PostgreSQL only. The configured role grants mirror the
-- real production sequence privileges reported in read-only inspection.
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $agent_numbers$
declare rejected boolean;
begin
 rejected:=false;
 begin perform public.get_next_order_number();
 exception when others then rejected=(sqlerrm='agent_legacy_rpc_forbidden'); end;
 if not rejected then raise exception 'agent could invoke owner order counter RPC'; end if;
 rejected:=false;
 begin perform public.get_next_quote_number();
 exception when others then rejected=(sqlerrm='agent_legacy_rpc_forbidden'); end;
 if not rejected then raise exception 'agent could invoke quote counter RPC'; end if;

 rejected:=false;
 begin perform pg_catalog.nextval('public.order_number_seq'::regclass);
 exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'agent bypassed guarded order RPC through raw sequence'; end if;
 rejected:=false;
 begin perform pg_catalog.nextval('public.quote_number_seq'::regclass);
 exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'agent bypassed guarded quote RPC through raw sequence'; end if;
end $agent_numbers$;

-- Existing management paths must still get numbers using the same public
-- zero-argument function names. Portal is also allowed, consistent with
-- previous RPC EXECUTE grants; only its raw sequence privilege changes.
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $manager_numbers$
declare n1 bigint;n2 bigint;
begin
 select public.get_next_order_number() into n1;
 select public.get_next_order_number() into n2;
 if n2<>n1+1 then raise exception 'owner order sequence wrapper broken'; end if;
 select public.get_next_quote_number() into n1;
 select public.get_next_quote_number() into n2;
 if n2<>n1+1 then raise exception 'owner quote sequence wrapper broken'; end if;
end $manager_numbers$;

set request.jwt.claim.sub='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $portal_numbers$
declare n bigint;
begin
 select public.get_next_order_number() into n;
 if n<10000 then raise exception 'existing portal-visible order number RPC changed'; end if;
 select public.get_next_quote_number() into n;
 if n<20000 then raise exception 'existing portal-visible quote number RPC changed'; end if;
end $portal_numbers$;

-- A disabled registered agent is STILL not allowed to call legacy APIs.
reset role;
update public.sales_agent_profiles set is_active=false
 where auth_user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $disabled_numbers$
declare rejected boolean:=false;
begin
 begin perform public.get_next_order_number();
 exception when others then rejected=(sqlerrm='agent_legacy_rpc_forbidden'); end;
 if not rejected then raise exception 'disabled registered agent used legacy counter'; end if;
end $disabled_numbers$;
reset role;
update public.sales_agent_profiles set is_active=true
 where auth_user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
reset request.jwt.claim.sub;
select 'agents cannot increment counters; management RPC still works PASS' as result;
