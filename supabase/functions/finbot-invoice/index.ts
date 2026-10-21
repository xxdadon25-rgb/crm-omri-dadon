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
// THE AMOUNT — measured against what is REALLY going out
//   `lineNet` is the sum of the lines buildItems actually produced, not the
//   invoice's subtotal. Those differ whenever a line carries a discount,
//   because buildItems sends the list price. Working from `lineNet` is what
//   makes the document total land on the saved total EVEN THEN, which is
//   requirement 5.
//
//   The consequence, accepted deliberately: on a discounted order this one line
//   carries the agreed discount and the manual adjustment together. That is not
//   a distortion of the document — it shows list prices and a single total
//   discount, which is an ordinary way to present an invoice — but it does mean
//   the figure is not purely the manual adjustment.
//
//   `bestNet` is the closest two-decimal net to the saved total, which is the
//   best any payload can reach while the provider adds VAT to net lines: the
//   achievable totals step by 0.01 x (1 + rate), leaving at most half of that.
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

  const lineNet = items.reduce((sum, i) => sum + i.amount * i.price, 0);
  const bestNet = Math.round((total / (1 + vatRate / 100)) * 100) / 100;
  const price = Math.round((bestNet - lineNet) * 100) / 100;

  // Nothing left to correct once the outgoing lines are accounted for. Also the
  // guard that keeps a rounding artefact from becoming a zero-value line on a
  // tax document.
  if (Math.abs(price) < 0.005) return null;

  return {
    name: "התאמת סכום",
    amount: 1,
    price,
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
