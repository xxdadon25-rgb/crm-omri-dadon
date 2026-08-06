/**
 * Supabase Edge Function: payment-webhook
 *
 * Creates a Finbot receipt (type 1) linked to the original invoice
 * when a payment is registered in the CRM.
 *
 * Deploy: Supabase Dashboard → Edge Functions → Deploy new function
 *   → name: payment-webhook
 *   → paste this file
 *   → Settings → Verify JWT = OFF
 *
 * Required secret: FINBOT_API_KEY (same as finbot-invoice)
 */

const FINBOT_URL = "https://api.finbotai.co.il/income";
const VAT_RATE = 1.18;

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

function formatDate(input: unknown): string {
  const d = input ? new Date(String(input)) : new Date();
  const use = Number.isNaN(d.getTime()) ? new Date() : d;
  const dd = String(use.getDate()).padStart(2, "0");
  const mm = String(use.getMonth() + 1).padStart(2, "0");
  const yyyy = use.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
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

function extractDocNumber(responseData: any): string | undefined {
  const data = responseData?.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const candidate = d.docNumber ?? d.number ?? d.doc_number ?? d.invoice_number ?? d.id;
    if (candidate != null) return String(candidate);
  }
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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const amount = Number(body.amount) || 0;
  if (amount <= 0) {
    return json({ ok: false, error: "Invalid payment amount" }, 400);
  }

  const priceBeforeVat = parseFloat((amount / VAT_RATE).toFixed(2));

  const invoiceNum = body.invoice_number || body.external_invoice_number || "";
  const itemName = `תשלום עבור חשבונית #${invoiceNum}`;

  const payload: Record<string, unknown> = {
    type: "1",
    date: formatDate(body.payment_date),
    language: "HE",
    currency: "ILS",
    vatType: true,
    rounding: false,
    customer: {
      name: String(body.customer_name || ""),
    },
    items: [
      {
        name: itemName,
        amount: 1,
        price: priceBeforeVat,
      },
    ],
  };

  if (body.external_invoice_number) {
    payload.linkedDocument = String(body.external_invoice_number);
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

  const status = responseData?.status;
  if (status !== 1) {
    const errArr = Array.isArray(responseData?.errors) ? responseData.errors : [];
    const firstErr = errArr.length ? String(errArr[0]) : undefined;
    const msg = responseData?.message || firstErr || `Finbot status ${status}`;
    return json({ ok: false, error: String(msg) });
  }

  const pdfUrl = extractPdfUrl(responseData?.data);
  const receiptNumber = extractDocNumber(responseData);

  return json({ ok: true, receiptNumber, pdfUrl });
});
