-- Independent supplier quotation packaging profiles and explicit sale levels.
-- No ALTER/UPDATE to public.products, inventory, receiving or supplier history.
CREATE TABLE IF NOT EXISTS public.supplier_quote_product_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  units_per_pack numeric CHECK (units_per_pack IS NULL OR units_per_pack > 0),
  packs_per_carton numeric CHECK (packs_per_carton IS NULL OR packs_per_carton > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id)
);
ALTER TABLE public.supplier_quote_product_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_quote_product_packages_staff_select ON public.supplier_quote_product_packages
  FOR SELECT TO authenticated USING (
    user_id = (select auth.uid())
    AND EXISTS (SELECT 1 FROM public.staff_members sm WHERE sm.auth_user_id = (select auth.uid()))
  );
CREATE POLICY supplier_quote_product_packages_staff_insert ON public.supplier_quote_product_packages
  FOR INSERT TO authenticated WITH CHECK (
    user_id = (select auth.uid())
    AND EXISTS (SELECT 1 FROM public.staff_members sm WHERE sm.auth_user_id = (select auth.uid()))
  );
CREATE POLICY supplier_quote_product_packages_staff_update ON public.supplier_quote_product_packages
  FOR UPDATE TO authenticated USING (
    user_id = (select auth.uid())
    AND EXISTS (SELECT 1 FROM public.staff_members sm WHERE sm.auth_user_id = (select auth.uid()))
  ) WITH CHECK (
    user_id = (select auth.uid())
    AND EXISTS (SELECT 1 FROM public.staff_members sm WHERE sm.auth_user_id = (select auth.uid()))
  );
GRANT SELECT, INSERT, UPDATE ON public.supplier_quote_product_packages TO authenticated;
REVOKE ALL ON public.supplier_quote_product_packages FROM anon;
ALTER TABLE public.supplier_quote_items
  ADD COLUMN IF NOT EXISTS sale_level text CHECK (sale_level IN ('unit','pack','carton'));
ALTER TABLE public.supplier_product_matches
  ADD COLUMN IF NOT EXISTS sale_level text CHECK (sale_level IN ('unit','pack','carton'));

-- Existing historical matches are NOT silently assigned a sale level.
-- Thus the unverified old test price cannot be picked for purchasing.
CREATE OR REPLACE VIEW public.supplier_quote_price_candidates_v
WITH (security_invoker = true) AS
SELECT
  i.user_id, q.supplier_id, i.product_id, i.base_unit, i.base_qty_per_pack,
  i.comparable_price, i.price_before_vat, i.supplier_sku, i.supplier_name_raw,
  i.unit AS supplier_unit_text, i.pack_size AS supplier_pack_size,
  i.id AS supplier_quote_item_id, q.id AS supplier_quote_id,
  q.document_number, q.document_type, q.quote_date, q.valid_until,
  q.status AS document_status, q.vat_basis, q.vat_rate
FROM public.supplier_quote_items i
JOIN public.supplier_quotes q ON q.id = i.supplier_quote_id
WHERE i.match_status = 'approved'
  AND i.product_id IS NOT NULL
  AND i.base_unit IS NOT NULL
  AND i.base_qty_per_pack > 0
  AND i.comparable_price IS NOT NULL
  AND i.sale_level IN ('unit','pack','carton')
  AND q.vat_basis IN ('excluded','included');

CREATE OR REPLACE VIEW public.supplier_quote_items_needing_review_v
WITH (security_invoker = true) AS
SELECT
  i.user_id, q.supplier_id, q.id AS supplier_quote_id, i.id AS supplier_quote_item_id,
  i.line_no, i.page_no, i.supplier_name_raw, i.supplier_sku, i.match_status, i.confidence,
  q.vat_basis, i.base_unit, i.base_qty_per_pack,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN i.match_status <> 'approved' THEN 'match_not_approved' END,
    CASE WHEN i.product_id IS NULL THEN 'no_canonical_product' END,
    CASE WHEN i.supplier_sku IS NULL OR btrim(i.supplier_sku) = '' OR btrim(i.supplier_sku) = '0' THEN 'sku_missing' END,
    CASE WHEN i.base_unit IS NULL OR i.base_qty_per_pack IS NULL THEN 'packaging_unknown' END,
    CASE WHEN i.sale_level IS NULL THEN 'sale_unit_unknown' END,
    CASE WHEN q.vat_basis = 'unknown' THEN 'vat_basis_unknown' END,
    CASE WHEN i.confidence = 'low' THEN 'low_confidence' END,
    CASE WHEN i.price_before_vat IS NULL THEN 'price_missing' END
  ],NULL) AS review_reasons
FROM public.supplier_quote_items i
JOIN public.supplier_quotes q ON q.id = i.supplier_quote_id
WHERE i.match_status <> 'approved'
   OR i.product_id IS NULL
   OR i.supplier_sku IS NULL OR btrim(i.supplier_sku) = '' OR btrim(i.supplier_sku) = '0'
   OR i.base_unit IS NULL OR i.base_qty_per_pack IS NULL
   OR i.sale_level IS NULL
   OR q.vat_basis = 'unknown'
   OR i.confidence = 'low'
   OR i.price_before_vat IS NULL;
