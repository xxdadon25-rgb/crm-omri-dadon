-- PREPARATION ONLY — DO NOT APPLY TO PRODUCTION.
-- Existing save_order_with_inventory marks orders.fulfilled after handling
-- inventory. A separate delivery-alert row follows THAT verified state.
-- Do not create a second fulfillment button or bypass inventory deductions.
-- Nothing here changes financial status (e.g. "הושלם" when invoice paid).
begin;

create or replace function public.sales_agent_sync_delivery_alert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.fulfilled is distinct from old.fulfilled then
    update public.sales_agent_delivery_alerts a
       set closed_at=case
         when new.fulfilled is true then transaction_timestamp()
         else null
       end
     where a.order_id=new.id
       and exists (
         select 1 from public.sales_agent_order_attributions att
         where att.order_id=new.id and att.agent_auth_id=a.agent_auth_id
       );
  end if;
  return new;
end;
$$;

revoke all on function public.sales_agent_sync_delivery_alert()
from public,anon,authenticated;

drop trigger if exists trg_sales_agent_sync_delivery_alert on public.orders;
create trigger trg_sales_agent_sync_delivery_alert
after update of fulfilled on public.orders
for each row execute function public.sales_agent_sync_delivery_alert();

commit;

-- Test on restored data with the ORIGINAL save_order_with_inventory function
-- (not by directly setting fulfilled); validate stock + status regression.
-- Updating invoice payment / financial status must NOT close delivery alert.
