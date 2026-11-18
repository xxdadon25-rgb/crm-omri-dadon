-- The PACKAGING LEVEL that products.buy_price is quoted in.
--
-- ADDITIVE. One nullable column on an existing table. No existing column is
-- altered, nothing is dropped, no policy changes and no existing row is
-- updated. Every product keeps NULL, which is the correct representation: we
-- have not been told, and we must not assume.
--
-- ============================================================================
-- THE ASSUMPTION THIS REMOVES
-- ============================================================================
-- Normalising a cost through packaging silently assumed that buy_price is a
-- price per BASE UNIT. It is not necessarily: a purchase price is typed off a
-- supplier document, and that document may quote per unit, per pack or per
-- carton. There is nothing in the data that says which.
--
-- Multiplying a per-CARTON purchase price by the 24 units in a carton
-- overstates the cost 24-fold and turns a healthy sale into an apparent loss —
-- the same class of error as the margin it was meant to fix, in the opposite
-- direction. So the level is recorded, per product, and the cost refuses to be
-- computed until it is known.
--
-- ============================================================================
-- THIS IS NOT THE VAT BASIS
-- ============================================================================
-- Two independent facts about the same number, deliberately kept apart:
--
--   PACKAGING BASIS (this column)  — is buy_price per unit, pack or carton?
--                                    Varies per product. Answered here.
--   VAT BASIS                      — does buy_price include VAT? Declared
--                                    once in src/lib/packagingMath.js as
--                                    BUY_PRICE_VAT_BASIS, with its provenance.
--
-- Collapsing them into one "basis" field would make it impossible to say "per
-- carton, excluding VAT", which is the commonest case on a supplier invoice.
--
-- ============================================================================
-- WHY THE ANSWER CANNOT BE DERIVED, AND IS ASKED FOR
-- ============================================================================
-- supplier_product_matches.sale_level looks like the answer. It is not. It
-- records the level THAT SUPPLIER'S QUOTED PRICE refers to, captured while
-- reviewing a quote beside that quote's own price.
--
-- products.buy_price is a different number with a different history: typed by
-- hand in the product form, or written from a DELIVERY NOTE line, or copied
-- from another product. No column anywhere records which supplier, quote or
-- document it came from.
--
-- So an approved match states the basis of a price we are not using. Where
-- buy_price was negotiated, taken from an older quote, or entered from a
-- delivery note in different packaging, a derived level would be confidently
-- wrong — and a wrong basis is worse than none, because the margin it
-- produces is one nobody questions.
--
-- The basis is therefore asked once and stored here. Until it is, no margin
-- is shown for that product.

ALTER TABLE public.supplier_quote_product_packages
  ADD COLUMN IF NOT EXISTS buy_price_level TEXT
  CONSTRAINT supplier_quote_product_packages_buy_price_level_check
  CHECK (buy_price_level IS NULL OR buy_price_level IN ('unit', 'pack', 'carton'));

COMMENT ON COLUMN public.supplier_quote_product_packages.buy_price_level IS
  'The packaging level products.buy_price is quoted in: unit | pack | carton. NULL = not known, and no normalised cost or margin is computed for the product until it is. Separate from the VAT basis of buy_price, which is declared in the application.';

-- The queue of products whose cost cannot yet be normalised. Partial, so it
-- indexes only the rows anyone will look for.
CREATE INDEX IF NOT EXISTS supplier_quote_product_packages_needs_buy_level_idx
  ON public.supplier_quote_product_packages (user_id, product_id)
  WHERE buy_price_level IS NULL;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $check$
DECLARE
  v_def TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'supplier_quote_product_packages'
       AND column_name = 'buy_price_level'
  ) THEN
    RAISE EXCEPTION 'verification failed: buy_price_level was not added';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conname = 'supplier_quote_product_packages_buy_price_level_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'verification failed: the level CHECK constraint is missing';
  END IF;
  -- NULL must stay legal: it is what every existing row holds, and it means
  -- "not known", which is a state the application depends on being able to
  -- represent.
  IF v_def NOT LIKE '%IS NULL%' THEN
    RAISE EXCEPTION 'verification failed: the CHECK does not permit NULL (%)', v_def;
  END IF;
  IF v_def NOT LIKE '%unit%' OR v_def NOT LIKE '%pack%' OR v_def NOT LIKE '%carton%' THEN
    RAISE EXCEPTION 'verification failed: the CHECK does not name the three levels (%)', v_def;
  END IF;
END
$check$;

-- ============================================================================
-- ROLLBACK
--
-- DROP INDEX IF EXISTS public.supplier_quote_product_packages_needs_buy_level_idx;
-- ALTER TABLE public.supplier_quote_product_packages
--   DROP CONSTRAINT IF EXISTS supplier_quote_product_packages_buy_price_level_check;
-- ALTER TABLE public.supplier_quote_product_packages DROP COLUMN IF EXISTS buy_price_level;
--
-- Dropping it loses only the knowledge of which level each purchase price is
-- quoted in; margins then read "pending" again. No price, inventory figure,
-- order or invoice is affected.
-- ============================================================================
