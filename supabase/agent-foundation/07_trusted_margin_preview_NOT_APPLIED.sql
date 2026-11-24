-- PREPARATION ONLY — DO NOT APPLY IN PRODUCTION.
-- Uses CURRENT QuickStock purchase prices, with the same-unit rule of
-- src/lib/cartProfit.js + src/lib/packagingMath.js.
-- NO new cost-verification table and NO re-entry of existing catalogue.
-- Purchase and sale prices are NET before VAT in the existing system.
--
-- NOTE: The products table has no persisted pack/carton conversion fields.
-- If a line EXPLICITLY states different sale/buy levels or uncertain basis,
-- the API fails closed rather than trusting a forged packaging multiplier.
-- The existing UI may still offer detailed pack/carton cost display; for
-- fully equivalent server support, store trusted packaging evidence first.
begin;

create or replace function public.sales_agent_check_order_margin(
  p_customer_id uuid,
  p_items jsonb,
  p_document_discount_net numeric default 0
)
returns table (
  allowed boolean,
  needs_manager_exception boolean,
  margin_percent numeric,
  net_revenue numeric,
  net_cost numeric,
  rejection_code text
)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_agent uuid := auth.uid();
  v_owner uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_line_total numeric;
  v_line_sales bigint;
  v_line_cost bigint;
  v_sales_agorot bigint := 0;
  v_cost_agorot bigint := 0;
  v_margin numeric;
