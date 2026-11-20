-- Issuing a credit note as THREE separable, atomic operations.
--
-- ADDITIVE. Adds two nullable columns and three functions to public, and
-- REPLACES the transition-guard function added by
-- 20261118120000_add_credit_note_finbot_lifecycle.sql (which must be applied
-- first). No existing column is altered, nothing is dropped, no policy
-- changes, and no existing row is updated.
--
-- ============================================================================
-- WHY THREE OPERATIONS AND NOT ONE
-- ============================================================================
-- CreditNoteButton does four things in sequence over four round trips, none of
-- them transactional: insert the credit note, mark the invoice, call Finbot,
-- restore the stock. Every boundary is a place to stop:
--
--   the invoice update fails   -> an orphan credit note, the invoice still
--                                 open, the stock never returned, and the next
--                                 click makes a SECOND credit note
--   Finbot fails or times out  -> the local credit exists, no tax document
--                                 does, and nothing records the gap
--   the stock loop fails midway-> some products restored, some not
--
-- And the stock came back, and the invoice stopped being a debt, BEFORE anyone
-- knew whether Finbot had issued the document at all. A credit that exists only
-- here is not a credit; it is a missing receivable.
--
-- So the work is split where the uncertainty is:
--
--   1. credit_note_reserve   local, atomic, idempotent. Records the INTENT:
--                            a credit note in state 'pending'. Touches no
--                            stock and no invoice. Safe to retry for ever.
--   2. credit_note_confirm   called only with a Finbot document number in
--                            hand. THIS is where stock returns and the invoice
--                            stops being a debt, in one transaction.
--   3. credit_note_resolve   records a failure or an unknown outcome, with the
--                            evidence that justifies calling it one or the
--                            other.
--
-- Finbot is called BETWEEN 1 and 2, outside any transaction, exactly once.
--
-- ============================================================================
-- THE CAP, AND WHAT IS NOT IN IT
-- ============================================================================
-- Cumulative credits may not exceed the invoice total. PAYMENTS ARE NOT PART OF
-- THAT SUM, and this is deliberate: a fully paid invoice can legitimately be
-- credited, which creates money owed BACK to the customer. An invariant of
-- "credits + payments <= total" would refuse the commonest refund there is —
-- paid 500, credit 200 — so it is not the invariant. Credits are bounded by the
-- goods; payments are a separate ledger, and this migration never reads or
-- writes one.
--
-- The cap counts every credit that MIGHT exist as a document — confirmed,
-- pending and uncertain — and excludes only 'failed', which is the one state
-- that means no document was created. The BALANCE (Gate C) counts only
-- 'confirmed'. The two sets differ on purpose:
--
--   the cap is conservative   so two concurrent attempts cannot both pass and
--                             together over-credit the invoice
--   the balance is strict     so a document that may not exist cannot remove a
--                             receivable
--
-- Both err towards not inventing money.

-- ============================================================================
-- GATE A MUST BE APPLIED FIRST. THIS REFUSES TO RUN OTHERWISE.
-- ============================================================================
-- Without this block, running B alone APPLIES CLEANLY — its own verification
-- passes, it emits a reassuring NOTICE, and the breakage surfaces only when
-- somebody tries to issue a credit and credit_note_reserve dies on a missing
-- column. Verified on a throwaway PostgreSQL: "column operation_id does not
-- exist", at runtime, in front of a user.
--
-- A migration that depends on another has to say so where it can still stop.
DO $require_a$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_col TEXT;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['finbot_status', 'finbot_error', 'finbot_attempted_at',
                               'finbot_confirmed_source', 'operation_id']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'credit_notes'
         AND column_name = v_col
    ) THEN
      v_missing := v_missing || v_col;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      'migration 20261118130000 requires 20261118120000_add_credit_note_finbot_lifecycle.sql to be applied first. Missing on public.credit_notes: %. Apply Gate A, then re-run this file.',
      array_to_string(v_missing, ', ');
  END IF;

  -- The guard A installs is replaced below, so its absence means A did not run
  -- even if someone added the columns by hand.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'credit_notes_finbot_status_guard'
       AND tgrelid = 'public.credit_notes'::regclass
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION
      'migration 20261118130000 requires the transition guard from 20261118120000. Apply Gate A first.';
  END IF;
END
$require_a$;

-- ----------------------------------------------------------------------------
-- COLUMNS: the evidence behind a resolution
-- ----------------------------------------------------------------------------
ALTER TABLE public.credit_notes
  -- THE ACCOUNTING DATE OF THE CREDIT DOCUMENT.
  --
  -- credit_notes had no business date at all: only `created_at`, a system
  -- timestamp. Those are not the same thing and must not be treated as one. A
  -- credit document issued at 00:40 on 1 April for a document dated 31 March
  -- lands in the wrong period if `created_at` is read as the accounting date,
  -- and a period that has been filed is then wrong.
  --
  -- NULLABLE, AND NEVER BACKFILLED. For every row already on record the
  -- accounting date is genuinely unknown — Finbot's reply carries no date, so
  -- nothing was ever stored — and writing `created_at` into it would be
  -- inventing the fact this column exists to hold. Those rows are reported for
  -- review instead.
  ADD COLUMN IF NOT EXISTS date DATE,
  -- WHY an uncertain attempt was called failed, in the resolver's own words.
  -- 'uncertain' means a tax document may exist. Downgrading that to 'failed'
  -- unlocks a retry, so it is the one judgement in this system that can lead to
  -- a duplicate tax document. It therefore may not be made silently: the
  -- trigger below refuses it unless this column is set in the same statement.
  ADD COLUMN IF NOT EXISTS finbot_resolution_note TEXT,
  ADD COLUMN IF NOT EXISTS finbot_resolved_at TIMESTAMPTZ;

