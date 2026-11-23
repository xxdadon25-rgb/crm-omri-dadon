-- Synthetic schema adaptation for COMMISSION preview tests only.
-- Production already has these exact columns. No real records are copied.
alter table public.invoices
 add column total numeric,
 add column vat_rate numeric,
 add column included_order_ids jsonb default '[]'::jsonb,
 add column credited_at timestamptz,
 add column credit_note_id uuid;
alter table public.payments
 add column invoice_id uuid,
 add column amount numeric,
 add column payment_date date,
 add column payment_group_id uuid,
 add column status text,
 add column payment_method text;
alter table public.credit_notes
 add column invoice_id uuid,
 add column total numeric,
 add column finbot_status text,
 add column external_credit_note_number text;
