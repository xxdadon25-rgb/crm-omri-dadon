import { supabase } from "@/api/supabaseClient";

// Constant gap between the human-facing Finbot reference (e.g. 10011) and the
// internal serial that Finbot's linkedDocument field needs (e.g. 4613). Valid
// only while every Finbot document originates from this CRM — if numbering
// streams ever diverge, this offset breaks and credit notes will link wrong.
export const FINBOT_SERIAL_OFFSET = 5398;

export function finbotSerialFromRef(ref) {
  const n = Number(ref);
  return Number.isFinite(n) ? String(n - FINBOT_SERIAL_OFFSET) : null;
}

// Finbot's external_pdf_url points at an HTML viewer page. Swapping the marker
// yields a direct PDF file URL served with application/pdf. Returns null when
// the input isn't the recognised viewer format, so callers can guard cleanly.
const SHOW_DOC_MARKER = "show_doc_app.php?auth/";
const LOAD_PDF_MARKER = "load_pdf_doc.php?auth=";

export function finbotPdfFileUrl(externalPdfUrl) {
  if (!externalPdfUrl || typeof externalPdfUrl !== "string") return null;
  if (!externalPdfUrl.includes(SHOW_DOC_MARKER)) return null;
  return externalPdfUrl.replace(SHOW_DOC_MARKER, LOAD_PDF_MARKER);
}

/**
 * Invoke the finbot-invoice Edge Function to issue a tax invoice through
 * Finbot. FINBOT_API_KEY lives server-side in Supabase Secrets — no secret
 * material passes through this file or the caller.
 *
 * Normalizes both failure channels (invoke error, ok:false body) into a
 * single { ok, invoiceNumber, pdfUrl, error } shape so callers don't have
 * to branch on which layer failed.
 */
export async function invokeFinbot(invoice, customer) {
  try {
    const { data, error } = await supabase.functions.invoke("finbot-invoice", {
      body: { invoice, customer },
    });
    if (error) {
      return { ok: false, error: error.message || "Finbot invoke failed" };
    }
    if (!data?.ok) {
      return { ok: false, error: data?.error || "Finbot returned an error" };
    }
    return {
      ok: true,
      invoiceNumber: data.invoiceNumber,
      pdfUrl: data.pdfUrl,
    };
  } catch (err) {
    return { ok: false, error: err?.message || "Finbot call threw" };
  }
}
