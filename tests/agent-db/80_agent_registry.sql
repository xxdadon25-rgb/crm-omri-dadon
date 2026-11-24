-- Disposable PostgreSQL manager/agent registry permissions.
reset role;
reset request.jwt.claim.sub;
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $test$
declare p public.sales_agent_profiles; n integer; done boolean;
begin
 p:=public.sales_agent_register_disabled(
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc','New Agent',8);
 if p.is_active or p.owner_auth_id<>auth.uid()
 then raise exception 'new agent must stay disabled'; end if;
 p:=public.sales_agent_register_disabled(
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc','New Agent',8);
 if p.is_active then raise exception 'duplicate registration activated agent'; end if;
 select count(*) into n from public.sales_agent_profiles
 where auth_user_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 if n<>1 then raise exception 'duplicate agent profile'; end if;

 done:=public.sales_agent_set_customer_assignment(
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 '22222222-2222-4222-8222-222222222222',true);
 if not done then raise exception 'assignment failed'; end if;
 select count(*) into n from public.sales_agent_customer_assignments
 where agent_auth_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 if n<>1 then raise exception 'assignment not persisted'; end if;

 done:=false;
 begin
   perform public.sales_agent_set_customer_assignment(
     'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
     '33333333-3333-4333-8333-333333333333',true);
 exception when others then done=(sqlerrm='customer_not_owned'); end;
 if not done then raise exception 'manager assigned foreign business customer'; end if;

 done:=false;
 begin
   perform public.sales_agent_register_disabled(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Owner',8);
 exception when others then done=(sqlerrm='invalid_agent_identity'); end;
 if not done then raise exception 'manager identity became agent'; end if;
 done:=false;
 begin
   perform public.sales_agent_register_disabled(
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd','Portal Identity',8);
 exception when others then done=(sqlerrm='portal_identity_cannot_be_agent'); end;
 if not done then raise exception 'customer portal identity registered as agent'; end if;

 -- Reassignment changes CURRENT data visibility, NOT immutable attribution.
 perform public.sales_agent_set_customer_assignment(
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   '11111111-1111-4111-8111-111111111111',false);
end $test$;

set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $test$
declare n integer; denied boolean:=false;
begin
 select count(*) into n from public.customers
 where id='11111111-1111-4111-8111-111111111111';
 if n<>0 then raise exception 'unassigned customer still visible to agent'; end if;
 begin
  perform public.sales_agent_set_customer_assignment(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222',true);
 exception when others then denied=(sqlerrm='not_manager'); end;
 if not denied then raise exception 'agent assigned own customers'; end if;
end $test$;

set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $test$
declare done boolean;
begin
 done:=public.sales_agent_set_customer_assignment(
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   '11111111-1111-4111-8111-111111111111',true);
 if not done then raise exception 'cannot restore original assignment'; end if;
 done:=public.sales_agent_disable(
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if not done then raise exception 'agent disable failed'; end if;
end $test$;

set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $test$
declare n integer;
begin
 select count(*) into n from public.customers
 where id='11111111-1111-4111-8111-111111111111';
 if n<>0 then raise exception 'disabled agent still sees customer'; end if;
 -- Commission preview must also be revoked, including via a forged direct
 -- RPC request that bypasses the hidden agent navigation.

 begin
   perform public.sales_agent_commission_preview();
   raise exception 'disabled agent accessed commission preview';
 exception when others then
   if sqlerrm<>'agent_not_active' then raise; end if;
 end;
end $test$;
reset role;
reset request.jwt.claim.sub;
select 'manager-only disabled agents, tenant-safe customer assignment, immediate revocation PASS' as result;
