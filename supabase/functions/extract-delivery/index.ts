/**
 * Supabase Edge Function: extract-delivery
 *
 * Reads a supplier delivery note or invoice with Gemini and returns the
 * supplier and the product lines. This file is the deployed source, kept in the
 * repository so the working configuration is no longer only in the Dashboard.
 *
 * SCOPE: this function extracts. It decides nothing about products, matching,
 * SKUs, inventory or pricing — the CRM's existing review screen owns all of
 * that, and every line returned here is handed to it untouched.
 *
 * Deploy: Supabase Dashboard → Edge Functions → extract-delivery → paste
 *
 * REQUEST
 *   { pages: [{ base64, mimeType }, ...] }   one logical document, in order
 *   { base64, mimeType }                     legacy single page, still accepted
 *
 * RESPONSE (unchanged contract)
 *   { ok: true, supplier: { name, tax_id }, items: [...],
 *     document_type, document_date, document_number,
 *     amount_net, vat_amount, amount_gross }
 *
 * A LINE IS NEVER LOST
 *   Every line Gemini returns is returned here, in order. Nothing is merged,
 *   deduplicated or dropped — two rows for the same product stay two rows, and
 *   the user decides what to do with them in the review screen.
 *
 *   Truncated output is a FAILURE, not a partial success. Reconstructing a cut
 *   JSON array and returning ok:true silently hid missing products, so it now
 *   returns extraction_incomplete and the user is told to rescan.
 */

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent";

// Transient failures are worth retrying; anything else is not. Backoff is
// exponential so a busy model is given room rather than hammered.
const MAX_ATTEMPTS = 4;
const RETRY_STATUSES = [429, 500, 503];

