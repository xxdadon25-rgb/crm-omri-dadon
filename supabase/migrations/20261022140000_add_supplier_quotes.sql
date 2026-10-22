-- Supplier quotation comparison — PHASE 1: storage only.
--
-- ADDITIVE. Creates three NEW tables, one NEW storage bucket and their
-- policies. It does not touch suppliers, products, supplier_deliveries,
-- supplier_price_history, orders, inventory or any existing policy, and it
-- changes no existing row. Every existing supplier window keeps working
-- whether or not this is applied.
--
-- WHAT IS DELIBERATELY *NOT* HERE
--   No trigger writes into supplier_price_history, and nothing here updates
--   products.buy_price. Those are fed by goods receiving — what was actually
--   RECEIVED and PAID. A quotation is an offer, and mixing offers into the
--   real cost history would corrupt the figures the CRM already relies on.
--   Quoted prices live in supplier_quote_items and nowhere else.
--
-- WHY NEW TABLES AND NOT supplier_price_history
--   Besides the above: supplier_price_history.product_id is NOT NULL with an
--   FK, so a quotation line that has NOT yet been matched to a CRM product
--   could not be stored in it at all — and unmatched lines are the entire
--   point of the approval step.
--
-- NAMING
--   `quotes` already exists and means CUSTOMER quotes. Everything here is
--   prefixed supplier_quote_* so the two can never be confused in a query.

-- ---------------------------------------------------------------------------
-- 1. A quotation document from one supplier.
--
--    supplier_id REFERENCES suppliers: the existing record is reused BY
--    REFERENCE and never modified. ON DELETE CASCADE because a quotation
--    without its supplier is meaningless; the arrow points this way only, so
--    deleting a quotation can never affect a supplier.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_quotes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supplier_id  UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,

  quote_date   DATE,
  valid_until  DATE,
  -- The uploaded document. Nullable: a quotation may be entered by hand.
  file_url     TEXT,
  file_path    TEXT,
  -- draft    -> uploaded, lines not reviewed
  -- reviewed -> every line has been accepted or rejected by a human
  -- archived -> superseded or expired; kept for history
  status       TEXT NOT NULL DEFAULT 'draft'
               CONSTRAINT supplier_quotes_status_check
               CHECK (status IN ('draft', 'reviewed', 'archived')),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_quotes_user_supplier_idx
  ON public.supplier_quotes (user_id, supplier_id, quote_date DESC);
CREATE INDEX IF NOT EXISTS supplier_quotes_user_created_idx
  ON public.supplier_quotes (user_id, created_at DESC);

COMMENT ON TABLE public.supplier_quotes IS
  'One quotation document received from a supplier. Offers only — never a record of what was received or paid; that stays in supplier_deliveries / supplier_price_history.';