COMMENT ON COLUMN public.credit_notes.date IS
  'The accounting date of the Finbot credit document: the date sent with the request that created it, recorded at confirmation. NULL = unknown, which is what every row created before this column holds; such a row is flagged for review and is NOT attributed to any reporting period. Deliberately distinct from created_at, which is a system timestamp and not an accounting date.';
COMMENT ON COLUMN public.credit_notes.finbot_resolution_note IS
  'The independent evidence for a resolution, e.g. "searched Finbot documents for 18/11/2026, no credit note against invoice 10073". REQUIRED to move uncertain -> failed, because that unlocks a retry which could issue a second tax document. Never written automatically.';
COMMENT ON COLUMN public.credit_notes.finbot_resolved_at IS
  'When an uncertain or failed outcome was resolved by a person.';

-- ----------------------------------------------------------------------------
-- THE TRANSITION GUARD, EXTENDED
-- ----------------------------------------------------------------------------
-- Same rules as Gate A, plus one: uncertain -> failed now requires evidence.
-- Replacing the function rather than adding a second trigger keeps all the
-- transition rules in one readable place.
CREATE OR REPLACE FUNCTION public.credit_notes_guard_finbot_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public, pg_temp
AS $fn$
BEGIN
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

  -- NEW IN GATE B: calling an unknown outcome a failure needs a reason.
  --
  -- 'failed' is the only state a retry is permitted from, so this transition is
  -- what converts "we do not know" into "it is safe to issue again". That is a
  -- human judgement about the world, not a fact in this database, and the
  -- judgement has to be written down next to the row it licenses.
  IF OLD.finbot_status = 'uncertain' AND NEW.finbot_status = 'failed'
     AND (NEW.finbot_resolution_note IS NULL
          OR btrim(NEW.finbot_resolution_note) = '') THEN
    RAISE EXCEPTION
      'credit_notes: % is uncertain; calling it failed unlocks a retry that could issue a second credit document. Set finbot_resolution_note in the same statement with the evidence that Finbot holds no such document.',
      OLD.credit_note_number;
  END IF;

  RETURN NEW;
END
$fn$;

-- ----------------------------------------------------------------------------
-- WHAT A RESERVATION IS IS NOT NEGOTIABLE AFTERWARDS
-- ----------------------------------------------------------------------------
-- RLS lets the owner UPDATE their own credit_notes rows, and the shipped
-- application does exactly that. So the four facts that DEFINE a reservation —
-- which lines, for how much, against which invoice, under which operation —
-- could be rewritten after reserve had validated them and before confirm acted
-- on them. Confirm re-validates, which caught the quantities; it could not
-- catch a changed `total` or a re-pointed `invoice_id`, and it should not have
-- to.
--
-- They are frozen instead. Confirm then necessarily applies the amounts and
-- quantities of the operation that was reserved, because no other values can
-- be there.
--
-- Only rows that CAME FROM reserve are frozen (operation_id IS NOT NULL).
-- Legacy credit notes predate all of this and are left exactly as mutable as
-- they were, so nothing that worked before stops working.
--
-- The three RPCs are unaffected: none of them writes any of these columns
-- after the insert.
CREATE OR REPLACE FUNCTION public.credit_notes_freeze_reserved()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public, pg_temp
AS $fn$
BEGIN
  IF OLD.operation_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.items IS DISTINCT FROM OLD.items THEN
    RAISE EXCEPTION
      'credit_notes: % was reserved; its items cannot be changed. Issue a separate credit note instead.',
      OLD.credit_note_number
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.total IS DISTINCT FROM OLD.total THEN
    RAISE EXCEPTION
      'credit_notes: % was reserved for %; its total cannot be changed.',
      OLD.credit_note_number, OLD.total
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
    RAISE EXCEPTION
      'credit_notes: % belongs to invoice %; it cannot be moved to another.',
      OLD.credit_note_number, OLD.invoice_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.operation_id IS DISTINCT FROM OLD.operation_id THEN
    RAISE EXCEPTION
      'credit_notes: the operation id of % cannot be changed — it is what makes a retry safe.',
      OLD.credit_note_number
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS credit_notes_freeze_reserved_guard ON public.credit_notes;
CREATE TRIGGER credit_notes_freeze_reserved_guard
  BEFORE UPDATE ON public.credit_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.credit_notes_freeze_reserved();

