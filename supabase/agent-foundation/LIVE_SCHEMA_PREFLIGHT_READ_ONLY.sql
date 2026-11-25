-- READ ONLY release preflight for QuickStock production database.
-- Never use this query to mutate production. It checks schema shape, NOT
-- data, credentials, row visibility, real calls, or live feature readiness.
-- Query under a privileged metadata-inspection role only.
with required(table_name,column_name,expected_type) as (
 values
 ('business_settings','user_id','uuid'),
 ('business_settings','vat_rate','numeric'),
 ('credit_notes','finbot_status','text'),
 ('customer_portal_access','portal_deleted_at','timestamp with time zone'),
 ('customers','user_id','uuid'),
 ('invoices','included_order_ids','jsonb'),
 ('invoices','vat_rate','numeric'),
 ('order_inventory_effects','net_deducted','numeric'),
 ('orders','fulfilled','boolean'),
 ('orders','inventory_deducted','boolean'),
 ('orders','items','jsonb'),
 ('orders','total_override','numeric'),
 ('payments','amount','numeric'),
 ('payments','invoice_id','uuid'),
 ('products','buy_price','numeric'),
 ('products','prices_migrated_to_net','boolean'),
 ('products','sell_price','numeric'),
 ('products','unit','text'),
 ('quotes','customer_id','uuid'),
 ('quotes','user_id','uuid')
), found as (
 select r.table_name,r.column_name,r.expected_type,
 c.data_type as actual_type,
 c.column_name is not null and c.data_type=r.expected_type as matches
 from required r
 left join information_schema.columns c
 on c.table_schema='public'
 and c.table_name=r.table_name and c.column_name=r.column_name
)
select table_name,column_name,expected_type,actual_type,
 case when matches then 'PASS' else 'BLOCK_RELEASE' end result
from found order by table_name,column_name;
