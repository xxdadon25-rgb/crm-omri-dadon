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
  -- The manager must receive the same saved numbers and product details
  -- that the agent submitted. No stock deduction or implicit invoice.
  if o.subtotal<>100 or o.vat_rate<>18 or o.vat_amount<>18 or o.total<>118
     or o.gross_total<>100 or o.discount_amount<>0
     or pg_catalog.jsonb_array_length(o.items)<>1
     or (o.items->0->>'name') is null
     or (o.items->0->>'product_id')::uuid
        <>'44444444-4444-4444-8444-444444444444'::uuid
     or (o.items->0->>'quantity')::numeric<>10
     or (o.items->0->>'unit_price')::numeric<>10
     or (o.items->0->>'total')::numeric<>100
  then raise exception 'manager order detail or totals do not match agent submission'; end if;
  if exists(select 1 from public.invoices i where i.order_id=o.id)
  then raise exception 'agent order incorrectly generated invoice automatically'; end if;
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
-- A manager-created invoice should preserve the same VAT-inclusive total
-- and belong to the same assigned client/order, with no hidden duplicate.
do $invoice_handoff$
declare o public.orders; i public.invoices; n integer;
begin
 select * into o from public.orders
 where id='aaaaaaaa-1111-4111-8111-111111111111';
 select * into i from public.invoices
 where id='59595959-5959-4959-8959-595959595951';
 if i.total is distinct from o.total or i.vat_rate is distinct from o.vat_rate
    or i.user_id is distinct from o.user_id
    or i.customer_id is distinct from o.customer_id
    or i.order_id is distinct from o.id
 then raise exception 'manager invoice does not match the agent order'; end if;
 select count(*) into n from public.invoices where order_id=o.id;
 if n<>1 then raise exception 'missing or duplicate invoice in handoff'; end if;
end $invoice_handoff$;
select 'agent order -> owner queue -> manager invoice -> assigned agent read PASS' as result;
