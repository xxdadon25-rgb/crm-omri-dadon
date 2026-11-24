-- Disposable PostgreSQL ONLY. Exercises activation after a disabled registry entry exists.
set role authenticated;
set request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
declare rejected boolean:=false;
begin
 begin
   perform public.sales_agent_activate('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 exception when others then rejected=(sqlerrm='not_manager'); end;
 if not rejected then raise exception 'self activation accepted'; end if;
end $$;

set request.jwt.claim.sub='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $$
declare rejected boolean:=false;
begin
 begin
   perform public.sales_agent_activate('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 exception when others then rejected=(sqlerrm='not_manager'); end;
 if not rejected then raise exception 'portal caller activation accepted'; end if;
end $$;

set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
declare ok boolean; active boolean; rejected boolean:=false;
begin
 ok:=public.sales_agent_activate('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 if not ok then raise exception 'manager activation failed'; end if;
 select is_active into active from public.sales_agent_profiles
 where auth_user_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 if not active then raise exception 'activation did not persist'; end if;
 if not public.sales_agent_activate('cccccccc-cccc-4ccc-8ccc-cccccccccccc')
 then raise exception 'repeat activation failed'; end if;

 rejected:=false;
 begin
   perform public.sales_agent_activate('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
 exception when others then rejected=(sqlerrm='agent_not_found'); end;
 if not rejected then raise exception 'portal identity activation accepted'; end if;

 rejected:=false;
 begin
   perform public.sales_agent_activate('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
 exception when others then rejected=(sqlerrm='agent_not_found'); end;
 if not rejected then raise exception 'foreign identity activation accepted'; end if;

 if not public.sales_agent_disable('cccccccc-cccc-4ccc-8ccc-cccccccccccc')
 then raise exception 'manager disable failed'; end if;
 select is_active into active from public.sales_agent_profiles
 where auth_user_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 if active then raise exception 'disable did not revoke agent'; end if;
end $$;

-- A previously registered disabled identity must not become an agent
-- if the account was subsequently added to the CRM staff registry.
reset role;
insert into public.staff_members(id,auth_user_id)
values ('46464646-4646-4464-8464-464646464646',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $
declare rejected boolean:=false;
begin
 begin
   perform public.sales_agent_activate('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 exception when others then rejected=(sqlerrm='agent_identity_conflict'); end;
 if not rejected then raise exception 'staff identity activated as agent'; end if;
end $;

reset role;
reset request.jwt.claim.sub;
select 'manager-only activation, idempotency, disable PASS' as result;
