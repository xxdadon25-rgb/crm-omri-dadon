-- The lifecycle state of the Finbot receipt belonging to a payment.
--
-- ADDITIVE. Adds one nullable column and one partial index to public.payments.
-- No existing column is altered, nothing is dropped, no policy changes and no
-- existing row is updated.
--
-- ============================================================================
-- WHY
-- ============================================================================
-- A payment is recorded in THIS database; its receipt is created in Finbot's.
-- The two can disagree, and until now nothing could say so. The single-invoice
-- payment dialog wrapped its whole receipt attempt in an empty catch and
-- otherwise tested only `ok`, so a refusal by Finbot and a lost connection
-- both ended as silence: the money was recorded, no receipt existed, and no
-- column anywhere recorded that fact. Reconciling meant opening Finbot and
-- comparing by hand, with nothing to compare against.
--
-- ============================================================================
-- THE STATES, AND THE ONE THAT MATTERS
-- ============================================================================
--   pending    recorded, receipt attempt not yet resolved
--   confirmed  Finbot accepted it AND returned a document identifier
--   failed     Finbot received the request and REFUSED it — no document was
--              created, so issuing the receipt again is safe
--   uncertain  the outcome is UNKNOWN: a document may or may not exist
--
-- 'uncertain' is the reason this column exists. A timeout, a 5xx, or a 2xx
-- body we cannot parse all leave a real possibility that Finbot created the
-- document. Retrying such a request issues a SECOND tax receipt for one
-- payment — a reporting error this system cannot undo. So 'uncertain' is never
-- retried automatically; it is surfaced for a human to reconcile, and the
-- partial index below is what makes finding those rows cheap.
--
-- NULL means "unknown, recorded before this column existed". It is deliberately
-- distinct from 'uncertain', which is a positive finding about one attempt.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS receipt_status TEXT;

-- Written as a NOT VALID-free plain CHECK on purpose: every existing row is
-- NULL, and NULL satisfies a CHECK, so this cannot fail on legacy data.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payments_receipt_status_check'
       AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_receipt_status_check
      CHECK (receipt_status IS NULL
             OR receipt_status IN ('pending', 'confirmed', 'failed', 'uncertain'));
  END IF;
END
$$;

COMMENT ON COLUMN public.payments.receipt_status IS
  'Lifecycle of this payment''s Finbot receipt: pending | confirmed | failed | uncertain. NULL = recorded before this column existed. ''uncertain'' means a document MAY exist and the request must never be retried automatically.';

-- The reconciliation queue: payments whose receipt is not settled. Partial, so
-- it indexes only the rows anyone will ever look for.
CREATE INDEX IF NOT EXISTS payments_receipt_attention_idx
  ON public.payments (user_id, payment_date)
  WHERE receipt_status IN ('pending', 'failed', 'uncertain');

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $check$
DECLARE
  v_ok BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'payments'
       AND column_name = 'receipt_status'
  ) THEN
    RAISE EXCEPTION 'verification failed: payments.receipt_status was not added';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payments_receipt_status_check'
       AND conrelid = 'public.payments'::regclass
  ) THEN
    RAISE EXCEPTION 'verification failed: the state CHECK constraint is missing';
  END IF;

  -- The constraint must name every state, not merely exist: a CHECK that has
  -- drifted would silently accept a value the application cannot interpret.
  SELECT pg_get_constraintdef(oid) LIKE '%pending%'
     AND pg_get_constraintdef(oid) LIKE '%confirmed%'
     AND pg_get_constraintdef(oid) LIKE '%failed%'
     AND pg_get_constraintdef(oid) LIKE '%uncertain%'
    INTO v_ok
    FROM pg_constraint
   WHERE conname = 'payments_receipt_status_check'
     AND conrelid = 'public.payments'::regclass;

  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'verification failed: the CHECK does not name the four states';
  END IF;
END
$check$;

-- ============================================================================
-- ROLLBACK
--
-- DROP INDEX IF EXISTS public.payments_receipt_attention_idx;
-- ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_receipt_status_check;
-- ALTER TABLE public.payments DROP COLUMN IF EXISTS receipt_status;
--
-- Dropping the column loses only the knowledge of which receipts were
-- confirmed. No amount, balance or payment row is affected.
-- ============================================================================
