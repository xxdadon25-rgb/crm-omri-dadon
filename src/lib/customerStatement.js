/**
 * Customer account statement (כרטסת לקוח) — the ledger calculation.
 *
 * PURE. No React, no network, no database, no imports. Everything here is a
 * function of its arguments, so the arithmetic that decides what a customer
 * owes can be tested exhaustively without a browser or a server.
 *
 * ============================================================================
 * WHAT COUNTS AS A TRANSACTION
 * ============================================================================
 * Exactly three sources, each counted once:
 *
 *   DEBIT   invoices.total        VAT-INCLUSIVE, as stored. Never re-derived
 *                                 from subtotal + vat_amount.
 *   CREDIT  payments.amount       one row per payment
 *   CREDIT  |credit_notes.total|  stored negative; the sign is normalised here
 *
 * ORDERS ARE NOT TRANSACTIONS. An order is a commercial document, not a
 * charge: it becomes a charge when an invoice is issued for it. Including both
 * would double count every invoiced order, and would charge for orders that
 * were never invoiced at all. This is why the statement's debit total
 * legitimately differs from the CRM's "סה״כ הכנסות" card, which sums orders.
 *
 * invoices.paid_amount is NOT used as a credit. It is the same money as the
 * payment rows, maintained in parallel by the payment dialog; adding both
 * would count every payment twice. It is used only to DERIVE a row's status
 * and to reconcile against the payment rows (see RECONCILIATION).
 *
 * Both invoice types are included — regular and monthly. A monthly invoice
 * aggregates ORDERS (included_order_ids), not invoices, and the orders it may
 * aggregate are excluded from any other invoice, so invoices never overlap.
 * A production check confirmed no invoice currently carries a non-empty
 * included_invoice_ids, but that was a snapshot: `nestedInvoiceIds` below
 * re-checks it on every run and reports it rather than trusting it.
 *
 * ============================================================================
 * A CREDITED INVOICE THAT WAS ALREADY PAID
 * ============================================================================
 * A credit note is always for the FULL invoice total and ignores how much was
 * already paid (CreditNoteButton writes total: -(invoice.total)). Nothing
 * resets paid_amount. So:
 *
 *   unpaid 500, credited      ->  500 debit, 500 credit                 = 0
 *   paid 500, then credited   ->  500 debit, 500 payment, 500 credit  = -500
 *   paid 200, then credited   ->  500 debit, 200 payment, 500 credit  = -200
 *
 * The last two are NOT zero, and must not be shown as zero. The customer paid
 * for goods that were then fully credited, so the business owes the money
 * back. The CRM has no refund record, so that credit stands until it is
 * settled outside the system. A negative closing balance is therefore a real
 * state — "יתרת זכות ללקוח" — and is never clamped to zero.
 *
 * ============================================================================
 * MONEY IS INTEGER AGOROT
 * ============================================================================
 * Every amount is converted to whole agorot on the way in and all arithmetic
 * is integer. 0.1 + 0.2 !== 0.3 in binary floating point, and a statement that
 * is a tenth of an agora out after two hundred rows is a statement whose
 * closing balance does not match its own last row. Formatting back to shekels
 * happens only at the display edge.
 */

/** Shekels (number | string | null) -> whole agorot. Null-ish becomes 0. */
export function toAgorot(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[₪,\s]/g, ""));
  if (!Number.isFinite(n)) return 0;
  // Half-away-from-zero, so -0.005 and 0.005 round symmetrically.
  return n < 0 ? -Math.round(-n * 100) : Math.round(n * 100);
}

/** Whole agorot -> shekels, for display only. */
export function toShekels(agorot) {
  return (agorot || 0) / 100;
}

/** A date-only key (YYYY-MM-DD) for comparison, from a date or timestamp.
 *  String comparison on this form is chronological, which avoids time zones
 *  shifting a document into the wrong day. */
