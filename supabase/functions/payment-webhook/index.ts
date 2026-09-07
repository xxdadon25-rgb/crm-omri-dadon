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

const PAYMENT_TYPE_MAP: Record<string, string> = {
  "מזומן": "0",
  "העברה בנקאית": "1",
  "כרטיס אשראי": "2",
  "שיק": "3",
  "ביט": "8",
  "פייבוקס": "9",
  "אחר": "7",
};

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

  const priceBeforeVat = Math.round((amount / VAT_RATE) * 100) / 100;

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

  const finbotPaymentType = PAYMENT_TYPE_MAP[body.payment_method] ?? "11";

  // A check receipt needs the drawing bank, branch, account and check number —
  // the same four values Finbot's own UI demands when CHECK is selected.
  // Sending only { type, sum, date } is why every check payment was recorded
  // but never produced a receipt, while cash and bank transfer succeeded.
  //
  // Finbot's API documents all four as NUMBERS, and it rejects a document whose
  // field type is wrong. Sending them as strings is why a check payment with
  // complete, valid details still produced no receipt.
  //
  // The stored values stay TEXT in public.payments and the input stays a text
  // field, so the operator's exact entry — leading zeros included — is
  // preserved in our own record. Only the outbound payload is converted, where
  // a JSON number cannot carry a leading zero by definition.
  const isCheck = body.payment_method === "שיק";

  // Digits only. This gate is what makes Number() safe: without it "" and "  "
  // become 0, "1e5" becomes 100000, "12.5" stays fractional, and a non-numeric
  // entry becomes NaN — which JSON.stringify serialises as null, so Finbot
  // would receive an empty field and fail exactly as it does today.
  // parseInt is deliberately NOT used: it would accept "12abc" as 12.
  const toFinbotNumber = (raw: unknown): number | null => {
    const s = String(raw ?? "").trim();
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : null;
  };

  let checkFields: Record<string, number | string> | null = null;
  if (isCheck) {
    const bankName = toFinbotNumber(body.bank_name);
    const bankBranch = toFinbotNumber(body.bank_branch);
    const bankAccount = toFinbotNumber(body.bank_account);
    const checkNumber = toFinbotNumber(body.check_number);

    // Refused before the Finbot call rather than after, and with a generic
    // message: a provider error is never echoed to the caller.
    if (
      bankName === null || bankBranch === null ||
      bankAccount === null || checkNumber === null
    ) {
      return json({ ok: false, error: "Invalid check payment details" }, 400);
    }

    // checkNumber goes out as the trimmed STRING the operator entered, unlike
    // the three bank fields. It is still validated as digits above, so the
    // string is always numeric — only its wire type differs.
    checkFields = {
      bankName,
      bankBranch,
      bankAccount,
      checkNumber: String(body.check_number ?? "").trim(),
    };
  }

  payload.payments = [
    {
      type: finbotPaymentType,
      sum: amount,
      date: formatDate(body.payment_date),
      // Merged for a check only, so the object sent for every other method is
      // byte-identical to the one that works in production today.
      ...(checkFields ?? {}),
    },
  ];

  if (body.finbot_serial) {
    payload.linkedDocument = String(body.finbot_serial);
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
    return json({ ok: false, error: String(msg), status, finbotErrors: errArr });
  }

  const pdfUrl = extractPdfUrl(responseData?.data);
  const receiptNumber = extractDocNumber(responseData);

  return json({ ok: true, receiptNumber, pdfUrl });
});
