-- STAGED ONLY — NOT APPLIED TO PRODUCTION.
-- AGENT-ONLY availability; NEVER update products.is_active or owner/portal
-- order and sale workflows. A blocked agent product can be restored by the
-- owner later without changing the QuickStock catalogue.
begin;

create table if not exists public.sales_agent_product_blocks (
 owner_auth_id uuid not null references auth.users(id) on delete restrict,
 product_id uuid not null references public.products(id) on delete cascade,
 blocked_at timestamptz not null default now(),
 blocked_by uuid references auth.users(id) on delete set null,
 primary key(owner_auth_id,product_id)
);
create index if not exists agent_product_blocks_product_idx
on public.sales_agent_product_blocks(product_id);

alter table public.sales_agent_product_blocks enable row level security;
revoke all on public.sales_agent_product_blocks from public,anon,authenticated;
grant select on public.sales_agent_product_blocks to authenticated;

create policy agent_product_blocks_scoped_read
on public.sales_agent_product_blocks
for select to authenticated
using (
  public.sales_agent_is_manager(owner_auth_id)
  or exists(
    select 1 from public.sales_agent_profiles ap
    where ap.auth_user_id=(select auth.uid())
      and ap.owner_auth_id=sales_agent_product_blocks.owner_auth_id
      and ap.is_active=true
  )
);

-- Owner-only control for later block/release. This does not change the owner
-- sale settings, the catalogue, payment, inventory, invoice or customer portal.
create or replace function public.sales_agent_set_product_block(
 p_product_id uuid,p_block boolean
) returns boolean
language plpgsql security definer
set search_path = ''
as $set_block$
declare v_owner uuid:=auth.uid();
begin
 if v_owner is null then raise exception 'not_authenticated'; end if;
 if p_product_id is null or p_block is null
 then raise exception 'invalid_agent_product_block'; end if;
 if not exists(
  select 1 from public.sales_agent_managers m
  where m.auth_user_id=v_owner and m.owner_auth_id=v_owner
 ) then raise exception 'not_manager'; end if;

 -- Acquire an EXCLUSIVE row lock so blocking cannot race a normal or
 -- approved-exception order holding FOR SHARE on the same product.
 -- Whichever transaction owns the product lock first completes first:
 -- agent order first -> block applies to future orders; block first ->
 -- the pending agent order sees the new block and is rejected.
 perform 1 from public.products p
 where p.id=p_product_id and p.user_id=v_owner
 for update;
 if not found then raise exception 'product_not_owned'; end if;

 if p_block then
  insert into public.sales_agent_product_blocks(
    owner_auth_id,product_id,blocked_by
  ) values(v_owner,p_product_id,v_owner)
  on conflict(owner_auth_id,product_id) do nothing;
 else
  delete from public.sales_agent_product_blocks b
  where b.owner_auth_id=v_owner and b.product_id=p_product_id;
 end if;
 return true;
end;
$set_block$;
revoke all on function public.sales_agent_set_product_block(uuid,boolean)
from public,anon,authenticated;
grant execute on function public.sales_agent_set_product_block(uuid,boolean)
to authenticated;
commit;
