-- Manual allocation of ONE payment across several invoices.
--
-- ADDITIVE. Adds one nullable column to public.payments, two indexes and one
-- function. It alters no existing column, drops nothing, changes no policy and
-- updates no existing row. Every payment recorded so far keeps NULL in the new
-- column, which is the correct representation: it was never part of a group.
--
-- ============================================================================
-- THE DATA MODEL, AND WHY THERE IS NO ALLOCATIONS TABLE
-- ============================================================================
-- A payment split across N invoices is stored as N ROWS IN public.payments —
-- one per invoice, each with a valid invoice_id — all sharing one
-- payment_group_id.
--
-- A separate payment_allocations table would be redundant: payments already
-- has exactly the shape of an allocation (invoice_id + amount + method + date),
-- and inventing a parallel table would mean two places to keep in step.
--
-- The decisive advantage is that NOTHING DOWNSTREAM CHANGES. Twelve places in
-- the application compute a balance as invoices.total - invoices.paid_amount,
-- and the customer statement reads payments row by row. Because this function
-- maintains paid_amount exactly as the single-invoice dialog does, every one of
-- those keeps working untouched, and "שולם חלקית" falls out of the existing
-- formula rather than needing new status logic.
--
-- payment_group_id is what makes the N rows recognisable as one real payment:
-- the ledger groups by it, and ONE receipt is issued for the group.
--
-- ============================================================================
-- WHY A SECURITY DEFINER FUNCTION AND NOT CLIENT-SIDE WRITES
-- ============================================================================
-- The single-invoice dialog already performs two non-atomic writes (insert the
-- payment, then update the invoice). If the second fails, a payment exists with
-- no matching paid_amount. Splitting across N invoices would multiply that
-- window by N: a browser that dies halfway leaves some invoices credited and
-- others not, with no record of which.
--
-- Everything here therefore happens inside ONE transaction, with:
--   * authentication  — auth.uid() must be present
--   * ownership       — every invoice must belong to the caller
--   * locking         — SELECT ... FOR UPDATE on each invoice, so two
--                       simultaneous payments cannot both read the same
--                       paid_amount and overpay
--   * overpayment     — each allocation is checked against the invoice's live
--                       remaining balance INSIDE the lock
--   * idempotency     — a re-submitted group id returns the existing result
--                       instead of inserting the payments a second time,
--                       serialised per group by a transaction-level advisory
--                       lock so two SIMULTANEOUS submissions of one group
--                       cannot both read "not recorded yet"
--
-- NOT in scope (deliberately): automatic allocation, and cancelling or
-- reversing a grouped payment. Both are separate decisions.

-- DEPENDS ON 20261105110000_add_receipt_lifecycle_status.sql, which adds
-- payments.receipt_status. The function below inserts 'pending' into it, so
-- applying this migration alone would leave every allocation call failing at
-- its INSERT. Checked explicitly rather than discovered at runtime.
DO $dep$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'payments'
       AND column_name = 'receipt_status'
  ) THEN
    RAISE EXCEPTION
      'apply 20261105110000_add_receipt_lifecycle_status.sql first: payments.receipt_status is missing';
  END IF;
END
$dep$;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_group_id UUID;

COMMENT ON COLUMN public.payments.payment_group_id IS
  'Groups the payment rows that make up ONE real payment split across several invoices. NULL for an ordinary single-invoice payment. One Finbot receipt is issued per group.';

-- The ledger groups by this; partial because almost every row is NULL.
CREATE INDEX IF NOT EXISTS payments_group_idx
  ON public.payments (payment_group_id)
  WHERE payment_group_id IS NOT NULL;

-- Idempotency lookup: "has this group already been recorded by this user?"
CREATE INDEX IF NOT EXISTS payments_user_group_idx
  ON public.payments (user_id, payment_group_id)
  WHERE payment_group_id IS NOT NULL;

