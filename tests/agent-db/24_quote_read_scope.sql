-- Disposable PostgreSQL regression for production's real
-- public_read_quotes USING(true) coexistence with the agent RLS policy.
-- Installed after the manager/customer/agent fixtures are created.
reset role;
reset request.jwt.claim.sub;
insert into public.quotes(id,user_id,customer_id) values
('83838383-8383-4838-8838-838383838381',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111'),
('83838383-8383-4838-8838-838383838382',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '22222222-2222-4222-8222-222222222222'),
('83838383-8383-4838-8838-838383838383',
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
 '33333333-3333-4333-8333-333333333333');
-- Match the ACTUAL verified legacy policy, not the simplified old fixture.
create policy public_read_quotes on public.quotes for select to public using (true);
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $agent_quotes$
declare n integer;
begin
 select count(*) into n from public.quotes;
 if n<>1 then raise exception 'agent read % quotes instead of assigned one',n; end if;
 if not exists(select 1 from public.quotes
   where customer_id='11111111-1111-4111-8111-111111111111')
 then raise exception 'agent could not read assigned quote'; end if;
 if exists(select 1 from public.quotes
   where customer_id<>'11111111-1111-4111-8111-111111111111')
 then raise exception 'agent leaked unassigned or foreign quote'; end if;
end $agent_quotes$;

-- Preserve existing legacy non-agent portal SELECT behavior.
set request.jwt.claim.sub='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $portal_quotes$
declare n integer;
begin
 select count(*) into n from public.quotes;
 if n<>3 then raise exception 'portal quote read changed: %',n; end if;
end $portal_quotes$;

-- Manager access must remain identical to pre-feature legacy policy.
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $manager_quotes$
declare n integer;
begin
 select count(*) into n from public.quotes;
 if n<>3 then raise exception 'manager quote read unexpectedly narrowed: %',n; end if;
end $manager_quotes$;

-- Removing the agent assignment immediately revokes quote access despite
-- the legacy public-read permissive policy. Restored only in disposable DB.
reset role;
delete from public.sales_agent_customer_assignments
 where agent_auth_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
 and customer_id='11111111-1111-4111-8111-111111111111';
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $revoked_quotes$
declare n integer;
begin
 select count(*) into n from public.quotes;
 if n<>0 then raise exception 'revoked agent leaked quotes: %',n; end if;
end $revoked_quotes$;
reset role;
insert into public.sales_agent_customer_assignments(customer_id,agent_auth_id)
 values('11111111-1111-4111-8111-111111111111',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
 on conflict do nothing;
reset request.jwt.claim.sub;
select 'agent quotes isolated despite legacy public-read policy PASS' as result;
