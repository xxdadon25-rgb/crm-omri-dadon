-- STAGED ONLY. Must be reviewed/applied AFTER 01_schema_NOT_APPLIED.sql
-- in an isolated test database. Do not execute against production.
-- A shared authenticated manager selects the human-readable name "עומרי"/"בן".
-- This is self-declaration, not independent cryptographic authentication.
begin;

alter table public.sales_agent_margin_exceptions
  add column if not exists approved_by_label text,
  add constraint sales_agent_approver_label_check
    check (
      (status = 'pending' and approved_by_label is null) or
      (status in ('approved','rejected') and approved_by_label in ('עומרי','בן')) or
      (status = 'invalidated' and approved_by_label is null)
    );

-- Execute permission is NOT granted to PUBLIC, anon or arbitrary JWT metadata.
-- The function can only decide an inert request; it cannot create an order,
-- reduce inventory, send WhatsApp or bypass the margin/price recheck.
create or replace function public.sales_agent_decide_exception(
  p_exception_id uuid,
  p_decision text,
  p_approver_label text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manager uuid := auth.uid();
  v_updated uuid;
begin
  if v_manager is null then raise exception 'not_authenticated'; end if;
  if p_exception_id is null or p_decision not in ('approved','rejected')
     or p_approver_label not in ('עומרי','בן') then
    raise exception 'invalid_exception_decision';
  end if;

  -- One atomic compare-and-set. Two simultaneous decisions cannot both win.
  -- The manager must be registered for this agent's owning business.
  update public.sales_agent_margin_exceptions e
  set status = p_decision,
      approved_by_label = p_approver_label,
      decided_by = v_manager,
      decided_at = transaction_timestamp()
  from public.sales_agent_profiles p
  where e.id = p_exception_id
    and e.status = 'pending'
    and p.auth_user_id = e.agent_auth_id
    and exists (
      select 1 from public.sales_agent_managers m
      where m.auth_user_id = v_manager
        and m.owner_auth_id = p.owner_auth_id
    )
  returning e.id into v_updated;

  return v_updated is not null;
end;
$$;
revoke all on function public.sales_agent_decide_exception(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.sales_agent_decide_exception(uuid,text,text)
  to authenticated;

commit;

-- Follow-up required in isolated tests:
-- 1. Unauthenticated / inactive / wrong-business user => denied.
-- 2. One of "עומרי"/"בן" required, no spoofed arbitrary labels.
-- 3. Race two concurrent approvals and an approve-versus-reject.
-- 4. No stock, payment, invoice or live order mutated.
-- 5. If cost/order payload changed since requested, the future order RPC MUST
--    reject even an approved exception unless re-requested; this RPC itself
--    only records manager's decision on a draft.
