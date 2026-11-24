-- Synthetic DB: validate that the real stock audit trigger records both
-- manager fulfillment and restoration without duplicate audit entries.
do $audit_realistic$
declare down_count integer;up_count integer;other_count integer;
begin
 select count(*) into down_count from public.inventory_movements
 where product_id='91919191-9191-4919-8919-919191919191'
   and movement_type='הפחתה' and quantity=3
   and quantity_before=20 and quantity_after=17;
 select count(*) into up_count from public.inventory_movements
 where product_id='91919191-9191-4919-8919-919191919191'
   and movement_type='תוספת' and quantity=3
   and quantity_before=17 and quantity_after=20;
 select count(*) into other_count from public.inventory_movements
 where product_id='91919191-9191-4919-8919-919191919191'
   and (quantity<>3 or movement_type not in ('הפחתה','תוספת'));
 if down_count<>1 or up_count<>1 or other_count<>0 then
   raise exception 'existing audit trigger unexpected movements: % down/% up/% other',
     down_count,up_count,other_count;
 end if;
 if not exists(
  select 1 from public.inventory_movements
  where product_id='55555555-5555-4555-8555-555555555555'
    and movement_type='הפחתה'
 ) or not exists(
  select 1 from public.inventory_movements
  where product_id='55555555-5555-4555-8555-555555555555'
    and movement_type='תוספת'
 ) then raise exception 'approved-exception stock changes not audited'; end if;
end $audit_realistic$;
select 'owner stock actions retain existing product movement audit PASS' as result;