-- ---------------------------------------------------------------------------
-- 2. One line of a quotation.
--
--    product_id IS NULLABLE, AND THAT IS THE POINT. A line arrives as the
--    supplier wrote it; it becomes comparable only once a human says which CRM
--    product it is. Until then product_id is NULL and match_status is
--    'pending', and the line is still stored, visible and auditable.
--
--    The supplier's own wording is kept verbatim in supplier_name_raw as well,
--    so a bad match can always be re-judged against what the document said.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_quote_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supplier_quote_id  UUID NOT NULL REFERENCES public.supplier_quotes(id) ON DELETE CASCADE,

  -- NULL until a match is approved. ON DELETE SET NULL: removing a product
  -- must not delete quotation history, it just un-matches the line.
  product_id         UUID REFERENCES public.products(id) ON DELETE SET NULL,

  supplier_sku       TEXT,
  supplier_name_raw  TEXT NOT NULL,

  unit_price         NUMERIC
                     CONSTRAINT supplier_quote_items_unit_price_check
                     CHECK (unit_price IS NULL OR unit_price >= 0),
  -- Comparing suppliers is meaningless without these: "₪10" is cheaper than
  -- "₪12" only if both are the same unit and pack size.
  unit               TEXT,
  pack_size          NUMERIC
                     CONSTRAINT supplier_quote_items_pack_size_check
                     CHECK (pack_size IS NULL OR pack_size > 0),
  currency           TEXT NOT NULL DEFAULT 'ILS',

  match_status       TEXT NOT NULL DEFAULT 'pending'
                     CONSTRAINT supplier_quote_items_match_status_check
                     CHECK (match_status IN ('pending', 'approved', 'rejected')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A line cannot claim to be approved without naming a product, and a
  -- rejected line cannot keep one. Enforced here rather than in the UI,
  -- because the comparison view trusts this invariant.
  CONSTRAINT supplier_quote_items_match_consistency CHECK (
    (match_status = 'approved' AND product_id IS NOT NULL) OR
    (match_status = 'pending') OR
    (match_status = 'rejected' AND product_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS supplier_quote_items_quote_idx
  ON public.supplier_quote_items (supplier_quote_id);
-- The comparison query: every approved price for one product, across quotes.
CREATE INDEX IF NOT EXISTS supplier_quote_items_user_product_idx
  ON public.supplier_quote_items (user_id, product_id)
  WHERE product_id IS NOT NULL;
-- The review queue.
CREATE INDEX IF NOT EXISTS supplier_quote_items_pending_idx
  ON public.supplier_quote_items (user_id, match_status)
  WHERE match_status = 'pending';

COMMENT ON COLUMN public.supplier_quote_items.product_id IS
  'NULL until a human approves a match. An unmatched line is still stored and still shown — the approval step is what makes it comparable.';

-- ---------------------------------------------------------------------------
-- 3. Remembered matches.
--
--    Without this, the same supplier line would be reviewed again on every
--    upload. Keyed on a NORMALISED sku/name so trivial spelling and spacing
--    differences do not produce a second row; the raw text stays on the item.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_product_matches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supplier_id       UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,

  -- lower(btrim(collapsed whitespace)) of the supplier's sku, or of its product
  -- name when it gives no sku. Computed by the application, stored here.
  supplier_key      TEXT NOT NULL,
  product_id        UUID REFERENCES public.products(id) ON DELETE CASCADE,

  status            TEXT NOT NULL DEFAULT 'pending'
                    CONSTRAINT supplier_product_matches_status_check
                    CHECK (status IN ('pending', 'approved', 'rejected')),
  -- 0..1, for ordering the review queue. Never used to auto-approve.
  confidence        NUMERIC
                    CONSTRAINT supplier_product_matches_confidence_check
                    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  approved_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One verdict per supplier key. This is what makes the review queue shrink
  -- over time instead of repeating itself.
  CONSTRAINT supplier_product_matches_unique UNIQUE (user_id, supplier_id, supplier_key),
  CONSTRAINT supplier_product_matches_approved_needs_product CHECK (
    status <> 'approved' OR product_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS supplier_product_matches_product_idx
  ON public.supplier_product_matches (user_id, product_id)
  WHERE product_id IS NOT NULL;

COMMENT ON TABLE public.supplier_product_matches IS
  'Remembered supplier-line -> CRM-product decisions, so an approved match is never reviewed twice. confidence orders the queue and NEVER auto-approves.';

-- ---------------------------------------------------------------------------
-- 4. AUTHORIZATION — staff only, and deliberately NOT the broad pattern.
--
--    THE RISK THIS CLOSES
--      Parts of this project carry pre-existing "Internal users full access"
--      policies written as auth.role() = 'authenticated'. Every PORTAL
--      CUSTOMER is an authenticated user. A policy of that shape on these
--      tables would therefore publish supplier COST prices to every customer
--      with a portal login.
--
--      So there is exactly one predicate here, for all three tables and all
--      four verbs: the caller must have a staff_members row. There is NO
--      portal-customer policy of any kind — not even SELECT — and no
--      USING (true) anywhere.
--
--    staff_members is the same table the portal already uses to recognise
--    staff, so this reuses the existing notion of "this auth user is staff"
--    rather than inventing a second one.
--
--    RLS is enabled with no permissive policy for anon, so an anonymous caller
--    gets nothing regardless of the grants.
-- ---------------------------------------------------------------------------
ALTER TABLE public.supplier_quotes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_quote_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_product_matches   ENABLE ROW LEVEL SECURITY;

DO $policies$
DECLARE
  tbl  TEXT;
  tbls TEXT[] := ARRAY['supplier_quotes', 'supplier_quote_items', 'supplier_product_matches'];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_staff_select" ON public.%I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_staff_insert" ON public.%I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_staff_update" ON public.%I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_staff_delete" ON public.%I', tbl, tbl);

    EXECUTE format($p$
      CREATE POLICY "%s_staff_select" ON public.%I
      FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.staff_members sm WHERE sm.auth_user_id = auth.uid()))
    $p$, tbl, tbl);

    -- INSERT also pins user_id to the caller, so one staff member cannot write
    -- rows attributed to another.
    EXECUTE format($p$
      CREATE POLICY "%s_staff_insert" ON public.%I
      FOR INSERT TO authenticated
      WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (SELECT 1 FROM public.staff_members sm WHERE sm.auth_user_id = auth.uid())
      )
    $p$, tbl, tbl);

    EXECUTE format($p$
      CREATE POLICY "%s_staff_update" ON public.%I
      FOR UPDATE TO authenticated
      USING (EXISTS (SELECT 1 FROM public.staff_members sm WHERE sm.auth_user_id = auth.uid()))
      WITH CHECK (EXISTS (SELECT 1 FROM public.staff_members sm WHERE sm.auth_user_id = auth.uid()))
    $p$, tbl, tbl);

    EXECUTE format($p$
      CREATE POLICY "%s_staff_delete" ON public.%I
      FOR DELETE TO authenticated
      USING (EXISTS (SELECT 1 FROM public.staff_members sm WHERE sm.auth_user_id = auth.uid()))
    $p$, tbl, tbl);
  END LOOP;
END
$policies$;

-- Table privileges. RLS still decides every row; these only open the door.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_quotes          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_quote_items     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_product_matches TO authenticated;
REVOKE ALL ON public.supplier_quotes          FROM anon;
REVOKE ALL ON public.supplier_quote_items     FROM anon;
REVOKE ALL ON public.supplier_product_matches FROM anon;

-- ---------------------------------------------------------------------------
-- 5. FILE STORAGE — a NEW private bucket.
--
--    Separate from delivery-documents on purpose: that bucket is PUBLIC (goods
--    receiving reads it with getPublicUrl), and a supplier price list must not
--    be served from a guessable public URL. This one is private, and the app
--    reads it through short-lived signed URLs.
--
--    The object policies mirror the table policies exactly — staff only, no
--    portal-customer access, no anonymous access.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('supplier-quotes', 'supplier-quotes', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "supplier_quotes_objects_staff_select" ON storage.objects;
DROP POLICY IF EXISTS "supplier_quotes_objects_staff_insert" ON storage.objects;
DROP POLICY IF EXISTS "supplier_quotes_objects_staff_update" ON storage.objects;
DROP POLICY IF EXISTS "supplier_quotes_objects_staff_delete" ON storage.objects;

CREATE POLICY "supplier_quotes_objects_staff_select" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'supplier-quotes'
  AND EXISTS (SELECT 1 FROM public.staff_members sm WHERE sm.auth_user_id = auth.uid())
);

CREATE POLICY "supplier_quotes_objects_staff_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'supplier-quotes'
  AND EXISTS (SELECT 1 FROM public.staff_members sm WHERE sm.auth_user_id = auth.uid())
);

