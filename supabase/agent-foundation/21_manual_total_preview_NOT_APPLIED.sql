-- STAGED ONLY. Read-only server-side manual-total parity preview.
-- It NEVER permits saving an order, consuming an exception, or reducing stock.
-- The existing agent order RPCs continue to reject total overrides.
begin;
create or replace function public.sales_agent_preview_manual_total(
 p_customer_id uuid,
 p_items jsonb,
 p_total_gross numeric
)
returns table (
 allowed boolean,
 needs_manager_exception boolean,
 margin_percent numeric,
 effective_net_revenue numeric,
 net_cost numeric,
 goods_subtotal_net numeric,
 taxable_adjustment_net numeric,
 vat_amount numeric,
 total_gross numeric
)
language plpgsql security definer
set search_path = ''
as $manual_total$
declare
 v_base record;
 v_owner uuid;
 v_rate numeric;
 v_adjust numeric;
 v_vat numeric;
 v_effective numeric;
 v_cents bigint;
 v_cost_cents bigint;
begin
 -- The trusted margin RPC validates active agent, assigned customer,
 -- original line sums, current product costs, agent-only blocks and packaging.
 select * into v_base
 from public.sales_agent_check_order_margin(p_customer_id,p_items,0);
 if not found then raise exception 'margin_result_missing'; end if;

 if p_total_gross is null or p_total_gross<=0
    or p_total_gross>1000000000
    or p_total_gross<>pg_catalog.round(p_total_gross,2)
 then raise exception 'invalid_manual_total'; end if;

 select ap.owner_auth_id into v_owner
 from public.sales_agent_profiles ap
 where ap.auth_user_id=auth.uid() and ap.is_active is true;
 if v_owner is null then raise exception 'agent_not_active'; end if;

 select s.vat_rate into v_rate
 from public.business_settings s where s.user_id=v_owner
 order by s.created_date limit 1;
 if v_rate is null or v_rate<0 or v_rate>100
 then raise exception 'business_settings_invalid'; end if;

 -- Parity with QuickStock OrderCreateModal: the difference is a TAXABLE
 -- adjustment. Stored order subtotal remains the sum of line totals.
 v_adjust:=pg_catalog.round(
   p_total_gross/(1+v_rate/100)-v_base.net_revenue,2);
 v_vat:=pg_catalog.round(
   p_total_gross-v_base.net_revenue-v_adjust,2);
 v_effective:=pg_catalog.round(v_base.net_revenue+v_adjust,2);

 if v_effective<=0 or v_vat<0 or
    v_effective+v_vat<>p_total_gross
 then raise exception 'invalid_taxable_adjustment'; end if;

 -- Compare INTEGER AGOROT to 40%, not rounded UI percentage.
 v_cents:=(v_effective*100)::bigint;
 v_cost_cents:=(v_base.net_cost*100)::bigint;
 return query select
   (v_cents-v_cost_cents)*100>=40*v_cents,
   (v_cents-v_cost_cents)*100<40*v_cents,
   pg_catalog.round((v_cents-v_cost_cents)::numeric*100/v_cents,6),
   v_effective,v_base.net_cost,v_base.net_revenue,
   v_adjust,v_vat,p_total_gross;
end;
$manual_total$;
revoke all on function public.sales_agent_preview_manual_total(uuid,jsonb,numeric)
 from public,anon,authenticated;
grant execute on function public.sales_agent_preview_manual_total(uuid,jsonb,numeric)
 to authenticated;
commit;