-- ============================================================================
-- The function.
--
-- p_allocations is [{ "invoice_id": uuid, "amount": number }, ...] — amounts in
-- SHEKELS, as the rest of the application stores them. Comparisons are done on
-- values rounded to the agora, so a client sending 33.333333 cannot slip past
-- the remaining-balance check by a fraction of an agora.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.allocate_payment_across_invoices(
  p_group_id        UUID,
  p_customer_id     UUID,
  p_allocations     JSONB,
  p_payment_method  TEXT,
  p_payment_date    DATE,
  p_reference       TEXT    DEFAULT NULL,
  p_notes           TEXT    DEFAULT NULL,
  p_bank_name       TEXT    DEFAULT NULL,
  p_bank_branch     TEXT    DEFAULT NULL,
  p_bank_account    TEXT    DEFAULT NULL,
  p_check_number    TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
-- Mandatory under SECURITY DEFINER: without it a caller-controlled search_path
-- could resolve `payments` or `invoices` to objects of their own choosing.
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_existing     INT;
  v_alloc        JSONB;
  v_invoice_id   UUID;
  v_amount       NUMERIC;
  v_inv          RECORD;
  v_remaining    NUMERIC;
  v_new_paid     NUMERIC;
  v_new_status   TEXT;
  v_total        NUMERIC := 0;
  v_count        INT := 0;
  v_payment_ids  UUID[] := ARRAY[]::UUID[];
  v_payment_id   UUID;
  -- invoice_id -> payment_id -> amount, returned explicitly. The caller issues
  -- one Finbot receipt per allocation and must write each receipt number onto
  -- the right row; matching by array POSITION would break silently the day the
  -- loop order changes, so the pairing is stated rather than implied.
  v_lines        JSONB := '[]'::jsonb;
  v_customer     RECORD;
  -- Invoices this payment settled in full. Returned so the caller can complete
  -- the orders they cover, exactly as the single-invoice flow does.
  v_settled      UUID[] := ARRAY[]::UUID[];
BEGIN
  -- ---- authentication -----------------------------------------------------
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'group_id_required';
  END IF;

  -- ---- serialise the group ------------------------------------------------
  -- Taken BEFORE the idempotency count, and this ordering is the whole point.
  --
  -- Under READ COMMITTED the count below cannot see an uncommitted sibling, so
  -- two simultaneous submissions of the SAME group id would both read zero and
  -- both insert. Blocking on the invoice locks further down does not save it:
  -- by then the stale count has already been taken, and after the first
  -- transaction commits the second simply proceeds with it — recording the
  -- same money twice whenever the invoices still have room for it.
  --
  -- A unique constraint cannot express this, because N rows legitimately share
  -- one group id. A transaction-level advisory lock keyed on the group does:
  -- the second caller waits here until the first commits or aborts, and then
  -- its count sees the truth.
  --
  -- The first key is a fixed namespace so this cannot collide with an advisory
  -- lock taken elsewhere; a hash collision between two different groups only
  -- makes them take turns, which is harmless.
  PERFORM pg_advisory_xact_lock(492117, hashtext(p_group_id::text));

  -- ---- idempotency --------------------------------------------------------
  -- A re-submitted group (double click, retried request, a browser that lost
  -- the response) must NOT record the payment twice.
  SELECT count(*) INTO v_existing
    FROM public.payments
   WHERE user_id = v_uid AND payment_group_id = p_group_id;

  IF v_existing > 0 THEN
    SELECT coalesce(sum(amount), 0), count(*)
      INTO v_total, v_count
      FROM public.payments
     WHERE user_id = v_uid AND payment_group_id = p_group_id;

    -- Which of this group's invoices are fully paid NOW. Reported on the
    -- retry path too, so a submission whose response was lost still gets its
    -- orders completed; that update is scoped by order status and is therefore
    -- harmless to repeat.
    SELECT coalesce(array_agg(DISTINCT i.id), ARRAY[]::uuid[])
      INTO v_settled
      FROM public.payments p
      JOIN public.invoices i ON i.id = p.invoice_id AND i.user_id = v_uid
     WHERE p.user_id = v_uid AND p.payment_group_id = p_group_id
       AND i.payment_status = 'שולם';

    -- The group's rows and the state of each one's receipt, so the caller can
    -- say WHICH allocations still lack a confirmed receipt. It still issues
    -- nothing on this path: a row left at 'pending' may have been attempted by
    -- the submission whose response was lost, and re-issuing it could produce
    -- a second tax document for the same allocation.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'invoice_id', p.invoice_id, 'payment_id', p.id, 'amount', p.amount,
             'invoice_number', p.invoice_number, 'receipt_status', p.receipt_status)
           ORDER BY p.amount), '[]'::jsonb)
      INTO v_lines
      FROM public.payments p
     WHERE p.user_id = v_uid AND p.payment_group_id = p_group_id;

    RETURN jsonb_build_object(
      'ok', true, 'already_recorded', true,
      'group_id', p_group_id, 'payment_count', v_count, 'total_amount', v_total,
      'settled_invoice_ids', to_jsonb(v_settled),
      'lines', v_lines
    );
  END IF;

  -- ---- the allocation list ------------------------------------------------
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array'
     OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'no_allocations';
  END IF;

  -- The customer must belong to the caller. Resolved once, and its name is
  -- denormalised onto the payment rows exactly as the existing dialog does.
  SELECT * INTO v_customer
    FROM public.customers
   WHERE id = p_customer_id AND user_id = v_uid;
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'customer_not_found';
  END IF;

  -- ---- one invoice at a time, under lock ----------------------------------
  FOR v_alloc IN SELECT jsonb_array_elements(p_allocations)
  LOOP
    v_invoice_id := (v_alloc ->> 'invoice_id')::uuid;
    v_amount     := round((v_alloc ->> 'amount')::numeric, 2);

    IF v_invoice_id IS NULL THEN
      RAISE EXCEPTION 'invoice_id_required';
    END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'invalid_amount:%', v_invoice_id;
    END IF;

    -- FOR UPDATE is the whole point: it serialises two payments racing for the
    -- same invoice. Without it both could read paid_amount = 0 and each write
    -- its own total, losing one of them and overpaying the invoice.
    --
    -- The ownership filter is part of the same statement, so an invoice that is
    -- not the caller's is indistinguishable from one that does not exist.
    SELECT * INTO v_inv
      FROM public.invoices
     WHERE id = v_invoice_id AND user_id = v_uid
     FOR UPDATE;

    IF v_inv IS NULL THEN
      RAISE EXCEPTION 'invoice_not_found:%', v_invoice_id;
    END IF;

    -- An invoice belonging to a different customer must never be settled by
    -- this customer's payment.
    IF v_inv.customer_id IS DISTINCT FROM p_customer_id THEN
      RAISE EXCEPTION 'invoice_customer_mismatch:%', v_invoice_id;
    END IF;

    -- A credited invoice is no longer a debt; paying it would be meaningless.
    IF v_inv.credited_at IS NOT NULL THEN
      RAISE EXCEPTION 'invoice_credited:%', v_invoice_id;
    END IF;

    -- ---- overpayment prevention, decided inside the lock ----------------
    v_remaining := round(coalesce(v_inv.total, 0) - coalesce(v_inv.paid_amount, 0), 2);
    IF v_amount > v_remaining THEN
      RAISE EXCEPTION 'overpayment:%:%:%', v_invoice_id, v_amount, v_remaining;
    END IF;

    v_new_paid := round(coalesce(v_inv.paid_amount, 0) + v_amount, 2);
    -- The SAME rule the single-invoice dialog applies, so a split payment and
    -- a direct one leave an invoice in an identical state.
    v_new_status := CASE WHEN v_new_paid >= round(coalesce(v_inv.total, 0), 2)
                         THEN 'שולם' ELSE 'שולם חלקית' END;

    INSERT INTO public.payments (
      user_id, invoice_id, invoice_number, customer_id, customer_name,
      amount, payment_method, payment_date, reference, notes, status,
      bank_name, bank_branch, bank_account, check_number, payment_group_id,
      -- The receipt has not been attempted yet when this transaction commits.
      -- Starting at 'pending' means a payment whose caller dies before the
      -- webhook call is findable afterwards instead of looking complete.
      receipt_status
    ) VALUES (
      v_uid, v_invoice_id, v_inv.invoice_number, p_customer_id, v_customer.name,
      v_amount, p_payment_method, p_payment_date, p_reference, p_notes, 'אושר',
      p_bank_name, p_bank_branch, p_bank_account, p_check_number, p_group_id,
      'pending'
    )
    RETURNING id INTO v_payment_id;

    v_payment_ids := v_payment_ids || v_payment_id;
    v_lines := v_lines || jsonb_build_object(
      'invoice_id', v_invoice_id,
      'payment_id', v_payment_id,
      'amount', v_amount,
      'invoice_number', v_inv.invoice_number,
      'payment_status', v_new_status
    );
    IF v_new_status = 'שולם' THEN
      v_settled := v_settled || v_invoice_id;
    END IF;

    UPDATE public.invoices
       SET paid_amount = v_new_paid,
           payment_status = v_new_status
     WHERE id = v_invoice_id AND user_id = v_uid;

    v_total := v_total + v_amount;
    v_count := v_count + 1;
  END LOOP;

  -- Any RAISE above aborts the whole function, so either every allocation was
  -- recorded or none was. There is no partial state to clean up.
  RETURN jsonb_build_object(
    'ok', true, 'already_recorded', false,
    'group_id', p_group_id, 'payment_count', v_count,
    'total_amount', v_total, 'payment_ids', to_jsonb(v_payment_ids),
    'settled_invoice_ids', to_jsonb(v_settled),
    'lines', v_lines
  );
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_payment_across_invoices(
  UUID, UUID, JSONB, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_payment_across_invoices(
  UUID, UUID, JSONB, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.allocate_payment_across_invoices(
  UUID, UUID, JSONB, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.allocate_payment_across_invoices(
  UUID, UUID, JSONB, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Records ONE payment split across several invoices as N payments rows sharing payment_group_id, inside a single transaction. Authenticates via auth.uid(), verifies ownership of the customer and every invoice, locks each invoice FOR UPDATE, refuses any allocation above an invoice''s remaining balance, and is idempotent on p_group_id (serialised by a transaction-level advisory lock, so concurrent submissions of one group cannot double-record). Returns settled_invoice_ids — the invoices the payment brought to שולם — so the caller can complete their linked orders. Maintains invoices.paid_amount and payment_status exactly as the single-invoice flow does.';

-- ============================================================================
-- VERIFICATION — raises rather than leaving a half-applied state unnoticed.
-- ============================================================================
DO $check$
DECLARE
  v_secdef BOOLEAN;
  v_config TEXT[];
  v_public BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'payments'
       AND column_name = 'payment_group_id'
  ) THEN
    RAISE EXCEPTION 'verification failed: payments.payment_group_id was not added';
  END IF;

  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_config
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'allocate_payment_across_invoices';

  IF v_secdef IS NULL THEN
    RAISE EXCEPTION 'verification failed: function was not created';
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'verification failed: function is not SECURITY DEFINER';
  END IF;
  IF v_config IS NULL OR NOT ('search_path=public, pg_temp' = ANY (v_config)) THEN
    RAISE EXCEPTION 'verification failed: search_path is not pinned (proconfig=%)', v_config;
  END IF;

  -- PUBLIC is ACL grantee oid 0, not a role, so aclexplode is the only
  -- reliable way to ask. A null proacl means the default EXECUTE-to-PUBLIC,
  -- which the REVOKE above exists to remove.
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE n.nspname = 'public' AND p.proname = 'allocate_payment_across_invoices'
       AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) INTO v_public;
  IF v_public THEN
    RAISE EXCEPTION 'verification failed: EXECUTE is still granted to PUBLIC';
  END IF;
END
$check$;

-- ============================================================================
-- ROLLBACK
--
-- DROP FUNCTION IF EXISTS public.allocate_payment_across_invoices(
--   UUID, UUID, JSONB, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
-- DROP INDEX IF EXISTS public.payments_user_group_idx;
-- DROP INDEX IF EXISTS public.payments_group_idx;
-- ALTER TABLE public.payments DROP COLUMN IF EXISTS payment_group_id;
--
-- Dropping the column loses only the knowledge of WHICH payments formed one
-- real payment. The payment rows themselves, every invoice's paid_amount and
-- every balance in the application are unaffected, because a grouped payment
-- is already stored as ordinary payment rows.
-- ============================================================================
