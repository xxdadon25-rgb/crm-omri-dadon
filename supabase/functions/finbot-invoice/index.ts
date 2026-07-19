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

// The Finbot spec says `data` is the "PDF link". Allow both shapes: a bare
// string, or an object where the link is under one of several field names.
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

  const payload: Record<string, unknown> = {
    type: "0",
    date: formatDate(invoice.date),
    language: "HE",
    currency: "ILS",
    vatType: true,
    rounding: false,
    customer: finbotCustomer,
    items: buildItems(invoice.items),
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

  console.log("Full Finbot response:", JSON.stringify(responseData));

  const status = responseData?.status;
  if (status !== 1) {
    const errArr = Array.isArray(responseData?.errors) ? responseData.errors : [];
    const firstErr = errArr.length ? String(errArr[0]) : undefined;
    const msg = responseData?.message || firstErr || `Finbot status ${status}`;
    return json({ ok: false, error: String(msg) });
  }

  const pdfUrl = extractPdfUrl(responseData?.data);
  const invoiceNumber = extractInvoiceNumber(responseData);

  console.log("extracted invoiceNumber:", invoiceNumber, "pdfUrl:", pdfUrl);
  return json({ ok: true, invoiceNumber, pdfUrl });
});
