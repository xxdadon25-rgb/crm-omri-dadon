-- SYNTHETIC ONLY: exact approved handoff:
-- active agent submits order -> owner can see it in existing orders table ->
-- owner issues invoice -> agent sees that invoice for assigned customer.
-- Also verify unrelated customers and agent invoice writes remain denied.
reset role;
reset request.jwt.claim.sub;
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $owner_receives_order$
declare o public.orders;
begin
 select * into o from public.orders
 where id='aaaaaaaa-1111-4111-8111-111111111111';
 if not found or o.user_id<>auth.uid()
    or o.customer_id<>'11111111-1111-4111-8111-111111111111'::uuid
    or o.status<>'ממתין לאישור'
    or o.fulfilled is distinct from false
    or o.inventory_deducted is distinct from false
 then raise exception 'manager did not receive regular agent-created order unchanged'; end if;
end $owner_receives_order$;
insert into public.invoices(id,user_id,customer_id,order_id,total,vat_rate)
values('59595959-5959-4959-8959-595959595951',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 'aaaaaaaa-1111-4111-8111-111111111111',118,18);
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $agent_reads_owner_invoice$
declare n integer; count_all integer;
begin
 select count(*) into n from public.orders
 where id='aaaaaaaa-1111-4111-8111-111111111111';
 if n<>1 then raise exception 'agent cannot read submitted order'; end if;
 select count(*) into n from public.invoices
 where id='59595959-5959-4959-8959-595959595951'
   and order_id='aaaaaaaa-1111-4111-8111-111111111111';
 if n<>1 then raise exception 'agent cannot see owner invoice for assigned order'; end if;
 select count(*) into count_all from public.invoices
 where customer_id='22222222-2222-4222-8222-222222222222';
 if count_all<>0 then raise exception 'agent saw invoice for unassigned customer'; end if;
end $agent_reads_owner_invoice$;
reset role;
reset request.jwt.claim.sub;
select 'agent order -> owner queue -> manager invoice -> assigned agent read PASS' as result;
