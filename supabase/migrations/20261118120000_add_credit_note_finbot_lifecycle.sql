-- The lifecycle state of the Finbot credit document belonging to a credit note,
-- and operation-level idempotency for issuing one.
--
-- ADDITIVE. Adds five nullable columns, three partial indexes, three CHECK
-- constraints and one trigger to public.credit_notes. No existing column is
-- altered, nothing is dropped, no policy changes, and NOT ONE EXISTING ROW IS
-- UPDATED — see "LEGACY ROWS" below for why no backfill is needed.
--
-- public.invoices is not touched at all.
--
-- ============================================================================
-- WHY
-- ============================================================================
-- A credit note is recorded in THIS database; its credit document is created in
-- Finbot's. The two can disagree, and nothing could say so. CreditNoteButton
-- wraps its whole Finbot attempt in a try/catch, shows a toast, and proceeds:
-- the local credit note exists, the invoice is marked credited, the stock comes
-- back, and no column anywhere records that no tax document was ever issued.
-- Reconciling means opening Finbot and comparing by hand, with nothing to
-- compare against.
--
-- Worse than a payment receipt: the local credit note is what stops the invoice
-- being treated as a debt, so an unissued credit document silently removes a
-- receivable from the books.
--
-- ============================================================================
-- THE STATES, AND THE ONE THAT MATTERS
-- ============================================================================
--   pending    the credit note is recorded, the Finbot attempt is unresolved
--   confirmed  Finbot accepted it AND returned a document identifier
--   failed     Finbot received the request and REFUSED it, or the request never
--              left this system — no document was created, so issuing it again
--              is safe
--   uncertain  the outcome is UNKNOWN: a document may or may not exist
--
-- 'uncertain' is the reason this column exists. A timeout, a 5xx, or a 2xx body
-- that cannot be parsed all leave a real possibility that Finbot created the
-- document. Issuing it again would put a SECOND credit document for one sale
-- into the customer's tax records, understating revenue — an error this system
-- cannot undo from here.
--
-- AND IT CANNOT BE RESOLVED BY ASKING. Finbot's API is three POST endpoints
-- (/income and two Shopify ones) and nothing else: there is no GET, no document
-- lookup, and IncomeDto carries no idempotency key. So no amount of code can
-- establish whether the document exists. Only a human looking at Finbot can.
-- That is not a style preference, it is the whole design constraint, and the
-- trigger below enforces it rather than trusting every future caller to
-- remember it.
--
-- ============================================================================
-- LEGACY ROWS: NULL, AND NO BACKFILL
-- ============================================================================
-- NULL means "recorded before this column existed". It is deliberately distinct
-- from 'uncertain', which is a positive finding about one attempt — the same
-- convention as payments.receipt_status.
--
-- Nothing is backfilled, because nothing needs to be. A legacy row already
-- carries its own evidence: external_credit_note_number is written ONLY after
-- Finbot returned status==1 with a document number, so a legacy row that has
-- one has provider-verified evidence, and a legacy row that has none does not.
-- The application therefore classifies a NULL row from that column alone, with
-- no write to existing data:
--
--   finbot_status = 'confirmed'                      -> confirmed
--   finbot_status IS NULL AND external number set    -> confirmed (legacy)
--   anything else                                    -> NOT confirmed
--
-- An UPDATE of 13 existing columns to assert something the data already proves
-- would be a change to financial records for no gain. This migration makes no
-- such change.
--
-- ============================================================================
-- WHAT THIS MIGRATION DOES NOT DO
-- ============================================================================
-- It makes the state representable and makes illegal transitions impossible.
-- It does NOT change when inventory is restored or when a debt stops being
-- counted: both of those live in application code (CreditNoteButton.jsx and
-- DebtSummary.jsx) and move in Gates B and C. Until then, behaviour is exactly
-- as it is today. That is the point of an additive gate — nothing changes
-- except what can now be recorded and relied upon.

