/**
 * WHAT ONE INVOICE STILL OWES, OR IS OWED BACK.
 *
 * PURE. No React, no network — one definition, used by the debt summary, the
 * payment dialog, the invoice list and the ledger, so they cannot drift apart
 * again.
 *
 * ============================================================================
 * TWO LEDGERS, AND WHY THEY MUST NOT BE ADDED TOGETHER
 * ============================================================================
 * CREDITS reverse the sale. They are bounded by the goods: cumulative credits
 * may not exceed the invoice total, which credit_note_reserve enforces.
 *
 * PAYMENTS are money received. They are bounded by nothing here, and they are
 * deliberately NOT part of the credit cap. A fully paid invoice can be credited
 * — that is a refund, the commonest one there is — and an invariant of
 * "credits + payments <= total" would refuse it.
 *
 * So the two are tracked apart and combined only at the end, as a SIGNED
 * figure:
 *
 *     netReceivable = total − confirmedCredits
 *     outstanding   = netReceivable − paid
 *
 *       > 0   the customer owes this
 *       < 0   THE BUSINESS OWES THIS BACK: money was taken for goods that were
 *             then credited
 *       = 0   settled
 *
 * The sign is never discarded. DebtSummary used to `continue` on
 * `debt <= 0`, which silently dropped every refund the business owed — the
 * figure simply vanished from the screen rather than appearing on the other
 * side.
 *
 * ============================================================================
 * ONLY A CONFIRMED CREDIT REDUCES A RECEIVABLE
 * ============================================================================
 * A credit note whose Finbot document may not exist is not a credit; it is an
 * intention. Counting it would remove a receivable from the books on the
 * strength of a request that may have been refused. So 'pending', 'failed' and
 * 'uncertain' are reported separately and never netted.
 *
 * Note the asymmetry with the CAP in credit_note_reserve, which counts
 * everything except 'failed'. The cap is conservative so two attempts cannot
 * together over-credit; the balance is strict so nothing unproven moves money.
 * Both err towards not inventing money.
 *
 * ============================================================================
 * LEGACY ROWS
 * ============================================================================
 * Nothing was backfilled, and nothing needs to be. A credit note recorded
 * before the lifecycle column existed carries its own evidence:
 * external_credit_note_number is written only after Finbot returned a document
 * number. And an invoice marked `credited_at` before credit notes were tracked
 * at all is treated as fully credited, because that is what it meant.
 */

import { toAgorot, toShekels } from "./packagingMath.js";

export const CREDIT_STATE = { NONE: "none", PARTIAL: "partial", FULL: "full" };

/** Is this credit note proven to exist as a Finbot document? */
export function isConfirmedCredit(cn) {
  if (!cn) return false;
  if (cn.finbot_status === "confirmed") return true;
  // Legacy: no lifecycle recorded, but a provider document number is present,
  // and that column is only ever written from a successful Finbot reply.
  if (cn.finbot_status === null || cn.finbot_status === undefined) {
    return String(cn.external_credit_note_number ?? "").trim() !== "";
  }
  return false;
}

/**
 * ============================================================================
 * THREE STATES, NOT TWO — AND 'failed' IS NOT ONE OF THE OTHER TWO
 * ============================================================================
 * A credit note is one of:
 *
 *   confirmed   the document exists. It reduces the receivable.
 *   MAY exist   'pending' or 'uncertain'. It reduces nothing, and it is an
 *               OPEN QUESTION: a document may be out there, so it is reported
 *               as an amount awaiting verification and it blocks deletion.
 *   failed      the document does NOT exist. It reduces nothing AND it is not
 *               an open question. Nothing is awaiting anything.
 *
 * Lumping 'failed' in with the other two was wrong: it showed a credit that
 * provably never happened as money "awaiting Finbot", inflating a figure the
 * owner is meant to act on and implying work that does not exist. A failed
 * attempt belongs in the error history, where it says what Finbot refused and
 * invites another try — and nowhere else.
 */

