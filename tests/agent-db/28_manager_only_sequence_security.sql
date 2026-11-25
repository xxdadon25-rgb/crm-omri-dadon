-- Disposable regression after manager-only number wrappers.
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $manager$
declare a bigint; b bigint;
begin
 select public.get_next_order_number() into a;
 select public.get_next_order_number() into b;
 if b<>a+1 then raise exception 'manager order counter broke'; end if;
 select public.get_next_quote_number() into a;
 select public.get_next_quote_number() into b;
 if b<>a+1 then raise exception 'manager quote counter broke'; end if;
end $manager$;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $agent$
declare denied boolean:=false;
begin
 begin perform public.get_next_order_number();
 exception when others then denied=(sqlerrm='not_manager'); end;
 if not denied then raise exception 'agent could get manager order number'; end if;
 denied:=false;
 begin perform public.get_next_quote_number();
 exception when others then denied=(sqlerrm='not_manager'); end;
 if not denied then raise exception 'agent could get manager quote number'; end if;
end $agent$;
set request.jwt.claim.sub='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $portal$
declare denied boolean:=false;
begin
 begin perform public.get_next_order_number();
 exception when others then denied=(sqlerrm='not_manager'); end;
 if not denied then raise exception 'portal allocated owner order counter'; end if;
 denied:=false;
 begin perform public.get_next_quote_number();
 exception when others then denied=(sqlerrm='not_manager'); end;
 if not denied then raise exception 'portal allocated owner quote counter'; end if;
end $portal$;
set request.jwt.claim.sub='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
do $other$
declare denied boolean:=false;
begin
 begin perform public.get_next_order_number();
 exception when others then denied=(sqlerrm='not_manager'); end;
 if not denied then raise exception 'other nonmanager advanced owner counter'; end if;
end $other$;
set role anon;
reset request.jwt.claim.sub;
do $anon$
declare denied boolean:=false;
begin
 begin perform public.get_next_order_number();
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'anonymous order counter call succeeded'; end if;
 denied:=false;
 begin perform public.get_next_quote_number();
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'anonymous quote counter call succeeded'; end if;
end $anon$;
reset role;
reset request.jwt.claim.sub;
select 'legacy sequence manager-only wrappers reject agent, portal and anonymous PASS' as result;
