/**
 * BUILDING A PARTIAL CREDIT: which lines, how much of each, and what it comes to.
 *
 * PURE. No React, no network, no database. Every amount is integer agorot and
 * every limit is checked here, so the dialog and the server cannot disagree
 * about what a legal partial credit is.
 *
 * ============================================================================
 * TWO WAYS A LINE CAN BE CREDITED, AND THEY ARE NOT THE SAME EVENT
 * ============================================================================
 *   RETURN            goods came back. Some or all of the line's quantity is
 *                     credited at the price it was sold at, and that quantity
 *                     returns to stock.
 *
 *   PRICE ADJUSTMENT  the goods are the customer's; the PRICE was wrong. The
 *                     operator states the price that should have been charged
 *                     and the credit is the difference across the line's
 *                     quantity. NOTHING returns to stock — crediting an
 *                     overcharge brings nothing back to the warehouse.
 *
 * A line may be in one mode or the other within one credit note, never both:
 * returning three units and repricing the other seven are two different
 * corrections, and putting them on one document makes the document unreadable.
 * They can be issued as two credits — which is what multiple partial credits
 * per invoice are for.
 *
 * ============================================================================
 * WHAT THE MONEY IS, AND WHERE VAT ENTERS
 * ============================================================================
 * Invoice lines are NET: `unit_price` and `total` exclude VAT, and the invoice
 * carries its own `vat_rate` and a GROSS `total`. So a credit is built net,
 * line by line, and the VAT is added ONCE at the end on the net sum — not per
 * line, which would round up to a line's worth of agorot adrift on a long
 * invoice.
 *
 * The GROSS figure is the one that matters to the cap:
 * `credit_note_reserve` compares against `invoices.total`, which is gross, and
 * `credit_notes.total` has always been stored gross. Mixing a net credit into a
 * gross cap would let an invoice be over-credited by the VAT on every partial.
 *
 * ============================================================================
 * WHAT COUNTS AS ALREADY CREDITED
 * ============================================================================
 * The same conservative set `credit_note_reserve` uses: everything except
 * 'failed'. A credit whose document MAY exist holds its share of the invoice,
 * because two attempts that each read a stale sum would otherwise pass together
 * and over-credit it. 'failed' is the one proven state and releases its share.
 *
 * Note this differs from the BALANCE, which counts only 'confirmed'. The cap is
 * conservative; the balance is strict. Both err towards not inventing money.
 */

import { toAgorot, toShekels } from "@/lib/packagingMath";

export const CREDIT_KIND = { RETURN: "return", PRICE: "price_adjustment" };

/** Agorot, as a non-negative magnitude. */
const ag = (v) => Math.abs(toAgorot(v) ?? 0);
/**
 * A finite number, or null for ABSENT.
 *
 * The empty string is absent, not zero. `Number("")` is 0, and that one
 * coercion had two teeth: an empty "corrected price" field read as ₪0 and
 * credited the ENTIRE line, and a credit line with no source_line_index was
 * attributed to line 0 — crediting quantity against goods it had nothing to do
 * with. Absent has to be absent.
 */
const num = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = String(v).trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** A credit note that holds its share of the invoice: anything but 'failed'. */
export function holdsCap(cn) {
  return cn?.finbot_status !== "failed";
}

/**
 * A line's own identity within the invoice.
 *
 * `invoices.items` is a JSON array with no stable id, so the INDEX is the only
 * identifier there is. It is safe to use precisely because invoices are
 * immutable — Gate C stopped writing to them, so a line cannot move after a
 * credit has pointed at it. The product id is carried alongside as a
 * cross-check, never as the key: one invoice can hold the same product twice.
 */
export function lineKey(index) { return index; }

/**
 * How much of each invoice line has ALREADY been credited as a return.
 *
 * @returns {Map<number, number>} line index -> quantity already returned
 */
