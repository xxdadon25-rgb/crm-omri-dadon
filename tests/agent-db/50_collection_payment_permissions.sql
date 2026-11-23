-- Disposable PostgreSQL synthetic permission test only.
-- Workflow: manager records payment, agent sees it, agent never changes it.
-- No financial operation is executed against production.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.payments(id,user_id,customer_id)
values(
 'dededede-dede-4ede-8ede-dededededede',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111'
);

set request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
declare n integer; blocked boolean;
begin
 select count(*) into n from public.payments
 where id='dededede-dede-4ede-8ede-dededededede';
 if n<>1 then raise exception 'agent cannot see manager-recorded payment'; end if;

 -- RLS restricted update/delete must return zero affected rows; no bypass.
 update public.payments set customer_id=
  '22222222-2222-4222-8222-222222222222'
 where id='dededede-dede-4ede-8ede-dededededede';
 get diagnostics n=row_count;
 if n<>0 then raise exception 'agent updated payment'; end if;

 delete from public.payments
 where id='dededede-dede-4ede-8ede-dededededede';
 get diagnostics n=row_count;
 if n<>0 then raise exception 'agent deleted payment'; end if;

 blocked:=false;
 begin
   insert into public.payments(id,user_id,customer_id)
   values(
    'fefefefe-fefe-4efe-8efe-fefefefefefe',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '11111111-1111-4111-8111-111111111111'
   );
 exception when insufficient_privilege then blocked:=true;
 end;
 if not blocked then raise exception 'agent inserted payment'; end if;
end $$;

-- Another authenticated account must see no receipt belonging to this business.
set request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $$
declare n integer;
begin
 select count(*) into n from public.payments
 where id='dededede-dede-4ede-8ede-dededededede';
 if n<>0 then raise exception 'unrelated portal identity sees payment'; end if;
end $$;
reset role;
reset request.jwt.claim.sub;
select 'manager recorded, agent read-only payment visibility PASS' as result;
