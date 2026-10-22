-- Supplier quotation comparison — PHASE 2: prices, packaging, SKU mapping and
-- lowest-historical-price selection.
--
-- ADDITIVE ONLY. Adds columns with ADD COLUMN IF NOT EXISTS, two new tables and
-- four views. It alters no existing column, drops nothing, writes no row into
-- an existing table, and adds no policy to a table it did not create.
--
-- NOT TOUCHED, deliberately and verifiably (see the verification block at the
-- end): supplier_price_history, supplier_deliveries, suppliers, products,
-- orders, inventory, the Customer Portal tables and everything belonging to
-- goods receiving or supplier orders. A quotation is an OFFER; those tables
-- record what was received and paid, and the two must never mix.
--
-- ============================================================================
-- THE SELECTION RULE, AND WHY IT IS SHAPED THIS WAY
-- ============================================================================
-- For each supplier + canonical product + unit, the chosen price is the LOWEST
-- approved historical price — not the most recent. There is NO age limit: an
-- old low stays eligible for ever, and the view carries its document date and
-- age so the screen can say so out loud instead of implying a current offer.
--
-- An active manual override beats that low, even when the override is HIGHER.
--
-- WHY DISTINCT ON AND NOT min()
--   The purchasing list must show the SKU, packaging, document and date OF THE
--   LINE THAT PRODUCED THE PRICE. `min(comparable_price)` returns a number and
--   then needs a second query to find "a" row with that price — and where one
--   supplier sells the same product in two pack sizes, or under two SKUs, that
--   second query can legitimately pick a DIFFERENT row. The price would then be
--   shown beside the wrong SKU and the wrong packaging.
--
--   DISTINCT ON picks ONE row and every provenance column comes from that same
--   row by construction. That is the whole mechanism behind "the SKU must
--   correspond to the exact selected product, packaging and price record".
--
-- WHY ARCHIVED DOCUMENTS STILL COUNT
--   An earlier draft of this feature read only the newest non-archived quote.
--   That is now wrong: history is preserved and the lowest wins, so a
--   superseded document's approved lines remain eligible. Archiving affects
--   how documents are LISTED, never whether a price is selectable.

-- ============================================================================
-- 1. Document-level columns: references, totals and the VAT basis.
-- ============================================================================
ALTER TABLE public.supplier_quotes
  ADD COLUMN IF NOT EXISTS document_type     TEXT,
  ADD COLUMN IF NOT EXISTS document_number   TEXT,
  ADD COLUMN IF NOT EXISTS amount_net        NUMERIC,
  ADD COLUMN IF NOT EXISTS vat_amount        NUMERIC,
  ADD COLUMN IF NOT EXISTS amount_gross      NUMERIC,
  ADD COLUMN IF NOT EXISTS vat_rate          NUMERIC,
  -- excluded -> line prices are already pre-VAT
  -- included -> line prices carry VAT and must be divided by (1 + rate)
  -- unknown  -> UNDECIDED. Lines from such a document are NOT selectable,
  --             because treating a gross price as net is an 18% error that
  --             looks entirely plausible on screen.
  ADD COLUMN IF NOT EXISTS vat_basis         TEXT NOT NULL DEFAULT 'unknown',
  -- SHA-256 of the uploaded page bytes: the duplicate-import guard.
  ADD COLUMN IF NOT EXISTS content_hash      TEXT,
  ADD COLUMN IF NOT EXISTS page_count        INT,
  ADD COLUMN IF NOT EXISTS extraction_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS extraction_error  TEXT,
  ADD COLUMN IF NOT EXISTS extracted_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS supersedes_quote_id UUID REFERENCES public.supplier_quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version           INT NOT NULL DEFAULT 1;

