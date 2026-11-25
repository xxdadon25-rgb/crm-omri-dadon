-- Disposable PostgreSQL only: precise existing legacy privileges
-- and SECURITY DEFINER sequence wrappers, copied from live introspection.
create sequence public.order_number_seq start with 10000;
create sequence public.quote_number_seq start with 20000;
grant usage,update on sequence public.order_number_seq,public.quote_number_seq
 to authenticated,anon;
create or replace function public.get_next_order_number()
returns bigint language sql security definer
as $old_order$ select nextval('order_number_seq'); $old_order$;
create or replace function public.get_next_quote_number()
returns bigint language sql security definer
as $old_quote$ select nextval('quote_number_seq'); $old_quote$;
grant execute on function public.get_next_order_number() to authenticated,anon;
grant execute on function public.get_next_quote_number() to authenticated,anon;
