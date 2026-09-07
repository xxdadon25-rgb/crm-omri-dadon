-- Check details on payments.
--
-- PURELY ADDITIVE. Adds four nullable columns to public.payments. It creates no
-- index, changes no RLS policy, adds no trigger, function or view, and updates
-- no existing row. Every current payment simply gets NULL in the new columns.
--
-- WHY
--   Finbot rejects a receipt for payment type "3" (check) unless the drawing
--   bank, branch, account and check number are supplied — the same four values
--   its own UI demands when CHECK is selected. Every check payment was
--   therefore recorded in the CRM but produced no receipt, while cash and bank
--   transfer succeeded. These columns keep those values with the payment as
--   audit data, alongside the request sent to Finbot.
--
-- TEXT, NOT NUMERIC — this matters
--   An Israeli branch or account number can begin with a zero. Stored as an
--   integer, "012345" becomes 12345 and the original is unrecoverable. These
--   are identifiers, never arithmetic operands, so they are text everywhere:
--   in the input element, in the payload, and here.
--
-- SAFETY
--   Adding a nullable column with no default is a catalogue-only change in
--   PostgreSQL — no table rewrite, no row-level work, and only a brief lock.
--   Non-check payments keep NULL in all four columns permanently, which is
--   the correct representation: they have no check to describe.
--
--   Deploy this BEFORE the frontend that writes these columns. The reverse
--   order makes every Payment.create fail with PGRST204 ("Could not find the
--   column ... in the schema cache") and payments stop saving entirely.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS bank_name    text,
  ADD COLUMN IF NOT EXISTS bank_branch  text,
  ADD COLUMN IF NOT EXISTS bank_account text,
  ADD COLUMN IF NOT EXISTS check_number text;

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   ALTER TABLE public.payments
--     DROP COLUMN IF EXISTS bank_name,
--     DROP COLUMN IF EXISTS bank_branch,
--     DROP COLUMN IF EXISTS bank_account,
--     DROP COLUMN IF EXISTS check_number;
--
-- Dropping them discards the recorded check details permanently. Roll the
-- frontend back FIRST, or Payment.create will fail for every payment method.
-- ---------------------------------------------------------------------------