/** A document may exist for this credit note. Not proven either way. */
export function mayExistCredit(cn) {
  return cn?.finbot_status === "pending" || cn?.finbot_status === "uncertain";
}

/** Finbot refused it, or it never left: no document exists. Audit only. */
export function isFailedCredit(cn) {
  return cn?.finbot_status === "failed";
}

/**
 * Needs a person to do something: verify an unknown outcome, or retry a
 * refusal. This is the reconciliation QUEUE, which is a different question
 * from "does a document exist" — a failed credit needs attention precisely
 * because nothing was created.
 */
export function isUnsettledCredit(cn) {
  return mayExistCredit(cn) || isFailedCredit(cn);
}

const abs = (v) => Math.abs(toAgorot(v) ?? 0);

/**
 * One invoice's position, in AGOROT, from the rows that describe it.
 *
 * @param {object} invoice
 * @param {Array}  creditNotes  this invoice's credit notes (any status)
 * @param {Array|null} payments this invoice's payment rows. When null,
 *   invoice.paid_amount is used — it is the denormalised mirror the app
 *   maintains, and the only figure available on screens that do not load
 *   payments.
 */
export function invoicePosition(invoice, creditNotes = [], payments = null) {
  const totalAg = abs(invoice?.total);
  const mine = (creditNotes || []).filter(
    cn => cn && (cn.invoice_id === invoice?.id || creditNotes === invoice?.credit_notes));

  let confirmedAg = 0, pendingAg = 0, failedAg = 0;
  let confirmedCount = 0, pendingCount = 0, failedCount = 0;
  for (const cn of mine) {
    if (isConfirmedCredit(cn)) { confirmedAg += abs(cn.total); confirmedCount += 1; }
    else if (mayExistCredit(cn)) { pendingAg += abs(cn.total); pendingCount += 1; }
    // A FAILED credit affects no figure at all. It is counted here only so the
    // audit view can show it, and it is deliberately absent from the amounts
    // above and from everything derived from them.
    else if (isFailedCredit(cn)) { failedAg += abs(cn.total); failedCount += 1; }
  }

  // A pre-tracking credit: the invoice says it was credited and there is no
  // credit note that accounts for it. That is what credited_at meant before
  // credit notes carried a lifecycle, so it is honoured as a full credit.
  const legacyFull = confirmedCount === 0
    && !!(invoice?.credited_at || invoice?.credit_note_id);
  if (legacyFull) confirmedAg = totalAg;

  // Clamped at the total. credit_note_reserve makes exceeding it impossible,
  // so this only matters for rows written before it existed; a credit larger
  // than its invoice would otherwise read as money owed back that was never
  // taken.
  const creditedAg = Math.min(confirmedAg, totalAg);
  const netReceivableAg = totalAg - creditedAg;

  const paidAg = payments === null
    ? abs(invoice?.paid_amount)
    : (payments || [])
        .filter(p => p && p.invoice_id === invoice?.id)
        .reduce((s, p) => s + abs(p.amount), 0);

  // SIGNED. Never clamped: a negative figure is a real obligation.
  const outstandingAg = netReceivableAg - paidAg;

  let state = CREDIT_STATE.NONE;
  if (creditedAg > 0) {
    state = creditedAg >= totalAg ? CREDIT_STATE.FULL : CREDIT_STATE.PARTIAL;
  }

  return {
    totalAg, creditedAg, netReceivableAg, paidAg, outstandingAg,
    // Awaiting verification: a document may exist. Never netted.
    pendingAg, pendingCount,
    // Audit only. Not awaiting anything, and in no other figure here.
    failedAg, failedCount,
    confirmedCount,
    // Kept as the name the reconciliation queue uses: everything a person has
    // to look at, which includes failures because they invite a retry.
    unsettledAg: pendingAg + failedAg,
    unsettledCount: pendingCount + failedCount,
    state, legacyFull,
    // The two sides, each non-negative, for a screen that shows them apart.
    debtAg: Math.max(0, outstandingAg),
    refundDueAg: Math.max(0, -outstandingAg),
  };
}

