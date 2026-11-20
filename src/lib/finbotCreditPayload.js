/**
 * THE BODY A PARTIAL CREDIT WOULD POST TO `finbot-invoice`.
 *
 * PURE. It builds a request and nothing sends it. Separated from the dialog so
 * the exact bytes can be asserted in a test rather than inspected by eye in a
 * network tab, and so the dry-run preview and the eventual live call cannot
 * drift apart.
 *
 * ============================================================================
 * WHAT THE EXISTING EDGE FUNCTION WILL AND WILL NOT CARRY
 * ============================================================================
 * Read from supabase/functions/finbot-invoice/index.ts, not assumed:
 *
 *   1. THE OVERRIDE WHITELIST IS {type, linkedDocument, credit}. Nothing else
 *      a caller sends in `overrides` is honoured — `items` least of all. So a
 *      partial credit cannot be expressed through `overrides`; its lines have
 *      to arrive as `invoice.items`, which `buildItems` reads. The whole-invoice
 *      flow already passes a synthetic invoice object, so this is the existing
 *      seam rather than a new one. NO CHANGE TO THE EDGE FUNCTION IS NEEDED.
 *
 *   2. `buildItems` DROPS ANY LINE WITH quantity <= 0:
 *
 *          .filter((i) => i && !i.is_header && Number(i.quantity) > 0)
 *
 *      A price-adjustment credit line is quantity 0 by design — no goods move —
 *      so sending it as it is stored would silently omit it from the document
 *      while `credit` still carried its money. The document would then disagree
 *      with its own total.
 *
 *      So a price adjustment goes on the wire as ONE unit priced at the credit
 *      it represents: `{amount: 1, price: <net credit>}`. The internal record
 *      keeps quantity 0 and `kind: 'price_adjustment'`, which is what stops the
 *      stock moving. The two representations are deliberately different, and
 *      this function is the only place that knows both.
 *
 *   3. `buildAdjustmentItem` appends an extra line, but only when the invoice
 *      object carries `has_manual_total === true`. The synthetic invoice here
 *      must never set it, or a spurious "התאמת סכום" line would appear on a
 *      credit document.
 *
 *   4. PRICES ARE NET. The payload sets `vatType: true`, so the provider adds
 *      VAT to the item prices itself. Our line nets go straight through and
 *      nothing here multiplies by a VAT rate.
 *
 *   5. `ItemDto.name` is capped at 100 characters by the provider. Longer names
 *      are truncated here rather than refused there.
 */

import { toShekels } from "@/lib/packagingMath";
import { CREDIT_KIND } from "@/lib/partialCredit";

/** Finbot's document type for a credit note, as the working flow uses it. */
export const FINBOT_CREDIT_TYPE = "4";

/** ItemDto.name is capped at 100 characters by the provider. */
export const NAME_MAX = 100;

/**
 * `credit` IS THE GROSS, AND IT OVERRIDES THE ITEMS. VERIFIED.
 *
 * ============================================================================
 * THE EVIDENCE: credit document 50026, against invoice 10129
 * ============================================================================
 *      we sent    items summing   165.60 net
 *                 credit          195.00
 *
 *      the issued document         165.25 net + 29.75 VAT = 195.00
 *
 * Three things follow, and none of them is an inference:
 *
 *   1. The document's GROSS is exactly the `credit` we sent. 195.00.
 *   2. The document's NET is NOT our items' net. We sent 165.60; it shows
 *      165.25.
 *   3. 195.00 / 1.18 = 165.2542, which rounds to exactly 165.25.
 *
 * So Finbot takes `credit` as the gross the document must come to, and
 * re-derives the net from it. OUR ITEM VALUES DO NOT SET THE AMOUNT.
 *
 * The 35-agora gap was never Finbot's doing. Invoice 10129's own stored total
 * (195.00) was not 1.18 x its own items (165.60 -> 195.41): 195.00 / 165.60 is
 * 1.17754, which is no VAT rate. 195.00 is a round number, so the invoice
 * carried a hand-entered total. The credit reversed the gross the customer was
 * actually charged, which is right; only the net breakdown differs from the
 * invoice's own.
 *
 * ============================================================================
 * WHAT THIS MEANS FOR A PARTIAL CREDIT, AND THE ROUND TRIP THAT MATTERS
 * ============================================================================
 * Since `credit` sets the gross and the net is derived from it, the document's
 * net will be round(gross / (1 + rate)). For our own figure to survive, that
 * has to land back on the net we computed.
 *
 * It does, and this was checked rather than hoped: for EVERY net amount from
 * ₪0.01 to ₪5,000 at both 17% and 18%, with gross computed as
 * net + round(net x rate), the back-derivation reproduces the net exactly.
 * Zero failures in 500,000 amounts, each rate.
 *
 * THIS IS THE OPPOSITE DIRECTION FROM THE RECEIPT PROBLEM, which is why it
 * works. payment-webhook starts from a GROSS target and has to find a net price
 * whose round-trip returns it — and 15.3% of amounts have no two-decimal
 * solution, which is what rejected receipt 722 and forced three decimals there.
 * Here the net is what we know and the gross is derived from it, and that
 * direction is exact.
 *
 * `assertGrossRoundTrip` enforces it per request anyway, so if a rate ever
 * arrives for which it does not hold, the request is refused rather than
 * producing a document whose subtotal disagrees with our record.
 */