-- Constraints added separately: ADD COLUMN IF NOT EXISTS cannot carry a named
-- CHECK idempotently, and a second apply must not fail.
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_quotes_vat_basis_check') THEN
    ALTER TABLE public.supplier_quotes ADD CONSTRAINT supplier_quotes_vat_basis_check
      CHECK (vat_basis IN ('excluded', 'included', 'unknown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_quotes_extraction_status_check') THEN
    ALTER TABLE public.supplier_quotes ADD CONSTRAINT supplier_quotes_extraction_status_check
      CHECK (extraction_status IN ('none', 'running', 'done', 'failed', 'incomplete'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_quotes_vat_rate_check') THEN
    ALTER TABLE public.supplier_quotes ADD CONSTRAINT supplier_quotes_vat_rate_check
      CHECK (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate < 100));
  END IF;
  -- A document cannot supersede itself.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_quotes_no_self_supersede') THEN
    ALTER TABLE public.supplier_quotes ADD CONSTRAINT supplier_quotes_no_self_supersede
      CHECK (supersedes_quote_id IS NULL OR supersedes_quote_id <> id);
  END IF;
END
$c$;

-- Duplicate imports. Partial, because most legacy rows have no hash.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_quotes_content_hash_uniq
  ON public.supplier_quotes (user_id, supplier_id, content_hash)
  WHERE content_hash IS NOT NULL;

-- A re-photographed copy has different bytes but the same reference.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_quotes_docref_uniq
  ON public.supplier_quotes (user_id, supplier_id, document_number, quote_date)
  WHERE document_number IS NOT NULL AND quote_date IS NOT NULL;

-- ============================================================================
-- 2. Line-level columns: the extracted figures and their normalised form.
-- ============================================================================
-- `unit` and `pack_size` (phase 1) hold the supplier's OWN wording and number.
-- `base_unit` and `base_qty_per_pack` are the normalised form used for
-- comparison. Both are kept: the raw text is what a human verifies against the
-- document, the normalised pair is what arithmetic may touch.
ALTER TABLE public.supplier_quote_items
  ADD COLUMN IF NOT EXISTS line_no           INT,
  ADD COLUMN IF NOT EXISTS page_no           INT,
  ADD COLUMN IF NOT EXISTS quantity          NUMERIC,
  ADD COLUMN IF NOT EXISTS line_total        NUMERIC,
  ADD COLUMN IF NOT EXISTS list_price        NUMERIC,
  ADD COLUMN IF NOT EXISTS discount_percent  NUMERIC,
  ADD COLUMN IF NOT EXISTS discount_amount   NUMERIC,
  -- The comparable figure. Always pre-VAT, per the supplier's own pack.
  ADD COLUMN IF NOT EXISTS price_before_vat  NUMERIC,
  ADD COLUMN IF NOT EXISTS base_unit         TEXT,
  ADD COLUMN IF NOT EXISTS base_qty_per_pack NUMERIC,
  ADD COLUMN IF NOT EXISTS confidence        TEXT,
  -- Exactly what the extractor returned, so a disputed line can be re-judged
  -- against the model's own output as well as against the stored page image.
  ADD COLUMN IF NOT EXISTS extracted_raw     JSONB,
  ADD COLUMN IF NOT EXISTS reviewed_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at       TIMESTAMPTZ;

-- The single number everything is ranked by: price per ONE base unit.
-- GENERATED, so it can never drift from its inputs and cannot be written
-- directly by application code.
DO $g$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'supplier_quote_items'
       AND column_name = 'comparable_price'
  ) THEN
    ALTER TABLE public.supplier_quote_items
      ADD COLUMN comparable_price NUMERIC
      GENERATED ALWAYS AS (price_before_vat / NULLIF(base_qty_per_pack, 0)) STORED;
  END IF;
END
$g$;

DO $c2$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_quote_items_price_before_vat_check') THEN
    ALTER TABLE public.supplier_quote_items ADD CONSTRAINT supplier_quote_items_price_before_vat_check
      CHECK (price_before_vat IS NULL OR price_before_vat >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_quote_items_base_qty_check') THEN
    ALTER TABLE public.supplier_quote_items ADD CONSTRAINT supplier_quote_items_base_qty_check
      CHECK (base_qty_per_pack IS NULL OR base_qty_per_pack > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_quote_items_discount_percent_check') THEN
    ALTER TABLE public.supplier_quote_items ADD CONSTRAINT supplier_quote_items_discount_percent_check
      CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_quote_items_confidence_check') THEN
    ALTER TABLE public.supplier_quote_items ADD CONSTRAINT supplier_quote_items_confidence_check
      CHECK (confidence IS NULL OR confidence IN ('high', 'low'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_quote_items_quantity_check') THEN
    ALTER TABLE public.supplier_quote_items ADD CONSTRAINT supplier_quote_items_quantity_check
      CHECK (quantity IS NULL OR quantity >= 0);
  END IF;
END
$c2$;

-- One line number per document, so ordering is stable and a line cannot be
-- silently written twice.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_quote_items_line_uniq
  ON public.supplier_quote_items (supplier_quote_id, line_no)
  WHERE line_no IS NOT NULL;

-- The selection index: the ranking is (product, unit, price), so this is the
-- order the views read in.
CREATE INDEX IF NOT EXISTS supplier_quote_items_selection_idx
  ON public.supplier_quote_items (user_id, product_id, base_unit, comparable_price)
  WHERE match_status = 'approved' AND product_id IS NOT NULL;

-- ============================================================================
-- 3. The stored pages of a document.
--
--    supplier_quotes.file_path holds ONE path; a document may be up to ten
--    photographed pages, and the page the model actually read is what a human
--    must be able to look at later.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.supplier_quote_pages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supplier_quote_id UUID NOT NULL REFERENCES public.supplier_quotes(id) ON DELETE CASCADE,
  page_no           INT  NOT NULL CHECK (page_no >= 1),
  file_path         TEXT NOT NULL,
  byte_size         INT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT supplier_quote_pages_page_uniq UNIQUE (supplier_quote_id, page_no)
);

CREATE INDEX IF NOT EXISTS supplier_quote_pages_quote_idx
  ON public.supplier_quote_pages (supplier_quote_id, page_no);

-- ============================================================================
-- 4. Manual price overrides — APPEND ONLY.
--
--    Removing an override does NOT delete the row: it stamps removed_at and
--    removed_by, so who set which price when, and who withdrew it, is a
--    complete chain. A later override is a NEW row.
--
--    Nothing here can touch supplier_quote_items, which is what makes
--    "never overwrite historical invoice prices" structural rather than a
--    convention someone has to remember.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.supplier_product_price_overrides (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supplier_id      UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  product_id       UUID NOT NULL REFERENCES public.products(id)  ON DELETE CASCADE,
  -- Part of the key: an override is for a product IN A UNIT. Overriding
  -- "per litre" must not silently also override "per bottle".
  base_unit        TEXT NOT NULL,
  price_before_vat NUMERIC NOT NULL CHECK (price_before_vat >= 0),
  note             TEXT,
  created_by       UUID NOT NULL REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_by       UUID REFERENCES auth.users(id),
  removed_at       TIMESTAMPTZ,
  CONSTRAINT supplier_price_override_removal_attributed CHECK (
    (removed_at IS NULL AND removed_by IS NULL) OR
    (removed_at IS NOT NULL AND removed_by IS NOT NULL)
  )
);

-- At most ONE active override per supplier+product+unit. Removed rows are
-- excluded from the index, so history accumulates freely.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_product_price_overrides_active_uniq
  ON public.supplier_product_price_overrides (user_id, supplier_id, product_id, base_unit)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS supplier_product_price_overrides_lookup_idx
  ON public.supplier_product_price_overrides (user_id, supplier_id, product_id);

COMMENT ON TABLE public.supplier_product_price_overrides IS
  'Manually set supplier prices. Append-only: removal stamps removed_at/removed_by and the row stays. An active override wins over the historical low even when higher. Never writes to supplier_quote_items.';

-- ============================================================================
-- 5. Supplier-specific SKU mapping.
--
--    The same canonical product legitimately has a DIFFERENT code at every
--    supplier. The unique key is already (user_id, supplier_id, supplier_key),
--    so each supplier keeps its own code space; these columns record what the
--    code actually was, and the packaging it referred to.
--
--    supplier_sku is TEXT and is never cast to a number: '000123' must stay
--    '000123', and '12/A-3' must stay intact.
-- ============================================================================
ALTER TABLE public.supplier_product_matches
  ADD COLUMN IF NOT EXISTS supplier_sku         TEXT,
  ADD COLUMN IF NOT EXISTS supplier_description TEXT,
  ADD COLUMN IF NOT EXISTS base_unit            TEXT,
  ADD COLUMN IF NOT EXISTS base_qty_per_pack    NUMERIC,
  ADD COLUMN IF NOT EXISTS brand                TEXT,
  ADD COLUMN IF NOT EXISTS size_text            TEXT;

DO $c3$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_product_matches_base_qty_check') THEN
    ALTER TABLE public.supplier_product_matches ADD CONSTRAINT supplier_product_matches_base_qty_check
      CHECK (base_qty_per_pack IS NULL OR base_qty_per_pack > 0);
  END IF;
END
$c3$;

-- Auto-apply lookup: exact supplier + exact SKU text. Case-sensitive on
-- purpose — '0012b' and '0012B' are different codes in supplier catalogues.
CREATE INDEX IF NOT EXISTS supplier_product_matches_sku_idx
  ON public.supplier_product_matches (user_id, supplier_id, supplier_sku)
  WHERE supplier_sku IS NOT NULL;

-- ============================================================================
-- 6. AUTHORIZATION for the two new tables — staff only, same predicate as
--    phase 1. No portal-customer policy of any kind, nothing on auth.role(),
--    nothing USING (true).
-- ============================================================================
ALTER TABLE public.supplier_quote_pages                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_product_price_overrides    ENABLE ROW LEVEL SECURITY;

DO $policies$
DECLARE
  tbl  TEXT;
  tbls TEXT[] := ARRAY['supplier_quote_pages', 'supplier_product_price_overrides'];
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_quote_pages             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_product_price_overrides TO authenticated;
REVOKE ALL ON public.supplier_quote_pages             FROM anon;
REVOKE ALL ON public.supplier_product_price_overrides FROM anon;

-- Storage objects for the page images live in the same private bucket and are
-- already covered by the phase-1 supplier_quotes_objects_* policies.

-- ============================================================================
-- 7. THE VIEWS.
--
--    security_invoker = true (PostgreSQL 15+): the view runs with the CALLER's
--    permissions, so the staff-only RLS on the underlying tables still
--    applies. Without it a view would run as its owner and would hand supplier
--    cost prices to every authenticated caller — portal customers included.
--    This single setting is the difference between the views being safe and
--    being a hole straight through phase 1's authorization.
-- ============================================================================

-- 7a. Every line that is ELIGIBLE to be selected, with its full provenance.
--
--     The eligibility rules are the business rules, in one place:
--       * the match was APPROVED by a human (never 'pending', never 'rejected')
--       * it names a canonical product
--       * it has a normalised unit and a comparable price
--       * the document's VAT basis is KNOWN — an 'unknown' basis means the
--         price might be gross, and a gross price ranked as net is an ~18%
--         error that looks perfectly reasonable.
--     No filter on document status: an archived or superseded document's
--     approved lines remain eligible for ever. No age limit.
CREATE OR REPLACE VIEW public.supplier_quote_price_candidates_v
WITH (security_invoker = true) AS
SELECT
  i.user_id,
  q.supplier_id,
  i.product_id,
  i.base_unit,
  i.base_qty_per_pack,
  i.comparable_price,
  i.price_before_vat,
  i.supplier_sku,
  i.supplier_name_raw,
  i.unit              AS supplier_unit_text,
  i.pack_size         AS supplier_pack_size,
  i.id                AS supplier_quote_item_id,
  q.id                AS supplier_quote_id,
  q.document_number,
  q.document_type,
  q.quote_date,
  q.valid_until,
  q.status            AS document_status,
  q.vat_basis,
  q.vat_rate
FROM public.supplier_quote_items i
JOIN public.supplier_quotes q ON q.id = i.supplier_quote_id
WHERE i.match_status      = 'approved'
  AND i.product_id        IS NOT NULL
  AND i.base_unit         IS NOT NULL
  AND i.comparable_price  IS NOT NULL
  AND q.vat_basis         IN ('excluded', 'included');

COMMENT ON VIEW public.supplier_quote_price_candidates_v IS
  'Approved, matched, normalised quotation lines eligible for price selection, each with its own document, date, SKU and packaging. No age limit; archived documents still count; lines from a document whose VAT basis is unknown are excluded.';

-- 7b. The LOWEST eligible price per supplier + product + unit, carrying the
--     SKU, packaging, document and date OF THAT EXACT LINE.
--
--     Ordering is the rule: cheapest first; on a tie the newer document, then
--     the item id so the result is fully deterministic and identical across
--     calls. One supplier with two SKUs or two pack sizes for the same product
--     yields ONE row here — the row that actually produced the winning price.
CREATE OR REPLACE VIEW public.supplier_product_lowest_price_v
WITH (security_invoker = true) AS
SELECT DISTINCT ON (user_id, supplier_id, product_id, base_unit)
  user_id,
  supplier_id,
  product_id,
  base_unit,
  comparable_price        AS price_before_vat,
  base_qty_per_pack,
  supplier_sku,
  supplier_name_raw,
  supplier_unit_text,
  supplier_pack_size,
  price_before_vat        AS pack_price_before_vat,
  supplier_quote_item_id,
  supplier_quote_id,
  document_number,
  document_type,
  quote_date,
  valid_until,
  document_status
FROM public.supplier_quote_price_candidates_v
ORDER BY user_id, supplier_id, product_id, base_unit,
         comparable_price ASC,
         quote_date DESC NULLS LAST,
         supplier_quote_item_id;

COMMENT ON VIEW public.supplier_product_lowest_price_v IS
  'The lowest approved historical price per supplier+product+unit. Every provenance column comes from the SAME line that produced the price, so the SKU and packaging always match the figure.';

-- 7c. Per pack variant, for the review screen: when one supplier offers the
--     same product in several pack sizes, this shows the best price for each
--     so the owner can see why one variant won.
CREATE OR REPLACE VIEW public.supplier_product_pack_lowest_price_v
WITH (security_invoker = true) AS
SELECT DISTINCT ON (user_id, supplier_id, product_id, base_unit, base_qty_per_pack)
  user_id, supplier_id, product_id, base_unit, base_qty_per_pack,
  comparable_price AS price_before_vat,
  price_before_vat AS pack_price_before_vat,
  supplier_sku, supplier_name_raw, supplier_unit_text, supplier_pack_size,
  supplier_quote_item_id, supplier_quote_id, document_number, quote_date, valid_until
FROM public.supplier_quote_price_candidates_v
ORDER BY user_id, supplier_id, product_id, base_unit, base_qty_per_pack,
         comparable_price ASC, quote_date DESC NULLS LAST, supplier_quote_item_id;

-- 7d. The SELECTED price: an active override if there is one, otherwise the
--     historical low.
--
--     FULL JOIN, not LEFT: an override may exist for a supplier-product with
--     no approved history at all, and it must still appear. The historical low
--     is carried alongside even when the override wins, so the screen can show
--     "overridden to X — lowest invoiced was Y on <date>".
CREATE OR REPLACE VIEW public.supplier_product_selected_price_v
WITH (security_invoker = true) AS
SELECT
  COALESCE(l.user_id,     o.user_id)     AS user_id,
  COALESCE(l.supplier_id, o.supplier_id) AS supplier_id,
  COALESCE(l.product_id,  o.product_id)  AS product_id,
  COALESCE(l.base_unit,   o.base_unit)   AS base_unit,

  CASE WHEN o.id IS NOT NULL THEN 'manual_override' ELSE 'historical_low' END AS price_source,
  COALESCE(o.price_before_vat, l.price_before_vat) AS price_before_vat,

  -- Provenance of the historical low, always present when one exists.
  l.price_before_vat      AS historical_low_price,
  l.base_qty_per_pack,
  l.supplier_sku,
  l.supplier_name_raw,
  l.supplier_unit_text,
  l.supplier_pack_size,
  l.pack_price_before_vat,
  l.supplier_quote_item_id,
  l.supplier_quote_id,
  l.document_number,
  l.document_type,
  l.quote_date,
  l.valid_until,
  l.document_status,

  -- Override provenance.
  o.id         AS override_id,
  o.created_by AS override_by,
  o.created_at AS override_at,
  o.note       AS override_note,

  -- Honesty fields. An old low is a historical record, NOT a confirmed offer,
  -- and these are what let the screen say so.
  (l.valid_until IS NOT NULL AND l.valid_until < CURRENT_DATE) AS quote_expired,
  CASE WHEN l.quote_date IS NOT NULL THEN (CURRENT_DATE - l.quote_date) END AS price_age_days
FROM public.supplier_product_lowest_price_v l
FULL JOIN (
  SELECT * FROM public.supplier_product_price_overrides WHERE removed_at IS NULL
) o
  ON  o.user_id     = l.user_id
  AND o.supplier_id = l.supplier_id
  AND o.product_id  = l.product_id
  AND o.base_unit   IS NOT DISTINCT FROM l.base_unit;

COMMENT ON VIEW public.supplier_product_selected_price_v IS
  'The price the CRM will use per supplier+product+unit: an active manual override if present (even when higher), otherwise the lowest approved historical price. Carries both figures, the source document and its age.';

-- 7e. Lines that need a human decision, with the REASON.
--
--     This is the other half of the eligibility rules in 7a: anything excluded
--     from selection must be visible somewhere, or a document would silently
--     contribute nothing and no one would know why.
CREATE OR REPLACE VIEW public.supplier_quote_items_needing_review_v
WITH (security_invoker = true) AS
SELECT
  i.user_id, q.supplier_id, q.id AS supplier_quote_id, i.id AS supplier_quote_item_id,
  i.line_no, i.page_no, i.supplier_name_raw, i.supplier_sku, i.match_status, i.confidence,
  q.vat_basis, i.base_unit, i.base_qty_per_pack,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN i.match_status <> 'approved'                      THEN 'match_not_approved' END,
    CASE WHEN i.product_id IS NULL                              THEN 'no_canonical_product' END,
    CASE WHEN i.supplier_sku IS NULL OR btrim(i.supplier_sku) = '' THEN 'sku_missing' END,
    CASE WHEN i.base_unit IS NULL OR i.base_qty_per_pack IS NULL THEN 'packaging_unknown' END,
    CASE WHEN q.vat_basis = 'unknown'                            THEN 'vat_basis_unknown' END,
    CASE WHEN i.confidence = 'low'                               THEN 'low_confidence' END,
    CASE WHEN i.price_before_vat IS NULL                         THEN 'price_missing' END
  ], NULL) AS review_reasons
FROM public.supplier_quote_items i
JOIN public.supplier_quotes q ON q.id = i.supplier_quote_id
WHERE i.match_status <> 'approved'
   OR i.product_id IS NULL
   OR i.supplier_sku IS NULL OR btrim(i.supplier_sku) = ''
   OR i.base_unit IS NULL OR i.base_qty_per_pack IS NULL
   OR q.vat_basis = 'unknown'
   OR i.confidence = 'low'
   OR i.price_before_vat IS NULL;

GRANT SELECT ON public.supplier_quote_price_candidates_v        TO authenticated;
GRANT SELECT ON public.supplier_product_lowest_price_v          TO authenticated;
GRANT SELECT ON public.supplier_product_pack_lowest_price_v     TO authenticated;
GRANT SELECT ON public.supplier_product_selected_price_v        TO authenticated;
GRANT SELECT ON public.supplier_quote_items_needing_review_v    TO authenticated;
REVOKE ALL ON public.supplier_quote_price_candidates_v        FROM anon;
REVOKE ALL ON public.supplier_product_lowest_price_v          FROM anon;
REVOKE ALL ON public.supplier_product_pack_lowest_price_v     FROM anon;
REVOKE ALL ON public.supplier_product_selected_price_v        FROM anon;
REVOKE ALL ON public.supplier_quote_items_needing_review_v    FROM anon;

-- ============================================================================
-- 8. VERIFICATION — raises rather than leaving a half-applied state unnoticed.
-- ============================================================================
DO $check$
DECLARE
  v_missing TEXT;
  v_bad     INT;
  v_rls     BOOLEAN;
  tbl       TEXT;
BEGIN
  -- Columns the views depend on.
  SELECT string_agg(c, ', ') INTO v_missing FROM (
    SELECT c FROM unnest(ARRAY['quantity','line_total','price_before_vat','base_unit',
                               'base_qty_per_pack','comparable_price','confidence','line_no']) AS c
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='supplier_quote_items' AND column_name=c)
  ) s;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'verification failed: supplier_quote_items missing %', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='supplier_quotes' AND column_name='vat_basis'
  ) THEN
    RAISE EXCEPTION 'verification failed: supplier_quotes.vat_basis was not added';
  END IF;

  -- comparable_price MUST be generated; a writable column could drift from
  -- price_before_vat / base_qty_per_pack and silently mis-rank suppliers.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='supplier_quote_items'
       AND column_name='comparable_price' AND is_generated = 'ALWAYS'
  ) THEN
    RAISE EXCEPTION 'verification failed: comparable_price is not a GENERATED column';
  END IF;

  -- Every new view must be security_invoker, or it bypasses the staff-only RLS.
  SELECT count(*) INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
     AND c.relname IN ('supplier_quote_price_candidates_v','supplier_product_lowest_price_v',
                       'supplier_product_pack_lowest_price_v','supplier_product_selected_price_v',
                       'supplier_quote_items_needing_review_v')
     AND NOT COALESCE((
       SELECT option_value::boolean FROM pg_options_to_table(c.reloptions)
        WHERE option_name = 'security_invoker'
     ), false);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'verification failed: % view(s) are not security_invoker', v_bad;
  END IF;

  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='v'
         AND c.relname LIKE 'supplier_%_v') < 5 THEN
    RAISE EXCEPTION 'verification failed: not all five views were created';
  END IF;

  -- RLS and policy shape on the two new tables.
  FOREACH tbl IN ARRAY ARRAY['supplier_quote_pages','supplier_product_price_overrides'] LOOP
    SELECT c.relrowsecurity INTO v_rls FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname=tbl;
    IF v_rls IS NULL THEN RAISE EXCEPTION 'verification failed: % not created', tbl; END IF;
    IF NOT v_rls THEN RAISE EXCEPTION 'verification failed: RLS off on %', tbl; END IF;

    SELECT count(*) INTO v_bad FROM pg_policies
     WHERE schemaname='public' AND tablename=tbl
       AND (coalesce(qual,'') || ' ' || coalesce(with_check,'')) NOT LIKE '%staff_members%';
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'verification failed: % has % policy(ies) not gated on staff_members', tbl, v_bad;
    END IF;
  END LOOP;

  -- The active-override uniqueness guard must exist, or two live overrides
  -- could disagree and the selected price would depend on row order.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public'
      AND indexname='supplier_product_price_overrides_active_uniq'
  ) THEN
    RAISE EXCEPTION 'verification failed: active override uniqueness index missing';
  END IF;

  -- Existing supplier tables must be untouched by this migration. A
  -- pre-existing policy set on them is fine; a policy named like OURS is not,
  -- because only this migration would have created it.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public'
       AND tablename IN ('supplier_price_history','supplier_deliveries','suppliers','products')
       AND (policyname LIKE 'supplier_quote%' OR policyname LIKE 'supplier_product_price%')
  ) THEN
    RAISE EXCEPTION 'verification failed: this migration added a policy to an existing supplier table';
  END IF;
