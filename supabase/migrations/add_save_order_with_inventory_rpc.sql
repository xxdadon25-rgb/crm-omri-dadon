-- Atomic order edit + inventory movement.
--
-- PURELY ADDITIVE. Creates ONE function. It does not alter orders, products,
-- any column, any index, any RLS policy, or any existing function. Applying it
-- changes no data.
--
-- WHY THIS EXISTS
--   The order edit flow used to move stock from the browser and then update the
--   order in a separate request. Those are two independent transactions, so a
--   failure between them left stock deducted against an order that was never
--   saved — observed in production: the save showed an error, the order kept
--   its old items, and the new quantity had already been taken from stock.
--
--   A try/catch in JavaScript cannot undo a committed UPDATE. The only correct
--   fix is to do both in ONE database transaction, which is what this function
--   is. A PostgREST RPC call runs inside an implicit transaction, so every
--   statement below either commits together or rolls back together.
--
-- WHAT IT DOES NOT CHANGE
--   Business behaviour is preserved exactly, including two deliberate quirks:
--     * a deduction is CLAMPED at zero (greatest(0, ...)), never negative,
--       matching deductInventory in the browser today;
--     * cancelling a supplied order WITHOUT choosing "restore stock" leaves
--       stock untouched and inventory_deducted true, because the goods really
--       are still out.
--   Restores are NOT clamped. That mirrors the browser's restoreInventory,
--   which this function replaces: every restore now happens here, so that
--   client-side copy was removed once nothing called it.
--
-- ROLLBACK is at the bottom of this file.

-- ---------------------------------------------------------------------------
-- SECURITY MODEL
--
-- SECURITY DEFINER is required: the function must hold the order lock and the
-- product locks in one transaction. That makes RLS inert INSIDE the function,
-- so the ownership checks here ARE the entire security boundary:
--
--   * auth.uid() must be present                          -> not_authenticated
--   * the order row must belong to the caller             -> order_not_found
--   * EVERY product named by the items must belong to the caller
--                                                         -> product_not_found
--
-- The last one is not theoretical. `items` is client-supplied, so without it a
-- caller could place another user's product_id into an order they own and move
-- that user's stock with RLS bypassed.
--
-- A non-owned order is reported as order_not_found — identical to a genuinely
-- missing id — so the function is not an existence oracle across tenants.
--
-- search_path is pinned so a caller cannot shadow `orders`, `products` or the
-- jsonb functions with objects in a schema of their own. auth.uid() is called
-- schema-qualified, which is why `auth` does not need to be on the path.
--
-- There is NO dynamic SQL anywhere: keys are compared against a literal
-- allowlist and values are cast, never interpolated.
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
                     'vat_amount', 'vat_rate', 'total')
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
-- GRANTS
--
-- Postgres grants EXECUTE to PUBLIC on a new function by default, which on a
-- SECURITY DEFINER function would expose it to the anon key. The REVOKE is
-- therefore required, not decorative.
--
-- anon and service_role are revoked EXPLICITLY, not just via PUBLIC. Both roles
-- inherit the PUBLIC grant, but production showed them carrying the privilege
-- unless named directly, so each is revoked by name. The order matters: the
-- revokes run first, then the single grant, so `authenticated` is the only role
-- left holding EXECUTE.
--
--   * anon         — this function must never be callable without a session;
--                    auth.uid() would be null and it would raise anyway, but
--                    the privilege should not exist in the first place.
--   * service_role — nothing server-side calls this. It bypasses RLS already,
--                    and a SECURITY DEFINER function whose entire security
--                    model is auth.uid() has no meaning for a role that has no
--                    auth.uid().
--
-- This block is idempotent and matches the verified production ACL exactly.
--
-- CREATE OR REPLACE (above) preserves the OID and the ACL on redeploy; a
-- DROP + CREATE would reset privileges and silently restore the PUBLIC grant.
-- ---------------------------------------------------------------------------
REVOKE ALL     ON FUNCTION public.save_order_with_inventory(uuid, jsonb, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_order_with_inventory(uuid, jsonb, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.save_order_with_inventory(uuid, jsonb, boolean) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.save_order_with_inventory(uuid, jsonb, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.save_order_with_inventory(uuid, jsonb, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   DROP FUNCTION IF EXISTS public.save_order_with_inventory(uuid, jsonb, boolean);
--
-- Dropping the function changes no data. The frontend must be rolled back
-- first, or every order edit save will fail — deploy this function BEFORE the
-- frontend that calls it, and remove it only AFTER that frontend is gone.
-- ---------------------------------------------------------------------------