export const CREDIT_FIELD_BASIS = "gross";

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Will Finbot's back-derivation reproduce the net we computed?
 *
 * The provider sets the document's gross from `credit` and derives the net as
 * gross / (1 + rate). Verified exact for every amount to ₪5,000 at 17% and
 * 18%, but asserted per request so an unexpected rate cannot slip through: a
 * document whose subtotal silently differs from our own record is the failure
 * this whole feature exists to avoid.
 */
export function assertGrossRoundTrip(netShekels, grossShekels, vatRate) {
  if (!Number.isFinite(vatRate) || vatRate < 0) return { ok: false, derivedNet: null };
  const derivedNet = r2(grossShekels / (1 + vatRate / 100));
  return { ok: Math.abs(derivedNet - r2(netShekels)) < 0.005, derivedNet };
}
const cap = (s) => {
  const t = String(s ?? "").trim();
  return t.length <= NAME_MAX ? t : `${t.slice(0, NAME_MAX - 1)}…`;
};

/**
 * One credit line, as Finbot's ItemDto.
 *
 * A RETURN keeps its quantity and its unit price: the document then reads like
 * the sale it reverses, which is what makes it checkable against the original.
 *
 * A PRICE ADJUSTMENT cannot: its quantity is zero and `buildItems` would drop
 * it. It becomes one unit priced at the credit, with a name that says what it
 * is — including the two prices, so the document explains itself without this
 * system.
 */
export function creditItemFor(line) {
  if (!line) return null;

  if (line.kind === CREDIT_KIND.RETURN) {
    const amount = Number(line.quantity) || 0;
    if (amount <= 0) return null;
    // Net, positive. The document type is what makes it a credit; the prices on
    // a credit document are not negated.
    const net = Math.abs(Number(line.total) || 0);
    return {
      name: cap(line.name),
      amount,
      // Back out the per-unit net from the line's own total so the item total
      // matches our figure exactly, discount included, rather than being
      // recomputed from a unit price the discount was applied to elsewhere.
      price: r2(net / amount),
    };
  }

  if (line.kind === CREDIT_KIND.PRICE) {
    const net = Math.abs(Number(line.total) || 0);
    if (net <= 0) return null;
    const from = Number(line.original_unit_price);
    const to = Number(line.corrected_unit_price);
    const detail = Number.isFinite(from) && Number.isFinite(to)
      ? ` (הפרש מחיר ${r2(from)}→${r2(to)} × ${line.priced_quantity})`
      : " (הפרש מחיר)";
    return { name: cap(`${line.name}${detail}`), amount: 1, price: r2(net) };
  }

  return null;
}

/**
 * The whole request body for `supabase.functions.invoke("finbot-invoice", …)`.
 *
 * @param {object} input
 * @param {object} input.invoice   the ORIGINAL invoice, read only
 * @param {object} input.credit    a result from buildPartialCredit
 * @param {string} [input.reason]
 * @param {string} [input.date]    ISO date; defaults to today
 * @returns {{
 *   ok: boolean, body: object|null,
 *   itemsNet: number, creditGross: number, creditNet: number,
 *   blockers: Array<{code, message}>, uncertainties: Array<{code, message}>
 * }}
 */
