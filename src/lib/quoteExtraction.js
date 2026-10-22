/**
 * Supplier quotation scanning — from photographed pages to review rows.
 *
 * This module is the seam between the extractor and the quotation tables. It
 * preprocesses pages, calls extract-supplier-quote, and turns each returned
 * line into a draft row shaped like supplier_quote_items — with the VAT basis
 * resolved, packaging parsed and the comparable price computed by quoteMath.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It writes nothing. Nothing reaches the database until a human approves it
 *   in the review screen, which is the whole point of requirement 7. It also
 *   never touches products.buy_price, supplier_price_history,
 *   supplier_deliveries, supplier_orders or inventory — a quotation is an
 *   offer, and those tables record what was received and paid.
 *
 * EVERY LINE SURVIVES
 *   One extracted line becomes exactly one draft row, in document order.
 *   Nothing is merged, deduplicated or filtered here: two rows for the same
 *   product stay two rows and the user decides. The only transformations are
 *   derivations (price before VAT, base unit, comparable price), and each one
 *   records whether it succeeded so the review screen can ask rather than
 *   guess.
 */
import { supabase } from "@/api/supabaseClient";
import { preprocessImage, MAX_PAGES, EXTRACTION_ERRORS } from "@/lib/quoteDocumentImage";
import {
  toNumber, round2, reconcileLinePrice, checkDiscount, resolveVatBasis,
  priceBeforeVat, parsePackaging, documentCompleteness, reviewFlags,
} from "@/lib/quoteMath";

export { MAX_PAGES, EXTRACTION_ERRORS };

/** SHA-256 over the concatenated page bytes — the duplicate-import guard.
 *  Computed from the PREPROCESSED bytes, so the hash describes exactly what
 *  was stored and read, not the camera's original file. */
