-- Synthetic-only metadata parity: reproduces the production inventory
-- movement audit trigger, using NO real products, orders or customer data.
-- Inspected against public.log_product_quantity_change on 2026-11-24.
create table public.inventory_movements (
 id uuid primary key default gen_random_uuid(),
 created_date timestamptz not null default now(),
 user_id uuid not null,
 product_id uuid not null,
 product_name text,
 product_sku text,
 movement_type text not null,
 quantity numeric not null,
 quantity_before numeric,
 quantity_after numeric,
 reference_type text,
 reference_id uuid,
 reference_number text,
 notes text,
 performed_by text
);
create or replace function public.log_product_quantity_change()
returns trigger language plpgsql set search_path to 'public','pg_temp'
as $audit$
begin
 if old.quantity is not distinct from new.quantity then return new; end if;
 insert into public.inventory_movements (
  user_id,product_id,product_name,product_sku,movement_type,
  quantity,quantity_before,quantity_after,reference_type,
  reference_id,reference_number,notes,performed_by
 ) values (
  new.user_id,new.id,new.name,new.sku,
  case when new.quantity<old.quantity then 'הפחתה' else 'תוספת' end,
  abs(new.quantity-old.quantity),old.quantity,new.quantity,
  case when nullif(current_setting('app.inventory_order_id',true),'') is not null
    then 'הזמנה' else 'עדכון כמות מוצר' end,
  nullif(current_setting('app.inventory_order_id',true),'')::uuid,
  nullif(current_setting('app.inventory_order_number',true),''),
  case when nullif(current_setting('app.inventory_order_id',true),'') is not null
    then 'תיעוד אוטומטי של שינוי כמות בעקבות הזמנה'
    else 'תיעוד אוטומטי של שינוי כמות; סוג הפעולה המקורי לא נשמר במקור העדכון' end,
  coalesce(auth.uid()::text,'מערכת')
 );
 return new;
end;
$audit$;
create trigger trg_log_product_quantity_change
after update on public.products
for each row execute function public.log_product_quantity_change();