export function creditedQuantities(creditNotes = []) {
  const out = new Map();
  for (const cn of creditNotes || []) {
    if (!holdsCap(cn)) continue;
    for (const line of cn.items || []) {
      // A legacy credit line has no kind and is a return, which is what the
      // whole-invoice flow has always produced.
      const kind = line?.kind ?? CREDIT_KIND.RETURN;
      if (kind !== CREDIT_KIND.RETURN) continue;
      const idx = num(line?.source_line_index);
      if (idx === null) continue;        // legacy: no index, cannot attribute
      const qty = num(line?.quantity) ?? 0;
      if (qty <= 0) continue;
      out.set(idx, (out.get(idx) || 0) + qty);
    }
  }
  return out;
}

/**
 * Credits already recorded against a whole invoice, in GROSS agorot.
 *
 * Legacy credit notes with no per-line index still count here: they are money
 * against the invoice even when they cannot be attributed to a line.
 */
export function creditedAmountAg(invoice, creditNotes = []) {
  return (creditNotes || [])
    .filter(cn => cn?.invoice_id === invoice?.id && holdsCap(cn))
    .reduce((s, cn) => s + ag(cn.total), 0);
}

/**
 * What is still creditable on this invoice, line by line and in total.
 *
 * @returns {{
 *   vatRate: number,
 *   lines: Array<{index, name, productId, quantity, unitPriceAg, discount,
 *                 lineNetAg, creditedQty, remainingQty, canReturn, canReprice}>,
 *   invoiceGrossAg: number, creditedGrossAg: number, remainingGrossAg: number
 * }}
 */
export function creditableInvoice(invoice, creditNotes = []) {
  // ==========================================================================
  // THE INVOICE'S OWN RATE, AND NOTHING ELSE
  // ==========================================================================
  // A hardcoded 17 stood here. It is the column default, so it is right most of
  // the time, which is exactly what makes it dangerous: an invoice issued at a
  // different rate would have its credit computed at 17% and nobody would see
  // the discrepancy until a filing.
  //
  // The rate comes from the invoice being credited, and when the invoice does
  // not carry one it is reported as unknown rather than assumed. The caller
  // then has a figure it can refuse to show instead of a plausible wrong one.
  //
  // AND A SEPARATE POINT WORTH KNOWING: finbot-invoice does NOT send `vatRate`,
  // although IncomeDto has the field. It sends `vatType: true` and lets the
  // provider apply the rate configured on the Finbot account. So the VAT shown
  // here is OUR arithmetic over the invoice's recorded rate, and the document's
  // VAT is the provider's. They agree only while the two rates agree.
  const rawVatRate = num(invoice?.vat_rate);
  const vatRateKnown = rawVatRate !== null && rawVatRate >= 0;
  const vatRate = vatRateKnown ? rawVatRate : null;
  const already = creditedQuantities(
    (creditNotes || []).filter(cn => cn?.invoice_id === invoice?.id));

  const lines = (invoice?.items || []).map((item, index) => {
    const quantity = num(item?.quantity) ?? 0;
    const unitPriceAg = ag(item?.unit_price);
    const discount = num(item?.discount) ?? 0;
    const creditedQty = already.get(index) || 0;
    const remainingQty = Math.max(0, quantity - creditedQty);
    return {
      index,
      name: item?.name || item?.description || "פריט",
      productId: item?.product_id ?? null,
      quantity, unitPriceAg, discount,
      // The line's own net, as the invoice recorded it.
      lineNetAg: ag(item?.total),
      creditedQty, remainingQty,
      canReturn: remainingQty > 0 && unitPriceAg > 0,
      // Repricing needs a price to come down FROM, and says nothing about
      // quantity, so a fully returned line can still be repriced... except
      // that there is then nothing left to reprice. Both must hold.
      canReprice: remainingQty > 0 && unitPriceAg > 0,
    };
  });

  const invoiceGrossAg = ag(invoice?.total);
  const creditedGrossAg = creditedAmountAg(invoice, creditNotes);
  return {
    vatRate, vatRateKnown, lines,
    invoiceGrossAg, creditedGrossAg,
    remainingGrossAg: Math.max(0, invoiceGrossAg - creditedGrossAg),
  };
}