// One logical document. More pages than this is a mistake, not a document.
const MAX_PAGES = 10;

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// The prompt.
//
// The rules below are not stylistic — each one exists because a real supplier
// document was read wrongly without it. In particular: the model is forbidden
// from "fixing" a quantity or a line total to make the arithmetic work, and
// forbidden from merging two rows that happen to look alike. Those two rules
// are what keep a legitimate product from vanishing.
// ---------------------------------------------------------------------------
const BASE_PROMPT = `
אתה עוזר שמחלץ נתונים מתעודות משלוח וחשבוניות ספק בעברית.
החזר אך ורק JSON תקין (בלי טקסט נוסף, בלי סימוני קוד) במבנה הבא:
{
  "supplier": { "name": "שם הספק או null", "tax_id": "ח.פ / עוסק מורשה של הספק, ספרות בלבד, או null" },
  "items": [
    {
      "sku": "מק\\"ט / קוד מוצר כפי שמופיע במסמך, או null",
      "product_name": "שם המוצר",
      "quantity": מספר או null,
      "unit_price": מספר או null,
      "total": מספר או null,
      "confidence": "high או low"
    }
  ],
  "document_type": "tax_invoice|invoice|receipt|delivery_note|unknown",
  "document_date": "YYYY-MM-DD או null",
  "document_number": "מספר המסמך או null",
  "amount_net": מספר או null,
  "vat_amount": מספר או null,
  "amount_gross": מספר או null
}

כללים לשורות המוצרים:
- **חלץ כל שורת מוצר במסמך.** אל תדלג על שורה, גם אם היא נראית דומה לשורה אחרת.
- **אסור לאחד שורות.** אם אותו מוצר מופיע בשתי שורות נפרדות — החזר שתי שורות נפרדות. אותו מק"ט אינו סיבה לאחד. אותו שם מוצר אינו סיבה לאחד.
- **כמות — קריטי:** הכמות היא נתון עובדתי שכתוב במסמך. **העתק אותה בדיוק כפי שהיא מופיעה. לעולם אל תשנה, אל תחשב ואל תגזור אותה משדה אחר.** גם אם הכמות לא מסתדרת עם המחיר והסה"כ — השאר אותה כפי שכתוב.
- **שמות מוצרים — קריטי:** העתק את שם המוצר **אות אות בדיוק כפי שכתוב**. אל תנחש מילה דומה, אל תשלים מילה מהקשר, ואל תתקן שגיאות כתיב. קרא כל אות בנפרד לפני שאתה כותב את המילה.
- **אזהרה — מילים שנקראות דומה אך שונות לחלוטין:** "מסננת" אינה "מכונת". "דלי" אינו "דל". "ספריי" אינו "ספרי". אם מילה מטושטשת — סמן confidence="low" לאותה שורה, אבל כתוב את מה שאתה רואה בפועל ולא ניחוש.
- **מק"ט:** חפש עמודה בשם "מק\\"ט", "קוד", "קטלוגי", "פריט" או דומה. החזר בדיוק כפי שמופיע (כולל אותיות ומקפים). אם אין מק"ט — החזר null. **אל תמציא מק"ט, ואל תשתמש במספר השורה הרץ (1,2,3...) כמק"ט.**
- **הנחות — קריטי:** במסמכים רבים יש שתי עמודות מחיר: מחיר מחירון (לפני הנחה) ומחיר בפועל (אחרי הנחה), ולעיתים גם עמודת "הנחה" או "% הנחה". **תמיד החזר ב-unit_price את המחיר ליחידה אחרי ההנחה — לעולם לא את מחיר המחירון.**
- **total הוא תמיד הסכום הסופי בפועל של השורה, אחרי הנחה**, כפי שמופיע במסמך.
- **אימות — רק על המחיר:** unit_price אמור לקיים unit_price × quantity = total. בצע את הכפל ובדוק. אם התוצאה לא תואמת — **תקן אך ורק את unit_price** לפי unit_price = total ÷ quantity. **אסור בהחלט לשנות את quantity או את total כדי שהמשוואה תסתדר.** אם משהו עדיין לא מסתדר — סמן confidence="low".
- confidence="low" עבור כל שורה שאתה לא בטוח בה.

כללים לזיהוי הספק:
- supplier.tax_id הוא המזהה של **הספק בלבד** — החברה שהוציאה את המסמך.
  1. מצא את **שם החברה הראשי** בראש המסמך (לרוב מודפס גדול, עם לוגו).
  2. חפש **ח.פ / ע.מ / עוסק מורשה** שמופיע ליד או מתחת לשם הזה.
  3. **התעלם לחלוטין** ממספר שמופיע ליד "לכבוד", "לקוח", "מס' לקוח" או "נמען".
  4. אם יש ספק מי הספק ומי הלקוח — **החזר null**. עדיף null מאשר מספר שגוי.
  ספרות בלבד, 8 או 9 ספרות.

כללים לשדות המסמך:
- כל ששת שדות המסמך אופציונליים. אם הערך אינו מופיע בבירור — החזר null.
- אסור להמציא ערך, ואסור לחשב סכום חסר כדי להשלים את האובייקט.
- document_type חייב להיות אחד מ: tax_invoice, invoice, receipt, delivery_note, unknown. אם אינך בטוח — unknown.
- document_date בפורמט YYYY-MM-DD רק אם התאריך ברור, אחרת null.
- amount_net = לפני מע"מ, vat_amount = המע"מ, amount_gross = כולל מע"מ. החזר סכומים רק אם הם כתובים במסמך.

מספרים ללא סימן ₪ ובלי פסיקים (לדוגמה 1234.5). החזר אך ורק את ה-JSON.
`.trim();

// Added only when more than one page is supplied.
const MULTIPAGE_PREAMBLE = `
**חשוב — מסמך מרובה עמודים:** כל העמודים המצורפים שייכים ל**מסמך אחד בלבד**, והם מסודרים לפי הסדר.
- אל תתייחס לכל עמוד כאל מסמך נפרד.
- שדות הכותרת (שם הספק, ח.פ, תאריך, מספר מסמך) מופיעים בדרך כלל בעמוד הראשון — קח אותם משם.
- סכום הסה"כ מופיע לעיתים קרובות רק בעמוד האחרון — קח אותו משם.
- אסוף את **כל שורות המוצרים מכל העמודים** לרשימת items אחת, לפי סדר העמודים.
- **אם אותו מוצר מופיע בשתי שורות שונות — השאר את שתיהן, אל תאחד ואל תמחק.** גם אם הן בעמודים שונים.
- אל תשמיט שורה בטענה שהיא כבר הופיעה בעמוד אחר.
`.trim();

function buildPrompt(pageCount: number): string {
  return pageCount > 1 ? `${MULTIPAGE_PREAMBLE}\n\n${BASE_PROMPT}` : BASE_PROMPT;
}