-- ----------------------------------------------------------------------------
-- COLUMNS
-- ----------------------------------------------------------------------------
ALTER TABLE public.credit_notes
  ADD COLUMN IF NOT EXISTS finbot_status TEXT,
  -- The provider's own words when it refused, for the reconciliation screen.
  -- Never shown to a customer.
  ADD COLUMN IF NOT EXISTS finbot_error TEXT,
  ADD COLUMN IF NOT EXISTS finbot_attempted_at TIMESTAMPTZ,
  -- How a 'confirmed' came to be: returned by the API, or typed in by the owner
  -- from Finbot's own screen while reconciling an 'uncertain'. The distinction
  -- matters in an audit: one is the provider's assertion, the other a person's.
  ADD COLUMN IF NOT EXISTS finbot_confirmed_source TEXT,
  -- ONE ISSUING OPERATION, ONE CREDIT NOTE.
  --
  -- Not a unique invoice_id: an invoice may legitimately receive several partial
  -- credits, so uniqueness has to be about the OPERATION, not the invoice. The
  -- client generates this before it writes anything; a retry of the same click,
  -- a second tab, or a resubmitted request carries the same value and collides
  -- with the row that already exists instead of creating a second credit.
  ADD COLUMN IF NOT EXISTS operation_id UUID;

-- ----------------------------------------------------------------------------
-- CONSTRAINTS
-- ----------------------------------------------------------------------------
-- Plain CHECKs, not NOT VALID: every existing row has NULL in these columns and
-- NULL satisfies a CHECK, so none of them can fail on legacy data.

ALTER TABLE public.credit_notes
  DROP CONSTRAINT IF EXISTS credit_notes_finbot_status_check;
ALTER TABLE public.credit_notes
  ADD CONSTRAINT credit_notes_finbot_status_check
  CHECK (finbot_status IS NULL
         OR finbot_status IN ('pending', 'confirmed', 'failed', 'uncertain'));

-- CONFIRMED REQUIRES EVIDENCE.
--
-- 'confirmed' is the only state that removes a receivable from the books, so it
-- may not be asserted without the document identifier that proves the document
-- exists. This is what makes "confirmed credits require verified Finbot
-- evidence" a property of the database rather than a habit of the caller.
ALTER TABLE public.credit_notes
  DROP CONSTRAINT IF EXISTS credit_notes_confirmed_needs_evidence_check;
ALTER TABLE public.credit_notes
  ADD CONSTRAINT credit_notes_confirmed_needs_evidence_check
  CHECK (finbot_status IS DISTINCT FROM 'confirmed'
         OR (external_credit_note_number IS NOT NULL
             AND btrim(external_credit_note_number) <> ''));

ALTER TABLE public.credit_notes
  DROP CONSTRAINT IF EXISTS credit_notes_confirmed_source_check;
ALTER TABLE public.credit_notes
  ADD CONSTRAINT credit_notes_confirmed_source_check
  CHECK (finbot_confirmed_source IS NULL
         OR finbot_confirmed_source IN ('api', 'manual'));

-- ----------------------------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------------------------
-- Idempotency. Partial, so the existing rows — all with operation_id NULL —
-- are not indexed at all and cannot collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS credit_notes_operation_idempotency_idx
  ON public.credit_notes (user_id, operation_id)
  WHERE operation_id IS NOT NULL;

-- ONE FINBOT DOCUMENT, ONE CREDIT NOTE.
--
-- A document number is unique in Finbot, so recording the same one against two
-- credit notes means one of them is wrong. The likeliest way that happens is
-- reconciliation: the owner reads a number off Finbot's screen and enters it
-- against the wrong row, or against two rows for the same event. Caught here
-- instead of quietly double-crediting a customer.
CREATE UNIQUE INDEX IF NOT EXISTS credit_notes_external_number_idx
  ON public.credit_notes (user_id, external_credit_note_number)
  WHERE external_credit_note_number IS NOT NULL;

-- The reconciliation queue: the rows a human has to look at. Partial, so it
-- indexes only those and stays small while most credit notes are settled.
CREATE INDEX IF NOT EXISTS credit_notes_finbot_attention_idx
  ON public.credit_notes (user_id, created_at DESC)
  WHERE finbot_status IN ('pending', 'failed', 'uncertain');

