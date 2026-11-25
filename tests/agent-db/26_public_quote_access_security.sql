-- Disposable PostgreSQL after stage 25 and earlier quote fixture.
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $agent$
declare n int;
begin
 select count(*) into n from public.quotes;
 if n<>1 then raise exception 'agent scope changed or leaked after global quote closure: %',n; end if;
end $agent$;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $owner$
declare n int;
begin
 select count(*) into n from public.quotes;
 if n<>2 then raise exception 'owner expected only own two quotes: %',n; end if;
end $owner$;
set request.jwt.claim.sub='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $portal$
declare n int;
begin
 select count(*) into n from public.quotes;
 if n<>1 then raise exception 'portal leaked unassigned or foreign quotes: %',n; end if;
end $portal$;
set request.jwt.claim.sub='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
do $other_owner$
declare n int;
begin
 select count(*) into n from public.quotes;
 if n<>1 then raise exception 'other owner scope altered: %',n; end if;
end $other_owner$;
set role anon;
reset request.jwt.claim.sub;
do $anonymous$
declare n int;
begin
 select count(*) into n from public.quotes;
 if n<>0 then raise exception 'anonymous public quotes still exposed: %',n; end if;
end $anonymous$;
reset role;
reset request.jwt.claim.sub;
select 'quote RLS: manager/agent/portal/other owner scoped, anonymous denied PASS' as result;