-- ----------------------------------------------------------------------------
-- 0. THE ITEM VALIDATOR — the only thing standing between a client and stock
-- ----------------------------------------------------------------------------
-- credit_note_reserve used to store `p_items` exactly as the client sent them,
-- and credit_note_confirm then restored stock from those quantities. Nothing
-- checked them against the invoice. A caller could send
--
--     [{"kind":"return","product_id":"<any product>","quantity":9999}]
--
-- and, once the credit was confirmed, 9,999 units would appear in inventory for
-- a product that may never have been on the invoice. The amount cap did not
-- catch it: it bounds the MONEY, and a line's quantity is not its money.
--
-- AND IT IS NOT ENOUGH TO CHECK ONCE. RLS lets the owner UPDATE their own
-- credit_notes rows — the shipped application does exactly that — so `items`
-- can be rewritten AFTER reserve and BEFORE confirm. So this runs in both, and
-- confirm re-validates what it is about to act on rather than trusting what
-- reserve stored.
--
-- WHAT IS ENFORCED
--   * a return line must name a real line of THAT invoice
--   * its product must be the product on that invoice line
--   * its quantity must be positive
--   * cumulative returned quantity per invoice line, across every credit note
--     that is not 'failed' — so 'pending' and 'uncertain' hold their share —
--     plus the quantities in this same request, may not exceed what was sold
--   * a price adjustment must carry no quantity, so it cannot move stock
--
-- p_exclude is the credit note being confirmed, left out of the cumulative sum
-- so a row does not count against itself.
--   * and it RETURNS the resolved lines, so the caller that moves stock uses
--     the product id taken FROM THE INVOICE rather than anything the client
--     sent. credit_note_confirm used to read
--     COALESCE(line ->> 'product_id', line ->> 'id') — and `id` was never
--     validated against anything, so a line carrying an index and no
--     product_id skipped the product check here (v_pid NULL) and then had
--     stock added to whatever `id` named. One resolution, used by both.
CREATE OR REPLACE FUNCTION public.credit_note_return_lines(
  p_invoice_id UUID,
  p_items      JSONB,
  p_exclude    UUID DEFAULT NULL
)
RETURNS TABLE (product_id UUID, qty NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
DECLARE
  v_uid       UUID := auth.uid();
  v_invoice   public.invoices;
  v_line      JSONB;
  v_kind      TEXT;
  v_idx       INT;
  v_qty       NUMERIC;
  v_pid       TEXT;
  v_inv_line  JSONB;
  v_inv_pid   TEXT;
  v_inv_qty   NUMERIC;
  v_already   NUMERIC;
  v_in_req    NUMERIC;
  v_matches   INT;
  -- The line's POSITION in the request. The within-request sum below has to
  -- exclude the line being checked, and two lines of one request can be
  -- byte-identical — a split over-credit is likeliest to look exactly like
  -- that — so excluding by value silently excluded both and let the split
  -- through. Position is the only thing that distinguishes them.
  v_ord       INT;
  v_out_pid   UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'credit_note_return_lines: not authenticated';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices
   WHERE id = p_invoice_id AND user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit_note_return_lines: invoice % not found', p_invoice_id;
  END IF;

  FOR v_line, v_ord IN
    SELECT t.e, t.ord FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
           WITH ORDINALITY AS t(e, ord)
  LOOP
    v_kind := COALESCE(NULLIF(v_line ->> 'kind', ''), 'return');

    -- ---- a price adjustment may not carry a quantity ----------------------
    -- Crediting an overcharge returns no goods. confirm skips any kind that is
    -- not 'return', but a line that claims to be an adjustment while carrying
    -- stock is a malformed request and is refused rather than silently zeroed:
    -- quietly rewriting a caller's figures hides the disagreement.
    IF v_kind = 'price_adjustment' THEN
      IF COALESCE(NULLIF(v_line ->> 'quantity', '')::numeric, 0) <> 0 THEN
        RAISE EXCEPTION
          'credit_note_return_lines: a price_adjustment line carries quantity % — a price credit returns no goods'
          , v_line ->> 'quantity'
          USING ERRCODE = 'check_violation';
      END IF;
      CONTINUE;
    END IF;

    IF v_kind <> 'return' THEN
      RAISE EXCEPTION 'credit_note_return_lines: unknown line kind %', v_kind
        USING ERRCODE = 'check_violation';
    END IF;

    v_qty := COALESCE(NULLIF(v_line ->> 'quantity', '')::numeric, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'credit_note_return_lines: a return line has quantity %', v_qty
        USING ERRCODE = 'check_violation';
    END IF;
    v_pid := NULLIF(v_line ->> 'product_id', '');

    -- ---- which invoice line is this reversing? ---------------------------
    -- source_line_index is the identifier: invoices.items is a JSON array with
    -- no stable id, and the index is safe because invoices are immutable.
    -- Without one, the product is resolved by id — but only when it appears on
    -- the invoice EXACTLY ONCE, since the same product can be on two lines at
    -- different prices and guessing between them would credit the wrong one.
    BEGIN
      v_idx := NULLIF(v_line ->> 'source_line_index', '')::int;
    EXCEPTION WHEN invalid_text_representation THEN
      v_idx := NULL;
    END;

    IF v_idx IS NULL THEN
      IF v_pid IS NULL THEN
        RAISE EXCEPTION
          'credit_note_return_lines: a return line has neither source_line_index nor product_id'
          USING ERRCODE = 'check_violation';
      END IF;
      SELECT count(*), min(ord - 1) INTO v_matches, v_idx
        FROM jsonb_array_elements(COALESCE(v_invoice.items, '[]'::jsonb))
             WITH ORDINALITY AS t(e, ord)
       WHERE t.e ->> 'product_id' = v_pid;
      IF v_matches = 0 THEN
        RAISE EXCEPTION
          'credit_note_return_lines: product % is not on invoice %', v_pid, p_invoice_id
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_matches > 1 THEN
        RAISE EXCEPTION
          'credit_note_return_lines: product % is on % lines of invoice %; source_line_index is required to say which',
          v_pid, v_matches, p_invoice_id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    v_inv_line := COALESCE(v_invoice.items, '[]'::jsonb) -> v_idx;
    IF v_inv_line IS NULL THEN
      RAISE EXCEPTION
        'credit_note_return_lines: invoice % has no line %', p_invoice_id, v_idx
        USING ERRCODE = 'check_violation';
    END IF;

    -- ---- the product must be THAT line's product ------------------------
    v_inv_pid := NULLIF(v_inv_line ->> 'product_id', '');
    IF v_pid IS NOT NULL AND v_inv_pid IS NOT NULL AND v_pid <> v_inv_pid THEN
      RAISE EXCEPTION
        'credit_note_return_lines: line % of invoice % is product %, not %',
        v_idx, p_invoice_id, v_inv_pid, v_pid
        USING ERRCODE = 'check_violation';
    END IF;

    v_inv_qty := COALESCE(NULLIF(v_inv_line ->> 'quantity', '')::numeric, 0);

    -- ---- cumulative, across every credit that might exist --------------
    -- 'failed' is excluded: no document was created, so it holds nothing.
    --
    -- BOTH SUMS BELOW MATCH ON THE RESOLVED INVOICE LINE, NOT ON THE RAW INDEX.
    -- They used to compare `COALESCE(index, -1) = v_idx`, which meant a line
    -- carrying no source_line_index collapsed to -1 and could never equal a
    -- resolved index. Two consequences, both real:
    --
    --   * every LEGACY credit — written before the index existed — was
    --     invisible to the cumulative check, so an invoice already fully
    --     credited by one of them could be credited again
    --   * two index-less lines in ONE request, resolving to the same product,
    --     each failed to see the other, so a split over-credit passed
    --
    -- A line resolves to this invoice line when it names the index, OR when it
    -- names no index and carries this line's product — which is the same rule
    -- the resolution above uses.
    --
    -- When a product is on several invoice lines, an index-less stored line is
    -- genuinely ambiguous and is counted against each of them. That
    -- over-counts, which only ever refuses more; the alternative is to ignore
    -- it, which under-counts and lets stock through.
    SELECT COALESCE(sum(COALESCE(NULLIF(e ->> 'quantity', '')::numeric, 0)), 0)
      INTO v_already
      FROM public.credit_notes cn,
           jsonb_array_elements(COALESCE(cn.items, '[]'::jsonb)) e
     WHERE cn.user_id = v_uid
       AND cn.invoice_id = p_invoice_id
       AND (p_exclude IS NULL OR cn.id <> p_exclude)
       AND (cn.finbot_status IS NULL OR cn.finbot_status <> 'failed')
       AND COALESCE(NULLIF(e ->> 'kind', ''), 'return') = 'return'
       AND (
             COALESCE(NULLIF(e ->> 'source_line_index', '')::int, -1) = v_idx
             OR (NULLIF(e ->> 'source_line_index', '') IS NULL
                 AND v_inv_pid IS NOT NULL
                 AND e ->> 'product_id' = v_inv_pid)
           );

    -- Other lines of THIS request that resolve to the same invoice line, so a
    -- single call cannot split an over-credit across two lines and slip past.
    SELECT COALESCE(sum(COALESCE(NULLIF(t.e ->> 'quantity', '')::numeric, 0)), 0)
      INTO v_in_req
      FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
     WHERE COALESCE(NULLIF(t.e ->> 'kind', ''), 'return') = 'return'
       AND (
             COALESCE(NULLIF(t.e ->> 'source_line_index', '')::int, -1) = v_idx
             OR (NULLIF(t.e ->> 'source_line_index', '') IS NULL
                 AND v_inv_pid IS NOT NULL
                 AND t.e ->> 'product_id' = v_inv_pid)
           )
       AND t.ord <> v_ord;

    IF v_already + v_in_req + v_qty > v_inv_qty THEN
      RAISE EXCEPTION
        'credit_note_return_lines: crediting % of line % would exceed what was sold — sold %, already credited %, also in this request %',
        v_qty, v_idx, v_inv_qty, v_already, v_in_req
        USING ERRCODE = 'check_violation';
    END IF;

    -- ---- the row the stock loop will act on -----------------------------
    -- THE PRODUCT COMES FROM THE INVOICE LINE, not from the credit line. The
    -- credit line's product_id was checked against it above when present, and
    -- when absent nothing about it was ever verified — so it is not used.
    --
    -- An invoice line with no product id, or one that is not a uuid, is a
    -- free-text line: it yields no row, and no stock moves for it. That is
    -- what the previous loop did by skipping it.
    BEGIN
      v_out_pid := NULLIF(v_inv_pid, '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_out_pid := NULL;
    END;
    IF v_out_pid IS NOT NULL THEN
      RETURN QUERY SELECT v_out_pid, v_qty;
    END IF;
  END LOOP;
END
$fn$;

REVOKE ALL ON FUNCTION public.credit_note_return_lines(UUID, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_note_return_lines(UUID, JSONB, UUID) TO authenticated;

-- The validator, as a name that reads correctly at the call sites that only
-- need the refusal. ONE implementation: this discards the rows the resolver
-- returns and keeps every RAISE.
CREATE OR REPLACE FUNCTION public.credit_note_check_items(
  p_invoice_id UUID,
  p_items      JSONB,
  p_exclude    UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
BEGIN
  PERFORM 1 FROM public.credit_note_return_lines(p_invoice_id, p_items, p_exclude);
END
$fn$;

REVOKE ALL ON FUNCTION public.credit_note_check_items(UUID, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_note_check_items(UUID, JSONB, UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 1. RESERVE — local, atomic, idempotent
-- ----------------------------------------------------------------------------
-- Records the intent to credit. Nothing observable outside this table changes:
-- no stock moves, the invoice is untouched, no payment is read. The credit note
-- lands in 'pending', which Gate C will NOT count against a receivable.
--
-- IDEMPOTENT ON p_operation_id. A second submission of the same operation — a
-- double click, a second tab, a resubmitted request, a retry after a dropped
-- response — returns the credit note that already exists and does nothing else.
-- The caller can tell the difference from `created`, and MUST read `finbot_status`
-- before deciding whether to call Finbot: an operation that already reached
-- 'uncertain' must not be sent again.
CREATE OR REPLACE FUNCTION public.credit_note_reserve(
  p_operation_id       UUID,
  p_invoice_id         UUID,
  p_credit_note_number TEXT,
  p_items              JSONB,
  p_total              NUMERIC,
  p_reason             TEXT DEFAULT NULL,
  p_order_id           UUID DEFAULT NULL,
  p_created_by         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
DECLARE
  v_uid       UUID := auth.uid();
  v_existing  public.credit_notes;
  v_invoice   public.invoices;
  v_amount    NUMERIC;
  v_committed NUMERIC;
  v_new       public.credit_notes;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'credit_note_reserve: not authenticated';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'credit_note_reserve: operation_id is required — it is what makes a retry safe';
  END IF;

  -- The amount is held as a POSITIVE magnitude for the arithmetic and stored
  -- with the sign the table already uses (negative), so nothing downstream has
  -- to change how it reads `total`.
  v_amount := round(abs(COALESCE(p_total, 0))::numeric, 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'credit_note_reserve: a credit of % is not an amount', p_total;
  END IF;

  -- ---- idempotency, BEFORE the lock and before any validation -------------
  -- A repeat of a settled operation must not be able to fail on a cap that has
  -- since been reached by its own earlier attempt.
  SELECT * INTO v_existing FROM public.credit_notes
   WHERE user_id = v_uid AND operation_id = p_operation_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'created', false,
      'credit_note_id', v_existing.id,
      'credit_note_number', v_existing.credit_note_number,
      'finbot_status', v_existing.finbot_status,
      'external_credit_note_number', v_existing.external_credit_note_number,
      'total', v_existing.total
    );
  END IF;

  -- ---- one writer per invoice --------------------------------------------
  -- Taken BEFORE the cap is computed. Read committed would otherwise let two
  -- concurrent reservations each read a stale sum and both pass.
  PERFORM pg_advisory_xact_lock(492118, hashtext(p_invoice_id::text));

  SELECT * INTO v_invoice FROM public.invoices
   WHERE id = p_invoice_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit_note_reserve: invoice % not found', p_invoice_id;
  END IF;

  -- ---- the cap -----------------------------------------------------------
  -- Everything that might exist as a document. 'failed' is excluded: it is the
  -- one state that means Finbot created nothing.
  SELECT COALESCE(sum(round(abs(total)::numeric, 2)), 0) INTO v_committed
    FROM public.credit_notes
   WHERE user_id = v_uid
     AND invoice_id = p_invoice_id
     AND (finbot_status IS NULL OR finbot_status <> 'failed');

  IF v_committed + v_amount > round(abs(COALESCE(v_invoice.total, 0))::numeric, 2) THEN
    RAISE EXCEPTION
      'credit_note_reserve: crediting % would take the invoice past its total — already credited %, invoice total %',
      v_amount, v_committed, round(abs(COALESCE(v_invoice.total, 0))::numeric, 2)
      USING ERRCODE = 'check_violation';
  END IF;

  -- ---- the lines, against the invoice ------------------------------------
  -- Under the same advisory lock as the amount cap, so the cumulative per-line
  -- check cannot read a stale sum either.
  PERFORM public.credit_note_check_items(p_invoice_id, COALESCE(p_items, '[]'::jsonb), NULL);

  INSERT INTO public.credit_notes (
    user_id, credit_note_number, invoice_id, order_id, customer_id,
    items, total, reason, created_by,
    operation_id, finbot_status, finbot_attempted_at
  ) VALUES (
    v_uid, p_credit_note_number, p_invoice_id, p_order_id, v_invoice.customer_id,
    COALESCE(p_items, '[]'::jsonb), -v_amount, p_reason, p_created_by,
    p_operation_id, 'pending', NULL
  )
  RETURNING * INTO v_new;

  RETURN jsonb_build_object(
    'created', true,
    'credit_note_id', v_new.id,
    'credit_note_number', v_new.credit_note_number,
    'finbot_status', v_new.finbot_status,
    'external_credit_note_number', NULL,
    'total', v_new.total
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.credit_note_reserve(UUID, UUID, TEXT, JSONB, NUMERIC, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_note_reserve(UUID, UUID, TEXT, JSONB, NUMERIC, TEXT, UUID, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. CONFIRM — the only place stock returns and a debt is reduced
-- ----------------------------------------------------------------------------
-- Called ONLY with a Finbot document number in hand, which is the evidence the
-- Gate A CHECK demands. In one transaction it confirms the credit note,
-- restores the stock, and — for a credit of the WHOLE invoice — marks the
-- invoice credited exactly as the application does today.
--
-- Stock is restored with a single arithmetic UPDATE per product rather than a
-- read followed by a write, so two concurrent confirmations cannot lose one
-- another's increment.
--
-- IDEMPOTENT: confirming an already-confirmed credit note with the SAME
-- document number does nothing and reports it. With a DIFFERENT number it is
-- refused — two documents for one credit note is precisely the error being
-- designed out.
-- The 4-argument form from an earlier revision of this file is dropped so the
-- two cannot coexist as overloads: PostgREST would not know which to call.
DROP FUNCTION IF EXISTS public.credit_note_confirm(UUID, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.credit_note_confirm(
  p_credit_note_id UUID,
  p_external_number TEXT,
  p_external_url   TEXT DEFAULT NULL,
  p_source         TEXT DEFAULT 'api',
  -- THE DOCUMENT'S ACCOUNTING DATE, from the caller.
  --
  -- Finbot's reply contains {ok, invoiceNumber, pdfUrl} and no date, so this is
  -- the date the CALLER SENT with the request. That is a real fact about the
  -- document and is recorded as such; it is not read back from the document,
  -- and nothing here derives it from a clock. NULL is accepted and leaves the
  -- row flagged for review rather than dated by guesswork.
  p_document_date  DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
DECLARE
  v_uid      UUID := auth.uid();
  v_cn       public.credit_notes;
  v_invoice  public.invoices;
  v_restored INT := 0;
  v_full     BOOLEAN := false;
  v_pid      UUID;
  v_qty      NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'credit_note_confirm: not authenticated';
  END IF;
  IF p_external_number IS NULL OR btrim(p_external_number) = '' THEN
    RAISE EXCEPTION 'credit_note_confirm: a Finbot document number is required — confirmed means a document exists';
  END IF;
  IF p_source NOT IN ('api', 'manual') THEN
    RAISE EXCEPTION 'credit_note_confirm: source must be api or manual, not %', p_source;
  END IF;

  SELECT * INTO v_cn FROM public.credit_notes
   WHERE id = p_credit_note_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit_note_confirm: credit note % not found', p_credit_note_id;
  END IF;

  PERFORM pg_advisory_xact_lock(492118, hashtext(v_cn.invoice_id::text));

  -- Already settled. Report rather than raise, so a retried confirmation after
  -- a dropped response is harmless — and restore nothing a second time.
  IF v_cn.finbot_status = 'confirmed' THEN
    IF btrim(COALESCE(v_cn.external_credit_note_number, '')) = btrim(p_external_number) THEN
      -- A repeat confirmation may supply the date that was missing, and only
      -- the date: nothing else about a confirmed document changes.
      IF v_cn.date IS NULL AND p_document_date IS NOT NULL THEN
        UPDATE public.credit_notes SET date = p_document_date WHERE id = v_cn.id;
      END IF;
      RETURN jsonb_build_object('confirmed', true, 'already', true,
                                'restored_products', 0,
                                'date_recorded', v_cn.date IS NULL AND p_document_date IS NOT NULL);
    END IF;
    RAISE EXCEPTION
      'credit_note_confirm: % is already confirmed as document %; refusing to attach a second document (%)',
      v_cn.credit_note_number, v_cn.external_credit_note_number, p_external_number;
  END IF;

  UPDATE public.credit_notes
     SET finbot_status = 'confirmed',
         external_credit_note_number = btrim(p_external_number),
         external_credit_note_url = COALESCE(p_external_url, external_credit_note_url),
         finbot_confirmed_source = p_source,
         -- COALESCE, not assignment: a date already on the row was recorded
         -- when the document was created and is not re-stated by a later
         -- confirmation of the same credit.
         date = COALESCE(date, p_document_date),
         finbot_attempted_at = COALESCE(finbot_attempted_at, now()),
         finbot_resolved_at = CASE WHEN p_source = 'manual' THEN now()
                                   ELSE finbot_resolved_at END
   WHERE id = v_cn.id;

  -- ---- stock, once, from the RESOLVED lines ------------------------------
  -- credit_note_return_lines validates and resolves in one pass, and every
  -- product id it yields comes FROM THE INVOICE LINE. This loop therefore
  -- cannot be pointed at a product the invoice never carried.
  --
  -- It used to read the credit line directly, as
  -- COALESCE(line ->> 'product_id', line ->> 'id') — and that `id` was checked
  -- against nothing: a line with an index and no product_id passed the
  -- validator untouched and then had stock added to whatever `id` said.
  --
  -- The re-validation is still a re-validation: items are frozen after reserve
  -- by the trigger below, but the INVOICE can change, and the cumulative
  -- per-line limit is recomputed here with this credit note excluded from its
  -- own sum.
  --
  -- A price adjustment yields no row at all, so an overcharge credit moves
  -- nothing.
  FOR v_pid, v_qty IN
    SELECT r.product_id, r.qty
      FROM public.credit_note_return_lines(
             v_cn.invoice_id, COALESCE(v_cn.items, '[]'::jsonb), v_cn.id) r
  LOOP
    -- One statement. No read-then-write, so nothing is lost under concurrency.
    -- The quantity is added in the SAME units the order deducted, which is what
    -- keeps a credit an exact reversal of its sale.
    UPDATE public.products
       SET quantity = COALESCE(quantity, 0) + v_qty
     WHERE id = v_pid AND user_id = v_uid;
    IF FOUND THEN v_restored := v_restored + 1; END IF;
  END LOOP;

  -- ---- the invoice, only for a FULL credit -------------------------------
  -- TEMPORARY, AND DELIBERATELY IDENTICAL TO TODAY'S BEHAVIOUR.
  --
  -- Twelve places in the application read invoices.credited_at to decide
  -- whether an invoice is still a debt and whether the credit button is
  -- offered. Gate C replaces all of them with a figure derived from the credit
  -- notes, after which this block goes away and invoices become immutable.
  -- Until then, not writing it would make a credited invoice look open again
  -- and offer the credit button a second time — a worse outcome than the
  -- write.
  --
  -- The change from today is one of TIMING, which is the point: it happens here,
  -- on confirmation, and never on a credit whose document may not exist.
  --
  -- A PARTIAL credit does not touch the invoice at all. There is no column that
  -- can express "partly credited", and inventing one by setting credited_at
  -- would hide the rest of the receivable.
  SELECT * INTO v_invoice FROM public.invoices
   WHERE id = v_cn.invoice_id AND user_id = v_uid;
  IF FOUND THEN
    v_full := round(abs(COALESCE(v_cn.total, 0))::numeric, 2)
              >= round(abs(COALESCE(v_invoice.total, 0))::numeric, 2);
    IF v_full AND v_invoice.credited_at IS NULL THEN
      UPDATE public.invoices
         SET credited_at = now(),
             credit_note_id = v_cn.id,
             payment_status = 'זוכה'
       WHERE id = v_invoice.id;
    END IF;
  END IF;

  RETURN jsonb_build_object('confirmed', true, 'already', false,
                            'restored_products', v_restored,
                            'full_credit', v_full,
                            'date_recorded', p_document_date IS NOT NULL);
END
$fn$;

REVOKE ALL ON FUNCTION public.credit_note_confirm(UUID, TEXT, TEXT, TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_note_confirm(UUID, TEXT, TEXT, TEXT, DATE) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. RESOLVE — record a failure, or an unknown outcome
-- ----------------------------------------------------------------------------
-- 'failed'    Finbot received the request and refused it, or the request never
--             left this system. No document exists, so a retry is safe.
-- 'uncertain' the outcome is unknown. A document may exist.
--
-- Moving an UNCERTAIN row to 'failed' requires p_evidence, because that
-- transition is what licenses a retry. The trigger enforces it as well, so a
-- direct UPDATE cannot route around this function.
--
-- No stock moves and no invoice changes here, in either direction: a credit
-- that was never issued never reduced anything, so there is nothing to undo.
CREATE OR REPLACE FUNCTION public.credit_note_resolve(
  p_credit_note_id UUID,
  p_status         TEXT,
  p_error          TEXT DEFAULT NULL,
  p_evidence       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
DECLARE
  v_uid UUID := auth.uid();
  v_cn  public.credit_notes;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'credit_note_resolve: not authenticated';
  END IF;
  IF p_status NOT IN ('failed', 'uncertain') THEN
    RAISE EXCEPTION 'credit_note_resolve: % is not a resolution; use credit_note_confirm for a document that exists', p_status;
  END IF;

  SELECT * INTO v_cn FROM public.credit_notes
   WHERE id = p_credit_note_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit_note_resolve: credit note % not found', p_credit_note_id;
  END IF;

  IF v_cn.finbot_status = 'uncertain' AND p_status = 'failed'
     AND (p_evidence IS NULL OR btrim(p_evidence) = '') THEN
    RAISE EXCEPTION
      'credit_note_resolve: % is uncertain; calling it failed unlocks a retry that could issue a second credit document. Pass the evidence that Finbot holds no such document.',
      v_cn.credit_note_number
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.credit_notes
     SET finbot_status = p_status,
         finbot_error = COALESCE(p_error, finbot_error),
         finbot_attempted_at = now(),
         finbot_resolution_note = COALESCE(NULLIF(btrim(COALESCE(p_evidence, '')), ''),
                                           finbot_resolution_note),
         finbot_resolved_at = CASE
           WHEN NULLIF(btrim(COALESCE(p_evidence, '')), '') IS NOT NULL THEN now()
           ELSE finbot_resolved_at END
   WHERE id = v_cn.id;

  RETURN jsonb_build_object('status', p_status, 'credit_note_id', v_cn.id);
END
$fn$;

REVOKE ALL ON FUNCTION public.credit_note_resolve(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_note_resolve(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $check$
DECLARE
  v_n INT;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'credit_notes'
     AND column_name IN ('finbot_resolution_note', 'finbot_resolved_at', 'date');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'verification failed: expected 3 new columns, found %', v_n;
  END IF;

  -- `date` must be a DATE, not a timestamp: an accounting date has no time of
  -- day, and storing one invites a timezone shifting a document into the wrong
  -- period.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'credit_notes'
       AND column_name = 'date' AND data_type = 'date'
  ) THEN
    RAISE EXCEPTION 'verification failed: credit_notes.date is not a DATE';
  END IF;

  -- NOTHING WAS DATED. Every pre-existing row keeps NULL: this migration does
  -- not decide what an existing document''s accounting date was.
  SELECT count(*) INTO v_n FROM public.credit_notes WHERE date IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'verification failed: % existing credit notes were given a date', v_n;
  END IF;

  FOR v_n IN SELECT 1 FROM unnest(ARRAY['credit_note_reserve', 'credit_note_confirm',
                                        'credit_note_resolve', 'credit_note_check_items',
                                        'credit_note_return_lines']) AS f(name)
              WHERE NOT EXISTS (SELECT 1 FROM pg_proc p
                                 JOIN pg_namespace n ON n.oid = p.pronamespace
                                WHERE n.nspname = 'public' AND p.proname = f.name)
  LOOP
    RAISE EXCEPTION 'verification failed: one of the three functions is missing';
  END LOOP;

  -- All three must be SECURITY DEFINER with a pinned search_path: they write
  -- financial rows, and a mutable search_path on a definer function is how a
  -- definer function becomes an escalation.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('credit_note_reserve', 'credit_note_confirm',
                       'credit_note_resolve', 'credit_note_check_items',
                       'credit_note_return_lines')
     AND p.prosecdef
     AND array_to_string(COALESCE(p.proconfig, ARRAY[]::text[]), ',') LIKE '%search_path%';
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'verification failed: % of 5 functions are SECURITY DEFINER with a pinned search_path', v_n;
  END IF;

  -- BOTH entry points must validate the lines. Either one alone leaves a hole:
  -- reserve alone would let a later change go unexamined, and confirm alone
  -- would let a bad reservation sit on record.
  --
  -- Either name counts: credit_note_check_items is the void wrapper and
  -- credit_note_return_lines is the implementation, so a call to either runs
  -- every refusal. Reserve uses the wrapper; confirm uses the resolver,
  -- because it needs the rows.
  FOR v_n IN SELECT 1 FROM unnest(ARRAY['credit_note_reserve', 'credit_note_confirm']) AS f(name)
              WHERE NOT EXISTS (
                SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = f.name
                   AND (pg_get_functiondef(p.oid) LIKE '%credit_note_check_items%'
                        OR pg_get_functiondef(p.oid) LIKE '%credit_note_return_lines%'))
  LOOP
    RAISE EXCEPTION 'verification failed: reserve and confirm must both validate the credit lines';
  END LOOP;

  -- CONFIRM MUST TAKE ITS PRODUCT IDS FROM THE RESOLVER, never from the credit
  -- line. The old `line ->> 'id'` fallback was an unvalidated client value.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'credit_note_confirm'
       AND pg_get_functiondef(p.oid) LIKE '%credit_note_return_lines%') THEN
    RAISE EXCEPTION 'verification failed: credit_note_confirm must restore stock from credit_note_return_lines';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'credit_note_confirm'
       AND pg_get_functiondef(p.oid) LIKE '%v_line ->> ''id''%') THEN
    RAISE EXCEPTION 'verification failed: credit_note_confirm still reads an unvalidated client id';
  END IF;

  -- The reserved facts must be frozen.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'credit_notes_freeze_reserved_guard'
                    AND tgrelid = 'public.credit_notes'::regclass
                    AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'verification failed: the reserved-facts freeze trigger is missing';
  END IF;

  -- The guard must now also demand evidence.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'credit_notes_guard_finbot_status'
     AND pg_get_functiondef(p.oid) LIKE '%finbot_resolution_note%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'verification failed: the transition guard does not require resolution evidence';
  END IF;

  -- No existing row was classified by THIS migration either.
  SELECT count(*) INTO v_n FROM public.credit_notes
   WHERE finbot_resolution_note IS NOT NULL OR finbot_resolved_at IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'verification failed: % rows were given a resolution', v_n;
  END IF;

  RAISE NOTICE 'credit note operations: OK';
END
$check$;

-- ============================================================================
-- ROLLBACK
--
-- DROP FUNCTION IF EXISTS public.credit_note_resolve(UUID, TEXT, TEXT, TEXT);
-- DROP FUNCTION IF EXISTS public.credit_note_confirm(UUID, TEXT, TEXT, TEXT, DATE);
-- DROP FUNCTION IF EXISTS public.credit_note_reserve(UUID, UUID, TEXT, JSONB, NUMERIC, TEXT, UUID, TEXT);
-- DROP FUNCTION IF EXISTS public.credit_note_check_items(UUID, JSONB, UUID);
-- DROP FUNCTION IF EXISTS public.credit_note_return_lines(UUID, JSONB, UUID);
-- DROP TRIGGER IF EXISTS credit_notes_freeze_reserved_guard ON public.credit_notes;
-- DROP FUNCTION IF EXISTS public.credit_notes_freeze_reserved();
-- ALTER TABLE public.credit_notes
--   DROP COLUMN IF EXISTS finbot_resolved_at,
--   DROP COLUMN IF EXISTS finbot_resolution_note,
--   DROP COLUMN IF EXISTS date;
--
-- The Gate A guard function is left in place; it is a superset of nothing and
-- simply stops demanding evidence once the column is gone, so re-apply Gate A's
-- definition if this is rolled back on its own. No credit note, invoice,
-- payment, price or inventory figure is affected.
-- ============================================================================
