-- Synthetic database only. No actual customer/product/order data.
-- Run with a disposable PostgreSQL instance, never a Supabase production URL.
create role authenticated nologin;
create role anon nologin;
create schema auth;
create schema extensions;
create extension if not exists pgcrypto with schema extensions;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth,public to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
create table auth.users(id uuid primary key);
insert into auth.users values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

create table public.customers(
  id uuid primary key,
  created_date timestamptz default now(),
  user_id uuid not null references auth.users(id),
  name text not null, contact_person text, phone text, mobile text,
  email text,address text,city text,tax_id text,notes text
);
create table public.products(
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  name text, buy_price numeric, sell_price numeric,
  is_active boolean default true,
  quantity numeric default 100
);
create table public.orders(
  id uuid primary key,
  created_date timestamptz default now(),
  user_id uuid not null references auth.users(id),
  order_number integer, customer_id uuid,
  customer_name text,customer_tax_id text,date date,
  items jsonb,subtotal numeric,gross_total numeric,
  discount_amount numeric,vat_rate numeric,vat_amount numeric,
  total numeric,notes text,status text,fulfilled boolean,
  inventory_deducted boolean,agent text
);
create table public.invoices(
  id uuid primary key,user_id uuid references auth.users(id),
  customer_id uuid,order_id uuid
);
create table public.payments(
  id uuid primary key,user_id uuid references auth.users(id),
  customer_id uuid
);
create table public.quotes(
  id uuid primary key,user_id uuid references auth.users(id),
  customer_id uuid
);
create table public.credit_notes(
  id uuid primary key,user_id uuid references auth.users(id),
  customer_id uuid
);
create table public.customer_product_prices(
  customer_id uuid references public.customers(id),
  product_id uuid references public.products(id),
  unit_price numeric,
  primary key(customer_id,product_id)
);
create table public.business_settings(
  id uuid primary key,
  created_date timestamptz default now(),
  user_id uuid not null references auth.users(id),
  order_counter integer,vat_rate numeric
);

do $$
declare t text;
begin
  foreach t in array array['customers','products','orders','invoices',
    'payments','quotes','credit_notes','customer_product_prices']
  loop
    execute format('alter table public.%I enable row level security',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated,anon',t);
  end loop;
end $$;
grant select,update on public.business_settings to authenticated;

create policy customers_select on public.customers for select to authenticated
  using(user_id=auth.uid());
create policy customers_insert on public.customers for insert to authenticated
  with check(user_id=auth.uid());
create policy customers_update on public.customers for update to authenticated
  using(user_id=auth.uid()) with check(user_id=auth.uid());
-- Recreate the known unsafe legacy policies; 04 fixes them.
create policy customers_delete on public.customers for delete using(true);

create policy products_select on public.products for select to authenticated
  using(user_id=auth.uid());
create policy products_insert on public.products for insert to authenticated
  with check(user_id=auth.uid());
create policy products_update on public.products for update to authenticated
  using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy products_delete on public.products for delete using(true);

do $$
declare t text;
begin
  foreach t in array array['orders','invoices','payments','quotes','credit_notes']
  loop
    execute format('create policy owner_read on public.%I for select to authenticated using(user_id=auth.uid())',t);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check(user_id=auth.uid())',t);
    execute format('create policy owner_update on public.%I for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid())',t);
    execute format('create policy owner_delete on public.%I for delete to authenticated using(user_id=auth.uid())',t);
  end loop;
end $$;

create policy customer_prices_portal on public.customer_product_prices
  for select to authenticated using(false);

insert into public.customers(id,user_id,name) values
('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Assigned Test Customer'),
('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Unassigned Test Customer'),
('33333333-3333-4333-8333-333333333333','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Foreign Owner Customer');

insert into public.products(id,user_id,name,buy_price,sell_price) values
('44444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Test unit-priced product',6,10),
('55555555-5555-4555-8555-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Under-margin product',7,10),
('66666666-6666-4666-8666-666666666666','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Foreign product',1,10);

insert into public.orders(id,user_id,order_number,customer_id,customer_name)
values('77777777-7777-4777-8777-777777777777',
'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1000,
'11111111-1111-4111-8111-111111111111','Assigned Test Customer');
insert into public.invoices(id,user_id,customer_id)
values('88888888-8888-4888-8888-888888888888',
'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
'11111111-1111-4111-8111-111111111111');

insert into public.business_settings(id,user_id,order_counter,vat_rate)
values('99999999-9999-4999-8999-999999999999',
'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1000,18);

-- New role membership and assignments are inserted after staged schema 01.
