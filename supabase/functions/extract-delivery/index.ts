/**
 * Supabase Edge Function: extract-delivery
 *
 * Reads a supplier delivery note or invoice with Gemini and returns the
 * supplier and the product lines. This file is the deployed source, kept in the
 * repository so the working configuration is no longer only in the Dashboard.
 *
 * Deploy: Supabase Dashboard → Edge Functions → extract-delivery → paste
 *
 * The document-level financial fields (document_type, document_date,
 * document_number, amount_net, vat_amount, amount_gross) are ADDITIVE and
 * optional. The `supplier` and `items` contract is unchanged, and a caller that
 * ignores the new fields behaves exactly as before.
 */

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent";

const MAX_RETRIES = 3;
const RETRY_WAIT_MS = 5000;

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

// The six document-level fields are requested AFTER "items" on purpose. The
// MAX_TOKENS recovery path below finds the item array by the first "[", so
// everything preceding it must stay exactly as it was. Placing the new fields
// last also means that when a long document runs into the token ceiling, it is
// the optional metadata that is lost — never the product lines.
const PROMPT = `זוהי תעודת משלוח או חשבונית ספק. חלץ את פרטי הספק ואת כל פריטי המוצרים.
החזר תשובה כ-JSON בלבד. אין להוסיף \`\`\`json או \`\`\` או כל טקסט אחר. רק JSON טהור.
פורמט נדרש:
{"supplier":{"name":"שם הספק או null","tax_id":"ח.פ או עוסק מורשה או null"},"items":[{"product_name":"שם המוצר","sku":"מק\"ט או null","quantity":1,"unit_price":0,"total":0}],"document_type":"tax_invoice|invoice|receipt|delivery_note|unknown","document_date":"YYYY-MM-DD או null","document_number":"מספר המסמך או null","amount_net":0,"vat_amount":0,"amount_gross":0}
אם שדה חסר השתמש ב-null.

כללים לשדות המסמך (ששת השדות האחרונים):
- כל ששת השדות אופציונליים. אם הערך אינו מופיע במסמך בבירור — החזר null.
- אסור להמציא ערך. אסור לחשב או לנחש סכום חסר רק כדי להשלים את האובייקט.
- document_type חייב להיות אחד מ: tax_invoice, invoice, receipt, delivery_note, unknown. אם אינך בטוח — unknown.
- document_date בפורמט YYYY-MM-DD רק אם התאריך ברור, אחרת null.
- amount_net = הסכום לפני מע״מ.
- vat_amount = סכום המע״מ.
- amount_gross = הסכום הסופי כולל מע״מ.
- החזר סכומים רק אם הם כתובים במסמך.`;

async function callGemini(apiKey: string, base64: string, mimeType: string): Promise<Response> {
  const url = `${GEMINI_URL}?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: PROMPT },
      ],
    }],
    generationConfig: { temperature: 0, maxOutputTokens: 8192 },
  });
  return await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return json({ ok: false, error: "GEMINI_API_KEY not configured" }, 500);
  }

  let body: { base64?: string; mimeType?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const base64 = body?.base64;
  const mimeType = body?.mimeType;
  if (!base64 || !mimeType) {
    return json({ ok: false, error: "base64 and mimeType are required" }, 400);
  }

  let resp = await callGemini(apiKey, base64, mimeType);
  let attempt = 0;
  while (resp.status === 503 && attempt < MAX_RETRIES) {
    attempt++;
    await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
    resp = await callGemini(apiKey, base64, mimeType);
  }

  if (!resp.ok) {
    const errPayload = await resp.json().catch(() => ({}));
    const msg = errPayload?.error?.message || `Gemini API ${resp.status}`;
    return json({ ok: false, error: msg });
  }

  const data = await resp.json();
  const candidate = data?.candidates?.[0];
  const rawText = candidate?.content?.parts?.[0]?.text ?? "";
  const finishReason = candidate?.finishReason;

  const text = String(rawText).replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  const objMatch = text.match(/\{[\s\S]*\}/);
  if (!objMatch) {
    return json({ ok: false, error: "לא ניתן לחלץ נתונים מהמסמך" });
  }

  try {
    const parsed = JSON.parse(objMatch[0]);
    if (parsed && Array.isArray(parsed.items)) {
      return json({
        ok: true,
        supplier: parsed.supplier ?? null,
        items: parsed.items,
        // Additive, optional. Absent or unreadable values stay null.
        document_type: parsed.document_type ?? null,
        document_date: parsed.document_date ?? null,
        document_number: parsed.document_number ?? null,
        amount_net: parsed.amount_net ?? null,
        vat_amount: parsed.vat_amount ?? null,
        amount_gross: parsed.amount_gross ?? null,
      });
    }
    return json({ ok: false, error: "מבנה JSON לא צפוי" });
  } catch {
    if (finishReason === "MAX_TOKENS") {
      const arrMatch = objMatch[0].match(/\[[\s\S]*/);
      if (arrMatch) {
        const partial = arrMatch[0];
        const lastClose = partial.lastIndexOf("}");
        if (lastClose !== -1) {
          try {
            const recoveredItems = JSON.parse(partial.slice(0, lastClose + 1) + "]");
            return json({
              ok: true,
              supplier: null,
              items: recoveredItems,
            });
          } catch {
            // fall through
          }
        }
      }
    }
    return json({ ok: false, error: "שגיאה בפענוח תשובת ה-AI" });
  }
});