/**
 * One line's net credit, in agorot.
 *
 * RETURN:  qty x unit price, less the line's discount.
 * PRICE:   (original − corrected) x the WHOLE line quantity, less the discount.
 *          The discount applies because it applied to the original charge: a
 *          10% discount on a line overcharged by ₪5 a unit overcharged the
 *          customer by ₪4.50 a unit, not ₪5.
 */
export function lineCreditNetAg(line, selection) {
  if (!line || !selection) return 0;
  const factor = 1 - (line.discount || 0) / 100;

  if (selection.kind === CREDIT_KIND.RETURN) {
    const qty = num(selection.quantity) ?? 0;
    if (qty <= 0) return 0;
    return Math.round(line.unitPriceAg * qty * factor);
  }

  if (selection.kind === CREDIT_KIND.PRICE) {
    const corrected = toAgorot(selection.correctedUnitPrice);
    if (corrected === null || corrected < 0) return 0;
    const delta = line.unitPriceAg - corrected;
    if (delta <= 0) return 0;
    return Math.round(delta * (line.quantity || 0) * factor);
  }
  return 0;
}

/**
 * The whole proposed credit: its lines, its money, and every reason it is not
 * yet legal.
 *
 * NOTHING IS WRITTEN AND NOTHING IS SENT. This builds a proposal and judges it.
 *
 * @param {object} input
 * @param {object} input.invoice
 * @param {Array}  input.creditNotes      the invoice's existing credit notes
 * @param {Object} input.selections       line index -> {kind, quantity|correctedUnitPrice}
 * @returns {{
 *   ok: boolean, errors: Array<{code, index?, message}>,
 *   lines: Array<object>, netAg: number, vatAg: number, grossAg: number,
 *   net: number, vat: number, gross: number, vatRate: number,
 *   remainingGrossAg: number, isFullCredit: boolean,
 *   restoresStock: boolean, stockLines: number
 * }}
 */