export function buildFinbotCreditRequest({ invoice, credit, reason = null, date = null } = {}) {
  const blockers = [];
  const uncertainties = [];

  const serial = String(invoice?.finbot_serial ?? "").trim();
  if (!serial) {
    blockers.push({
      code: "no_finbot_serial",
      message: "לחשבונית המקורית אין מזהה מסמך פנימי בפינבוט — בלעדיו לא ניתן לקשר את הזיכוי למסמך המקורי",
    });
  }
  if (!credit?.ok) {
    blockers.push({ code: "credit_invalid", message: "בחירת הזיכוי אינה תקינה" });
  }

  const items = (credit?.lines || []).map(creditItemFor).filter(Boolean);
  if (credit?.ok && items.length !== (credit?.lines || []).length) {
    // Should be unreachable: every kind has a representation above. Reported
    // rather than silently sending fewer lines than were selected.
    blockers.push({
      code: "line_not_representable",
      message: "שורת זיכוי שלא ניתן לייצג במסמך פינבוט — ההפקה נחסמה",
    });
  }

  // What the provider will compute from the lines, and what we think it is.
  const itemsNet = r2(items.reduce((s, i) => s + i.amount * i.price, 0));
  const creditNet = r2(credit?.net ?? 0);
  const creditGross = r2(credit?.gross ?? 0);

  // The document's subtotal will be derived from `credit`, so it must land
  // back on our net.
  if (credit?.ok) {
    const trip = assertGrossRoundTrip(creditNet, creditGross, credit.vatRate);
    if (!trip.ok) {
      blockers.push({
        code: "gross_does_not_round_trip",
        message: `הסכום הסופי (${creditGross.toFixed(2)} ₪) יגרור במסמך סכום לפני מע״מ של ${trip.derivedNet === null ? "—" : trip.derivedNet.toFixed(2)} ₪ במקום ${creditNet.toFixed(2)} ₪ — ההפקה נחסמה`,
      });
    }
  }

  if (credit?.ok && Math.abs(itemsNet - creditNet) > 0.005) {
    blockers.push({
      code: "items_do_not_sum",
      message: `סכום שורות המסמך (${itemsNet.toFixed(2)} ₪) אינו שווה לזיכוי שחושב (${creditNet.toFixed(2)} ₪)`,
    });
  }

  // ---- WHAT IS STILL NOT KNOWN -------------------------------------------
  // `credit` as gross, and the absence of `payments`, are settled by document
  // 50026. What that document does not show is how the provider renders the
  // LINE DETAIL when it overrides our item values. The money is unaffected —
  // the gross is our `credit` and the net round-trips to our figure — so this
  // is a presentation question, and it is the only one left.
  uncertainties.push({
    code: "line_detail_rendering",
    message: "מסמך 50026 מאשר שהסכום נקבע מ-credit ושהסכום לפני מע״מ נגזר ממנו. לא ידוע כיצד פינבוט מציג את פירוט השורות כשהוא דורס את ערכי הפריטים — האם הוא משמר את השורות שנשלחו, משנה את קנה המידה שלהן, או מאחד לשורה אחת. הכספים אינם מושפעים",
  });

  if (blockers.length > 0) {
    return { ok: false, body: null, itemsNet, creditNet, creditGross, blockers, uncertainties };
  }

  const body = {
    // The SYNTHETIC invoice. Its items are the credit lines, which is the only
    // seam the edge function offers. has_manual_total is deliberately absent so
    // no adjustment line is appended.
    invoice: {
      date: date || new Date().toISOString().split("T")[0],
      items: (credit.lines || []).map((line) => {
        const it = creditItemFor(line);
        // The shape buildItems reads: name, quantity, unit_price. NET prices.
        return { name: it.name, quantity: it.amount, unit_price: it.price };
      }),
      total: CREDIT_FIELD_BASIS === "gross" ? creditGross : creditNet,
      customer_name: invoice?.customer_name ?? "",
      customer_tax_id: invoice?.customer_tax_id ?? null,
      customer_address: invoice?.customer_address ?? null,
      vat_rate: credit.vatRate,
      ...(reason ? { notes: reason } : {}),
    },
    customer: {
      name: invoice?.customer_name ?? "",
      tax_id: invoice?.customer_tax_id ?? null,
      address: invoice?.customer_address ?? null,
    },
    // ONLY the three keys the edge function honours. Anything else here would
    // be dropped, and sending it would imply it does something.
    overrides: {
      type: FINBOT_CREDIT_TYPE,
      // THE ORIGINAL LINKAGE, UNCHANGED. Every partial credit points at the
      // same parent invoice document, which is what makes several of them
      // reconcilable against one sale. linkedDocument is a single string, so a
      // credit can never span two invoices.
      linkedDocument: serial,
      credit: CREDIT_FIELD_BASIS === "gross" ? creditGross : creditNet,
    },
  };

  return { ok: true, body, itemsNet, creditNet, creditGross, blockers: [], uncertainties };
}

/** A readable dry-run of what would be posted, for the preview panel. */
export function describeFinbotCreditRequest(req) {
  if (!req?.body) return null;
  const { invoice, overrides } = req.body;
  return {
    endpoint: "supabase.functions.invoke(\"finbot-invoice\")",
    type: overrides.type,
    linkedDocument: overrides.linkedDocument,
    credit: overrides.credit,
    creditBasis: CREDIT_FIELD_BASIS,
    vatType: true,
    itemCount: invoice.items.length,
    items: invoice.items.map(i => ({
      name: i.name, amount: i.quantity, price: i.unit_price,
      lineNet: Math.round(i.quantity * i.unit_price * 100) / 100,
    })),
    itemsNet: req.itemsNet,
    creditNet: req.creditNet,
    creditGross: req.creditGross,
    paymentsSent: false,
  };
}
