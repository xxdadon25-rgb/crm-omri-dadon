-- STAGED ONLY. NOT APPLIED TO PRODUCTION.
-- Read-only, payment-by-payment commission preview; no writes, payouts,
-- payment-state changes or new "cheque cleared" step.
-- Owner confirmed all records under Payments represent actually received
-- funds, including cleared cheques. Existing status 'אושר' is respected.
--
-- This is NOT the final immutable accounting ledger: the agreed rate is read
-- from immutable original order attribution; credits/ambiguous invoices are flagged.
-- Do not initiate payouts or silently backfill ledger from this preview.
begin;

create or replace function public.sales_agent_commission_preview(
  p_agent_id uuid default null
)
returns table (
  payment_id uuid,
  invoice_id uuid,
  order_id uuid,
  agent_auth_id uuid,
  payment_date date,
  gross_received numeric,
  invoice_vat_rate numeric,
  net_received numeric,
  commission_pct numeric,
  commission_amount numeric,
  review_reason text
)
language plpgsql
stable security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_agent uuid;
  v_owner uuid;
begin
  if v_caller is null then raise exception 'not_authenticated'; end if;
  v_agent:=coalesce(p_agent_id,v_caller);
  select ap.owner_auth_id into v_owner
  from public.sales_agent_profiles ap
  where ap.auth_user_id=v_agent;
  if v_owner is null then raise exception 'agent_not_found'; end if;

  if v_caller <> v_agent and not exists (
    select 1 from public.sales_agent_managers m
    where m.auth_user_id=v_caller and m.owner_auth_id=v_owner
  ) then raise exception 'not_authorized'; end if;

  -- One row per actual RECEIPT (payment.id). Payments in a group are already
  -- apportioned per invoice, so never sum payment_group_id separately.
  return query
  select
    p.id,
    i.id,
    o.id,
    att.agent_auth_id,
    p.payment_date,
    p.amount,
    i.vat_rate,
    case when reasons.reason is null
      then round(p.amount/(1+i.vat_rate/100),2)
      else null::numeric end,
    att.commission_pct_attributed,
    case when reasons.reason is null
      then round(p.amount/(1+i.vat_rate/100)*att.commission_pct_attributed/100,2)
      else null::numeric end,
    reasons.reason
  from public.sales_agent_order_attributions att
  join public.sales_agent_profiles ap
    on ap.auth_user_id=att.agent_auth_id
   and ap.owner_auth_id=v_owner
  join public.orders o
    on o.id=att.order_id and o.user_id=v_owner
  join public.invoices i
    on i.order_id=o.id
   and i.user_id=v_owner and i.customer_id=o.customer_id
  join public.payments p
    on p.invoice_id=i.id
   and p.user_id=v_owner and p.customer_id=i.customer_id
  cross join lateral (
    select case
      when p.status is distinct from 'אושר'
        then 'payment_not_approved'
      when p.amount is null or p.amount<=0 or p.payment_date is null
        then 'invalid_payment'
      when i.vat_rate is null or i.vat_rate<0 or i.vat_rate>100
        then 'missing_invoice_vat'
      when i.total is null or i.total<=0
        then 'invalid_invoice_total'
      -- Money above the invoice total is customer credit, not another sale.
      -- Do not pay a sales commission on an unallocated overpayment.
      when (select coalesce(sum(coalesce(p2.amount,0)),0)
            from public.payments p2
            where p2.invoice_id=i.id and p2.user_id=v_owner
              and p2.status='אושר') > i.total
        then 'invoice_overpaid_needs_allocation'
      when i.included_order_ids is not null
           and (
             pg_catalog.jsonb_typeof(i.included_order_ids)<>'array'
             or i.included_order_ids <> '[]'::jsonb
           ) then 'multi_order_invoice_needs_allocation'
      when i.credited_at is not null or i.credit_note_id is not null
        then 'credited_invoice_needs_reconciliation'
      when exists (
        select 1 from public.credit_notes cn
        where cn.invoice_id=i.id and cn.user_id=v_owner
          and (
            cn.finbot_status in ('confirmed','pending','uncertain')
            or (cn.finbot_status is null
                and nullif(pg_catalog.btrim(cn.external_credit_note_number),'') is not null)
          )
      ) then 'credit_note_needs_reconciliation'
      when att.commission_pct_attributed is null
           or att.commission_pct_attributed<0
           or att.commission_pct_attributed>100 then 'missing_historical_agent_rate'
      else null::text end as reason
  ) reasons
  where att.agent_auth_id=v_agent
  order by p.payment_date,p.id;
end;
$$;

revoke all on function public.sales_agent_commission_preview(uuid)
from public,anon,authenticated;
grant execute on function public.sales_agent_commission_preview(uuid)
to authenticated;
commit;

-- A manager can see an agent's preview by explicit agent ID only for their
-- business. An agent can see only self. Nobody can INSERT commission rows.
-- Credits and ambiguous invoice links MUST remain review-only, not 8% earned.
