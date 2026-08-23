-- Business expenses.
--
-- PURELY ADDITIVE. Creates one table. It does not alter products, suppliers,
-- supplier_deliveries, supplier_price_history, supplier_orders, orders or
-- invoices, and it changes no existing policy, column or row.
--
-- MODEL
--   One row per business expense. amount_net (the amount BEFORE VAT) is the
--   authoritative figure — vat_amount and amount_gross are recorded when the
--   document states them, and are never derived to fill a gap.
--
--   Expenses created from a supplier goods receipt carry supplier_delivery_id,
--   which links back to the already-uploaded document. Nothing is copied: the
--   file stays where the receiving flow put it. Manually entered expenses leave
--   that column NULL and may carry their own file_path instead.
--
-- SECURITY
--   Same rule as every other user-owned table in this CRM: a row belongs to one
--   auth user and only that user can read or write it.

CREATE TABLE IF NOT EXISTS expenses (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  date          DATE        NOT NULL,
  category      TEXT        NOT NULL,
  payee         TEXT,
  description   TEXT,

  -- The amount before VAT. Required, because it is the figure the business
  -- reports on, and the one the dashboard will eventually sum.
  amount_net    NUMERIC     NOT NULL,
  -- Recorded only when the document states them. A receipt with no VAT line
  -- legitimately leaves these NULL.
  vat_amount    NUMERIC,
  amount_gross  NUMERIC,

  document_number TEXT,

  -- Set when the expense came from a supplier goods receipt. ON DELETE SET NULL
  -- so removing a delivery record never deletes the financial record with it.
  supplier_delivery_id UUID REFERENCES supplier_deliveries(id) ON DELETE SET NULL,

  -- Only used by manually uploaded receipts. Supplier-sourced expenses read the
  -- file through supplier_delivery_id instead of storing a second copy.
  file_path     TEXT,
  file_name     TEXT,

  CONSTRAINT expenses_amount_net_check CHECK (amount_net >= 0)
);

-- One expense per goods receipt. This is the duplicate guard: a retried insert,
-- a double-clicked save or a repeated request can only ever produce one row.
-- Partial, so the many manually entered expenses (all NULL) do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS expenses_supplier_delivery_uniq
  ON expenses (supplier_delivery_id)
  WHERE supplier_delivery_id IS NOT NULL;

-- The dashboard will sum amount_net over a date range for one user.
CREATE INDEX IF NOT EXISTS expenses_user_date_idx
  ON expenses (user_id, date DESC);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- The same four-policy shape every user-owned table in this CRM already uses.
CREATE POLICY "expenses_select" ON expenses
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "expenses_insert" ON expenses
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "expenses_update" ON expenses
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "expenses_delete" ON expenses
  FOR DELETE USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- DROP TABLE IF EXISTS expenses;
--
-- Dropping the table removes every expense record. No supplier, delivery,
-- product, order or invoice data is affected, because none of it was ever
-- written by this table.
-- ---------------------------------------------------------------------------
