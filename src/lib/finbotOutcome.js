/**
 * WHAT A FINBOT REPLY MEANS FOR A DOCUMENT WE ASKED IT TO CREATE.
 *
 * PURE. No React, no network — because this one decision governs whether a
 * second tax document can ever be issued for the same credit, and a decision
 * like that has to be testable exhaustively rather than inferred from a stack
 * of nested catch blocks.
 *
 * ============================================================================
 * THREE OUTCOMES, AND WHY THE THIRD IS NOT A FAILURE
 * ============================================================================
 *   confirmed  the document exists and we know its number
 *   failed     the request reached Finbot and was REFUSED, or never left this
 *              system at all. No document was created, so issuing it again is
 *              safe
 *   uncertain  we do not know. A document may exist
 *
 * Collapsing 'uncertain' into 'failed' is the dangerous mistake, and it is the
 * easy one to make: both look like "it didn't work" from the caller's side. But
 * 'failed' licenses a retry, and a retry of a request that actually succeeded
 * puts a SECOND credit document into a customer's tax records, understating
 * revenue. Finbot has no GET endpoint and no idempotency key — three POSTs and
 * nothing else — so nothing can check afterwards which it was. The distinction
 * has to be made here, from the shape of the reply, and made cautiously.
 *
 * THE RULE: only a reply that PROVES nothing was created may be 'failed'.
 * Everything ambiguous is 'uncertain', and a human resolves it against
 * Finbot's own screen.
 *
 * ============================================================================
 * WHAT EACH REPLY SHAPE PROVES
 * ============================================================================
 * The edge function (supabase/functions/finbot-invoice) returns
 * `{ok:true, invoiceNumber, pdfUrl}` or `{ok:false, error}`, and
 * `supabase.functions.invoke` can itself fail before any of that.
 *
 *   invoke error                  -> UNCERTAIN. The edge function may have run
 *                                    and called Finbot; the response was lost.
 *   no data at all                -> UNCERTAIN. Same reason.
 *   ok:true + a document number   -> CONFIRMED.
 *   ok:true + NO number           -> UNCERTAIN. Finbot accepted something; we
 *                                    cannot name the document, so we cannot
 *                                    claim it and must not re-send.
 *   "Finbot request failed: ..."  -> UNCERTAIN, unless the message names a
 *                                    failure that happened BEFORE the request
 *                                    could be transmitted. See PRE_SEND below:
 *                                    the fetch rejects for both, and only one
 *                                    of them proves nothing was created.
 *   "Finbot HTTP 4xx: ..."        -> FAILED. A response arrived, so the request
 *                                    arrived, and Finbot rejected it. 408 and
 *                                    409 are the exceptions: a conflict can
 *                                    mean the document already exists, and a
 *                                    request timeout says nothing about how
 *                                    much of the request was processed first.
 *   "Finbot HTTP 5xx: ..."        -> UNCERTAIN. The request was accepted and
 *                                    something broke; a document may exist.
 *   "Finbot returned invalid JSON"-> UNCERTAIN. A 2xx body we cannot read is
 *                                    most likely a SUCCESS we cannot parse.
 *   a business error (status != 1)-> FAILED. Finbot evaluated it and declined.
 *   anything else                 -> UNCERTAIN, by default. An unrecognised
 *                                    reply is not evidence of absence.
 */

export const OUTCOME = {
  CONFIRMED: "confirmed",
  FAILED: "failed",
  UNCERTAIN: "uncertain",
};

/** The Hebrew the operator sees for each outcome. */
export const OUTCOME_MESSAGE = {
  [OUTCOME.CONFIRMED]: "מסמך הזיכוי הופק בפינבוט",
  [OUTCOME.FAILED]: "פינבוט דחה את הזיכוי — לא נוצר מסמך. הזיכוי נרשם ומחכה לטיפול",
  [OUTCOME.UNCERTAIN]: "לא ידוע אם נוצר מסמך בפינבוט. הזיכוי נרשם ומחכה לבדיקה — אין לנסות שוב לפני שבדקת בפינבוט",
};

const text = (v) => (typeof v === "string" ? v : "");

/**
 * A document identifier as a string, whatever JSON type it arrived as.
 *
 * The edge function currently stringifies it, but a number would otherwise be
 * read as absent and a perfectly good confirmation would be filed as
 * 'uncertain' — cautious in the right direction, and still wrong: it would
 * leave stock unreturned and send the owner to reconcile a document that was
 * reported to us correctly.
 */
