/**
 * Manual allocation of one payment across several invoices — the arithmetic.
 *
 * PURE. No React, no network, no database, no imports. The rules that decide
 * whether an allocation is legal live here so they can be tested exhaustively,
 * and so the dialog and the server agree about what "legal" means.
 *
 * MONEY IS INTEGER AGOROT
 *   Every amount is converted to whole agorot before anything is compared or
 *   summed. Splitting ₪100 across three invoices in floating point produces
 *   33.33 + 33.33 + 33.34 = 100.00000000000001, and a client-side total that
 *   disagrees with its own parts by a fraction of an agora will either be
 *   rejected by the server or, worse, accepted and leave an invoice a tenth of
 *   an agora short of settled. Shekels appear only at the edges.
 *
 * WHAT THIS MODULE DOES NOT DO
 *   It does not allocate automatically — the owner enters every amount. It
 *   does not cancel or reverse anything. Both were excluded from this change.
 */

/** Shekels (number | string | null) -> whole agorot. */
export function toAgorot(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[₪,\s]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? -Math.round(-n * 100) : Math.round(n * 100);
}

/** Whole agorot -> shekels, for display and for the request payload. */
export function toShekels(agorot) {
  return (agorot || 0) / 100;
}

/** What is still owed on an invoice, in agorot. Never negative: an invoice
 *  that was somehow overpaid has nothing left to allocate, not a credit to
 *  spend elsewhere. */
export function remainingAgorot(invoice) {
  const total = toAgorot(invoice?.total);
  const paid = toAgorot(invoice?.paid_amount);
  return Math.max(0, total - paid);
}

/**
 * Is this invoice a candidate for allocation?
 *
 * Mirrors the server's refusals, so the dialog cannot offer something the
 * function will reject: it must still owe money, and it must not be credited
 * (a credited invoice is no longer a debt).
 */
export function isAllocatable(invoice) {
  if (!invoice) return false;
  if (invoice.credited_at || invoice.credit_note_id) return false;
  return remainingAgorot(invoice) > 0;
}

/**
 * Validate a whole allocation before it is sent.
 *
 * @param {object}  input
 * @param {Array}   input.invoices    the customer's invoices (full rows)
 * @param {object}  input.amounts     { [invoiceId]: shekels-as-entered }
 * @param {number|string} input.paymentAmount  the real payment received
 *
 * @returns {{
 *   ok: boolean, errors: Array<{code, invoiceId?, message}>,
 *   lines: Array, allocatedAgorot: number, paymentAgorot: number,
 *   unallocatedAgorot: number
 * }}
 *
 * THE RULES, each with a reason:
 *   1. an amount must be positive — a zero line is not an allocation
 *   2. an amount may not exceed that invoice's remaining balance — the server
 *      refuses it under lock, so accepting it here would only produce a
 *      confusing failure later
 *   3. at least one line is required
 *   4. the sum of the lines must EQUAL the payment received. Not "at most":
 *      money received but not allocated would silently vanish from the
 *      customer's balance, and money allocated but not received would credit
 *      invoices against nothing. The remainder is reported so the dialog can
 *      show exactly what is left to place.
 */
