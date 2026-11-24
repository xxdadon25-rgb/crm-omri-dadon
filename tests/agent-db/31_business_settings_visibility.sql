-- Disposable PostgreSQL ONLY. Stage 27 removes anonymous SELECT
-- on tables containing QuickStock business/API credentials. No real values
-- are queried or copied.
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $owner$
declare n int;
begin
 select count(*) into n from public.business_settings;
 if n<>1 then raise exception 'owner business settings read broken: %',n; end if;
end $owner$;

set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $agent$
declare n int;
begin
 select count(*) into n from public.business_settings;
 if n<>0 then raise exception 'agent exposed owner settings: %',n; end if;
end $agent$;

set request.jwt.claim.sub='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $portal$
declare n int;
begin
 select count(*) into n from public.business_settings;
 if n<>0 then raise exception 'portal exposed owner settings: %',n; end if;
end $portal$;

set role anon;
reset request.jwt.claim.sub;
do $anon$
declare denied boolean:=false;
begin
 begin
  perform * from public.business_settings limit 1;
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'anonymous business settings still readable'; end if;
end $anon$;
reset role;
reset request.jwt.claim.sub;
select 'owner settings preserved; agent/portal/anonymous settings read denied PASS' as result;
