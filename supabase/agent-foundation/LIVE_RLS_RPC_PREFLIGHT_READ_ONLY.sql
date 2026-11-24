-- Production READ-ONLY baseline verification (no data rows or secrets).
-- Execute immediately before rollout, then re-evaluate after each gated step.
-- PASS = a required existing-schema invariant verified.
-- EXPECTED_RELEASE_HOLD = a known legacy public access which stage 25/27
-- must close together with the verified PDF endpoint/UI release.
-- BLOCK_RELEASE = baseline drift which requires investigation first.
with relations(name) as (
 values ('customers'),('products'),('orders'),('invoices'),('payments'),
        ('credit_notes'),('quotes'),('business_settings'),
        ('order_inventory_effects'),('customer_portal_access')
), rel_checks as (
 select 'rls:'||r.name as check_name,
  case when c.oid is null then 'BLOCK_RELEASE'
       when c.relrowsecurity is true then 'PASS'
       else 'BLOCK_RELEASE' end status
 from relations r left join pg_class c on c.relname=r.name
   and c.relnamespace='public'::regnamespace and c.relkind='r'
), functions(name,args) as (
 values
 ('save_order_with_inventory','p_order_id uuid, p_updates jsonb, p_restore_stock boolean'),
 ('create_order_with_inventory','p_request_id uuid, p_order jsonb'),
 ('allocate_payment_across_invoices','p_group_id uuid, p_customer_id uuid, p_allocations jsonb, p_payment_method text, p_payment_date date, p_reference text, p_notes text, p_bank_name text, p_bank_branch text, p_bank_account text, p_check_number text'),
 ('credit_note_reserve','p_operation_id uuid, p_invoice_id uuid, p_credit_note_number text, p_items jsonb, p_total numeric, p_reason text, p_order_id uuid, p_created_by text'),
 ('credit_note_confirm','p_credit_note_id uuid, p_external_number text, p_external_url text, p_source text, p_document_date date'),
 ('credit_note_resolve','p_credit_note_id uuid, p_status text, p_error text, p_evidence text'),
 ('credit_note_return_lines','p_invoice_id uuid, p_items jsonb, p_exclude uuid'),
 ('credit_note_check_items','p_invoice_id uuid, p_items jsonb, p_exclude uuid'),
 ('get_next_order_number',''),
 ('get_next_quote_number','')
), function_checks as (
 select 'privileged_rpc:'||f.name as check_name,
 case when count(p.oid)=1 and bool_and(p.prosecdef) then 'PASS'
      else 'BLOCK_RELEASE' end as status
 from functions f
 left join pg_proc p on p.proname=f.name
   and p.pronamespace='public'::regnamespace
   and pg_get_function_identity_arguments(p.oid)=f.args
 group by f.name
), legacy_checks as (
 select 'legacy_public_policy:'||v.tablename as check_name,
 case when exists(select 1 from pg_policies p
   where p.schemaname='public' and p.tablename=v.tablename
     and p.policyname=v.policyname and p.cmd='SELECT'
     and p.roles::text like '%public%' and p.qual='true')
 then 'EXPECTED_RELEASE_HOLD' else 'BLOCK_RELEASE' end as status
 from (values ('quotes','public_read_quotes'),
              ('business_settings','public_read_business_settings'))
   v(tablename,policyname)
), privileges as (
 select 'public_settings_anon_table_select' as check_name,
 case when has_table_privilege('anon','public.business_settings','SELECT')
      then 'EXPECTED_RELEASE_HOLD' else 'BLOCK_RELEASE' end status
), baseline as (
 select * from rel_checks union all select * from function_checks
 union all select * from legacy_checks union all select * from privileges
)
select check_name,status from baseline order by check_name;