-- ----------------------------------------------------------------------------
-- THE TRANSITION GUARD
-- ----------------------------------------------------------------------------
-- The legal moves, and the two that are refused:
--
--   NULL      -> any state            legacy row being classified
--   pending   -> confirmed|failed|uncertain
--   failed    -> pending              a retry, which is SAFE: no document exists
--   failed    -> confirmed            the owner found one after all
--   uncertain -> confirmed            the owner read the number off Finbot
--   uncertain -> failed               the owner checked; nothing was created
--
--   uncertain -> pending              REFUSED. This is exactly what an
--                                     automatic retry looks like, and it is the
--                                     one move that can produce a duplicate tax
--                                     document. A human must first establish
--                                     which it was.
--   confirmed -> anything             REFUSED. A confirmed credit document is
--                                     issued and reported; its state is history.
--                                     A mistake in it is corrected by issuing
--                                     another document, never by editing this
--                                     row.
--   non-NULL  -> NULL                 REFUSED. A finding is not erasable.
CREATE OR REPLACE FUNCTION public.credit_notes_guard_finbot_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public, pg_temp
AS $fn$
BEGIN
  -- Untouched status: every other column stays freely updatable, so attaching
  -- a PDF url or correcting a reason is unaffected by any of this.
  IF NEW.finbot_status IS NOT DISTINCT FROM OLD.finbot_status THEN
    RETURN NEW;
  END IF;

  IF OLD.finbot_status IS NOT NULL AND NEW.finbot_status IS NULL THEN
    RAISE EXCEPTION
      'credit_notes: refusing to erase finbot_status (was %). A finding about a tax document is not reversible.',
      OLD.finbot_status;
  END IF;

  IF OLD.finbot_status = 'confirmed' THEN
    RAISE EXCEPTION
      'credit_notes: % is confirmed and cannot change state. Correct it by issuing another credit document.',
      OLD.credit_note_number;
  END IF;

  IF OLD.finbot_status = 'uncertain' AND NEW.finbot_status = 'pending' THEN
    RAISE EXCEPTION
      'credit_notes: % is uncertain — a Finbot document may already exist for it, and Finbot has no endpoint that can tell us. Retrying would risk a second credit document. Check Finbot: if the document exists set finbot_status to confirmed with its number, and only if it does not, set failed.',
      OLD.credit_note_number;
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS credit_notes_finbot_status_guard ON public.credit_notes;
CREATE TRIGGER credit_notes_finbot_status_guard
  BEFORE UPDATE ON public.credit_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.credit_notes_guard_finbot_status();

-- ----------------------------------------------------------------------------
-- COMMENTS
-- ----------------------------------------------------------------------------
COMMENT ON COLUMN public.credit_notes.finbot_status IS
  'Lifecycle of the Finbot credit document: pending | confirmed | failed | uncertain. NULL = recorded before this column existed; classify such a row from external_credit_note_number. Only confirmed may reduce a receivable. uncertain is NEVER retried automatically — Finbot has no lookup endpoint, so only a human can resolve it.';
COMMENT ON COLUMN public.credit_notes.finbot_error IS
  'The provider''s refusal text for the reconciliation screen. Internal only.';
COMMENT ON COLUMN public.credit_notes.finbot_attempted_at IS
  'When the most recent Finbot issuing attempt was made.';
COMMENT ON COLUMN public.credit_notes.finbot_confirmed_source IS
  'How a confirmed state was established: api (returned by Finbot) or manual (entered by the owner from Finbot''s own screen while reconciling).';
COMMENT ON COLUMN public.credit_notes.operation_id IS
  'Client-generated id for ONE issuing operation, unique per user. Makes a retried click, a second tab or a resubmitted request collide with the credit note that already exists instead of creating a second one. Deliberately not a unique invoice_id: one invoice may receive several partial credits.';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $check$
DECLARE
  v_def  TEXT;
  v_rows BIGINT;
  v_n    INT;
