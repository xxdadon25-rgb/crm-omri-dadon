/**
 * The lifecycle of a Finbot receipt, and how a provider response is classified.
 *
 * PURE. No React, no network, no imports — so the rule that decides whether a
 * tax document may exist can be tested exhaustively.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * A payment is recorded in our database; the receipt is created in someone
 * else's. Those two facts can disagree, and until now the application had no
 * way to say so: the single-invoice dialog wrapped the whole receipt attempt in
 * `catch (e) { }` and tested only `receiptData?.ok`, so a refusal and a
 * timeout both ended as silence. The money was recorded, nothing said a
 * receipt was missing, and nobody could tell afterwards which payments had one.
 *
 * ============================================================================
 * THE FOUR STATES
 * ============================================================================
 *   pending    The payment is recorded and the receipt request has not been
 *              resolved yet. Every payment row starts here.
 *
 *   confirmed  The provider accepted the request AND returned a document
 *              identifier. A receipt certainly exists. `ok: true` with no
 *              identifier at all is NOT confirmed — see below.
 *
 *   failed     The provider received the request, processed it and REFUSED it.
 *              No document was created, so re-issuing is safe.
 *
 *   uncertain  The outcome is unknown: the request may or may not have created
 *              a document. This is the state that must never be retried
 *              automatically — a blind retry against a provider that did
 *              create the document issues a SECOND tax receipt for one
 *              payment, which is a reporting error we cannot undo from here.
 *              It requires a human to look at Finbot and reconcile.
 *
 * ============================================================================
 * HOW THE WEBHOOK'S ANSWERS MAP ONTO THEM
 * ============================================================================
 * payment-webhook returns HTTP 200 with { ok: false, error } for every failure,
 * so `supabase.functions.invoke` resolves rather than throwing and the error
 * STRING is the only evidence available. Its four failure paths are not
 * equivalent:
 *
 *   "Finbot request failed: …"   fetch itself threw. The request may have
 *                                reached Finbot and been processed before the
 *                                connection broke.               -> UNCERTAIN
 *
 *   "Finbot HTTP 5xx: …"         the server answered, but with a fault. Whether
 *                                it committed the document first is unknown.
 *                                                                 -> UNCERTAIN
 *
 *   "Finbot HTTP 4xx: …"         the request was rejected before any document
 *                                could be created.                -> FAILED
 *
 *   "Finbot returned invalid JSON"  a 2xx body we cannot read. The document
 *                                very likely WAS created.         -> UNCERTAIN
 *
 *   a business error (`status` present, != 1)   Finbot processed the request
 *                                and declined it.                 -> FAILED
 *
 * And locally:
 *   invoke threw / transport error  -> UNCERTAIN (the function may have run)
 *   FINBOT_API_KEY not configured   -> FAILED   (nothing was ever sent)
 *   ok: true with no number and no url -> UNCERTAIN (something was created and
 *                                we cannot name it; a retry would duplicate it)
 */

export const RECEIPT = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  FAILED: "failed",
  UNCERTAIN: "uncertain",
};

/** Can this state safely be resolved by issuing the receipt again? */
export function isSafeToReissue(state) {
  return state === RECEIPT.FAILED;
}

/** Does this state require a human to compare our records with Finbot? */
export function needsReconciliation(state) {
  return state === RECEIPT.UNCERTAIN;
}

/**
 * Classify one receipt attempt.
 *
 * @param {object}  outcome
 * @param {any}     outcome.data    the webhook's parsed body, if any
 * @param {any}     outcome.error   supabase.functions.invoke's error, if any
 * @param {any}     outcome.thrown  an exception from the call itself, if any
 * @returns {{ state: string, reason: string, receiptNumber: string|null,
 *             pdfUrl: string|null, message: string }}
 */
