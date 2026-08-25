-- Portal access: remember that a customer was explicitly removed.
--
-- ADDITIVE. Adds one nullable column to customer_portal_access and relaxes one
-- constraint on that same table. It does not touch customers, auth.users, the
-- signup triggers, RLS, foreign keys, portal_orders, portal_order_items,
-- invoices, quotes, customer_product_prices, customer_blocked_products or any
-- other table — and it changes no existing row's data.
--
-- WHY
--   The portal-access screen lists CRM customers and LEFT JOINs their access
--   row, so "no access row" renders as "אין גישה / הפעל גישה לפורטל". That is
--   correct for a customer who was never configured for the portal — but it is
--   indistinguishable from one a staff member deliberately removed, so a deleted
--   portal customer reappeared as an un-configured one.
--
--   Deleting the row therefore cannot express the difference. The row stays and
--   is blanked instead, and this column records the moment it was removed:
--     portal_deleted_at IS NULL      -> a live portal access row
--     portal_deleted_at IS NOT NULL  -> explicitly removed; hidden from the
--                                       normal list, listed under
--                                       "לקוחות שהוסרו מהפורטל"
--
--   Restoring clears the column. It grants nothing on its own: auth_user_id,
--   is_active and first_login_completed all stay cleared, so staff must run the
--   normal portal-access flow again.

-- ---------------------------------------------------------------------------
-- 1. Allow phone_or_email to be cleared.
--
--    Removal blanks phone_or_email so that link_portal_customer_on_signup()
--    cannot re-link the row to whoever next registers with that address:
--
--      WHERE phone_or_email = NEW.email AND is_active = true AND auth_user_id IS NULL
--
--    With the address NULL, `NULL = NEW.email` is NULL rather than true, and
--    is_active = false fails independently — both halves of the predicate are
--    broken.
--
--    DROP NOT NULL only removes a restriction. It rewrites no row, changes no
--    stored value, and every existing row keeps the address it has today. The
--    column simply becomes able to hold NULL for rows written from now on.
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_portal_access
  ALTER COLUMN phone_or_email DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The removal marker. Nullable, so every existing row gets NULL — i.e.
--    "not removed", which is the correct state for all of them.
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_portal_access
  ADD COLUMN IF NOT EXISTS portal_deleted_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.customer_portal_access.portal_deleted_at IS
  'Set when staff removed this customer from the portal. NULL = live access row. A removed row is blanked (auth_user_id, phone_or_email cleared) but kept, so the CRM customer is never deleted and the removal is distinguishable from "never configured".';

-- The removed-customers view reads exactly these rows, and the normal list
-- excludes them. Partial, because almost every row has NULL here.
CREATE INDEX IF NOT EXISTS customer_portal_access_deleted_idx
  ON public.customer_portal_access (portal_deleted_at)
  WHERE portal_deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Verification — raises if the table is not in the expected state, so a
--    partial apply is visible immediately rather than at the next removal.
-- ---------------------------------------------------------------------------
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customer_portal_access'
      AND column_name = 'phone_or_email' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'verification failed: phone_or_email is still NOT NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customer_portal_access'
      AND column_name = 'portal_deleted_at'
  ) THEN
    RAISE EXCEPTION 'verification failed: portal_deleted_at was not added';
  END IF;

  -- Nothing should be marked as removed by this migration itself.
  IF EXISTS (
    SELECT 1 FROM public.customer_portal_access WHERE portal_deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'verification failed: portal_deleted_at is unexpectedly set on existing rows';
  END IF;
END
$check$;

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- ALTER TABLE public.customer_portal_access DROP COLUMN IF EXISTS portal_deleted_at;
--
-- Dropping the column loses only the record of which rows were removed. Those
-- rows are already blanked, so no customer regains access — they simply
-- reappear in the normal list as "אין גישה", the behaviour that existed before.
--
-- Restoring the NOT NULL constraint is only possible once no row holds NULL:
--   -- UPDATE public.customer_portal_access SET phone_or_email = '<placeholder>'
--   --  WHERE phone_or_email IS NULL;
--   -- ALTER TABLE public.customer_portal_access
--   --   ALTER COLUMN phone_or_email SET NOT NULL;
-- That UPDATE writes real data, so it is deliberately left commented out.
-- ---------------------------------------------------------------------------