export function validateAllocation({ invoices = [], amounts = {}, paymentAmount = 0 } = {}) {
  const errors = [];
  const byId = new Map(invoices.map(i => [i.id, i]));
  const lines = [];
  let allocatedAgorot = 0;

  for (const [invoiceId, raw] of Object.entries(amounts)) {
    const agorot = toAgorot(raw);
    if (agorot === 0) continue;            // an untouched row is not an error

    const invoice = byId.get(invoiceId);
    if (!invoice) {
      errors.push({ code: "unknown_invoice", invoiceId, message: "חשבונית לא נמצאה" });
      continue;
    }
    if (agorot < 0) {
      errors.push({ code: "negative_amount", invoiceId, message: "סכום ההקצאה חייב להיות חיובי" });
      continue;
    }
    if (invoice.credited_at || invoice.credit_note_id) {
      errors.push({ code: "invoice_credited", invoiceId, message: "לא ניתן לשלם חשבונית שזוכתה" });
      continue;
    }

    const remaining = remainingAgorot(invoice);
    if (agorot > remaining) {
      errors.push({
        code: "overpayment", invoiceId,
        message: `הסכום עולה על היתרה לתשלום (${toShekels(remaining).toFixed(2)} ₪)`,
      });
      continue;
    }

    allocatedAgorot += agorot;
    lines.push({ invoice_id: invoiceId, amountAgorot: agorot, remainingAgorot: remaining });
  }

  const paymentAgorot = toAgorot(paymentAmount);

  if (lines.length === 0 && errors.length === 0) {
    errors.push({ code: "no_allocations", message: "יש להקצות סכום לחשבונית אחת לפחות" });
  }
  if (paymentAgorot <= 0) {
    errors.push({ code: "invalid_payment_amount", message: "יש להזין סכום תשלום תקין" });
  }
  if (paymentAgorot > 0 && lines.length > 0 && allocatedAgorot !== paymentAgorot) {
    const diff = paymentAgorot - allocatedAgorot;
    errors.push({
      code: diff > 0 ? "under_allocated" : "over_allocated",
      message: diff > 0
        ? `נותרו ${toShekels(diff).toFixed(2)} ₪ שלא הוקצו`
        : `הוקצו ${toShekels(-diff).toFixed(2)} ₪ מעל סכום התשלום`,
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    lines,
    allocatedAgorot,
    paymentAgorot,
    unallocatedAgorot: paymentAgorot - allocatedAgorot,
  };
}

/**
 * The payload for allocate_payment_across_invoices.
 *
 * Amounts are converted back to shekels with exactly two decimals, which is
 * what the server rounds to — so what was validated in agorot here is what is
 * compared against the remaining balance there.
 */
export const CHECK_METHOD = "שיק";

/**
 * A SPLIT CHECK, AND WHY THERE IS NO LONGER A RULE HERE
 *
 * An earlier version of this file refused to split a check across invoices,
 * because Finbot's documentation does not say whether one physical check named
 * on several receipts is one deposit or several, and its API exposes no GET
 * endpoint to read back and find out.
 *
 * The owner has confirmed from the live system that the current production
 * flow already registers the same check details against several invoices
 * separately and issues a linked receipt for each, which answers the question
 * the documentation could not. The restriction is therefore gone, and a check
 * is treated exactly like every other method: one linked receipt per
 * allocation, each for its own amount, all naming the same check.
 *
 * What still protects the money is the allocation rule itself, not a
 * method-specific exception: `validateAllocation` requires the allocations to
 * sum to EXACTLY the amount entered, so the receipts issued against one check
 * can never total more — or less — than the check is worth.
 */

/**
 * Deterministic order for automatic allocation: OLDEST INVOICE FIRST.
 *
 * The tie-breaker is the invoice id, and it is not decoration. Two invoices
 * issued on the same day are extremely common — a day's orders invoiced
 * together — and without a total order the two could swap between renders.
 * The preview the owner approves would then not be the allocation that gets
 * written. An invoice with no date at all sorts last rather than first, so a
 * missing date can never quietly consume a payment ahead of a real debt.
 */
export function compareForAllocation(a, b) {
  const da = a?.date ? String(a.date) : null;
  const db = b?.date ? String(b.date) : null;
  if (da === null && db !== null) return 1;
  if (da !== null && db === null) return -1;
  if (da !== null && db !== null && da !== db) return da < db ? -1 : 1;
  const ia = String(a?.id ?? "");
  const ib = String(b?.id ?? "");
  if (ia === ib) return 0;
  return ia < ib ? -1 : 1;
}

/**
 * Spread ONE total across a customer's open invoices, oldest first.
 *
 * Each invoice is settled IN FULL before the next is touched, so only the last
 * invoice reached can be left partially paid. That is the whole point of
 * oldest-first: the debt that has been outstanding longest is cleared first,
 * and the remainder lands on the newest invoice rather than being smeared
 * across several.
 *
 * MORE THAN THE CUSTOMER OWES IS REFUSED, NOT ABSORBED.
 * A total above the eligible outstanding balance cannot be allocated, and
 * recording it anyway would leave money credited to nothing — an unallocated
 * credit that no invoice accounts for and no balance explains. The surplus is
 * named so the operator can see exactly how much does not fit.
 *
 * @param {object} input
 * @param {Array}  input.invoices  the customer's invoices (full rows)
 * @param {number} input.totalAgorot  the payment received, in whole agorot
 * @returns {{
 *   ok: boolean, code: string|null, message: string|null,
 *   lines: Array<{invoice_id, amountAgorot, remainingAgorot, invoice}>,
 *   allocatedAgorot: number, eligibleAgorot: number, surplusAgorot: number
 * }}
 */
export function autoAllocate({ invoices = [], totalAgorot = 0 } = {}) {
  const eligible = invoices.filter(isAllocatable).slice().sort(compareForAllocation);
  const eligibleAgorot = eligible.reduce((s, i) => s + remainingAgorot(i), 0);

  const empty = {
    lines: [], allocatedAgorot: 0, eligibleAgorot, surplusAgorot: 0,
  };

  if (!Number.isFinite(totalAgorot) || totalAgorot <= 0) {
    return { ok: false, code: "invalid_amount", message: "יש להזין סכום תשלום תקין", ...empty };
  }
  if (eligible.length === 0) {
    return {
      ok: false, code: "nothing_outstanding",
      message: "אין ללקוח חשבוניות פתוחות להקצאה", ...empty,
    };
  }
  if (totalAgorot > eligibleAgorot) {
    return {
      ok: false, code: "exceeds_outstanding",
      message: `הסכום עולה ב-${toShekels(totalAgorot - eligibleAgorot).toFixed(2)} ₪ על סך היתרות הפתוחות (${toShekels(eligibleAgorot).toFixed(2)} ₪). לא ניתן לרשום יתרת זכות לא משויכת.`,
      ...empty, surplusAgorot: totalAgorot - eligibleAgorot,
    };
  }

  const lines = [];
  let left = totalAgorot;
  for (const invoice of eligible) {
    if (left <= 0) break;
    const rem = remainingAgorot(invoice);
    if (rem <= 0) continue;
    // Settle this one in full if the money reaches; otherwise it takes what is
    // left and the loop ends. Only the LAST line can be a partial payment.
    const take = Math.min(rem, left);
    lines.push({
      invoice_id: invoice.id, amountAgorot: take, remainingAgorot: rem, invoice,
    });
    left -= take;
  }

  // Integer agorot throughout, so this cannot be off by a fraction.
  const allocatedAgorot = lines.reduce((s, l) => s + l.amountAgorot, 0);
  if (allocatedAgorot !== totalAgorot) {
    return {
      ok: false, code: "allocation_mismatch",
      message: "שגיאה בחישוב ההקצאה — יש לרענן ולנסות שוב",
      lines, allocatedAgorot, eligibleAgorot, surplusAgorot: totalAgorot - allocatedAgorot,
    };
  }

  return {
    ok: true, code: null, message: null,
    lines, allocatedAgorot, eligibleAgorot, surplusAgorot: 0,
  };
}

export function buildAllocationPayload({ groupId, customerId, lines, method, date, reference, notes, checkDetails }) {
  return {
    p_group_id: groupId,
    p_customer_id: customerId,
    p_allocations: lines.map(l => ({
      invoice_id: l.invoice_id,
      amount: Number(toShekels(l.amountAgorot).toFixed(2)),
    })),
    p_payment_method: method,
    p_payment_date: date,
    p_reference: reference || null,
    p_notes: notes || null,
    // Check details are passed through unchanged: the existing check accounting
    // behaviour is not altered by this feature.
    p_bank_name: checkDetails?.bank_name ?? null,
    p_bank_branch: checkDetails?.bank_branch ?? null,
    p_bank_account: checkDetails?.bank_account ?? null,
    p_check_number: checkDetails?.check_number ?? null,
  };
}

/** Group payment rows for display: a grouped payment is ONE real payment shown
 *  once, with its invoice lines beneath it. Ungrouped rows stay as they are. */
export function groupPayments(payments = []) {
  const groups = new Map();
  const singles = [];

  for (const p of payments) {
    if (!p.payment_group_id) { singles.push(p); continue; }
    const g = groups.get(p.payment_group_id) || {
      groupId: p.payment_group_id,
      payment_method: p.payment_method,
      payment_date: p.payment_date,
      reference: p.reference,
      created_date: p.created_date,
      external_receipt_number: null,
      external_receipt_url: null,
      rows: [],
      totalAgorot: 0,
    };
    g.rows.push(p);
    g.totalAgorot += toAgorot(p.amount);
    // The receipt is issued once per group and stored on whichever row carries
    // it; surface it at group level so the ledger can link to it once.
    if (p.external_receipt_number && !g.external_receipt_number) {
      g.external_receipt_number = p.external_receipt_number;
    }
    if (p.external_receipt_url && !g.external_receipt_url) {
      g.external_receipt_url = p.external_receipt_url;
    }
    groups.set(p.payment_group_id, g);
  }

  return { groups: [...groups.values()], singles };
}