BEGIN
  -- 1. every column present
  SELECT count(*) INTO v_n
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'credit_notes'
     AND column_name IN ('finbot_status', 'finbot_error', 'finbot_attempted_at',
                         'finbot_confirmed_source', 'operation_id');
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'verification failed: expected 5 new columns, found %', v_n;
  END IF;

  -- 2. the state CHECK must NAME every state, not merely exist
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint WHERE conname = 'credit_notes_finbot_status_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'verification failed: the state CHECK is missing';
  END IF;
  IF v_def NOT LIKE '%pending%' OR v_def NOT LIKE '%confirmed%'
     OR v_def NOT LIKE '%failed%' OR v_def NOT LIKE '%uncertain%' THEN
    RAISE EXCEPTION 'verification failed: the CHECK does not name the four states (%)', v_def;
  END IF;
  -- NULL must stay legal: it is what every existing row holds.
  IF v_def NOT LIKE '%IS NULL%' THEN
    RAISE EXCEPTION 'verification failed: the CHECK does not permit NULL (%)', v_def;
  END IF;

  -- 3. confirmed must be unassertable without evidence
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'credit_notes_confirmed_needs_evidence_check') THEN
    RAISE EXCEPTION 'verification failed: the confirmed-needs-evidence CHECK is missing';
  END IF;

  -- 4. the indexes
  FOR v_def IN SELECT x FROM unnest(ARRAY[
        'credit_notes_operation_idempotency_idx',
        'credit_notes_external_number_idx',
        'credit_notes_finbot_attention_idx']) AS x LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                    WHERE schemaname = 'public' AND indexname = v_def) THEN
      RAISE EXCEPTION 'verification failed: index % is missing', v_def;
    END IF;
  END LOOP;

  -- 5. the guard
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'credit_notes_finbot_status_guard'
                    AND tgrelid = 'public.credit_notes'::regclass
                    AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'verification failed: the transition guard is missing';
  END IF;

  -- 6. NOTHING WAS CLASSIFIED. Every pre-existing row must still be NULL: this
  --    migration asserts nothing about rows it did not create.
  SELECT count(*) INTO v_rows
    FROM public.credit_notes WHERE finbot_status IS NOT NULL;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'verification failed: % existing rows were classified; this migration must not write to them', v_rows;
  END IF;

  -- 7. invoices untouched
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'invoices'
                AND column_name LIKE 'finbot_status%') THEN
    RAISE EXCEPTION 'verification failed: public.invoices was modified';
  END IF;

  RAISE NOTICE 'credit_notes Finbot lifecycle: OK (existing rows left NULL, as intended)';
END
$check$;

-- ============================================================================
-- ROLLBACK
--
-- DROP TRIGGER IF EXISTS credit_notes_finbot_status_guard ON public.credit_notes;
-- DROP FUNCTION IF EXISTS public.credit_notes_guard_finbot_status();
-- DROP INDEX IF EXISTS public.credit_notes_finbot_attention_idx;
-- DROP INDEX IF EXISTS public.credit_notes_external_number_idx;
-- DROP INDEX IF EXISTS public.credit_notes_operation_idempotency_idx;
-- ALTER TABLE public.credit_notes
--   DROP CONSTRAINT IF EXISTS credit_notes_confirmed_source_check,
--   DROP CONSTRAINT IF EXISTS credit_notes_confirmed_needs_evidence_check,
--   DROP CONSTRAINT IF EXISTS credit_notes_finbot_status_check;
-- ALTER TABLE public.credit_notes
--   DROP COLUMN IF EXISTS operation_id,
--   DROP COLUMN IF EXISTS finbot_confirmed_source,
--   DROP COLUMN IF EXISTS finbot_attempted_at,
--   DROP COLUMN IF EXISTS finbot_error,
--   DROP COLUMN IF EXISTS finbot_status;
--
-- Dropping these loses only the knowledge of which credit documents actually
-- exist in Finbot, and the protection against issuing one twice. No credit
-- note, invoice, payment, price or inventory figure is affected: every amount
-- lives in columns this migration never touches.
-- ============================================================================