END
$check$;

-- ============================================================================
-- ROLLBACK
--
-- DROP VIEW IF EXISTS public.supplier_quote_items_needing_review_v;
-- DROP VIEW IF EXISTS public.supplier_product_selected_price_v;
-- DROP VIEW IF EXISTS public.supplier_product_pack_lowest_price_v;
-- DROP VIEW IF EXISTS public.supplier_product_lowest_price_v;
-- DROP VIEW IF EXISTS public.supplier_quote_price_candidates_v;
-- DROP TABLE IF EXISTS public.supplier_product_price_overrides;
-- DROP TABLE IF EXISTS public.supplier_quote_pages;
-- ALTER TABLE public.supplier_product_matches
--   DROP COLUMN IF EXISTS supplier_sku, DROP COLUMN IF EXISTS supplier_description,
--   DROP COLUMN IF EXISTS base_unit,    DROP COLUMN IF EXISTS base_qty_per_pack,
--   DROP COLUMN IF EXISTS brand,        DROP COLUMN IF EXISTS size_text;
-- ALTER TABLE public.supplier_quote_items
--   DROP COLUMN IF EXISTS comparable_price, DROP COLUMN IF EXISTS base_qty_per_pack,
--   DROP COLUMN IF EXISTS base_unit,  DROP COLUMN IF EXISTS price_before_vat,
--   DROP COLUMN IF EXISTS discount_amount, DROP COLUMN IF EXISTS discount_percent,
--   DROP COLUMN IF EXISTS list_price, DROP COLUMN IF EXISTS line_total,
--   DROP COLUMN IF EXISTS quantity,   DROP COLUMN IF EXISTS page_no,
--   DROP COLUMN IF EXISTS line_no,    DROP COLUMN IF EXISTS confidence,
--   DROP COLUMN IF EXISTS extracted_raw, DROP COLUMN IF EXISTS reviewed_by,
--   DROP COLUMN IF EXISTS reviewed_at;
-- ALTER TABLE public.supplier_quotes
--   DROP COLUMN IF EXISTS document_type, DROP COLUMN IF EXISTS document_number,
--   DROP COLUMN IF EXISTS amount_net, DROP COLUMN IF EXISTS vat_amount,
--   DROP COLUMN IF EXISTS amount_gross, DROP COLUMN IF EXISTS vat_rate,
--   DROP COLUMN IF EXISTS vat_basis, DROP COLUMN IF EXISTS content_hash,
--   DROP COLUMN IF EXISTS page_count, DROP COLUMN IF EXISTS extraction_status,
--   DROP COLUMN IF EXISTS extraction_error, DROP COLUMN IF EXISTS extracted_at,
--   DROP COLUMN IF EXISTS supersedes_quote_id, DROP COLUMN IF EXISTS version;
--
-- Dropping the overrides table loses the override history and the automatic
-- lowest-price selection resumes. Dropping the item columns loses extracted
-- prices and packaging but NOT the stored documents, which stay in the bucket.
-- Nothing outside this feature reads any of it.
-- ============================================================================