function docNumber(v) {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/**
 * The HTTP status the edge function reported, if it reported one.
 * `Finbot HTTP 400: ...` -> 400
 */
function httpStatusFrom(message) {
  const m = text(message).match(/Finbot HTTP (\d{3})/);
  return m ? Number(m[1]) : null;
}

/**
 * ============================================================================
 * THE ONLY NETWORK FAILURES THAT PROVE NOTHING WAS SENT
 * ============================================================================
 * The edge function wraps its `fetch` in a bare catch:
 *
 *     try { res = await fetch(FINBOT_URL, {...}); }
 *     catch (err) { return json({ok:false, error:`Finbot request failed: ${err.message}`}); }
 *
 * That one message covers two completely different events. `fetch` rejects when
 * the connection could never be established — and ALSO when the socket dies
 * after the request has gone out and been processed. "connection closed before
 * message completed" is the second kind: Finbot may well have created the
 * document and the reply was lost on the way back.
 *
 * Treating the whole class as 'failed' would therefore license a retry on a
 * credit that already exists, which is the single error this design is built to
 * prevent. So the DEFAULT for this class is 'uncertain', and only a message
 * that names address resolution or connection ESTABLISHMENT — events that
 * necessarily precede any transmission — may be called 'failed'.
 *
 * Deliberately NOT in this list, because each can happen with the request
 * already delivered: connection reset, ECONNRESET, socket hang up, terminated,
 * aborted, any timeout, "error reading a body", "connection closed before
 * message completed".
 *
 * An unrecognised message is uncertain. Adding to this list means asserting
 * that a given runtime cannot produce that text after transmitting, which is a
 * claim about the runtime and should be made with care.
 */
const PRE_SEND = [
  /error trying to connect/i,
  /tcp connect error/i,
  /dns error/i,
  /failed to lookup address/i,
  /getaddrinfo/i,
  /name or service not known/i,
  /\bENOTFOUND\b/,
  /connection refused/i,
  /\bECONNREFUSED\b/,
  /invalid peer certificate/i,
  /certificate verify failed/i,
  /\bunknown scheme\b/i,
  /invalid url/i,
];

/** Did this network failure happen before anything could be transmitted? */
function provenNeverSent(message) {
  const m = text(message);
  return PRE_SEND.some(re => re.test(m));
}

/**
 * @param {{invokeError?: any, data?: any}} reply
 *   invokeError — what supabase.functions.invoke rejected with
 *   data        — the edge function's parsed body
 * @returns {{kind: string, number: string|null, url: string|null,
 *            error: string|null, reason: string}}
 */
export function classifyFinbotOutcome({ invokeError = null, data = null } = {}) {
  const out = (kind, reason, extra = {}) => ({
    kind, reason, number: null, url: null, error: null, ...extra,
  });

  // The call itself did not come back. The edge function may well have created
  // the document before the response was lost.
  if (invokeError) {
    return out(OUTCOME.UNCERTAIN, "invoke_failed",
      { error: text(invokeError?.message) || String(invokeError) });
  }
  if (data === null || data === undefined || typeof data !== "object") {
    return out(OUTCOME.UNCERTAIN, "no_response_body",
      { error: "no response from finbot-invoice" });
  }

  if (data.ok === true) {
    const number = docNumber(data.invoiceNumber ?? data.creditNoteNumber);
    if (number) {
      return out(OUTCOME.CONFIRMED, "accepted_with_number", {
        number,
        url: text(data.pdfUrl).trim() || null,
      });
    }
    // Accepted, but unnameable. Sending it again is the one thing that must not
    // happen; the owner reads the number off Finbot instead.
    return out(OUTCOME.UNCERTAIN, "accepted_without_number",
      { error: "Finbot accepted the request but returned no document number" });
  }

  const err = text(data.error);

  // The fetch inside the edge function threw. That is TWO different events
  // behind one message, and only one of them is a failure.
  if (/^Finbot request failed:/.test(err)) {
    return provenNeverSent(err)
      ? out(OUTCOME.FAILED, "proven_never_sent", { error: err })
      : out(OUTCOME.UNCERTAIN, "network_failure_after_send_possible", { error: err });
  }

  const status = httpStatusFrom(err);
  if (status !== null) {
    // A response arrived, so the request arrived and Finbot answered it.
    //
    // TWO 4xx CODES ARE NOT VERDICTS.
    //
    //   409 Conflict — can mean the document ALREADY EXISTS, which would make
    //       a retry a duplicate rather than a fix.
    //   408 Request Timeout — the server gave up waiting for the request, but
    //       it says nothing about how much of it had already arrived and been
    //       handed on. A gateway can emit 408 with the body fully received.
    //       "Finbot never processed it" is not provable from 408, and the whole
    //       rule here is that only proof may unlock a retry.
    if (status === 409 || status === 408) {
      return out(OUTCOME.UNCERTAIN,
        status === 409 ? "conflict_may_already_exist" : "request_timeout_not_a_verdict",
        { error: err });
    }
    if (status >= 400 && status < 500) {
      return out(OUTCOME.FAILED, "refused_4xx", { error: err });
    }
    return out(OUTCOME.UNCERTAIN, "server_error_5xx", { error: err });
  }

  if (/invalid JSON/i.test(err)) {
    return out(OUTCOME.UNCERTAIN, "unparseable_body", { error: err });
  }

  // A business error: Finbot answered with status != 1 and a reason. It
  // evaluated the document and declined to create it.
  if (data.status !== undefined && data.status !== null && Number(data.status) !== 1) {
    return out(OUTCOME.FAILED, "business_error",
      { error: err || `Finbot status ${data.status}` });
  }

  // Unrecognised. Not evidence of absence.
  return out(OUTCOME.UNCERTAIN, "unrecognised_reply",
    { error: err || "unrecognised reply from finbot-invoice" });
}

/**
 * May this credit note be sent to Finbot?
 *
 * The caller asks BEFORE sending, including after a `reserve` that returned an
 * existing row — which is how a retried click lands on an operation that has
 * already been through Finbot once.
 *
 * 'uncertain' is the whole point: a document may exist, so it is never sent
 * again automatically, whatever the user clicks. Only a person who has checked
 * Finbot may move it on.
 */
export function maySendToFinbot(finbotStatus) {
  return finbotStatus === null || finbotStatus === undefined
    || finbotStatus === "pending" || finbotStatus === "failed";
}
