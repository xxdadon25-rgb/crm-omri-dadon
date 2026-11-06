-- Private storage for receipt documents, readable only by CRM staff.
--
-- ADDITIVE. Creates one storage bucket and one SELECT policy. No existing
-- bucket, policy, table or row is altered.
--
-- ============================================================================
-- WHY THE BUCKET IS PRIVATE
-- ============================================================================
-- A receipt is a tax document naming a customer and an amount. The buckets
-- this project already uses for attachments are PUBLIC: their urls are
-- unguessable but not access-controlled, so anyone holding one can read the
-- file, signed in or not, forever.
--
-- This bucket is private. There is no durable address at all; the application
-- mints a signed url at the moment of the click, valid for five minutes.
--
-- ============================================================================
-- WHY "TO authenticated" IS NOT ENOUGH — THE MISTAKE THIS FIXES
-- ============================================================================
-- A policy of `TO authenticated USING (bucket_id = 'payment-receipts')` reads
-- as "signed-in CRM users". It is not.
--
-- PORTAL CUSTOMERS ARE AUTHENTICATED USERS TOO. They sign in through Supabase
-- auth and are recognised by customer_portal_access.auth_user_id — the same
-- `authenticated` role as staff. Under that policy any customer who signed
-- into the ordering portal could sign and read EVERY receipt in the bucket,
-- including other customers' receipts: their names, their amounts, their
-- payment dates. The role says nothing about who the person is.
--
-- So the policy asks the question the project already asks everywhere else
-- this matters: is this auth user a member of staff_members? That is the same
-- test used by customer_product_prices, so there is one notion of "staff"
-- rather than a second one that could drift from it.
--
-- ============================================================================
-- SELECT ONLY, AND WHY
-- ============================================================================
-- There is no insert, update or delete policy. Receipts are uploaded from the
-- Supabase Dashboard by the owner, not by the application, so the application
-- needs exactly one permission: to read an object in order to sign it. Granting
-- writes it never uses would only widen what a compromised session could do.
--
-- The customer ordering portal is unchanged by this migration: it gains no
-- access it did not have, and loses none it had.

-- ---------------------------------------------------------------------------
-- The bucket. `public = false` is the point; everything else is a guard rail.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('payment-receipts', 'payment-receipts', false, 26214400, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Read access for staff, and for nobody else.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'Staff read payment receipts'
  ) THEN
    CREATE POLICY "Staff read payment receipts"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'payment-receipts'
        AND EXISTS (
          SELECT 1 FROM public.staff_members sm
           WHERE sm.auth_user_id = auth.uid()
        )
      );
  END IF;
END
$$;

-- ============================================================================
-- VERIFICATION — raises rather than leaving a bucket readable by the wrong
-- people, or unreadable by the right ones.
-- ============================================================================
DO $check$
DECLARE
  v_public  BOOLEAN;
  v_using   TEXT;
BEGIN
  SELECT public INTO v_public FROM storage.buckets WHERE id = 'payment-receipts';
  IF v_public IS NULL THEN
    RAISE EXCEPTION 'verification failed: the payment-receipts bucket was not created';
  END IF;
  IF v_public THEN
    RAISE EXCEPTION 'verification failed: the payment-receipts bucket is PUBLIC';
  END IF;

  SELECT qual INTO v_using
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'Staff read payment receipts';

  IF v_using IS NULL THEN
    RAISE EXCEPTION 'verification failed: the read policy is missing';
  END IF;
  IF v_using NOT LIKE '%staff_members%' THEN
    RAISE EXCEPTION
      'verification failed: the policy does not require staff membership, so portal customers would pass it (qual=%)',
      v_using;
  END IF;
  IF v_using NOT LIKE '%payment-receipts%' THEN
    RAISE EXCEPTION 'verification failed: the policy is not scoped to this bucket (qual=%)', v_using;
  END IF;

  -- Nothing may be writable through the API: receipts are uploaded by hand.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'Staff read payment receipts'
       AND cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'verification failed: the receipts policy is not SELECT-only';
  END IF;
END
$check$;

-- ============================================================================
-- ROLLBACK
--
-- DROP POLICY IF EXISTS "Staff read payment receipts" ON storage.objects;
-- -- and, only once no receipt is stored in it:
-- DELETE FROM storage.buckets WHERE id = 'payment-receipts';
--
-- Dropping the policy makes stored receipts unreadable — "הצג קבלה" will
-- report that it cannot open them — but deletes nothing and changes no
-- payment, amount or balance.
-- ============================================================================