/** The same, in shekels, for display. */
export function invoiceBalance(invoice, creditNotes = [], payments = null) {
  const p = invoicePosition(invoice, creditNotes, payments);
  return {
    ...p,
    total: toShekels(p.totalAg),
    credited: toShekels(p.creditedAg),
    netReceivable: toShekels(p.netReceivableAg),
    paid: toShekels(p.paidAg),
    outstanding: toShekels(p.outstandingAg),
    pending: toShekels(p.pendingAg),
    failed: toShekels(p.failedAg),
    unsettled: toShekels(p.unsettledAg),
    debt: toShekels(p.debtAg),
    refundDue: toShekels(p.refundDueAg),
  };
}

/** How the invoice's credit state reads on screen. */
export const CREDIT_LABEL = {
  [CREDIT_STATE.NONE]: null,
  [CREDIT_STATE.PARTIAL]: "זוכה חלקית",
  [CREDIT_STATE.FULL]: "זוכה",
};

/**
 * A customer's whole position across their invoices.
 *
 * Returns BOTH sides rather than one netted number, because they answer
 * different questions: what to collect, and what to refund. A single net figure
 * hides a customer who owes 1,000 on one invoice and is owed 1,000 on another.
 */
export function customerPosition(invoices = [], creditNotes = [], payments = null) {
  let debtAg = 0, refundDueAg = 0, pendingAg = 0, failedAg = 0;
  const perInvoice = [];
  for (const inv of invoices || []) {
    const p = invoicePosition(inv, creditNotes, payments);
    debtAg += p.debtAg;
    refundDueAg += p.refundDueAg;
    pendingAg += p.pendingAg;
    failedAg += p.failedAg;
    perInvoice.push({ invoice: inv, position: p });
  }
  return {
    debtAg, refundDueAg, pendingAg, failedAg,
    unsettledAg: pendingAg + failedAg,
    netAg: debtAg - refundDueAg,
    debt: toShekels(debtAg),
    refundDue: toShekels(refundDueAg),
    // Awaiting verification. A failed credit is NOT here.
    pending: toShekels(pendingAg),
    // Audit only.
    failed: toShekels(failedAg),
    unsettled: toShekels(pendingAg + failedAg),
    net: toShekels(debtAg - refundDueAg),
    perInvoice,
  };
}

/**
 * May this invoice be deleted?
 *
 * ============================================================================
 * NOT IF ANY EXTERNAL ACCOUNTING DOCUMENT MAY EXIST FOR IT
 * ============================================================================
 * The delete paths remove the invoice, its payments and EVERY credit note that
 * references it. Nothing here can withdraw a document from Finbot, so deleting
 * the local record of one leaves a live, reported document that this system
 * cannot explain — and no way to find out that it happened.
 *
 * So deletion is refused when any of these holds:
 *
 *   1. a CONFIRMED credit note exists — a credit document is issued
 *   2. a credit note MAY exist ('pending' or 'uncertain') — unknown is not
 *      permission. Deleting it would destroy the only record that the question
 *      was ever open, and Finbot has no endpoint to ask afterwards.
 *   3. the INVOICE ITSELF was issued in Finbot — external_invoice_number,
 *      external_pdf_url or finbot_serial. A tax invoice exists against the
 *      customer; the local row is its only counterpart here.
 *
 * A FAILED credit note does not block anything: no document was created, which
 * is the one state that is proven.
 *
 * Legacy rows are covered by the same tests: `isConfirmedCredit` reads a
 * pre-lifecycle credit note's document number as evidence, and the three
 * invoice columns predate all of this work.
 *
 * @returns {{allowed: boolean, reason: string|null, message: string|null,
 *            confirmedCount: number, mayExistCount: number}}
 */
