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

  for (const p of payments) {
    all.push({
      kind: KIND.PAYMENT,
      id: p.id,
      date: dateKey(p.payment_date) || dateKey(p.created_date),
      dateFallback: !dateKey(p?.payment_date),
      docNumber: p.external_receipt_number || p.reference || null,
      description: describePayment(p),
      debit: 0,
      credit: toAgorot(p.amount),
      status: null,
      rawStatus: p.status ?? null,
      invoiceId: p.invoice_id ?? null,
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
    totals: { debit: totalDebit, credit: totalCredit, count: rows.length },
    closing,
    allTime: { debit: allTimeDebit, credit: allTimeCredit, closing: allTimeClosing },
    reconciliation: { crmOutstanding, delta: allTimeClosing - crmOutstanding, causes, mismatches },
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
  const method = p.payment_method ? ` · ${p.payment_method}` : "";
  return `תשלום${method}`;
}

/** Is the closing balance money the customer owes, or money owed to them? */
export function balanceSide(closing) {
  if (closing > 0) return { side: "debit", label: "יתרה לחובת הלקוח" };
  if (closing < 0) return { side: "credit", label: "יתרת זכות ללקוח" };
  return { side: "zero", label: "יתרה מאופסת" };
}
