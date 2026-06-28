-- ============================================================
-- CRM / ERP Schema for Supabase
-- Run this in the Supabase SQL Editor (Project → SQL Editor → New query)
-- ============================================================

-- Enable UUID extension (already enabled in Supabase by default)
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ──────────────────────────────────────────────────────────────
-- Helper: every table gets id, created_date, user_id
-- ──────────────────────────────────────────────────────────────

-- customers
CREATE TABLE IF NOT EXISTS customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name              TEXT NOT NULL,
  customer_type     TEXT DEFAULT 'פרטי',
  crm_status        TEXT DEFAULT 'ליד חדש',
  contact_person    TEXT,
  phone             TEXT,
  mobile            TEXT,
  email             TEXT,
  address           TEXT,
  city              TEXT,
  tax_id            TEXT,
  payment_terms     TEXT DEFAULT 'שוטף+30',
  credit_limit      NUMERIC,
  discount_percent  NUMERIC DEFAULT 0,
  notes             TEXT,
  is_active         BOOLEAN DEFAULT TRUE,
  location_lat      DOUBLE PRECISION,
  location_lng      DOUBLE PRECISION
);

-- products
CREATE TABLE IF NOT EXISTS products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name                     TEXT NOT NULL,
  sku                      TEXT,
  barcode                  TEXT,
  category_id              UUID,
  category                 TEXT,
  supplier_id              UUID,
  supplier                 TEXT,
  buy_price                NUMERIC,
  sell_price               NUMERIC NOT NULL DEFAULT 0,
  quantity                 NUMERIC DEFAULT 0,
  min_quantity             NUMERIC DEFAULT 0,
  unit                     TEXT DEFAULT 'יחידה',
  image_url                TEXT,
  description              TEXT,
  notes                    TEXT,
  is_active                BOOLEAN DEFAULT TRUE,
  tags                     TEXT,
  prices_migrated_to_net   BOOLEAN DEFAULT FALSE
);

-- categories
CREATE TABLE IF NOT EXISTS categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name        TEXT NOT NULL,
  parent_id   UUID,
  description TEXT,
  sort_order  INTEGER DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE
);

-- suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name            TEXT NOT NULL,
  contact_person  TEXT,
  phone           TEXT,
  mobile          TEXT,
  email           TEXT,
  address         TEXT,
  city            TEXT,
  tax_id          TEXT,
  payment_terms   TEXT DEFAULT 'שוטף+30',
  bank_name       TEXT,
  bank_account    TEXT,
  notes           TEXT,
  is_active       BOOLEAN DEFAULT TRUE
);

-- quotes
CREATE TABLE IF NOT EXISTS quotes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  quote_number      INTEGER,
  customer_id       UUID,
  customer_name     TEXT NOT NULL,
  customer_type     TEXT DEFAULT 'פרטי',
  customer_tax_id   TEXT,
  customer_address  TEXT,
  date              DATE,
  valid_until       DATE,
  items             JSONB DEFAULT '[]',
  subtotal          NUMERIC,
  discount_amount   NUMERIC,
  vat_rate          NUMERIC DEFAULT 17,
  vat_amount        NUMERIC,
  total             NUMERIC,
  notes             TEXT,
  customer_notes    TEXT,
  internal_notes    TEXT,
  agent_notes       TEXT,
  delivery_notes    TEXT,
  order_id          UUID,
  order_number      INTEGER,
  status            TEXT DEFAULT 'טיוטה'
);

-- orders
CREATE TABLE IF NOT EXISTS orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  order_number          INTEGER,
  quote_id              UUID,
  customer_id           UUID,
  customer_name         TEXT NOT NULL,
  customer_tax_id       TEXT,
  date                  DATE,
  delivery_date         DATE,
  delivery_address      TEXT,
  items                 JSONB DEFAULT '[]',
  subtotal              NUMERIC,
  vat_rate              NUMERIC DEFAULT 17,
  vat_amount            NUMERIC,
  total                 NUMERIC,
  notes                 TEXT,
  status                TEXT DEFAULT 'ממתין לאישור',
  inventory_processed   BOOLEAN DEFAULT FALSE,
  monthly_invoice_id    UUID
);

-- invoices
CREATE TABLE IF NOT EXISTS invoices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  invoice_number          INTEGER,
  invoice_type            TEXT DEFAULT 'regular',
  billing_month           INTEGER,
  billing_year            INTEGER,
  included_order_ids      JSONB DEFAULT '[]',
  included_invoice_ids    JSONB DEFAULT '[]',
  monthly_invoice_id      UUID,
  quote_id                UUID,
  order_id                UUID,
  customer_id             UUID,
  customer_name           TEXT NOT NULL,
  customer_tax_id         TEXT,
  customer_address        TEXT,
  date                    DATE,
  due_date                DATE,
  items                   JSONB DEFAULT '[]',
  subtotal                NUMERIC,
  discount_amount         NUMERIC,
  vat_rate                NUMERIC DEFAULT 17,
  vat_amount              NUMERIC,
  total                   NUMERIC,
  paid_amount             NUMERIC DEFAULT 0,
  notes                   TEXT,
  payment_status          TEXT DEFAULT 'ממתין לתשלום',
  external_invoice_number TEXT,
  external_pdf_url        TEXT
);

-- payments
CREATE TABLE IF NOT EXISTS payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  invoice_id      UUID NOT NULL,
  invoice_number  INTEGER,
  customer_id     UUID NOT NULL,
  customer_name   TEXT,
  amount          NUMERIC NOT NULL,
  payment_method  TEXT NOT NULL,
  payment_date    DATE NOT NULL,
  reference       TEXT,
  notes           TEXT,
  status          TEXT DEFAULT 'ממתין'
);

