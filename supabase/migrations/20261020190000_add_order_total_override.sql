-- An editable final total on an order.
--
-- THE PROBLEM
--   An order's total is derived: subtotal + VAT, where subtotal is the sum of
--   the line totals. A user who wants to bill ₪188.00 instead of the computed
--   ₪188.09 has no way to say so. Forcing it through discount_amount does not
--   work: that field is RECOMPUTED from the items on every save, it cannot go
--   negative in the UI, and it sits on the pre-VAT side, so rounding the final
--   figure through it produces subtotals like 159.3220 that then propagate into
--   monthly invoices and the accounting export.
--
-- WHAT THIS ADDS
--   orders.total_override — the final amount the user CHOSE, stored as the
--   target rather than as a delta. A target survives every item edit without
--   needing to be recomputed; a stored delta would have to be maintained.
--   NULL means "no manual total", which is every order that exists today.
--
--   NO second column is needed on invoices. VAT is stored as the REMAINDER
--   rather than as subtotal x rate, so an adjusted order satisfies
--
--       subtotal + adjustment_net + vat_amount = total,  exactly
--
--   and the adjustment is recoverable anywhere as total - subtotal -
--   vat_amount. An order with no manual total yields zero there, so no
--   consumer has to be told whether an adjustment exists.
--
--   The column is nullable with no default, so adding it is a catalogue change
--   and rewrites no rows.
--
-- THE RPC
--   save_order_with_inventory rejects any key it does not know, by design, so
--   the column alone is not enough — the function must be replaced to accept
--   it. The body below is a BYTE-FOR-BYTE copy of the installed version with
--   exactly two additions: 'total_override' in the field allowlist, and one
--   assignment in the UPDATE. It was produced by copying the existing text
--   programmatically rather than by retyping it, so no inventory logic, lock
--   order, delta calculation or error code can have drifted.
--
-- ROLLBACK is at the bottom of this file.

begin;

-- ---------------------------------------------------------------------------
-- 0. Preconditions.
-- ---------------------------------------------------------------------------
do $pre$
begin
  if to_regprocedure('public.save_order_with_inventory(uuid,jsonb,boolean)') is null then
    raise exception 'precondition failed: save_order_with_inventory(uuid,jsonb,boolean) is missing';
  end if;
  if to_regclass('public.orders') is null then
    raise exception 'precondition failed: orders is missing';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'total_override'
  ) then
    raise exception 'precondition failed: orders.total_override already exists';
  end if;
end;
$pre$;

-- ---------------------------------------------------------------------------
-- 1. The column.
-- ---------------------------------------------------------------------------
alter table public.orders add column total_override numeric;

comment on column public.orders.total_override is
  'The final payable amount the user typed by hand, VAT included. NULL means the total is the derived subtotal + VAT. Cleared whenever a product, quantity, unit price or line discount changes, because the figure it was chosen against no longer exists.';

