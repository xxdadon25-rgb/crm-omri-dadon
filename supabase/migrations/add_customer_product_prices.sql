-- Customer-specific product prices.
--
-- PURELY ADDITIVE. Creates one table. It does not alter products, customers,
-- orders, invoices or any existing policy, and it NEVER touches
-- products.sell_price — the normal catalogue price stays exactly as it is.
--
-- MODEL
--   customer + product -> the last unit price saved for that customer in a CRM
--   order. One row per pair, latest price wins, no history, no price lists, no
--   discount rules. Absence of a row is meaningful: it means "this customer has
--   no special price", and the portal then falls back to its existing
--   sell_price + discount behaviour.
--
-- SECURITY
--   A portal customer may read ONLY the rows belonging to the customer identity
--   linked to their auth user through customer_portal_access, and that link
--   must still be active. They cannot read another customer's prices and cannot
--   write at all: prices are set exclusively by CRM staff saving an order.

CREATE TABLE IF NOT EXISTS customer_product_prices (
  customer_id  UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id   UUID        NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  unit_price   NUMERIC     NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (customer_id, product_id),
  CONSTRAINT customer_product_prices_unit_price_check CHECK (unit_price >= 0)
);

-- The portal reads every saved price for one customer in a single query.
CREATE INDEX IF NOT EXISTS customer_product_prices_customer_idx
  ON customer_product_prices (customer_id);

ALTER TABLE customer_product_prices ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Portal customer: read own prices only.
--
-- The subquery ties the row to the caller's own auth user via
-- customer_portal_access, so customer A can never see customer B's price even
-- by guessing a customer_id. Deliberately SELECT only — a customer must never
-- be able to set their own price.
-- ---------------------------------------------------------------------------
CREATE POLICY "Portal customer reads own prices" ON customer_product_prices
FOR SELECT TO authenticated
USING (
  customer_id IN (
    SELECT cpa.customer_id
    FROM customer_portal_access cpa
    WHERE cpa.auth_user_id = auth.uid()
      AND cpa.is_active
  )
);

-- ---------------------------------------------------------------------------
-- CRM staff: full access.
--
-- staff_members is the same table the portal already uses to recognise staff
-- (demo mode), so this reuses the existing notion of "this auth user is staff"
-- rather than inventing a second one.
-- ---------------------------------------------------------------------------
CREATE POLICY "Staff read prices" ON customer_product_prices
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM staff_members sm WHERE sm.auth_user_id = auth.uid())
);

CREATE POLICY "Staff insert prices" ON customer_product_prices
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM staff_members sm WHERE sm.auth_user_id = auth.uid())
);

CREATE POLICY "Staff update prices" ON customer_product_prices
FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM staff_members sm WHERE sm.auth_user_id = auth.uid())
);

CREATE POLICY "Staff delete prices" ON customer_product_prices
FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM staff_members sm WHERE sm.auth_user_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- DROP TABLE IF EXISTS customer_product_prices;
--
-- Dropping the table removes every saved customer price. The portal then falls
-- back to sell_price + discount for everyone, which is the behaviour that
-- existed before this feature — no order, invoice or catalogue data is
-- affected, because none of it was ever written by this table.
-- ---------------------------------------------------------------------------