export function buildPartialCredit({ invoice, creditNotes = [], selections = {} } = {}) {
  const info = creditableInvoice(invoice, creditNotes);
  const errors = [];
  const lines = [];

  for (const [rawIndex, sel] of Object.entries(selections || {})) {
    const index = Number(rawIndex);
    const line = info.lines[index];
    if (!line) {
      errors.push({ code: "unknown_line", index, message: "שורה שאינה קיימת בחשבונית" });
      continue;
    }
    if (!sel || !sel.kind) continue;                  // not selected

    if (sel.kind === CREDIT_KIND.RETURN) {
      const qty = num(sel.quantity);
      if (qty === null || qty <= 0) {
        errors.push({ code: "quantity_required", index,
          message: `${line.name}: יש להזין כמות לזיכוי` });
        continue;
      }
      // THE CUMULATIVE QUANTITY CHECK. Everything already credited on this
      // line, across every earlier credit note, is subtracted first.
      if (qty > line.remainingQty) {
        errors.push({ code: "quantity_exceeds", index,
          message: `${line.name}: ניתן לזכות עד ${line.remainingQty} (נמכרו ${line.quantity}, זוכו כבר ${line.creditedQty})` });
        continue;
      }
      const netAg = lineCreditNetAg(line, { kind: sel.kind, quantity: qty });
      if (netAg <= 0) {
        errors.push({ code: "zero_amount", index,
          message: `${line.name}: הזיכוי יוצא אפס` });
        continue;
      }
      lines.push({
        kind: CREDIT_KIND.RETURN, source_line_index: index,
        product_id: line.productId, name: line.name,
        quantity: qty, unit_price: -toShekels(line.unitPriceAg),
        discount: line.discount, total: -toShekels(netAg), netAg,
      });
      continue;
    }

    if (sel.kind === CREDIT_KIND.PRICE) {
      const corrected = num(sel.correctedUnitPrice);
      if (corrected === null) {
        errors.push({ code: "price_required", index,
          message: `${line.name}: יש להזין את המחיר המתוקן` });
        continue;
      }
      if (corrected < 0) {
        errors.push({ code: "price_negative", index,
          message: `${line.name}: מחיר מתוקן אינו יכול להיות שלילי` });
        continue;
      }
      const originalShekels = toShekels(line.unitPriceAg);
      if (toAgorot(corrected) >= line.unitPriceAg) {
        errors.push({ code: "price_not_lower", index,
          message: `${line.name}: המחיר המתוקן חייב להיות נמוך מ-${originalShekels.toFixed(2)} ₪ — זיכוי מקטין חיוב` });
        continue;
      }
      const netAg = lineCreditNetAg(line, { kind: sel.kind, correctedUnitPrice: corrected });
      if (netAg <= 0) {
        errors.push({ code: "zero_amount", index,
          message: `${line.name}: הזיכוי יוצא אפס` });
        continue;
      }
      lines.push({
        kind: CREDIT_KIND.PRICE, source_line_index: index,
        product_id: line.productId, name: line.name,
        // NO STOCK MOVES for a price adjustment, and the quantity is recorded
        // as zero so nothing downstream can mistake it for goods coming back.
        quantity: 0,
        original_unit_price: originalShekels,
        corrected_unit_price: corrected,
        priced_quantity: line.quantity,
        discount: line.discount,
        total: -toShekels(netAg), netAg,
      });
      continue;
    }

    errors.push({ code: "unknown_kind", index, message: "סוג זיכוי לא מוכר" });
  }

  if (lines.length === 0 && errors.length === 0) {
    errors.push({ code: "nothing_selected", message: "יש לבחור פריט אחד לפחות לזיכוי" });
  }

  // VAT ONCE, on the net sum — and only when the invoice states its rate.
  const netAg = lines.reduce((s, l) => s + l.netAg, 0);
  if (!info.vatRateKnown && netAg > 0) {
    errors.push({
      code: "vat_rate_unknown",
      message: "בחשבונית המקורית לא רשום שיעור מע״מ — לא ניתן לחשב את סכום הזיכוי",
    });
  }
  const vatAg = info.vatRateKnown ? Math.round(netAg * (info.vatRate / 100)) : 0;
  const grossAg = netAg + vatAg;

  // THE CUMULATIVE AMOUNT CHECK, in gross — the footing the cap uses.
  if (grossAg > info.remainingGrossAg) {
    errors.push({
      code: "amount_exceeds",
      message: `הזיכוי (${toShekels(grossAg).toFixed(2)} ₪) עולה על היתרה שניתן לזכות (${toShekels(info.remainingGrossAg).toFixed(2)} ₪ מתוך ${toShekels(info.invoiceGrossAg).toFixed(2)} ₪)`,
    });
  }

  const stockLines = lines.filter(l => l.kind === CREDIT_KIND.RETURN).length;
  return {
    ok: errors.length === 0 && lines.length > 0,
    errors, lines,
    netAg, vatAg, grossAg,
    net: toShekels(netAg), vat: toShekels(vatAg), gross: toShekels(grossAg),
    vatRate: info.vatRate, vatRateKnown: info.vatRateKnown,
    remainingGrossAg: info.remainingGrossAg,
    // A credit that happens to reach the whole invoice. Reported so the dialog
    // can say so — a FULL correction is a different decision from a partial
    // one, and the operator should know which they are about to make.
    isFullCredit: grossAg > 0 && grossAg >= info.invoiceGrossAg - info.creditedGrossAg
                  && info.creditedGrossAg === 0 && grossAg >= info.invoiceGrossAg,
    restoresStock: stockLines > 0,
    stockLines,
  };
}