begin
  if v_agent is null then raise exception 'not_authenticated'; end if;
  select ap.owner_auth_id into v_owner
  from public.sales_agent_profiles ap
  where ap.auth_user_id = v_agent and ap.is_active = true;
  if v_owner is null then raise exception 'agent_not_active'; end if;

  if p_customer_id is null or not exists (
    select 1 from public.sales_agent_customer_assignments ca
    join public.customers c on c.id=ca.customer_id
    where ca.agent_auth_id=v_agent
      and ca.customer_id=p_customer_id and c.user_id=v_owner
  ) then raise exception 'customer_not_assigned'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) not between 1 and 250
  then raise exception 'invalid_items'; end if;

  -- Document-level discounts are intentionally blocked until the existing
  -- documentProfit aggregation and editable total can be matched exactly.
  if p_document_discount_net is distinct from 0 then
    raise exception 'document_discount_not_yet_supported';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'invalid_line'; end if;
    if coalesce(v_item->>'quantity','') !~ '^[0-9]+([.][0-9]+)?$'
      or coalesce(v_item->>'unit_price','') !~ '^[0-9]+([.][0-9]+)?$'
      or coalesce(v_item->>'total','') !~ '^[0-9]+([.][0-9]+)?$'
      or coalesce(v_item->>'discount','0') !~ '^[0-9]+([.][0-9]+)?$'
      or coalesce(v_item->>'product_id','') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then raise exception 'invalid_line'; end if;

    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_discount := coalesce((v_item->>'discount')::numeric,0);
    v_line_total := (v_item->>'total')::numeric;

    if v_quantity <= 0 or v_quantity > 1000000
      or v_unit_price < 0 or v_unit_price > 100000000
      or v_discount < 0 or v_discount > 100 or v_line_total <= 0
    then raise exception 'invalid_line'; end if;

    -- A line is sale-level unit-priced by the current catalogue convention.
    -- Never accept client packaging to fabricate a cheaper cost per sale.
    if coalesce(v_item->>'sale_level_review','false') = 'true'
       or (v_item ? 'sale_level'
         and v_item ? 'buy_level'
         and v_item->>'sale_level' <> v_item->>'buy_level')
       or (v_item ? 'price_basis'
         and v_item->>'price_basis' <> 'catalog_same_sold_unit_v1')
       or (v_item ? 'sale_level'
         and v_item->>'sale_level' not in ('unit','pack','carton'))
       or (v_item ? 'buy_level'
         and v_item->>'buy_level' not in ('unit','pack','carton'))
    then raise exception 'sale_unit_needs_clarification'; end if;

    select * into v_product
    from public.products p
    where p.id = (v_item->>'product_id')::uuid
      and p.user_id = v_owner and p.is_active is true;
    if not found then raise exception 'product_not_found'; end if;

    -- Agent-only block, independent from existing products.is_active.
    -- Checked by the SECURITY DEFINER server RPC, so editing the browser
    -- payload or price cannot bypass a manager-blocked product.
    if exists (
      select 1 from public.sales_agent_product_blocks b
      where b.owner_auth_id=v_owner and b.product_id=v_product.id
    ) then raise exception 'agent_product_blocked'; end if;

    -- A zero/missing cost is not proof that inventory was obtained for free.
    -- Zero-cost legacy entries otherwise give a fabricated 100% margin.
    if v_product.buy_price is null or v_product.buy_price <= 0
    then raise exception 'cost_missing'; end if;

    -- Match the legacy QuickStock cartProfit fallback for unverified
    -- carton/pack vs unit cost bases. A business-approved, matching catalogue
    -- price normally passes; a very large ratio is a REVIEW, not a 99%-margin
    -- approval. Never infer a packaging multiplier from a price alone.
    -- This rule applies even if the browser FORGES price_basis.
    -- Also inspect the catalogue's OWN reference sale price. Otherwise
    -- an agent can bypass a known unit/carton anomaly by entering a different
    -- selling price which happens to fall inside the suspicious ratio band.
    if (v_product.sell_price is not null and v_product.sell_price > 0
        and (v_product.buy_price > v_product.sell_price*3
          or v_product.sell_price > v_product.buy_price*12))
       or (v_unit_price > 0 and
         (v_product.buy_price > v_unit_price*3
          or v_unit_price > v_product.buy_price*12))
    then raise exception 'sale_unit_needs_clarification'; end if;

    -- Existing JS lineProfit same-level behavior:
    -- line cost = round(buy_price * 100 * qty) agorot.
    -- Stored line TOTAL is the actual NET revenue per documentProfit.
    -- Guard line consistency: a malicious client cannot inflate TOTAL
    -- independently of quantity, price and discount.
    -- Like packagingMath: round the individual quoted selling price to
    -- agorot first, then round the discounted extended line once.
    v_line_sales := round(round(v_unit_price*100) * v_quantity
                          * (1-v_discount/100))::bigint;
    -- The submitted line total is stored downstream. Refuse hidden third-
    -- decimal fractions that could pass a cents-only comparison yet survive
    -- into the issued invoice with a different amount.
    if v_line_total is distinct from round(v_line_total,2)
       or v_line_sales <> round(v_line_total*100)::bigint
    then raise exception 'inconsistent_line_total'; end if;

    v_line_cost := round(v_product.buy_price*100*v_quantity)::bigint;
    v_sales_agorot := v_sales_agorot + v_line_sales;
    v_cost_agorot := v_cost_agorot + v_line_cost;
  end loop;

  if v_sales_agorot <= 0 then raise exception 'no_net_revenue'; end if;
  v_margin := (v_sales_agorot-v_cost_agorot)::numeric*100/v_sales_agorot;
  return query select
    (v_sales_agorot-v_cost_agorot)*100 >= 40*v_sales_agorot,
    (v_sales_agorot-v_cost_agorot)*100 < 40*v_sales_agorot,
    round(v_margin,6),
    v_sales_agorot::numeric/100,
    v_cost_agorot::numeric/100,
    case when (v_sales_agorot-v_cost_agorot)*100 >= 40*v_sales_agorot
      then null::text else 'manager_exception_required'::text end;
end;
$$;
revoke all on function public.sales_agent_check_order_margin(uuid,jsonb,numeric)
  from public,anon,authenticated;
grant execute on function public.sales_agent_check_order_margin(uuid,jsonb,numeric)
  to authenticated;
commit;

-- Mandatory restored-DB tests before deployment: parity with documentProfit
-- on actual current-catalogue sale-unit lines, 40%-boundary, discounts,
-- unknown cost, forged total/packaging, multi-product blending, concurrent
-- product-price edits, disabled agent and unassigned customer.
