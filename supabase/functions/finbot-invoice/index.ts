/**
 * Supabase Edge Function: finbot-invoice
 *
 * Proxies invoice issuance to Finbot (https://api.finbotai.co.il/income).
 * The FINBOT_API_KEY lives ONLY in Supabase Secrets — it must never appear
 * on the client. verify_jwt should be DISABLED for this function (dashboard
 * toggle), same pattern as revach-proxy.
 *
 * Deploy: Supabase Dashboard → Edge Functions → Deploy new function
 *   → name: finbot-invoice
 *   → paste this file
 *   → Settings → Verify JWT = OFF
 *
 * Invoke:
 *   supabase.functions.invoke('finbot-invoice', { body: { invoice, customer } })
 */

const FINBOT_URL = "https://api.finbotai.co.il/income";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ISO YYYY-MM-DD (or other parseable form) → DD/MM/YYYY. Falls back to today.
function formatDate(input: unknown): string {
  const d = input ? new Date(String(input)) : new Date();
  const use = Number.isNaN(d.getTime()) ? new Date() : d;
  const dd = String(use.getDate()).padStart(2, "0");
  const mm = String(use.getMonth() + 1).padStart(2, "0");
  const yyyy = use.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function trimOrUndef(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

// Skip header/pseudo lines and lines with no quantity.
function buildItems(invoiceItems: any[]): Array<{ name: string; amount: number; price: number }> {
  if (!Array.isArray(invoiceItems)) return [];
  return invoiceItems
    .filter((i) => i && !i.is_header && Number(i.quantity) > 0)
    .map((i) => ({
      name: String(i.name ?? ""),
      amount: Number(i.quantity) || 0,
      price: Number(i.unit_price) || 0,
    }));
}

// ONE extra line that makes the issued document total match the saved order
// total, for orders carrying a manual total and only those.
//
// WHY A LINE AND NOT A FIELD
//   The payload carries net prices and `vatType: true`, so the provider computes
//   the document total itself from the lines. There is no "adjust the total"
//   field among the ones this integration is known to work with, and no way to
//   mark an amount VAT-exempt. A line is the only lever, which is also why the
//   adjustment is treated as taxable everywhere else in this feature.
//
// THE GATE — an explicit flag, never an inference
//   `has_manual_total` is set by the caller, which is the only party that can
//   see orders.total_override; this function only ever receives the invoice.
//
//   It is NOT inferred from the figures. An adjusted order satisfies
//   subtotal + adjustment + vat_amount = total, so the gap looks like a usable
//   signal, but a MONTHLY invoice rounds those three fields independently and a
//   quarter of ordinary ones carry a one-agora gap. Inference would have added
//   a spurious "התאמת סכום ₪0.01" line to them. A flag cannot be fooled that way.
//
//   Absent or false means no line, so every invoice without a manual total
//   produces the payload it produces today, defects and all. That is the whole
//   of the requirement to leave the general discount handling alone.
//
// THE AMOUNT — FIVE decimals, and that is the whole point
//   `lineNet` is the sum of the lines buildItems actually produced, not the
//   invoice's subtotal. Those differ whenever a line carries a discount,
//   because buildItems sends the list price. Working from `lineNet` is what
//   makes the document total land on the saved total even then.
//
//   WHY TWO DECIMALS COULD NOT WORK
//     The provider computes VAT on the net SUM and rounds it to the agora, so
//     the document total is `net + round(net x rate)`. With a two-decimal net
//     that total SKIPS values: at 18% it steps 1.98, 1.99, 2.01, because the
//     rounded VAT jumps. 15.3% of two-decimal targets — including 2.00, 10.00
//     and 100.00 — are simply unreachable. Invoice 10071 issued at 1.99 for a
//     2.00 order for exactly this reason; it was not a calculation error.
//
//   WHY FIVE DECIMALS DO
//     items.price is documented as accepting decimals. Carrying the adjustment
//     at five places lets the net sum be `total / (1 + rate)` to a precision
//     the rounding cannot disturb, and the total then lands on the target for
//     EVERY two-decimal target. It holds under both rounding models the real
//     invoices leave open — `net + round(net x rate)` and `round(net x (1+rate))`
//     — so it does not depend on knowing which one the provider uses.
//
//     FIVE rather than four: at 18% four decimals are enough, but at 17% — the
//     rate several code paths still default to — 1710 targets in every 200000
//     land an agora out under the first model, because rounding the net to four
//     places pushes the VAT across a boundary. Five decimals is exact at both
//     rates across the whole range; four is not.
//
//     Only this one line carries the extra precision. Product prices,
//     quantities and discounts are passed through untouched.
//
//   ARITHMETIC IN INTEGERS
//     Agorot and hundred-thousandths, not shekels. `total / 1.18` in floating
//     point produces values like 1.6949152542372882, and the error has nowhere
//     to go but the invoice. Scaling to integers first means one division of
//     exact integers and one rounding, with no accumulation.
function buildAdjustmentItem(
  invoice: any,
  items: Array<{ amount: number; price: number }>,
): { name: string; amount: number; price: number } | null {
  // The gate. No manual total, no line, nothing changed.
  if (invoice?.has_manual_total !== true) return null;

  const total = Number(invoice?.total);
  const vatRate = Number(invoice?.vat_rate);
  if (!Number.isFinite(total) || !Number.isFinite(vatRate)) return null;
  if (vatRate <= -100) return null;

  // Hundred-thousandths of a shekel: five decimal places, as integers.
  const SCALE = 100000;

  // The target gross, in agorot.
  const totalAgorot = Math.round(total * 100);
  // The net it implies, in hundred-thousandths:
  //   net = total / (1 + rate/100) = totalAgorot / (100 + rate)   [shekels]
  // scaled by SCALE, this is one integer division and one rounding.
  const targetNetScaled = Math.round((totalAgorot * SCALE) / (100 + vatRate));
  // What the product lines already contribute, in the same unit.
  const lineNetScaled = items.reduce(
    (sum, i) => sum + i.amount * Math.round(i.price * SCALE),
    0,
  );

  const priceScaled = targetNetScaled - lineNetScaled;

  // Dropped ONLY when there is exactly nothing to correct.
  //
  // This test used to be `< 500`, half an agora at this scale, on the reasoning
  // that a smaller adjustment could not matter. It can. 500 hundred-thousandths
  // of NET is up to 0.0059 of GROSS, which is enough to straddle an agora
  // boundary: a 165.17 order on lines totalling 139.97 net needs +0.00458, and
  // discarding it issued the document at 165.16. The threshold was expressed in
  // the wrong currency — net — while the thing it protected was the gross.
  //
  // At exactly zero the product lines already sum to the target net, so the
  // document lands on the target with no line at all. Any other value is sent,
  // however small, because the only figure small enough to be safely discarded
  // is none.
  if (priceScaled === 0) return null;

  return {
    name: "התאמת סכום",
    amount: 1,
    price: priceScaled / SCALE,
  };
}

// The Finbot spec says `data` is the "PDF link". Allow both shapes: a bare
// string, or an object where the link is under one of several field names.
function extractFinbotSerial(pdfUrl: string | undefined): string | undefined {
  if (!pdfUrl) return undefined;
  const m = pdfUrl.match(/auth\/(\d{4})/);
  return m ? m[1] : undefined;
}

function extractPdfUrl(data: unknown): string | undefined {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const candidate = d.pdf_url ?? d.pdfUrl ?? d.link ?? d.url ?? d.pdf;
    if (typeof candidate === "string") return candidate;
  }
  return undefined;
}

function extractInvoiceNumber(responseData: any): string | undefined {
  const data = responseData?.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const candidate =
      d.docNumber ?? d.number ?? d.doc_number ?? d.invoice_number ?? d.id;
    if (candidate != null) return String(candidate);
  }
  // Finbot embeds the doc number in the Hebrew success message when `data`
  // is just a URL string, e.g. "המסמך נוצר בהצלחה, מספר המסמך: 10001".
  const message = responseData?.message;
  if (typeof message === "string") {
    const m = message.match(/מספר המסמך[:\s]+(\d+)/);
    if (m) return m[1];
  }
  return undefined;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const secret = Deno.env.get("FINBOT_API_KEY");
  if (!secret) {
    return json({ ok: false, error: "FINBOT_API_KEY not configured" }, 500);
  }

  let body: { invoice?: any; customer?: any; overrides?: any };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const invoice = body?.invoice ?? {};
  const customer = body?.customer ?? {};

  const customerEmail = trimOrUndef(customer.email);

  const finbotCustomer: Record<string, string> = {
    name: String(customer.name ?? invoice.customer_name ?? ""),
  };
  const email = customerEmail;
  const phone = trimOrUndef(customer.phone ?? customer.mobile);
  const address = trimOrUndef(customer.address ?? invoice.customer_address);
  const tax = trimOrUndef(customer.tax_id ?? invoice.customer_tax_id);
  if (email) finbotCustomer.email = email;
  if (phone) finbotCustomer.phone = phone;
  if (address) finbotCustomer.address = address;
  if (tax) finbotCustomer.tax = tax;

  const baseItems = buildItems(invoice.items);
  const adjustmentItem = buildAdjustmentItem(invoice, baseItems);
  const finbotItems = adjustmentItem ? [...baseItems, adjustmentItem] : baseItems;

  const payload: Record<string, unknown> = {
    type: "0",
    date: formatDate(invoice.date),
    language: "HE",
    currency: "ILS",
    vatType: true,
    rounding: false,
    customer: finbotCustomer,
    items: finbotItems,
  };
  if (customerEmail) {
    payload.email = { to: customerEmail };
  }

  // Client overrides — whitelist only: { type, linkedDocument, credit }.
  // Used by the credit-note flow to switch document type and attach the
  // parent invoice number + refund amount. Any other key is ignored.
  const overrides = body?.overrides;
  if (overrides && typeof overrides === "object") {
    if (overrides.type != null) payload.type = overrides.type;
    if (overrides.linkedDocument != null) payload.linkedDocument = overrides.linkedDocument;
    if (overrides.credit != null) payload.credit = overrides.credit;
  }

  let res: Response;
  try {
    res = await fetch(FINBOT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        secret,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return json({ ok: false, error: `Finbot request failed: ${(err as Error).message}` });
  }

  const rawText = await res.text();

  if (!res.ok) {
    return json({ ok: false, error: `Finbot HTTP ${res.status}: ${rawText.slice(0, 500)}` });
  }

  let responseData: any;
  try {
    responseData = JSON.parse(rawText);
  } catch {
    return json({ ok: false, error: "Finbot returned invalid JSON" });
  }

  console.log("FINBOT FULL RESPONSE:", JSON.stringify(responseData));

  const status = responseData?.status;
  if (status !== 1) {
    const errArr = Array.isArray(responseData?.errors) ? responseData.errors : [];
    const firstErr = errArr.length ? String(errArr[0]) : undefined;
    const msg = responseData?.message || firstErr || `Finbot status ${status}`;
    return json({ ok: false, error: String(msg) });
  }

  const pdfUrl = extractPdfUrl(responseData?.data);
  const invoiceNumber = extractInvoiceNumber(responseData);
  const finbotSerial = extractFinbotSerial(pdfUrl);

  return json({ ok: true, invoiceNumber, pdfUrl, finbotSerial });
});