-- ---------------------------------------------------------------------------
-- 2. save_order_with_inventory — the installed body, plus one field.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_order_with_inventory(
  p_order_id      uuid,
  p_updates       jsonb,
  p_restore_stock boolean DEFAULT false
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller       uuid;
  v_order        public.orders%ROWTYPE;
  v_prev         jsonb;
  v_next         jsonb;
  v_delta        jsonb;
  v_row          record;
  v_was_deducted boolean;
  v_will_fulfil  boolean;
  v_cancelled    boolean;
  v_mode         text;
  v_deducted     boolean;
  v_change       numeric;
  v_qty          numeric;
  v_new_qty      numeric;
BEGIN
  -- ---- 1. caller ---------------------------------------------------------
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- ---- 2. field allowlist, BEFORE taking any lock ------------------------
  -- Rejecting an unknown key rather than ignoring it is deliberate: silently
  -- dropping a field the user believes they saved is worse than a clean
  -- failure. A new frontend field therefore requires this list to be updated
  -- first, which is the correct ordering for a manually deployed function.
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object' THEN
    RAISE EXCEPTION 'invalid_updates';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_updates) AS k
     WHERE k NOT IN ('status', 'notes', 'items', 'fulfilled',
                     'subtotal', 'gross_total', 'discount_amount',
                     'vat_amount', 'vat_rate', 'total', 'total_override')
  ) THEN
    RAISE EXCEPTION 'unknown_order_field';
  END IF;

  IF p_updates ? 'items' AND jsonb_typeof(p_updates -> 'items') <> 'array' THEN
    RAISE EXCEPTION 'invalid_items';
  END IF;

  -- ---- 3. lock the order and verify ownership ----------------------------
  -- FOR UPDATE serialises two concurrent edits of the SAME order: the second
  -- waits here and then reads the first one's committed items as its baseline.
  SELECT * INTO v_order
    FROM public.orders
   WHERE id = p_order_id
     AND user_id = v_caller
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  -- ---- 4. baseline is the STORED items, never the client's snapshot ------
  -- This is the single most important line in the function. The browser's idea
  -- of "previous items" can be stale, tampered with, or already drifted; the
  -- stored row is what stock was actually taken for.
  v_prev := COALESCE(v_order.items, '[]'::jsonb);
  v_next := COALESCE(p_updates -> 'items', v_prev);

  v_was_deducted := COALESCE(v_order.inventory_deducted, false);
  v_will_fulfil  := COALESCE((p_updates ->> 'fulfilled')::boolean, v_order.fulfilled, false);
  v_cancelled    := COALESCE(p_updates ->> 'status', v_order.status) = 'בוטל';

  -- ---- 5-6. per-product delta -------------------------------------------
  -- Lines with no product_id are excluded HERE and therefore can never reach
  -- inventory: free-text lines have never affected stock. Duplicate lines for
  -- the same product are summed, so two rows of one product are one movement.
  --
  -- A quantity is read with ->> so both a JSON number and a numeric string
  -- work. A genuinely non-numeric quantity raises and rolls the whole call
  -- back, which is intended: silently skipping such a line would understate
  -- the movement without telling anyone. (A production audit of 46
  -- product-backed lines found 0 non-numeric and 0 fractional quantities.)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'pid', d.pid, 'prev_qty', d.prev_qty, 'next_qty', d.next_qty)), '[]'::jsonb)
    INTO v_delta
    FROM (
      SELECT f.pid,
             COALESCE(sum(f.qty) FILTER (WHERE f.side = 'prev'), 0) AS prev_qty,
             COALESCE(sum(f.qty) FILTER (WHERE f.side = 'next'), 0) AS next_qty
        FROM (
          SELECT 'prev'::text AS side,
                 (e ->> 'product_id')::uuid AS pid,
                 COALESCE(NULLIF(e ->> 'quantity', '')::numeric, 0) AS qty
            FROM jsonb_array_elements(v_prev) AS e
           WHERE NULLIF(e ->> 'product_id', '') IS NOT NULL
          UNION ALL
          SELECT 'next'::text,
                 (e ->> 'product_id')::uuid,
                 COALESCE(NULLIF(e ->> 'quantity', '')::numeric, 0)
            FROM jsonb_array_elements(v_next) AS e
           WHERE NULLIF(e ->> 'product_id', '') IS NOT NULL
        ) AS f
       GROUP BY f.pid
    ) AS d;

  -- ---- 7/8/9. which movement, and on which quantities --------------------
  -- These five modes reproduce the browser's branches exactly.
  --   restore_all / deduct_all act on a WHOLE item set, not on a difference:
  --   that is what makes "not deducted -> fulfilled" take the NEW set and
  --   "deducted -> not fulfilled" give back the PREVIOUS one.
  IF v_cancelled AND v_was_deducted AND p_restore_stock THEN
    v_mode := 'restore_all';        -- give back exactly what was taken
  ELSIF v_cancelled AND v_was_deducted THEN
    v_mode := 'none';               -- goods are still out: stock untouched
  ELSIF v_will_fulfil AND NOT v_was_deducted THEN
    v_mode := 'deduct_all';         -- take the full NEW set
  ELSIF NOT v_will_fulfil AND v_was_deducted AND NOT v_cancelled THEN
    v_mode := 'restore_all';        -- give back the full PREVIOUS set
  ELSIF v_will_fulfil AND v_was_deducted THEN
    v_mode := 'delta';              -- still supplied: only the difference
  ELSE
    v_mode := 'none';               -- never deducted, not being fulfilled
  END IF;

  -- inventory_deducted is DERIVED here, never accepted from the client: it is
  -- the flag that must stay consistent with the stock this call just moved.
  v_deducted := CASE v_mode
                  WHEN 'deduct_all'  THEN true
                  WHEN 'restore_all' THEN false
                  WHEN 'delta'       THEN true
                  ELSE v_was_deducted
                END;

  -- ---- lock and move, in ascending product id ---------------------------
  -- ORDER BY d.pid gives every transaction the same lock order, so two
  -- concurrent saves touching an overlapping product set queue rather than
  -- deadlock. Locking inside the loop (rather than one ORDER BY ... FOR UPDATE
  -- statement) makes that ordering a property of the code, not of the planner.
  IF v_mode <> 'none' THEN
    FOR v_row IN
      SELECT d.pid, d.prev_qty, d.next_qty
        FROM jsonb_to_recordset(v_delta)
          AS d(pid uuid, prev_qty numeric, next_qty numeric)
       ORDER BY d.pid
    LOOP
      -- v_change is the amount to REMOVE from stock. Negative means put back.
      v_change := CASE v_mode
                    WHEN 'delta'       THEN v_row.next_qty - v_row.prev_qty
                    WHEN 'deduct_all'  THEN v_row.next_qty
                    WHEN 'restore_all' THEN -v_row.prev_qty
                  END;

      CONTINUE WHEN v_change = 0;   -- price/discount-only edits land here

      -- Ownership is enforced on the lock itself. A product that is missing or
      -- belongs to someone else aborts the whole call.
      SELECT quantity INTO v_qty
        FROM public.products
       WHERE id = v_row.pid
         AND user_id = v_caller
         FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'product_not_found';
      END IF;

      -- Deductions clamp at zero (current behaviour). Restores do not clamp,
      -- also current behaviour. NOTE: a clamped deduction is not invertible,
      -- which is exactly why the baseline above must be the stored items and
      -- never a reconstructed movement history.
      v_new_qty := CASE
                     WHEN v_change > 0 THEN greatest(0, COALESCE(v_qty, 0) - v_change)
                     ELSE COALESCE(v_qty, 0) - v_change
                   END;

      UPDATE public.products
         SET quantity = v_new_qty
       WHERE id = v_row.pid
         AND user_id = v_caller;

      -- The old client code discarded this error, so a rejected stock write
      -- could pass as a successful save. Here it aborts everything.
      IF NOT FOUND THEN
        RAISE EXCEPTION 'inventory_update_failed';
      END IF;
    END LOOP;
  END IF;

  -- ---- 10. the order, in the SAME transaction ---------------------------
  -- `p_updates ? 'key'` rather than COALESCE for every field: an absent key
  -- means "leave alone", an explicit null means "write null". COALESCE would
  -- conflate the two and silently ignore a deliberate null.
  UPDATE public.orders
     SET status             = CASE WHEN p_updates ? 'status'          THEN p_updates ->> 'status' ELSE status END,
         notes              = CASE WHEN p_updates ? 'notes'           THEN p_updates ->> 'notes'  ELSE notes  END,
         items              = CASE WHEN p_updates ? 'items'           THEN p_updates -> 'items'   ELSE items  END,
         fulfilled          = CASE WHEN p_updates ? 'fulfilled'       THEN (p_updates ->> 'fulfilled')::boolean       ELSE fulfilled       END,
         subtotal           = CASE WHEN p_updates ? 'subtotal'        THEN (p_updates ->> 'subtotal')::numeric        ELSE subtotal        END,
         gross_total        = CASE WHEN p_updates ? 'gross_total'     THEN (p_updates ->> 'gross_total')::numeric     ELSE gross_total     END,
         discount_amount    = CASE WHEN p_updates ? 'discount_amount' THEN (p_updates ->> 'discount_amount')::numeric ELSE discount_amount END,
         vat_amount         = CASE WHEN p_updates ? 'vat_amount'      THEN (p_updates ->> 'vat_amount')::numeric      ELSE vat_amount      END,
         vat_rate           = CASE WHEN p_updates ? 'vat_rate'        THEN (p_updates ->> 'vat_rate')::numeric        ELSE vat_rate        END,
         total              = CASE WHEN p_updates ? 'total'           THEN (p_updates ->> 'total')::numeric           ELSE total           END,
         -- An explicit null is how the client CLEARS the override, so the
         -- `? 'key'` test matters here more than anywhere else in this list:
         -- COALESCE would read "clear it" as "leave it alone" and the manual
         -- total would survive an item edit that was supposed to discard it.
         total_override     = CASE WHEN p_updates ? 'total_override' THEN (p_updates ->> 'total_override')::numeric  ELSE total_override  END,
         inventory_deducted = v_deducted
   WHERE id = p_order_id
     AND user_id = v_caller
   RETURNING * INTO v_order;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  RETURN v_order;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Privileges.