CREATE POLICY "supplier_quotes_objects_staff_update" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'supplier-quotes'
  AND EXISTS (SELECT 1 FROM public.staff_members sm WHERE sm.auth_user_id = auth.uid())
);

CREATE POLICY "supplier_quotes_objects_staff_delete" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'supplier-quotes'
  AND EXISTS (SELECT 1 FROM public.staff_members sm WHERE sm.auth_user_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- 6. VERIFICATION — raises rather than leaving a half-applied state unnoticed.
--
--    The important assertion is the last one: NO policy on these tables may be
--    unconditionally permissive. That is the thing that would silently expose
--    cost prices, and it is cheap to assert.
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  tbl       TEXT;
  tbls      TEXT[] := ARRAY['supplier_quotes', 'supplier_quote_items', 'supplier_product_matches'];
  v_rls     BOOLEAN;
  v_count   INT;
  v_bad     INT;
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    SELECT c.relrowsecurity INTO v_rls
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = tbl;
    IF v_rls IS NULL THEN
      RAISE EXCEPTION 'verification failed: table % was not created', tbl;
    END IF;
    IF NOT v_rls THEN
      RAISE EXCEPTION 'verification failed: RLS is not enabled on %', tbl;
    END IF;

    SELECT count(*) INTO v_count FROM pg_policies
     WHERE schemaname = 'public' AND tablename = tbl;
    IF v_count <> 4 THEN
      RAISE EXCEPTION 'verification failed: % has % policies, expected 4', tbl, v_count;
    END IF;

    -- Every policy must name staff_members. A policy that does not is either
    -- the broad authenticated pattern or an outright USING (true).
    SELECT count(*) INTO v_bad FROM pg_policies
     WHERE schemaname = 'public' AND tablename = tbl
       AND (
         coalesce(qual, '') || ' ' || coalesce(with_check, '')
       ) NOT LIKE '%staff_members%';
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'verification failed: % has % policy(ies) not gated on staff_members', tbl, v_bad;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'supplier-quotes' AND public = false) THEN
    RAISE EXCEPTION 'verification failed: supplier-quotes bucket missing or PUBLIC';
  END IF;
END
$check$;

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- DROP POLICY IF EXISTS "supplier_quotes_objects_staff_select" ON storage.objects;
-- DROP POLICY IF EXISTS "supplier_quotes_objects_staff_insert" ON storage.objects;
-- DROP POLICY IF EXISTS "supplier_quotes_objects_staff_update" ON storage.objects;
-- DROP POLICY IF EXISTS "supplier_quotes_objects_staff_delete" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'supplier-quotes';   -- only once empty
-- DROP TABLE IF EXISTS public.supplier_quote_items;
-- DROP TABLE IF EXISTS public.supplier_product_matches;
-- DROP TABLE IF EXISTS public.supplier_quotes;
--
-- Safe: nothing outside this feature reads these tables or this bucket, so
-- dropping them removes the new window's data and affects nothing else.
-- Deleting the bucket row fails while objects remain, which is the desired
-- order — empty it first, deliberately.
-- ---------------------------------------------------------------------------
