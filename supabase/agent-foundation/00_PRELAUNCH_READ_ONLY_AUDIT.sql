-- READ-ONLY production preflight queries. Safe to run manually in SQL Editor.
-- NO DDL, DML, permissions, records, customer names, or money mutations.
-- Do not confuse this with a go-live approval or a production migration.
begin read only;

-- Catalogues: find legitimate catalog entries missing a known purchase cost.
select count(*) as products,
  count(*) filter(where buy_price is null) as cost_missing,
  count(*) filter(where buy_price=0) as zero_cost,
  count(*) filter(where unit is null or btrim(unit)='') as unit_unspecified,
  count(*) filter(where is_active is true) as active_products
from public.products;

-- Existing units, so UI labels follow the BUSINESS sale unit, not all "piece".
select coalesce(nullif(btrim(unit),''),'(unspecified)') sale_unit,count(*) products
from public.products group by 1 order by count(*) desc;

-- Historical order/invoice properties to cover before agent launch.
select
  (select count(*) from public.orders) as orders,
  (select count(*) filter(where discount_amount>0) from public.orders) as order_document_discounts,
  (select count(*) from public.invoices) as invoices,
  (select count(*) filter(where included_order_ids is not null
    and jsonb_typeof(included_order_ids)='array'
    and jsonb_array_length(included_order_ids)>0) from public.invoices)
    as multi_order_invoice_rows,
  (select count(*) from public.payments) as payment_rows,
  (select count(*) filter(where invoice_id is null) from public.payments)
    as payments_not_linked_to_invoice,
  (select count(*) filter(where payment_group_id is not null) from public.payments)
    as grouped_payment_allocations;

-- Check existing privileged function bodies haven't changed since the
-- staged 09_legacy_security_definer_guard_NOT_APPLIED.sql was prepared.
-- Compare names/MD5 before considering a migration; never blanket overwrite.
select p.proname, pg_get_function_identity_arguments(p.oid) signature,
  pg_catalog.md5(pg_get_functiondef(p.oid)) as deployed_body_md5
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'create_order_with_inventory','save_order_with_inventory',
  'allocate_payment_across_invoices','credit_note_confirm',
  'credit_note_reserve','credit_note_resolve','credit_note_return_lines'
) order by p.proname;

commit;
