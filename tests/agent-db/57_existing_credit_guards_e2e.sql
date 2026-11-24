-- Disposable DB only: actual production Finbot and reservation triggers
-- must stop unsafe refund mutations and permit justified resolution.
reset role;
insert into public.credit_notes(
 id,user_id,customer_id,invoice_id,credit_note_number,
 operation_id,items,total,finbot_status
) values(
 '84848484-8484-4848-8848-848484848481',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '88888888-8888-4888-8888-888888888888',
 'TEST-RESERVED-1',
 '84848484-8484-4848-8848-848484848482',
 '[{"name":"test","quantity":1}]'::jsonb,-10,'uncertain'
);
do $credit_guard$
declare blocked boolean; status text; noted text;
begin
 blocked:=false;
 begin
  update public.credit_notes set total=-11
  where id='84848484-8484-4848-8848-848484848481';
 exception when check_violation then blocked:=true; end;
 if not blocked then raise exception 'reserved credit total mutated'; end if;
 blocked:=false;
 begin
  update public.credit_notes set items='[]'::jsonb
  where id='84848484-8484-4848-8848-848484848481';
 exception when check_violation then blocked:=true; end;
 if not blocked then raise exception 'reserved credit lines mutated'; end if;
 blocked:=false;
 begin
  update public.credit_notes set finbot_status='pending'
  where id='84848484-8484-4848-8848-848484848481';
 exception when others then blocked:=true; end;
 if not blocked then raise exception 'uncertain Finbot state retried'; end if;
 blocked:=false;
 begin
  update public.credit_notes set finbot_status='failed'
  where id='84848484-8484-4848-8848-848484848481';
 exception when others then blocked:=true; end;
 if not blocked then raise exception 'Finbot failure allowed without evidence'; end if;
 update public.credit_notes
 set finbot_status='failed',
 finbot_resolution_note='SYNTHETIC fixture: verified no external document'
 where id='84848484-8484-4848-8848-848484848481';
 select finbot_status,finbot_resolution_note into status,noted
 from public.credit_notes
 where id='84848484-8484-4848-8848-848484848481';
 if status<>'failed' or noted is null
 then raise exception 'evidence-backed failure transition denied'; end if;
 update public.credit_notes set finbot_status='confirmed'
 where id='84848484-8484-4848-8848-848484848481';
 blocked:=false;
 begin
  update public.credit_notes set finbot_status='failed'
  where id='84848484-8484-4848-8848-848484848481';
 exception when others then blocked:=true; end;
 if not blocked then raise exception 'confirmed Finbot credit modified'; end if;
end $credit_guard$;
select 'reserved credit and Finbot state guards PASS' as result;