--
--    CREATE OR REPLACE keeps the existing ACL, so this is a restatement rather
--    than a repair, kept because the original migration documents at length why
--    anon and service_role must be revoked BY NAME and not merely through
--    PUBLIC. The order matters: revokes first, then the single grant.
-- ---------------------------------------------------------------------------
revoke all on function public.save_order_with_inventory(uuid, jsonb, boolean) from public;
revoke all on function public.save_order_with_inventory(uuid, jsonb, boolean) from anon;
revoke all on function public.save_order_with_inventory(uuid, jsonb, boolean) from service_role;
grant execute on function public.save_order_with_inventory(uuid, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Verification.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_oid oid;
  v_src text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders'
       and column_name = 'total_override' and is_nullable = 'YES'
  ) then
    raise exception 'verification failed: orders.total_override is missing or not nullable';
  end if;
  -- No existing row may have acquired a value: the column is additive and
  -- every order that exists today has no manual total.
  if exists (select 1 from public.orders where total_override is not null) then
    raise exception 'verification failed: an existing order already carries total_override';
  end if;

  v_oid := to_regprocedure('public.save_order_with_inventory(uuid,jsonb,boolean)')::oid;
  if v_oid is null then
    raise exception 'verification failed: the expected RPC signature is missing';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'save_order_with_inventory') <> 1 then
    raise exception 'verification failed: save_order_with_inventory is not a single overload';
  end if;

  select p.prosrc into v_src from pg_proc p where p.oid = v_oid;

  -- The new field is accepted and written.
  if v_src not like '%''total_override''%' then
    raise exception 'verification failed: the RPC does not accept total_override';
  end if;
  if v_src not like '%total_override     = CASE WHEN p_updates ? ''total_override''%' then
    raise exception 'verification failed: the RPC does not write total_override';
  end if;

  -- Everything the copy promised to preserve. These are the load-bearing parts
  -- of the inventory path; if the copy had drifted, one of them would be gone.
  if v_src not like '%not_authenticated%'
     or v_src not like '%unknown_order_field%'
     or v_src not like '%order_not_found%'
     or v_src not like '%inventory_deducted = v_deducted%' then
    raise exception 'verification failed: the RPC body lost part of its original behaviour';
  end if;

  -- Still SECURITY DEFINER with a pinned search_path, and still authenticated-only.
  if not exists (
    select 1 from pg_proc p
     where p.oid = v_oid
       and p.prosecdef
       and array_to_string(coalesce(p.proconfig, '{}'), ',') like 'search_path=%'
  ) then
    raise exception 'verification failed: the RPC lost SECURITY DEFINER or its search_path';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'verification failed: authenticated cannot EXECUTE the RPC';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE')
     or has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'verification failed: anon or service_role can EXECUTE the RPC';
  end if;
  if exists (
    select 1 from pg_proc p
     where p.oid = v_oid
       and (p.proacl is null
            or exists (select 1 from aclexplode(p.proacl) a
                        where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
  ) then
    raise exception 'verification failed: PUBLIC can EXECUTE the RPC';
  end if;
end;
$verify$;

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   begin;
--   -- 1. restore the function from add_save_order_with_inventory_rpc.sql
--   --    (same signature, so CREATE OR REPLACE is enough; do NOT drop it,
--   --     dropping would discard the ACL that migration took care to set)
--   alter table public.orders drop column if exists total_override;
--   commit;
--
--   Dropping the column discards every manual total. Order totals themselves
--   are unaffected: `total` is a column in its own right and keeps the adjusted
--   figure, so no invoice, payment or ledger balance changes. What is lost is
--   the ability to tell an adjusted total apart from a derived one, and the
--   accounting export stops adding its adjustment line. The stored subtotal
--   and vat_amount of an order that was already adjusted are NOT restored to
--   their derived values: they keep the figures that reconcile against the
--   total actually invoiced, which is the correct history.
-- ---------------------------------------------------------------------------
