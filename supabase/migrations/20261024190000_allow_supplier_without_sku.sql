-- Explicitly confirmed absence of a supplier SKU. Preserve the source PDF unchanged.
ALTER TABLE public.supplier_quote_items ADD COLUMN IF NOT EXISTS sku_unavailable boolean NOT NULL DEFAULT false;
ALTER TABLE public.supplier_product_matches ADD COLUMN IF NOT EXISTS sku_unavailable boolean NOT NULL DEFAULT false;
CREATE OR REPLACE VIEW public.supplier_quote_items_needing_review_v
WITH (security_invoker = true) AS
SELECT
 i.user_id, q.supplier_id, q.id AS supplier_quote_id, i.id AS supplier_quote_item_id,
 i.line_no, i.page_no, i.supplier_name_raw, i.supplier_sku, i.match_status, i.confidence,
 q.vat_basis, i.base_unit, i.base_qty_per_pack,
 ARRAY_REMOVE(ARRAY[
   CASE WHEN i.match_status <> 'approved' THEN 'match_not_approved' END,
   CASE WHEN i.product_id IS NULL THEN 'no_canonical_product' END,
   CASE WHEN NOT i.sku_unavailable AND
      (i.supplier_sku IS NULL OR btrim(i.supplier_sku) = '' OR btrim(i.supplier_sku) = '0')
     THEN 'sku_missing' END,
   CASE WHEN i.base_unit IS NULL OR i.base_qty_per_pack IS NULL THEN 'packaging_unknown' END,
   CASE WHEN i.sale_level IS NULL THEN 'sale_unit_unknown' END,
   CASE WHEN q.vat_basis = 'unknown' THEN 'vat_basis_unknown' END,
   CASE WHEN i.confidence = 'low' THEN 'low_confidence' END,
   CASE WHEN i.price_before_vat IS NULL THEN 'price_missing' END
 ],NULL) AS review_reasons
FROM public.supplier_quote_items i
JOIN public.supplier_quotes q ON q.id = i.supplier_quote_id
WHERE i.match_status <> 'approved' OR i.product_id IS NULL
 OR (NOT i.sku_unavailable AND
     (i.supplier_sku IS NULL OR btrim(i.supplier_sku) = '' OR btrim(i.supplier_sku) = '0'))
 OR i.base_unit IS NULL OR i.base_qty_per_pack IS NULL OR i.sale_level IS NULL
 OR q.vat_basis = 'unknown' OR i.confidence = 'low' OR i.price_before_vat IS NULL;