export function dateKey(value) {
  if (!value) return null;
  const s = String(value);
  // Already YYYY-MM-DD or an ISO timestamp.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Row kinds, in the order they sort within one day: a charge precedes the
 *  money that settles it, and a credit note comes last. */
export const KIND = { INVOICE: "invoice", PAYMENT: "payment", CREDIT_NOTE: "credit_note" };
const KIND_ORDER = { [KIND.INVOICE]: 0, [KIND.PAYMENT]: 1, [KIND.CREDIT_NOTE]: 2 };

/** The payment method whose instrument has a number worth naming. */
export const CHECK_METHOD = "שיק";

/**
 * How a receipt is presented for one allocation.
 *
 * CONFIRMED is the only state that claims a document exists, and it is only
 * reached by HAVING its number. The rest say, precisely, what is not known.
 */
export const RECEIPT_VIEW = {
  CONFIRMED: "confirmed",   // a document number is on record
  UNCERTAIN: "uncertain",   // an attempt whose outcome was never established
  FAILED: "failed",         // the provider refused; no document was created
  PENDING: "pending",       // recorded, the receipt attempt never resolved
  NONE: "none",             // nothing on record either way
};

/** What the statement prints for a receipt in each state. */
export function receiptLabel(state, number) {
  switch (state) {
    case RECEIPT_VIEW.CONFIRMED: return { text: `קבלה ${number}`, confirmed: true };
    case RECEIPT_VIEW.UNCERTAIN: return { text: "קבלה לא ודאית", confirmed: false };
    case RECEIPT_VIEW.FAILED:    return { text: "הקבלה נדחתה", confirmed: false };
    case RECEIPT_VIEW.PENDING:   return { text: "קבלה בהמתנה", confirmed: false };
    default:                     return { text: "ללא קבלה", confirmed: false };
  }
}

/**
 * How a payment is described on the statement.
 *
 * A CHEQUE NAMES ITS OWN NUMBER AND NOTHING MORE. The bank, branch and
 * account are the drawer's banking details: they are needed to issue the
 * receipt and are kept on the payment row, but a statement handed to the
 * customer has no business restating them, and this is the only place that
 * decides what a cheque looks like.
 */
export function paymentLabel(row) {
  if (row?.method === CHECK_METHOD) {
    return row?.checkNumber
      ? `שולם בצ'ק · מס' ${row.checkNumber}`
      : "שולם בצ'ק";
  }
  return row?.method ? `שולם ב${row.method}` : "תשלום";
}

/** Statuses the statement prints for an invoice row. */
export const STATUS = {
  CREDITED: "זוכה",
  PAID: "שולם",
  PARTIAL: "שולם חלקית",
  UNPAID: "לא שולם",
};

/**
 * A row's status, DERIVED FROM THE AMOUNTS rather than from payment_status.
 *
 * payment_status overloads one column with two unrelated facts — whether a tax
 * document was issued ("חשבונית הופקה") and whether it was paid — so a
 * half-paid invoice that also has an external document cannot express both.
 * The amounts can. The raw label is still carried on the row for reference.
 */
export function invoiceStatus(invoice) {
  if (invoice?.credited_at || invoice?.credit_note_id) return STATUS.CREDITED;
  const total = toAgorot(invoice?.total);
  const paid = toAgorot(invoice?.paid_amount);
  if (paid <= 0) return STATUS.UNPAID;
  if (paid >= total) return STATUS.PAID;
  return STATUS.PARTIAL;
}

/** The effective date of an invoice: its document date, else the row's
 *  creation date, which is NOT NULL in the schema. */
function invoiceDate(invoice) {
  return dateKey(invoice?.date) || dateKey(invoice?.created_date);
}

/**
 * Build the statement.
 *
 * @param {object}   input
 * @param {Array}    input.invoices     invoices for ONE customer
 * @param {Array}    input.payments     payments for ONE customer
 * @param {Array}    input.creditNotes  credit notes for ONE customer
 * @param {string?}  input.from         YYYY-MM-DD inclusive, or null for "from the beginning"
 * @param {string?}  input.to           YYYY-MM-DD inclusive, or null for "until the end"
 *
 * @returns {{
 *   opening: number, rows: Array, totals: object, closing: number,
 *   allTime: object, reconciliation: object, warnings: Array, undated: Array
 * }}  all amounts in AGOROT
 */
export function buildStatement({ invoices = [], payments = [], creditNotes = [], from = null, to = null } = {}) {
  const fromKey = dateKey(from);
  const toKey = dateKey(to);
  const warnings = [];

  // ── 1. Every transaction, as a row ───────────────────────────────────────
  const all = [];

  // Dates of the invoices, so a credit note with no date of its own can
  // inherit the date of the document it reverses (see the credit-note loop).
  const invoiceDateById = new Map();
  const unidentified = [];

  for (const inv of invoices) {
    const status = invoiceStatus(inv);
    const d = invoiceDate(inv);
    invoiceDateById.set(inv.id, d);

    // An issued invoice always carries a number: both creation paths set
    // invoice_number, and an externally issued one also carries
    // external_invoice_number. A row with NEITHER is not an identifiable
    // document — the only writer that omits the number is the self-test
    // insert in QualityControl.
    //
    // It is still CHARGED. Excluding it would be the only way a genuine
    // invoice could silently vanish from a statement, and a missing charge is
    // a worse error than a visible anomaly. It is reported instead, so nobody
    // mistakes it for a verified issued document.
    const identified = inv.invoice_number != null || !!inv.external_invoice_number;
    if (!identified) {
      unidentified.push({ invoiceId: inv.id, total: toAgorot(inv.total), date: d });
    }

    all.push({
      kind: KIND.INVOICE,
      id: inv.id,
      date: d,
      dateFallback: !dateKey(inv?.date),       // the document itself carried no date
      docNumber: inv.external_invoice_number || inv.invoice_number || null,
      description: describeInvoice(inv),
      debit: toAgorot(inv.total),
      credit: 0,
      status,
      rawStatus: inv.payment_status ?? null,
      invoiceType: inv.invoice_type ?? "regular",
      invoiceId: inv.id,
      unidentified: !identified,
    });
  }

  // ── Payments: ONE ENTRY PER REAL PAYMENT ─────────────────────────────────
  //
  // A payment split across invoices is stored as N rows sharing one
  // payment_group_id. Printing those rows as N lines is arithmetically correct
  // — they sum to the payment — but it READS as N payments: three lines that
  // each look like a payment of their own, for a customer who wrote one
  // cheque. On a statement a customer may dispute, that is the difference
  // between a document they can follow and one they cannot.
  //
  // So a group becomes ONE credit entry for the whole amount, with the
  // allocations as a breakdown underneath. The money is counted exactly once,
  // because the entry's credit IS the sum of its allocations and the
  // allocations themselves are no longer rows.
  const invoiceById = new Map(invoices.map(i => [i.id, i]));
  const invoiceLabelById = new Map(
    invoices.map(i => [i.id, i.external_invoice_number || i.invoice_number || null]));

  /** What is still owed on an invoice, as it stands now. */
  const remainingOf = (inv) => {
    if (!inv) return null;
    const left = toAgorot(inv.total) - toAgorot(inv.paid_amount);
    return left > 0 ? left : 0;
  };

  /**
   * One allocation, as the breakdown under a payment shows it.
   *
   * THE RECEIPT IS NEVER CLAIMED AS CONFIRMED ON AN ASSUMPTION.
   *   A stored receipt number is evidence in itself: it is written only after
   *   the provider returned that document number. So a number present means a
   *   receipt exists, including for payments recorded before receipt_status
   *   existed (NULL, not "unconfirmed").
   *
   *   What must never be inferred is the other direction. No number means no
   *   confirmed receipt, whatever the status says, and 'uncertain' and
   *   'failed' are reported as what they are rather than flattened into
   *   "missing" — they mean different things to whoever has to fix them.
   */
  const allocationOf = (p) => {
    const inv = invoiceById.get(p.invoice_id);
    const receiptNumber = p.external_receipt_number || null;
    const status = p.receipt_status ?? null;
    let receiptState;
    if (receiptNumber) receiptState = RECEIPT_VIEW.CONFIRMED;
    else if (status === "uncertain") receiptState = RECEIPT_VIEW.UNCERTAIN;
    else if (status === "failed") receiptState = RECEIPT_VIEW.FAILED;
    else if (status === "pending") receiptState = RECEIPT_VIEW.PENDING;
    else receiptState = RECEIPT_VIEW.NONE;

    return {
      paymentId: p.id,
      invoiceId: p.invoice_id ?? null,
      invoiceLabel: p.invoice_id ? (invoiceLabelById.get(p.invoice_id) ?? null) : null,
      amount: toAgorot(p.amount),
      receiptNumber,
      receiptState,
      // What the invoice still owes, as it stands now.
      invoiceRemaining: remainingOf(inv),
      invoiceTotal: inv ? toAgorot(inv.total) : null,
    };
  };

  // Group the rows: one bucket per payment_group_id, and a bucket of its own
  // for every ungrouped payment, so both kinds take the same path from here.
  const buckets = new Map();
  for (const p of payments) {
    const key = p.payment_group_id ? `g:${p.payment_group_id}` : `p:${p.id}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  }

  for (const [key, rows] of buckets) {
    const head = rows[0];
    const groupId = head.payment_group_id || null;
    // All rows of a group are written by one call and share one payment_date.
    // The earliest is used anyway, so a group can never be placed later than
    // its own money, and a disagreement is reported rather than hidden.
    const dates = rows.map(r => dateKey(r.payment_date) || dateKey(r.created_date));
    const distinctDates = new Set(dates.filter(Boolean));
    if (distinctDates.size > 1) {
      warnings.push({
        code: "group_date_mismatch",
        count: distinctDates.size,
        message: `תשלום מפוצל אחד נושא ${distinctDates.size} תאריכים שונים — נעשה שימוש במוקדם שבהם`,
      });
    }
    const date = [...distinctDates].sort()[0] || null;

    const allocations = rows.map(allocationOf);
    const credit = allocations.reduce((s, a) => s + a.amount, 0);
    const receiptNumbers = [...new Set(
      allocations.map(a => a.receiptNumber).filter(Boolean))];

    all.push({
      kind: KIND.PAYMENT,
      // Stable and unique across both kinds, for a React key and for the
      // comparator's final tiebreak.
      id: key,
      date,
      dateFallback: !dateKey(head?.payment_date),
      method: head.payment_method ?? null,
      description: describePayment(head),
      // The cheque's own number, and NOTHING else about the bank. A customer
      // statement identifies a cheque; it does not restate the drawer's bank,
      // branch and account back at them.
      checkNumber: head.payment_method === CHECK_METHOD
        ? (head.check_number ? String(head.check_number) : null)
        : null,
      reference: head.reference || null,
      // Every receipt issued under this one payment.
      receiptNumbers,
      // For a single-allocation payment this is the document number, as
      // before. For a group there may be several, so the breakdown carries
      // them per allocation and this stays empty rather than naming one.
      docNumber: receiptNumbers.length === 1 ? receiptNumbers[0] : null,
      paymentGroupId: groupId,
      allocations,
      allocationCount: allocations.length,
      isGrouped: allocations.length > 1,
      debit: 0,
      // ONE credit for the whole payment. Equal to the sum of its allocations
      // by construction, which is what keeps the money counted once and the
      // running balance correct.
      credit,
      status: null,
      rawStatus: head.status ?? null,
      invoiceId: allocations.length === 1 ? (head.invoice_id ?? null) : null,
      // Kept for reconciliation: the raw rows this entry stands for.
      paymentIds: rows.map(r => r.id),
    });
  }

  for (const cn of creditNotes) {
    // created_at is nullable and there is no business date column, so a credit
    // note can arrive with no date of its own.
    //
    // THE DATE CHAIN, AND WHY IT MATTERS
    //   An undated row cannot be placed in time, and a row that floats into
    //   "the current period" is counted in EVERY consecutive statement while
    //   never entering any opening balance — so January's closing stops
    //   matching February's opening and the same credit is presented twice.
    //
    //   So the date is resolved, in order: the credit note's own timestamp,
    //   then its row creation, then THE DATE OF THE INVOICE IT REVERSES. A
    //   credit note always carries invoice_id, and an invoice always has a
    //   date (its own, or the NOT NULL created_date), so this resolves for
    //   every credit note raised by the application. The substitution is
    //   flagged as derived rather than presented as the document's own date.
    //
    //   The database is not touched: this is a display and ordering decision
    //   made at read time.
    const ownDate = dateKey(cn.created_at) || dateKey(cn.created_date);
    const derivedDate = ownDate ? null : (invoiceDateById.get(cn.invoice_id) || null);

    all.push({
      kind: KIND.CREDIT_NOTE,
      id: cn.id,
      date: ownDate || derivedDate,
      dateFallback: !ownDate,
      // True only when the date shown belongs to another document.
      dateDerived: !ownDate && !!derivedDate,
      derivedFromInvoiceId: derivedDate ? (cn.invoice_id ?? null) : null,
      docNumber: cn.external_credit_note_number || cn.credit_note_number || null,
      description: cn.reason || "זיכוי",
      debit: 0,
      // Stored negative; the statement shows a positive credit.
      credit: Math.abs(toAgorot(cn.total)),
      status: null,
      rawStatus: null,
      invoiceId: cn.invoice_id ?? null,
    });
  }

  // ── 2. Split into opening / period / undated ─────────────────────────────
  //
  // A row whose date could not be resolved AT ALL goes into the OPENING
  // BALANCE, not into the period.
  //
  //   An earlier version put it in the period. That is wrong across
  //   statements: the row never enters any opening balance, so it is counted
  //   again in every consecutive period and January's closing stops equalling
  //   February's opening. Treating it as "before all time" counts it exactly
  //   once in every statement, keeps consecutive periods reconciling, and
  //   still never discards it — a dropped row is a wrong balance.
  //
  // It is reported either way, so the missing date gets fixed rather than
  // living on as a quiet adjustment to the opening figure.
  const openingRows = [];
  const periodRows = [];
  const undated = [];
  const derived = [];

  for (const row of all) {
    if (!row.date) { undated.push(row); openingRows.push(row); continue; }
    if (row.dateDerived) derived.push(row);
    if (fromKey && row.date < fromKey) { openingRows.push(row); continue; }
    if (toKey && row.date > toKey) continue;              // after the period: not shown
    periodRows.push(row);
  }

  if (undated.length > 0) {
    warnings.push({
      code: "undated_rows",
      count: undated.length,
      message: `${undated.length} תנועות ללא תאריך שניתן לקבוע — נכללו ביתרת הפתיחה`,
    });
  }

  if (derived.length > 0) {
    warnings.push({
      code: "derived_dates",
      count: derived.length,
      message: `${derived.length} זיכויים ללא תאריך משלהם — נעשה שימוש בתאריך החשבונית שזוכתה`,
    });
  }

  if (unidentified.length > 0) {
    warnings.push({
      code: "unidentified_invoice",
      count: unidentified.length,
      message: `${unidentified.length} חשבוניות ללא מספר מסמך — נכללו בחישוב אך אינן מאומתות כמסמך שהופק`,
      details: unidentified,
    });
  }

  // ── 3. Opening balance ───────────────────────────────────────────────────
  const opening = openingRows.reduce((s, r) => s + r.debit - r.credit, 0);

  // ── 4. Deterministic order, then the running balance ─────────────────────
  // The comparator is TOTAL: date, then kind, then document number, then id.
  // Without the final tiebreak two rows could swap between renders and every
  // running balance after them would change, which makes a printed statement
  // irreproducible.
  periodRows.sort(compareRows);

  let running = opening;
  const rows = periodRows.map((r) => {
    running = running + r.debit - r.credit;
    return { ...r, balance: running };
  });

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const closing = opening + totalDebit - totalCredit;

  // ── 5. Reconciliation against the CRM's own figure ───────────────────────
  // Reported, never silently corrected. The CRM's customer balance is
  //   Σ (total − paid_amount) over invoices whose payment_status !== "שולם"
  // which has two known defects: it ignores credit notes entirely, and it
  // still counts a credited invoice's remainder as debt. The statement's
  // all-time balance is the correct figure; the delta is explained.
  const allTimeDebit = all.filter(r => r.kind === KIND.INVOICE).reduce((s, r) => s + r.debit, 0);
  const allTimeCredit = all.filter(r => r.kind !== KIND.INVOICE).reduce((s, r) => s + r.credit, 0);
  const allTimeClosing = allTimeDebit - allTimeCredit;

  const crmOutstanding = invoices
    .filter(i => i.payment_status !== "שולם")
    .reduce((s, i) => s + (toAgorot(i.total) - toAgorot(i.paid_amount)), 0);

  const causes = [];
  const creditedRemainder = invoices
    .filter(i => (i.credited_at || i.credit_note_id) && i.payment_status !== "שולם")
    .reduce((s, i) => s + (toAgorot(i.total) - toAgorot(i.paid_amount)), 0);
  if (creditedRemainder !== 0) {
    causes.push({ code: "crm_counts_credited_as_debt", amount: creditedRemainder });
  }
  const creditNotesTotal = creditNotes.reduce((s, cn) => s + Math.abs(toAgorot(cn.total)), 0);
  if (creditNotesTotal !== 0) {
    causes.push({ code: "crm_ignores_credit_notes", amount: creditNotesTotal });
  }

  // Per-invoice: does paid_amount still agree with its payment rows? A
  // production check found no discrepancy, but the two are written
  // non-atomically by the payment dialog, so this is re-checked every run
  // rather than assumed.
  const paidByInvoice = new Map();
  for (const p of payments) {
    if (!p.invoice_id) continue;
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) || 0) + toAgorot(p.amount));
  }
  const mismatches = [];
  for (const inv of invoices) {
    const recorded = toAgorot(inv.paid_amount);
    const summed = paidByInvoice.get(inv.id) || 0;
    if (recorded !== summed) {
      mismatches.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number ?? null,
        paidAmount: recorded,
        paymentsSum: summed,
        difference: recorded - summed,
      });
    }
  }
  if (mismatches.length > 0) {
    warnings.push({
      code: "paid_amount_mismatch",
      count: mismatches.length,
      message: `${mismatches.length} חשבוניות שבהן paid_amount אינו תואם לסכום התשלומים`,
      details: mismatches,
    });
  }

  // Payments whose invoice is not among this customer's invoices — an orphan
  // credit that would otherwise reduce the balance with nothing to point at.
  const invoiceIds = new Set(invoices.map(i => i.id));
  const orphanPayments = payments.filter(p => p.invoice_id && !invoiceIds.has(p.invoice_id));
  if (orphanPayments.length > 0) {
    warnings.push({
      code: "orphan_payments",
      count: orphanPayments.length,
      message: `${orphanPayments.length} תשלומים שאינם משויכים לחשבונית של לקוח זה`,
    });
  }

  // ── Is every payment counted exactly once? ───────────────────────────────
  //
  // Each real payment is now ONE entry whose credit is the sum of its
  // allocations, so the two things that could go wrong are both checked here
  // against the RAW rows rather than against the entries built from them.
  //
  //   1. the same raw row delivered twice. The reads that feed this statement
  //      are paged, and a page that overlaps its predecessor would deliver one
  //      payment twice, understating the balance by its full value on business
  //      letterhead.
  //   2. an entry whose credit does not equal its allocations. That cannot
  //      happen by construction — the credit IS their sum — which is exactly
  //      why it is worth asserting: if it ever stops being true, the running
  //      balance is wrong and nothing else would say so.
  const paymentEntries = all.filter(r => r.kind === KIND.PAYMENT);

  const seenRawIds = new Set();
  const duplicatePaymentIds = [];
  for (const p of payments) {
    if (p.id === null || p.id === undefined) continue;
    if (seenRawIds.has(p.id)) duplicatePaymentIds.push(p.id);
    else seenRawIds.add(p.id);
  }
  if (duplicatePaymentIds.length > 0) {
    warnings.push({
      code: "duplicate_payment_rows",
      count: duplicatePaymentIds.length,
      message: `${duplicatePaymentIds.length} שורות תשלום כפולות — היתרה עלולה להיות שגויה`,
      details: duplicatePaymentIds,
    });
  }

  const unbalanced = paymentEntries.filter(
    r => r.credit !== (r.allocations || []).reduce((s2, a) => s2 + a.amount, 0));
  if (unbalanced.length > 0) {
    warnings.push({
      code: "payment_entry_unbalanced",
      count: unbalanced.length,
      message: `${unbalanced.length} תשלומים שסכומם אינו תואם לפירוט ההקצאות שלהם`,
      details: unbalanced.map(r => r.id),
    });
  }

  // One entry IS one real payment now, so this is simply how many there are.
  const distinctPayments = paymentEntries.length;

  // Allocations whose receipt is not on record as a document. Counted over
  // ALLOCATIONS, because that is the level a receipt belongs to: one payment
  // can have one confirmed receipt and one that failed.
  const allAllocations = paymentEntries.flatMap(r => r.allocations || []);
  const receiptsUnconfirmed = allAllocations.filter(
    a => a.receiptState !== RECEIPT_VIEW.CONFIRMED);
  const receiptsUncertain = allAllocations.filter(
    a => a.receiptState === RECEIPT_VIEW.UNCERTAIN);
  if (receiptsUnconfirmed.length > 0) {
    warnings.push({
      code: "receipts_unconfirmed",
      count: receiptsUnconfirmed.length,
      message: receiptsUncertain.length > 0
        ? `${receiptsUnconfirmed.length} הקצאות ללא קבלה מאומתת, מהן ${receiptsUncertain.length} במצב לא ודאי — אין להפיק קבלה נוספת לפני בדיקה ב-Finbot`
        : `${receiptsUnconfirmed.length} הקצאות ללא קבלה מאומתת`,
      details: receiptsUnconfirmed.map(a => ({
        paymentId: a.paymentId, invoiceLabel: a.invoiceLabel,
        amount: a.amount, receiptState: a.receiptState,
      })),
    });
  }

  // The nesting assumption, re-checked rather than trusted.
  const nestedInvoiceIds = invoices.filter(i =>
    Array.isArray(i.included_invoice_ids) && i.included_invoice_ids.length > 0);
  if (nestedInvoiceIds.length > 0) {
    warnings.push({
      code: "nested_invoices",
      count: nestedInvoiceIds.length,
      message: `${nestedInvoiceIds.length} חשבוניות מרכזות חשבוניות אחרות — ייתכן כפל חיוב`,
    });
  }

  return {
    opening,
    rows,
    totals: {
      debit: totalDebit, credit: totalCredit, count: rows.length,
      // The three headline figures, separated because they answer different
      // questions: a credit note is not a payment received, and a statement
      // that adds the two into one "credit" figure cannot be reconciled
      // against a bank statement.
      invoiced: totalDebit,
      paymentsReceived: rows.filter(r => r.kind === KIND.PAYMENT)
        .reduce((s2, r) => s2 + r.credit, 0),
      creditNotes: rows.filter(r => r.kind === KIND.CREDIT_NOTE)
        .reduce((s2, r) => s2 + r.credit, 0),
      // One entry per real payment, and how many allocations they cover.
      paymentCount: rows.filter(r => r.kind === KIND.PAYMENT).length,
      allocationCount: rows.filter(r => r.kind === KIND.PAYMENT)
        .reduce((s2, r) => s2 + (r.allocationCount || 1), 0),
    },
    closing,
    allTime: { debit: allTimeDebit, credit: allTimeCredit, closing: allTimeClosing },
    reconciliation: {
      crmOutstanding, delta: allTimeClosing - crmOutstanding, causes, mismatches,
      distinctPayments, duplicatePaymentIds,
      unbalancedPayments: unbalanced.length,
      receiptsUnconfirmed: receiptsUnconfirmed.length,
      receiptsUncertain: receiptsUncertain.length,
    },
    warnings,
    undated,
    derived,
    unidentified,
    period: { from: fromKey, to: toKey },
  };
}

/** Total, deterministic ordering. Exported so a test can assert stability. */
export function compareRows(a, b) {
  // Undated rows sort last, so the dated sequence reads cleanly.
  if (!a.date && b.date) return 1;
  if (a.date && !b.date) return -1;
  if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ka = KIND_ORDER[a.kind] ?? 9;
  const kb = KIND_ORDER[b.kind] ?? 9;
  if (ka !== kb) return ka - kb;
  // The allocations of ONE payment stay together.
  //
  // Each allocation now carries its own receipt number, so ordering by
  // document number alone could interleave two payments made on the same day
  // and a reader could no longer see which lines belong to which payment.
  //
  // This cannot reorder anything that existed before: a row with no group —
  // every invoice, every credit note and every payment recorded until now —
  // keys as "", so identical keys fall straight through to the document number
  // exactly as they did.
  const ga = String(a.paymentGroupId ?? "");
  const gb = String(b.paymentGroupId ?? "");
  if (ga !== gb) return ga < gb ? -1 : 1;
  const na = String(a.docNumber ?? "");
  const nb = String(b.docNumber ?? "");
  if (na !== nb) return na < nb ? -1 : 1;
  return String(a.id ?? "") < String(b.id ?? "") ? -1 : 1;
}

function describeInvoice(inv) {
  if (inv.invoice_type === "monthly") {
    const n = Array.isArray(inv.included_order_ids) ? inv.included_order_ids.length : 0;
    const month = inv.billing_month ? `${String(inv.billing_month).padStart(2, "0")}/${inv.billing_year}` : "";
    return `חשבונית מרכזת ${month}${n ? ` · ${n} הזמנות` : ""}`.trim();
  }
  return "חשבונית";
}

function describePayment(p) {
  return paymentLabel({
    method: p.payment_method ?? null,
    checkNumber: p.check_number ? String(p.check_number) : null,
  });
}

/** Is the closing balance money the customer owes, or money owed to them? */
export function balanceSide(closing) {
  if (closing > 0) return { side: "debit", label: "יתרה לחובת הלקוח" };
  if (closing < 0) return { side: "credit", label: "יתרת זכות ללקוח" };
  return { side: "zero", label: "יתרה מאופסת" };
}