export function classifyReceiptOutcome({ data = null, error = null, thrown = null } = {}) {
  // ---- the call itself did not complete ----------------------------------
  // The Edge Function may have run to completion and created the document
  // before the response was lost, so this is never "failed".
  if (thrown) {
    return out(RECEIPT.UNCERTAIN, "invoke_threw", null, null, String(thrown?.message || thrown));
  }
  if (error) {
    return out(RECEIPT.UNCERTAIN, "invoke_error", null, null, String(error?.message || error));
  }
  // No body at all: we cannot tell what happened.
  if (data === null || data === undefined) {
    return out(RECEIPT.UNCERTAIN, "no_response_body", null, null, "");
  }

  if (data.ok === true) {
    const number = nonEmpty(data.receiptNumber);
    const url = nonEmpty(data.pdfUrl);
    if (number || url) {
      return out(RECEIPT.CONFIRMED, "ok", number, url, "");
    }
    // Finbot accepted it (status === 1) but we could not extract any
    // identifier. A document exists and we cannot name it; issuing another
    // would duplicate it, so this is reconciliation work, not a retry.
    return out(RECEIPT.UNCERTAIN, "ok_without_identifier", null, null, "");
  }

  const reason = String(data.error ?? data.message ?? "");

  // A business error: Finbot answered with its own status code, which means it
  // read the request and declined it.
  if (data.status !== undefined && data.status !== null && data.status !== 1) {
    return out(RECEIPT.FAILED, "finbot_business_error", null, null, reason);
  }

  // Nothing was ever sent to the provider.
  if (/FINBOT_API_KEY not configured/i.test(reason)
      || /Invalid payment amount/i.test(reason)
      || /Invalid check payment details/i.test(reason)
      || /Invalid JSON body/i.test(reason)
      || /Method not allowed/i.test(reason)) {
    return out(RECEIPT.FAILED, "rejected_before_send", null, null, reason);
  }

  // fetch threw inside the function — the request may still have been served.
  if (/^Finbot request failed/i.test(reason)) {
    return out(RECEIPT.UNCERTAIN, "provider_unreachable", null, null, reason);
  }

  // A 2xx body we cannot parse. Finbot almost certainly created the document.
  if (/Finbot returned invalid JSON/i.test(reason)) {
    return out(RECEIPT.UNCERTAIN, "unreadable_provider_response", null, null, reason);
  }

  const http = /^Finbot HTTP (\d{3})/i.exec(reason);
  if (http) {
    const code = Number(http[1]);
    // 4xx: refused on inspection, before anything was written.
    // 5xx: the provider broke mid-request; it may have written first.
    return code >= 500
      ? out(RECEIPT.UNCERTAIN, "provider_server_error", null, null, reason)
      : out(RECEIPT.FAILED, "provider_rejected", null, null, reason);
  }

  // An ok:false we do not recognise. Defaulting to "failed" would invite a
  // retry that might duplicate a document, so the cautious state wins.
  return out(RECEIPT.UNCERTAIN, "unclassified", null, null, reason);
}

function out(state, reason, receiptNumber, pdfUrl, message) {
  return { state, reason, receiptNumber: receiptNumber || null, pdfUrl: pdfUrl || null, message: message || "" };
}

function nonEmpty(v) {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s === "" ? null : s;
}

/** What to tell the operator, in Hebrew. Never silence. */
export function receiptMessage(result) {
  switch (result.state) {
    case RECEIPT.CONFIRMED:
      return { level: "success", text: `הקבלה הופקה${result.receiptNumber ? ` (מסמך ${result.receiptNumber})` : ""}` };
    case RECEIPT.FAILED:
      return {
        level: "warning",
        text: "התשלום נרשם, אך הפקת הקבלה נדחתה ולא נוצר מסמך. יש להפיק קבלה ידנית.",
      };
    case RECEIPT.UNCERTAIN:
      return {
        level: "warning",
        text: "התשלום נרשם, אך לא ניתן לאמת אם הופקה קבלה. אין להפיק קבלה נוספת לפני בדיקה ב-Finbot — ייתכן שהמסמך כבר נוצר.",
      };
    default:
      return { level: "info", text: "הפקת הקבלה ממתינה" };
  }
}

/** The patch to write onto the payment row(s) for this outcome. */
export function receiptPatch(result) {
  const patch = { receipt_status: result.state };
  if (result.receiptNumber) patch.external_receipt_number = result.receiptNumber;
  if (result.pdfUrl) patch.external_receipt_url = result.pdfUrl;
  return patch;
}
