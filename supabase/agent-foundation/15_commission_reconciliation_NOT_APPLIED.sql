-- PREPARATION ONLY — DO NOT APPLY TO PRODUCTION.
-- Manager-only, idempotent posting of clear and unambiguous agent receipts.
-- Does NOT register customer payments, adjust orders, pay agents, or backfill
-- old orders without immutable agent attribution.
--
-- Each actual payment is identified by payment UUID, not payment_group_id.
-- Every accrual is immutable. A changed/credited/noneligible payment causes
-- one compensating reversal, not an overwrite. A reversed settlement CANNOT
-- be reaccrued automatically; manager must reconcile the historical record.
begin;

create or replace function public.sales_agent_reconcile_commissions(
  p_agent_id uuid
)
returns table (new_settlements integer, new_reversals integer, needs_review integer)
language plpgsql security definer
set search_path = ''
as $reconcile$
declare
  v_owner uuid;
  v_row record;
  v_entry public.sales_agent_commission_entries%rowtype;
  v_settlements integer:=0;
  v_reversals integer:=0;
  v_reviews integer:=0;
begin
  if auth.uid() is null or p_agent_id is null then
    raise exception 'not_authenticated';
  end if;
  select owner_auth_id into v_owner
  from public.sales_agent_profiles
  where auth_user_id=p_agent_id;
  if v_owner is null or not exists (
    select 1 from public.sales_agent_managers m
    where m.auth_user_id=auth.uid() and m.owner_auth_id=v_owner
  ) then raise exception 'not_authorized'; end if;

  -- Serialize concurrent manager reconciliations for the same agent.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('agent_commission_'||p_agent_id::text)
  );

  -- A payment may change, disappear, be marked unapproved, or receive a
  -- credit; detect anything whose original snapshot is no longer eligible.
  for v_entry in
    select e.* from public.sales_agent_commission_entries e
    where e.agent_auth_id=p_agent_id and e.entry_kind='settlement'
    order by e.created_at,e.id
  loop
    if not exists (
      select 1
      from public.sales_agent_commission_preview(p_agent_id) p
      where p.payment_id=v_entry.payment_id
        and p.invoice_id=v_entry.invoice_id
        and p.order_id=v_entry.order_id
        and p.review_reason is null
        and p.net_received=v_entry.net_collected
        and p.commission_pct=v_entry.commission_pct
        and p.commission_amount=v_entry.commission_amount
        and p.payment_date=v_entry.settled_on
    ) then
      insert into public.sales_agent_commission_entries(
        agent_auth_id,order_id,invoice_id,payment_id,
        entry_kind,source_key,settled_on,net_collected,
        commission_pct,commission_amount
      ) values (
        v_entry.agent_auth_id,v_entry.order_id,v_entry.invoice_id,
        v_entry.payment_id,'reversal','reversal:'||v_entry.id::text,
        current_date,-v_entry.net_collected,
        v_entry.commission_pct,-v_entry.commission_amount
      )
      on conflict(source_key) do nothing;
      if found then v_reversals:=v_reversals+1; end if;
    end if;
  end loop;

  for v_row in select * from public.sales_agent_commission_preview(p_agent_id)
  loop
    if v_row.review_reason is not null then
      v_reviews:=v_reviews+1;
      continue;
    end if;

    select e.* into v_entry
    from public.sales_agent_commission_entries e
    where e.source_key='settlement:'||v_row.payment_id::text;

    if found then
      -- Existing snapshot was either kept, or reversed above. Never alter
      -- an immutable record or award a second commission on the same money.
      if exists (
        select 1 from public.sales_agent_commission_entries rev
        where rev.source_key='reversal:'||v_entry.id::text
      ) then v_reviews:=v_reviews+1; end if;
      continue;
    end if;

    insert into public.sales_agent_commission_entries(
      agent_auth_id,order_id,invoice_id,payment_id,entry_kind,
      source_key,settled_on,net_collected,commission_pct,commission_amount
    ) values (
      v_row.agent_auth_id,v_row.order_id,v_row.invoice_id,
      v_row.payment_id,'settlement',
      'settlement:'||v_row.payment_id::text,v_row.payment_date,
      v_row.net_received,v_row.commission_pct,v_row.commission_amount
    ) on conflict(source_key) do nothing;
    if found then v_settlements:=v_settlements+1; end if;
  end loop;

  return query select v_settlements,v_reversals,v_reviews;
end;
$reconcile$;

revoke all on function public.sales_agent_reconcile_commissions(uuid)
  from public,anon,authenticated;
grant execute on function public.sales_agent_reconcile_commissions(uuid)
  to authenticated;

-- Ledger is append-only. Do not allow even a privileged manual UPDATE/DELETE
-- to hide historical accrual or its compensating reversal.
create or replace function public.sales_agent_forbid_commission_entry_mutation()
returns trigger language plpgsql
set search_path = ''
as $immutable$
begin
  -- FK ON DELETE SET NULL may clear the pointer to a manager-deleted receipt.
  -- The immutable source_key keeps its original payment UUID for audit and
  -- the next reconciliation writes an independent compensating reversal.
  if tg_op='UPDATE' and old.payment_id is not null
    and new.payment_id is null
    and (to_jsonb(new)-'payment_id')=(to_jsonb(old)-'payment_id')
  then return new; end if;
  raise exception 'immutable_commission_ledger';
end;
$immutable$;
revoke all on function public.sales_agent_forbid_commission_entry_mutation()
  from public,anon,authenticated;
drop trigger if exists trg_agent_commission_entry_immutable
  on public.sales_agent_commission_entries;
create trigger trg_agent_commission_entry_immutable
before update or delete on public.sales_agent_commission_entries
for each row execute function public.sales_agent_forbid_commission_entry_mutation();
commit;

-- FAIL CLOSED: credit, refund, mixed invoices and altered prior receipts must
-- be reviewed and reconciled BEFORE PAYOUT. No commission payout RPC here.
