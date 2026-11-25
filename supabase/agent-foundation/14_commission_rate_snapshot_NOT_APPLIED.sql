-- STAGED ONLY. DO NOT APPLY TO PRODUCTION.
-- Snapshot an agent's agreed rate when the ORIGINAL order is created.
-- Never use mutable agent profile rates to reprice historical commissions.
begin;
alter table public.sales_agent_order_attributions
  add column if not exists commission_pct_attributed numeric(5,2)
    check (commission_pct_attributed between 0 and 100);

-- No automatic backfill: historical attributions, if any, must be reviewed
-- using their actual contractual rate. A null snapshot is NOT zero percent.
-- Future trusted order RPCs must always insert an explicit snapshot.
create or replace function public.sales_agent_forbid_rate_snapshot_changes()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if new.agent_auth_id is distinct from old.agent_auth_id
    or new.order_id is distinct from old.order_id
    or new.commission_pct_attributed is distinct from old.commission_pct_attributed
  then raise exception 'immutable_agent_order_attribution'; end if;
  return new;
end;
$$;
revoke all on function public.sales_agent_forbid_rate_snapshot_changes()
  from public,anon,authenticated;
drop trigger if exists trg_sales_agent_rate_immutable
  on public.sales_agent_order_attributions;
create trigger trg_sales_agent_rate_immutable
before update on public.sales_agent_order_attributions
for each row execute function public.sales_agent_forbid_rate_snapshot_changes();
commit;