export function canDeleteInvoice(invoice, creditNotes = []) {
  const mine = (creditNotes || []).filter(cn => cn?.invoice_id === invoice?.id);
  const confirmed = mine.filter(isConfirmedCredit);
  const mayExist = mine.filter(mayExistCredit);
  const base = { confirmedCount: confirmed.length, mayExistCount: mayExist.length };

  if (confirmed.length > 0) {
    const nums = confirmed.map(c => c.external_credit_note_number).filter(Boolean).join(", ");
    return {
      ...base, allowed: false, reason: "confirmed_credit_exists",
      message: nums
        ? `לא ניתן למחוק חשבונית שהופק עבורה מסמך זיכוי בפינבוט (${nums}). המסמך מדווח ולא ניתן לבטלו מכאן.`
        : "לא ניתן למחוק חשבונית שהופק עבורה מסמך זיכוי בפינבוט. המסמך מדווח ולא ניתן לבטלו מכאן.",
    };
  }

  if (mayExist.length > 0) {
    return {
      ...base, allowed: false, reason: "credit_may_exist",
      message: mayExist.length === 1
        ? "לא ניתן למחוק חשבונית שיש לה זיכוי שטרם אומת בפינבוט — ייתכן שהמסמך הופק. בדוק בפינבוט וסגור את הזיכוי לפני מחיקה."
        : `לא ניתן למחוק חשבונית שיש לה ${mayExist.length} זיכויים שטרם אומתו בפינבוט — ייתכן שהמסמכים הופקו. בדוק בפינבוט וסגור אותם לפני מחיקה.`,
    };
  }

  const issued = externalDocumentOf(invoice);
  if (issued) {
    return {
      ...base, allowed: false, reason: "invoice_issued_externally",
      message: `לא ניתן למחוק חשבונית שהופקה בפינבוט (${issued}). המסמך מדווח ולא ניתן לבטלו מכאן — להיפוך החיוב יש להפיק זיכוי.`,
    };
  }

  return { ...base, allowed: true, reason: null, message: null };
}

/**
 * The identifier of the invoice's own Finbot document, if one was ever issued.
 *
 * Any of the three is enough. They are written at different moments by
 * different code paths — the number and the pdf url when the document comes
 * back, the serial for linking a later credit to it — so an invoice can carry
 * one without the others.
 */
export function externalDocumentOf(invoice) {
  for (const key of ["external_invoice_number", "finbot_serial", "external_pdf_url"]) {
    const v = String(invoice?.[key] ?? "").trim();
    if (v) return key === "external_pdf_url" ? "מסמך חיצוני" : v;
  }
  return null;
}

/**
 * THE VERIFIED ACCOUNTING DATE OF A CREDIT DOCUMENT, OR NULL.
 *
 * ============================================================================
 * ONLY credit_notes.date. NOT created_at, AND NEVER THE INVOICE'S DATE
 * ============================================================================
 * Two different wrong answers were available here, and both are refused:
 *
 *   THE INVOICE'S DATE would backdate the credit into a period that is already
 *   closed and filed. A credit issued in March against a January invoice is a
 *   March document.
 *
 *   created_at is a SYSTEM TIMESTAMP, not an accounting date. They usually
 *   agree, which is what makes the gap dangerous rather than visible: a
 *   document dated 31 March and written at 00:40 on 1 April would be reported
 *   in April, and a filed period would be wrong by one document.
 *
 * So only the column that holds the document's own date counts. Every row
 * written before that column existed returns null, which is the truth: Finbot's
 * reply carries no date, so nothing was ever recorded for them. They are
 * flagged for review and attributed to no period.
 *
 * The customer statement has a DIFFERENT problem — an undated row cannot be
 * ordered in a ledger at all — and solves it by inheriting the invoice's date
 * for display, flagged as derived. That is a presentation choice inside one
 * customer's ledger and must not leak into period reporting, which is why this
 * function does not offer it.
 */
export function creditDocumentDate(cn) {
  const v = cn?.date;
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A confirmed credit document whose accounting date is unknown.
 *
 * It is not an unsettled credit — the document exists and the money is right.
 * What is missing is the one fact period reporting needs, so it is surfaced as
 * its own kind of review rather than mixed in with credits awaiting Finbot.
 */
export function needsDateReview(cn) {
  return isConfirmedCredit(cn) && creditDocumentDate(cn) === null;
}