async function callGemini(
  apiKey: string,
  prompt: string,
  parts: { mimeType: string; base64: string }[],
): Promise<Response> {
  const url = `${GEMINI_URL}?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{
      parts: [
        { text: prompt },
        ...parts.map((p) => ({
          inline_data: { mime_type: p.mimeType || "image/jpeg", data: p.base64 },
        })),
      ],
    }],
    generationConfig: { temperature: 0, maxOutputTokens: 8192 },
  });

  let res: Response | null = null;
  let lastStatus = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (res.ok) return res;

    lastStatus = res.status;
    if (!RETRY_STATUSES.includes(res.status) || attempt === MAX_ATTEMPTS) return res;

    // 1s, 2s, 4s
    await sleep(1000 * Math.pow(2, attempt - 1));
  }

  return res ?? new Response(null, { status: lastStatus || 500 });
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

  let body: { base64?: string; mimeType?: string; pages?: { base64?: string; mimeType?: string }[] };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  // One logical document. A single page is a list of length one, so the old
  // single-file shape is a special case rather than a separate path.
  let pages: { base64: string; mimeType: string }[];
  if (Array.isArray(body?.pages)) {
    pages = body.pages
      .filter((p) => p && typeof p.base64 === "string" && p.base64.length > 0)
      .map((p) => ({ base64: p.base64!, mimeType: p.mimeType || "image/jpeg" }));
  } else if (body?.base64) {
    pages = [{ base64: body.base64, mimeType: body.mimeType || "image/jpeg" }];
  } else {
    pages = [];
  }

  if (pages.length === 0) {
    return json({ ok: false, error: "base64 and mimeType are required" }, 400);
  }
  if (pages.length > MAX_PAGES) {
    return json({ ok: false, error: "too_many_pages", max_pages: MAX_PAGES }, 400);
  }

  const resp = await callGemini(apiKey, buildPrompt(pages.length), pages);

  if (!resp.ok) {
    const errPayload = await resp.json().catch(() => ({}));
    const msg = (errPayload as any)?.error?.message || `Gemini API ${resp.status}`;
    return json({ ok: false, error: msg });
  }

  const data = await resp.json();
  const candidate = data?.candidates?.[0];

  if (!candidate) {
    const blockReason = data?.promptFeedback?.blockReason;
    return json({ ok: false, error: `no_candidates:${blockReason ?? "unknown"}` });
  }

  const rawText = candidate?.content?.parts?.[0]?.text ?? "";
  const finishReason = candidate?.finishReason;

  if (!rawText) {
    return json({ ok: false, error: `empty_response:${finishReason ?? "unknown"}` });
  }

  // A cut-off response is INCOMPLETE, never a partial success. Salvaging the
  // lines that happened to fit returned an invoice that looked fine but was
  // missing products, with nothing to tell the user.
  if (finishReason === "MAX_TOKENS") {
    return json({ ok: false, error: "extraction_incomplete" });
  }

  const text = String(rawText).replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Trailing prose around a valid object is common; a truncated object is
    // not, and it is already excluded above.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return json({ ok: false, error: "לא ניתן לחלץ נתונים מהמסמך" });
    }
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return json({ ok: false, error: "שגיאה בפענוח תשובת ה-AI" });
    }
  }

  if (!parsed || !Array.isArray(parsed.items)) {
    return json({ ok: false, error: "מבנה JSON לא צפוי" });
  }

  // The supplier tax id is validated, never invented: 8 or 9 digits or null.
  // The CRM uses it only to strengthen its existing mismatch warning.
  let supplier = parsed.supplier ?? null;
  if (supplier && typeof supplier === "object") {
    const rawTax = (supplier as any).tax_id;
    const digits = rawTax == null ? "" : String(rawTax).replace(/\D/g, "");
    (supplier as any).tax_id =
      digits.length === 8 || digits.length === 9 ? digits : null;
  }

  // Lines pass through one-to-one, in order. No merge, no dedupe, no filter.
  return json({
    ok: true,
    supplier,
    items: parsed.items,
    document_type: parsed.document_type ?? null,
    document_date: parsed.document_date ?? null,
    document_number: parsed.document_number ?? null,
    amount_net: parsed.amount_net ?? null,
    vat_amount: parsed.vat_amount ?? null,
    amount_gross: parsed.amount_gross ?? null,
  });
});