-- crm_tasks
CREATE TABLE IF NOT EXISTS crm_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  customer_id    UUID NOT NULL,
  customer_name  TEXT,
  title          TEXT NOT NULL,
  due_date       DATE,
  status         TEXT DEFAULT 'פתוחה',
  notes          TEXT
);

-- repair_tickets
CREATE TABLE IF NOT EXISTS repair_tickets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  ticket_number               INTEGER,
  customer_id                 UUID,
  customer_name               TEXT NOT NULL,
  customer_phone              TEXT,
  device_type                 TEXT NOT NULL,
  device_brand                TEXT,
  device_model                TEXT,
  serial_number               TEXT,
  problem_description         TEXT NOT NULL,
  status                      TEXT DEFAULT 'נכנס',
  priority                    TEXT DEFAULT 'רגילה',
  technician                  TEXT,
  received_date               DATE,
  estimated_completion_date   DATE,
  completion_date             DATE,
  cost_estimate               NUMERIC,
  parts_cost                  NUMERIC DEFAULT 0,
  labor_cost                  NUMERIC DEFAULT 0,
  final_cost                  NUMERIC,
  deposit_paid                NUMERIC DEFAULT 0,
  notes                       TEXT,
  customer_notes              TEXT
);

-- inventory_movements
CREATE TABLE IF NOT EXISTS inventory_movements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  product_id       UUID NOT NULL,
  product_name     TEXT,
  product_sku      TEXT,
  movement_type    TEXT NOT NULL,
  quantity         NUMERIC NOT NULL,
  quantity_before  NUMERIC,
  quantity_after   NUMERIC,
  reference_type   TEXT,
  reference_id     UUID,
  reference_number TEXT,
  notes            TEXT,
  performed_by     TEXT
);

-- notifications
CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  type            TEXT NOT NULL,
  severity        TEXT DEFAULT 'info',
  reference_type  TEXT,
  reference_id    UUID,
  is_read         BOOLEAN DEFAULT FALSE,
  read_at         TEXT
);

-- import_logs
CREATE TABLE IF NOT EXISTS import_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  import_type   TEXT NOT NULL,
  file_name     TEXT,
  file_url      TEXT,
  total_rows    INTEGER,
  success_rows  INTEGER,
  updated_rows  INTEGER,
  failed_rows   INTEGER,
  status        TEXT NOT NULL,
  error_details TEXT,
  performed_by  TEXT
);

-- invoice_logs
CREATE TABLE IF NOT EXISTS invoice_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  invoice_id               UUID,
  customer_name            TEXT,
  request_payload          TEXT,
  response_payload         TEXT,
  status                   TEXT NOT NULL,
  error_message            TEXT,
  external_invoice_number  TEXT,
  pdf_url                  TEXT
);

-- backups
CREATE TABLE IF NOT EXISTS backups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  label               TEXT,
  backup_type         TEXT NOT NULL DEFAULT 'ידני',
  status              TEXT NOT NULL DEFAULT 'בתהליך',
  entities_included   TEXT,
  record_counts       TEXT,
  data_url            TEXT,
  size_kb             NUMERIC,
  error_message       TEXT
);

-- business_settings (one row per user / business)
CREATE TABLE IF NOT EXISTS business_settings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  business_name               TEXT NOT NULL DEFAULT 'העסק שלי',
  logo_url                    TEXT,
  phone                       TEXT,
  email                       TEXT,
  address                     TEXT,
  tax_id                      TEXT,
  vat_rate                    NUMERIC DEFAULT 17,
  quote_counter               INTEGER DEFAULT 1000,
  order_counter               INTEGER DEFAULT 1000,
  invoice_counter             INTEGER DEFAULT 1000,
  profitability_access_code   TEXT DEFAULT '1234',
  api_url                     TEXT,
  api_key                     TEXT,
  api_secret                  TEXT,
  api_company_id              TEXT
);

-- ──────────────────────────────────────────────────────────────
-- Row Level Security (RLS)
-- Each user can only see and modify their own rows.
-- ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'customers','products','categories','suppliers','quotes','orders',
    'invoices','payments','crm_tasks','repair_tickets','inventory_movements',
    'notifications','import_logs','invoice_logs','backups','business_settings'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    -- SELECT
    EXECUTE format(
      'CREATE POLICY "%s_select" ON %I FOR SELECT USING (auth.uid() = user_id)',
      tbl, tbl
    );
    -- INSERT (user_id is set automatically by the DEFAULT, but we also enforce it)
    EXECUTE format(
      'CREATE POLICY "%s_insert" ON %I FOR INSERT WITH CHECK (auth.uid() = user_id)',
      tbl, tbl
    );
    -- UPDATE
    EXECUTE format(
      'CREATE POLICY "%s_update" ON %I FOR UPDATE USING (auth.uid() = user_id)',
      tbl, tbl
    );
    -- DELETE
    EXECUTE format(
      'CREATE POLICY "%s_delete" ON %I FOR DELETE USING (auth.uid() = user_id)',
      tbl, tbl
    );
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────
-- Indexes for common query patterns
-- ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_customers_user     ON customers(user_id, created_date DESC);
CREATE INDEX IF NOT EXISTS idx_products_user      ON products(user_id, created_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_user        ON orders(user_id, created_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_user      ON invoices(user_id, created_date DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_user        ON quotes(user_id, created_date DESC);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_customer ON crm_tasks(customer_id);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_status ON repair_tickets(user_id, status);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_customer ON repair_tickets(customer_id);
