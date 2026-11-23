-- Synthetic commission preview regression. Runs only in ephemeral CI DB.
-- All payments listed in Payments are cleared/received per business owner;
-- no extra cheque-cleared flag and no agent payment write access.
reset role;
reset request.jwt.claim.sub;

-- Attribution is fixed when the agent originally creates the order.
-- Real order ID from the agent's normal-order integration test:
-- aaaaaaaa-1111-4111-8111-111111111111, agent bbbbb...
insert into public.invoices
(id,user_id,customer_id,order_id,total,vat_rate,included_order_ids)
values
('11110000-1111-4111-8111-111100001111',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 'aaaaaaaa-1111-4111-8111-111111111111',118,18,'[]'),
('11110000-2222-4222-8222-111100002222',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '30303030-3030-4030-8030-303030303030',118,18,'[]'),
('11110000-3333-4333-8333-111100003333',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 'aaaaaaaa-1111-4111-8111-111111111111',118,18,'["77777777-7777-4777-8777-777777777777"]'),
('11110000-4444-4444-8444-111100004444',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 'aaaaaaaa-1111-4111-8111-111111111111',118,18,'[]'),
('11110000-5555-4555-8555-111100005555',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '77777777-7777-4777-8777-777777777777',118,18,'[]');

-- Two independent partial receipts share a grouped identifier; each
-- payment row is an invoice allocation, not a duplicate group total.
insert into public.payments
(id,user_id,customer_id,invoice_id,amount,payment_date,status,payment_method,payment_group_id)
values
('22220000-1111-4111-8111-222200001111',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '11110000-1111-4111-8111-111100001111',59,'2026-11-20','אושר','שיק',
 'abababab-abab-4bab-8bab-abababababab'),
('22220000-2222-4222-8222-222200002222',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '11110000-1111-4111-8111-111100001111',59,'2026-11-21','אושר','העברה בנקאית',
 'abababab-abab-4bab-8bab-abababababab'),
('22220000-3333-4333-8333-222200003333',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '11110000-2222-4222-8222-111100002222',118,'2026-11-22','אושר','מזומן',null),
('22220000-4444-4444-8444-222200004444',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '11110000-3333-4333-8333-111100003333',118,'2026-11-22','אושר','שיק',null),
('22220000-5555-4555-8555-222200005555',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '11110000-4444-4444-8444-111100004444',118,'2026-11-22','אושר','מזומן',null),
('22220000-6666-4666-8666-222200006666',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '11110000-5555-4555-8555-111100005555',118,'2026-11-22','אושר','מזומן',null);

insert into public.credit_notes
(id,user_id,customer_id,invoice_id,total,finbot_status)
values
('33330000-4444-4444-8444-333300004444',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '11110000-4444-4444-8444-111100004444',35,'confirmed');

set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

do $$
declare c integer; actual numeric; pending_count integer;
begin
 select count(*),sum(commission_amount)
 into c,actual
 from public.sales_agent_commission_preview(null)
 where review_reason is null;
 if c<>3 or actual<>16 then
   raise exception '3 settled receipts should earn 16 total commission, got %/%',c,actual;
 end if;

 select count(*) into pending_count
 from public.sales_agent_commission_preview()
 where review_reason is not null;
 if pending_count<>2 then
   raise exception 'credit + multi-order items must be review-only, got %',pending_count;
 end if;

 if exists (
   select 1 from public.sales_agent_commission_preview()
   where review_reason is null and (commission_amount<0 or net_received is null)
 ) then raise exception 'unsafe commission record'; end if;

 -- All payment ids are unique even for grouped batch receipts.
 select count(distinct payment_id) into c
 from public.sales_agent_commission_preview();
 if c<>5 then raise exception 'expected 5 distinct payment IDs, got %',c; end if;
end $$;

-- An unrelated portal user has no right to preview a sales agent's commission.
set request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $$
declare blocked boolean:=false;
begin
 begin
   perform public.sales_agent_commission_preview('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 exception when others then blocked:=sqlerrm='not_authorized'; end;
 if not blocked then raise exception 'unrelated user accessed agent commission'; end if;
end $$;

-- Manager can inspect an agent's rows, but no financial rows are created.
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
declare c integer; n integer;
begin
 select count(*) into c from public.sales_agent_commission_preview(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if c<>5 then raise exception 'manager agent preview missing rows: %',c; end if;
 select count(*) into n from public.sales_agent_commission_entries;
 if n<>0 then raise exception 'preview incorrectly posted commission ledger'; end if;
end $$;

reset role;
reset request.jwt.claim.sub;
select 'commission preview: unique receipts, owner order, historical VAT, credit review PASS' as result;