export async function documentContentHash(pages) {
  const parts = pages.map(p => p.base64 || "");
  const joined = parts.join("|");
  const bytes = new TextEncoder().encode(joined);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Preprocess every page, in order.
 *
 * Uses the goods-receiving scanner's own pixel pipeline, copied verbatim into
 * quoteDocumentImage.js. A PDF passes through as-is, exactly as there.
 */
export async function preparePages(files) {
  if (!files?.length) throw new Error("no_pages");
  if (files.length > MAX_PAGES) throw new Error("too_many_pages");
  const pages = [];
  for (const file of files) {
    pages.push(await preprocessImage(file));
  }
  return pages;
}

/**
 * Call the extractor. Server error codes are technical on purpose; the user
 * gets Hebrew, using the same map the existing scanner uses.
 */
export async function extractQuotePages(pages) {
  const { data, error } = await supabase.functions.invoke("extract-supplier-quote", {
    body: { pages },
  });
  if (error) {
    // invoke() resolves on a non-2xx, so the returned error is inspected too.
    const detail = await error?.context?.clone?.().text?.().catch(() => null);
    throw new Error(error.message || detail || "שגיאה בקריאה לשרת החילוץ");
  }
  if (!data?.ok) {
    throw new Error(EXTRACTION_ERRORS[data?.error] || data?.error || "שגיאה בחילוץ הנתונים");
  }
  return data;
}

/**
 * Turn an extraction result into draft review rows.
 *
 * ORDER OF OPERATIONS MATTERS
 *   1. Reconcile each line's arithmetic FIRST, because the VAT decision is
 *      made from the sum of the line totals and a mis-read unit price would
 *      poison it.
 *   2. Decide the VAT basis ONCE for the whole document, from its own totals.
 *   3. Only then derive each line's pre-VAT price, since that depends on the
 *      basis — and when the basis is unknown, the price stays null and the
 *      line is flagged instead of being quietly treated as net.
 */
export function buildDraftFromExtraction(extraction, { vatBasisOverride = null, vatRateOverride = null } = {}) {
  const rawItems = Array.isArray(extraction?.items) ? extraction.items : [];

  // Pass 1: line arithmetic. unit_price may be corrected; quantity and total
  // never are.
  const stage1 = rawItems.map((item, idx) => {
    const recon = reconcileLinePrice({
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: item.total,
    });
    const discount = checkDiscount({
      list_price: item.list_price,
      discount_percent: item.discount_percent,
      discount_amount: item.discount_amount,
      unit_price: recon.unit_price,
    });
    return {
      line_no: toNumber(item.line_no) ?? idx + 1,
      page_no: toNumber(item.page_from) ?? null,
      supplier_sku: item.sku == null ? null : String(item.sku),   // TEXT: zeros kept
      supplier_name_raw: String(item.product_name ?? "").trim(),
      quantity: toNumber(item.quantity),
      unit: item.unit == null ? null : String(item.unit),
      pack_size: toNumber(item.pack_size),
      list_price: toNumber(item.list_price),
      discount_percent: toNumber(item.discount_percent),
      discount_amount: toNumber(item.discount_amount),
      unit_price: recon.unit_price,
      line_total: toNumber(item.total),
      // 'low' whenever the model said so OR our own cross-checks disagreed —
      // a corrected price and an impossible discount are both reasons to look.
      confidence: item.confidence === "low" || recon.adjusted || !discount.ok ? "low" : "high",
      price_adjusted: recon.adjusted,
      price_adjust_reason: recon.reason,
      discount_ok: discount.ok,
      discount_expected: discount.expected,
      extracted_raw: item,
    };
  });

  // The sum of the line totals: the evidence for the VAT decision and for the
  // completeness check.
  const lineTotalSum = stage1.reduce((s, l) => s + (l.line_total ?? 0), 0);

  const vat = vatBasisOverride
    ? { basis: vatBasisOverride, vat_rate: toNumber(vatRateOverride), reason: "user_confirmed", triangle_ok: null }
    : resolveVatBasis({
        amount_net: extraction?.amount_net,
        vat_amount: extraction?.vat_amount,
        amount_gross: extraction?.amount_gross,
        line_total_sum: round2(lineTotalSum),
      });

  // Pass 2: packaging and the pre-VAT price.
  const items = stage1.map((line) => {
    const pack = parsePackaging({
      unit: line.unit,
      pack_size: line.pack_size,
      text: `${line.unit ?? ""} ${line.supplier_name_raw}`.trim(),
    });
    const beforeVat = priceBeforeVat({
      unit_price: line.unit_price,
      vat_basis: vat.basis,
      vat_rate: vat.vat_rate,
    });
    const row = {
      ...line,
      base_unit: pack.base_unit,
      base_qty_per_pack: pack.base_qty_per_pack,
      packaging_source: pack.source,
      packaging_confident: pack.confident,
      price_before_vat: beforeVat,
      // comparable_price is GENERATED by the database; shown here for review.
      comparable_price: beforeVat != null && pack.base_qty_per_pack
        ? beforeVat / pack.base_qty_per_pack
        : null,
      // Nothing is matched or approved by this module.
      product_id: null,
      match_status: "pending",
    };
    row.review_reasons = reviewFlags({ item: row, quote: { vat_basis: vat.basis } });
    return row;
  });

  const completeness = documentCompleteness({
    line_total_sum: round2(lineTotalSum),
    amount_net: extraction?.amount_net,
    amount_gross: extraction?.amount_gross,
    vat_basis: vat.basis,
  });

  return {
    document: {
      document_type: extraction?.document_type ?? null,
      document_number: extraction?.document_number ?? null,
      quote_date: extraction?.document_date ?? null,
      valid_until: extraction?.valid_until ?? null,
      amount_net: toNumber(extraction?.amount_net),
      vat_amount: toNumber(extraction?.vat_amount),
      amount_gross: toNumber(extraction?.amount_gross),
      vat_basis: vat.basis,
      vat_rate: vat.vat_rate,
      page_count: toNumber(extraction?.page_count),
    },
    supplier_hint: extraction?.supplier ?? null,
    items,
    line_total_sum: round2(lineTotalSum),
    vat,
    completeness,
    batches: extraction?.batches ?? [],
  };
}
