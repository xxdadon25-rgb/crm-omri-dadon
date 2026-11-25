-- SYNTHETIC POSTGRES ONLY: agent can read assigned customer invoice,
-- manager-recorded payment and issued credit, but NOT unassigned records.
-- No production data and no user-facing financial mutation is performed.
reset role;
reset request.jwt.claim.sub;
insert into public.invoices(id,user_id,customer_id,total,vat_rate)
values
('46464646-4646-4464-8464-464646464641',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',118,18),
('46464646-4646-4464-8464-464646464642',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '22222222-2222-4222-8222-222222222222',236,18);
insert into public.payments
(id,user_id,customer_id,invoice_id,amount,payment_date,payment_method,status)
values
('47474747-4747-4474-8474-474747474741',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '46464646-4646-4464-8464-464646464641',50,current_date,'test','אושר'),
('47474747-4747-4474-8474-474747474742',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '22222222-2222-4222-8222-222222222222',
 '46464646-4646-4464-8464-464646464642',30,current_date,'test','אושר');
insert into public.credit_notes
(id,user_id,customer_id,invoice_id,credit_note_number,
 total,finbot_status,external_credit_note_number)
values
('48484848-4848-4484-8484-484848484841',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '46464646-4646-4464-8464-464646464641',
 'TEST-AGENT-CREDIT-A',-10,'confirmed','TEST-EXT-A'),
('48484848-4848-4484-8484-484848484842',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '22222222-2222-4222-8222-222222222222',
 '46464646-4646-4464-8464-464646464642',
 'TEST-AGENT-CREDIT-B',-10,'confirmed','TEST-EXT-B');

set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $visibility$
declare
 visible_invoice integer;visible_payment integer;visible_credit integer;
 other_invoice integer;other_payment integer;other_credit integer;
 changed integer;
begin
 select count(*) into visible_invoice from public.invoices where
 id='46464646-4646-4464-8464-464646464641';
 select count(*) into visible_payment from public.payments where
 id='47474747-4747-4474-8474-474747474741';
 select count(*) into visible_credit from public.credit_notes where
 id='48484848-4848-4484-8484-484848484841';
 select count(*) into other_invoice from public.invoices where
 id='46464646-4646-4464-8464-464646464642';
 select count(*) into other_payment from public.payments where
 id='47474747-4747-4474-8474-474747474742';
 select count(*) into other_credit from public.credit_notes where
 id='48484848-4848-4484-8484-484848484842';
 if visible_invoice<>1 or visible_payment<>1 or visible_credit<>1
    or other_invoice<>0 or other_payment<>0 or other_credit<>0 then
   raise exception 'agent financial scope wrong invoices %/% payments %/% credits %/%',
     visible_invoice,other_invoice,visible_payment,other_payment,
     visible_credit,other_credit;
 end if;
 -- Payment document visibility is READ ONLY, including on an assigned client.
 update public.payments set amount=0
 where id='47474747-4747-4474-8474-474747474741';
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'agent changed received amount'; end if;
 delete from public.credit_notes
 where id='48484848-4848-4484-8484-484848484841';
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'agent deleted client credit'; end if;
end $visibility$;
reset role;
reset request.jwt.claim.sub;

-- Assignment removal must immediately revoke all three financial reads.
delete from public.sales_agent_customer_assignments where
 customer_id='11111111-1111-4111-8111-111111111111'
 and agent_auth_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $revoked$
declare n integer;
begin
 select count(*) into n from public.invoices where
 id='46464646-4646-4464-8464-464646464641';
 if n<>0 then raise exception 'revoked agent still sees invoice'; end if;
 select count(*) into n from public.payments where
 id='47474747-4747-4474-8474-474747474741';
 if n<>0 then raise exception 'revoked agent still sees receipt'; end if;
 select count(*) into n from public.credit_notes where
 id='48484848-4848-4484-8484-484848484841';
 if n<>0 then raise exception 'revoked agent still sees credit'; end if;
end $revoked$;
reset role;
reset request.jwt.claim.sub;
insert into public.sales_agent_customer_assignments(customer_id,agent_auth_id)
values('11111111-1111-4111-8111-111111111111',
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select 'assigned invoice/payment/credit reads, denied writes and instant revocation PASS' as result;
