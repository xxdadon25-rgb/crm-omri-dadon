-- PREPARATION ONLY — DO NOT APPLY IN PRODUCTION.
-- Requires 01_schema_NOT_APPLIED.sql and 05_agent_direct_write_guard_NOT_APPLIED.sql.
--
-- Agent can create only a NEW customer (lead) for their own owning business.
-- Direct browser INSERT remains denied by RLS. Agent is assigned atomically.
-- No assignment of existing customer, edit of terms, credit limit, or portal
-- access through this routine. It cannot create orders or touch inventory.
begin;

create or replace function public.sales_agent_create_customer(
  p_request_id uuid,
  p_customer jsonb
)
returns public.customers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent_id uuid := auth.uid();
  v_owner_id uuid;
  v_customer public.customers%rowtype;
  v_name text;
begin
  if v_agent_id is null then raise exception 'not_authenticated'; end if;
  if p_request_id is null or p_customer is null
     or jsonb_typeof(p_customer) is distinct from 'object' then
    raise exception 'invalid_customer';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_customer) as k
    where k not in (
      'name','contact_person','phone','mobile','email',
      'address','city','tax_id','notes'
    )
  ) then
    raise exception 'unknown_customer_field';
  end if;

  v_name := nullif(trim(p_customer->>'name'), '');
  if v_name is null or length(v_name) > 200 then
    raise exception 'invalid_customer_name';
  end if;

  -- Only an active agent may create customers, always under the VERIFIED
  -- business owner, never a caller-provided user_id.
  select ap.owner_auth_id
    into v_owner_id
  from public.sales_agent_profiles ap
  where ap.auth_user_id = v_agent_id and ap.is_active = true
  for share;

  if v_owner_id is null then raise exception 'agent_not_active'; end if;

  -- Retry safety: a previously created UUID is valid only if it is this
  -- agent's own customer under the very same business owner.
  select * into v_customer
  from public.customers c
  where c.id = p_request_id;
  if found then
    if v_customer.user_id <> v_owner_id or not exists (
      select 1 from public.sales_agent_customer_assignments a
      where a.customer_id = p_request_id and a.agent_auth_id = v_agent_id
    ) then
      raise exception 'customer_request_id_in_use';
    end if;
    return v_customer;
  end if;

  insert into public.customers (
    id,user_id,name,contact_person,phone,mobile,email,
    address,city,tax_id,notes
  ) values (
    p_request_id,v_owner_id,v_name,
    nullif(trim(p_customer->>'contact_person'),''),
    nullif(trim(p_customer->>'phone'),''),
    nullif(trim(p_customer->>'mobile'),''),
    nullif(trim(p_customer->>'email'),''),
    nullif(trim(p_customer->>'address'),''),
    nullif(trim(p_customer->>'city'),''),
    nullif(trim(p_customer->>'tax_id'),''),
    nullif(trim(p_customer->>'notes'),'')
  )
  returning * into v_customer;

  insert into public.sales_agent_customer_assignments (
    customer_id,agent_auth_id,assigned_by
  ) values (v_customer.id,v_agent_id,v_agent_id);

  return v_customer;
end;
$$;

revoke all on function public.sales_agent_create_customer(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.sales_agent_create_customer(uuid,jsonb)
  to authenticated;

commit;

-- Test against restored snapshot:
-- 1. Active agent => customer.user_id is verified owner, one assignment,
--    customer's default financial terms unmodified.
-- 2. Repeating same UUID => same row; no duplicate.
-- 3. Existing UUID owned by another user or another agent => denied.
-- 4. Inactive agent / portal customer / anon / arbitrary authenticated => denied.
-- 5. Reject payload setting user_id, is_blocked, discount_percent,
--    credit_limit, payment_terms or is_active.
-- 6. Force rollback if either INSERT fails. Manager existing flows unchanged.
