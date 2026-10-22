/**
 * Supabase Edge Function: extract-supplier-quote
 *
 * Reads a supplier QUOTATION or INVOICE with Gemini and returns its lines, for
 * the supplier price-comparison window.
 *
 * RELATIONSHIP TO extract-delivery
 *   This is a deliberate COPY of that function, not a shared one and not a
 *   modification of it. The goods-receiving scanner must keep behaving exactly
 *   as it does today, and its prompt is tuned for delivery notes — where goods
 *   were RECEIVED and a discount is already folded into the unit price. A
 *   quotation needs the discount columns kept apart, the packaging columns
 *   read, and a validity date.
 *
 *   Everything that is not prompt or output shape is copied unchanged: the
 *   model, temperature 0, the 4-attempt backoff on 429/500/503, the JSON-fence
 *   stripping and brace-slice fallback, the tax-id digit validation, the
 *   MAX_TOKENS failure, and the one-to-one pass-through of lines.
 *
 *   If you improve a shared rule here, the same rule probably wants the same
 *   fix in extract-delivery. They are intentionally separate; they are not
 *   intentionally different.
 *
 * SCOPE: this function extracts. It decides nothing about products, matching,
 * SKUs, prices, inventory or VAT treatment. It writes to no table and touches
 * no storage. Every line it reads is handed to the review screen untouched.
 *
 * Deploy: Supabase Dashboard -> Edge Functions -> deploy a new function
 *   -> name it exactly: extract-supplier-quote
 *   -> Verify JWT: ON (the caller is signed-in CRM staff)
 *   -> secret: GEMINI_API_KEY (ALREADY present; read-only, shared with
 *      extract-delivery, which is not modified)
 *
 * REQUEST
 *   { pages: [{ base64, mimeType }, ...] }   one logical document, in order
 *   { base64, mimeType }                     single page, also accepted
 *
 * RESPONSE
 *   { ok: true,
 *     supplier: { name, tax_id },
 *     items: [{ line_no, page_from, sku, product_name, quantity, unit,
 *               pack_size, list_price, discount_percent, discount_amount,
 *               unit_price, total, confidence }],
 *     document_type, document_date, document_number, valid_until,
 *     amount_net, vat_amount, amount_gross,
 *     batches: [{ from_page, to_page, item_count }] }
 *
 * A LINE IS NEVER LOST
 *   Lines are returned in document order, one-to-one. Nothing is merged,
 *   deduplicated or dropped, and two rows for the same product stay two rows.
 *
 *   Truncated output is a FAILURE, never a partial success. Where the original
 *   returns extraction_incomplete and stops, this one first tries to make the
 *   job smaller: see ADAPTIVE BATCHING below. If a SINGLE page still truncates,
 *   that is reported as a failure rather than returning a short list.
 */

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent";

// Copied from extract-delivery: transient failures are worth retrying,
// anything else is not, and the backoff is exponential so a busy model is
// given room rather than hammered.
const MAX_ATTEMPTS = 4;
const RETRY_STATUSES = [429, 500, 503];

// One logical document. More pages than this is a mistake, not a document.
const MAX_PAGES = 10;

// ADAPTIVE BATCHING
//   maxOutputTokens is 8192. A JSON line carrying a Hebrew product name, a SKU,
//   packaging and three price fields costs roughly 60-80 output tokens, so a
//   single call tops out near a hundred lines — and a dense multi-page invoice
//   exceeds that easily.
//
//   So the document is read in batches of pages. If a batch comes back
//   truncated, the batch is SPLIT IN HALF and each half re-read, recursively,
//   down to one page. Only a single page that still truncates is a real
//   failure. This is what turns "too long, rescan it yourself" into "read it
//   properly", without ever accepting a short list.
const BATCH_PAGES = 4;

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
// The line-level rules are carried over from extract-delivery almost word for
// word, because each one exists because a real supplier document was read
// wrongly without it. Three are worth re-reading before touching anything:
// never merge two rows, never alter a quantity, and never invent a SKU.
//
// WHAT IS DIFFERENT FROM THE DELIVERY PROMPT
//   * list price, discount % and discount amount are their OWN fields. The
//     delivery prompt folds the discount into unit_price because receiving only
//     cares what was paid; a comparison has to show WHY one supplier is
//     cheaper, and a discount that may expire is not the same as a low price.
//     unit_price is still the price AFTER discount, so the delivery rule is
//     preserved rather than replaced.
//   * unit and pack_size are read from the document's own columns. Comparing
//     suppliers without them is meaningless: 10 shekels per bottle and 10 per
//     six-pack are not the same price.
//   * valid_until, because a quotation expires and an invoice does not.
//   * document_type accepts "quote".
// ---------------------------------------------------------------------------
const BASE_PROMPT = `
אתה עוזר שמחלץ נתונים מהצעות מחיר, מחירונים וחשבוניות של ספקים בעברית.
החזר אך ורק JSON תקין (בלי טקסט נוסף, בלי סימוני קוד) במבנה הבא:
{
  "supplier": { "name": "שם הספק או null", "tax_id": "ח.פ / עוסק מורשה של הספק, ספרות בלבד, או null" },
  "items": [
    {
      "sku": "מק\\"ט / קוד מוצר כפי שמופיע במסמך, או null",
      "product_name": "שם המוצר",
      "quantity": מספר או null,
      "unit": "יחידת המידה כפי שכתובה במסמך (ליטר, ק\\"ג, יחידה, מטר, ארגז...) או null",
      "pack_size": מספר היחידות או הכמות באריזה אחת, או null,
      "list_price": "מחיר מחירון ליחידה לפני הנחה, או null",
      "discount_percent": מספר או null,
      "discount_amount": מספר או null,
      "unit_price": מספר או null,
      "total": מספר או null,
      "confidence": "high או low"
    }
  ],
  "document_type": "quote|tax_invoice|invoice|receipt|delivery_note|unknown",
  "document_date": "YYYY-MM-DD או null",
  "valid_until": "YYYY-MM-DD או null",
  "document_number": "מספר המסמך או null",
  "amount_net": מספר או null,
  "vat_amount": מספר או null,
  "amount_gross": מספר או null
}

כללים לשורות המוצרים:
- **חלץ כל שורת מוצר במסמך.** אל תדלג על שורה, גם אם היא נראית דומה לשורה אחרת.
- **אסור לאחד שורות.** אם אותו מוצר מופיע בשתי שורות נפרדות — החזר שתי שורות נפרדות. אותו מק"ט אינו סיבה לאחד. אותו שם מוצר אינו סיבה לאחד. אריזה שונה היא מוצר שונה.
- **כמות — קריטי:** הכמות היא נתון עובדתי שכתוב במסמך. **העתק אותה בדיוק כפי שהיא מופיעה. לעולם אל תשנה, אל תחשב ואל תגזור אותה משדה אחר.** גם אם הכמות לא מסתדרת עם המחיר והסה"כ — השאר אותה כפי שכתוב.
- **שמות מוצרים — קריטי:** העתק את שם המוצר **אות אות בדיוק כפי שכתוב**. אל תנחש מילה דומה, אל תשלים מילה מהקשר, ואל תתקן שגיאות כתיב. קרא כל אות בנפרד לפני שאתה כותב את המילה.
- **אזהרה — מילים שנקראות דומה אך שונות לחלוטין:** "מסננת" אינה "מכונת". "דלי" אינו "דל". "ספריי" אינו "ספרי". אם מילה מטושטשת — סמן confidence="low" לאותה שורה, אבל כתוב את מה שאתה רואה בפועל ולא ניחוש.
- **מק"ט — קריטי:** חפש עמודה בשם "מק\\"ט", "קוד", "קטלוגי", "פריט", "ברקוד" או דומה. החזר **בדיוק כפי שמופיע, כמחרוזת**, כולל אותיות, מקפים, לוכסנים ו**אפסים מובילים** (למשל "000123" יישאר "000123"). אם אין מק"ט — החזר null. **אל תמציא מק"ט, ואל תשתמש במספר השורה הרץ (1,2,3...) כמק"ט.**
- **אריזה ויחידת מידה:** אם יש עמודת יחידה ("יח'", "ליטר", "ק\\"ג", "ארגז"...) — החזר אותה ב-unit כפי שכתובה. אם כתוב גודל אריזה (למשל "6x1.5 ליטר", "ארגז 12", "500 גרם") — החזר את המספר ב-pack_size ואת היחידה ב-unit. אם לא כתוב — החזר null בשני השדות. **אל תנחש גודל אריזה.**
- **הנחות — קריטי:** במסמכים רבים יש שתי עמודות מחיר: מחיר מחירון (לפני הנחה) ומחיר בפועל (אחרי הנחה), ולעיתים גם עמודת "הנחה" או "% הנחה".
  * ב-list_price החזר את מחיר המחירון **לפני** ההנחה, אם הוא מופיע.
  * ב-discount_percent / discount_amount החזר את ההנחה **רק אם היא כתובה במסמך**. אל תחשב הנחה שלא כתובה.
  * **ב-unit_price תמיד החזר את המחיר ליחידה אחרי ההנחה — לעולם לא את מחיר המחירון.**
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
- כל שדות המסמך אופציונליים. אם הערך אינו מופיע בבירור — החזר null.
- אסור להמציא ערך, ואסור לחשב סכום חסר כדי להשלים את האובייקט.
- document_type חייב להיות אחד מ: quote, tax_invoice, invoice, receipt, delivery_note, unknown. הצעת מחיר או מחירון -> quote. אם אינך בטוח — unknown.
- document_date ו-valid_until בפורמט YYYY-MM-DD רק אם התאריך ברור, אחרת null. valid_until הוא תוקף ההצעה ("בתוקף עד", "תוקף ההצעה") — אם לא כתוב, null.
- amount_net = לפני מע"מ, vat_amount = המע"מ, amount_gross = כולל מע"מ. **החזר סכומים רק אם הם כתובים במסמך** — הם משמשים לקביעה אם מחירי השורות כוללים מע"מ, ולכן סכום מומצא גורם לטעות של 18%.

מספרים ללא סימן ₪ ובלי פסיקים (לדוגמה 1234.5). מק"ט תמיד כמחרוזת. החזר אך ורק את ה-JSON.
`.trim();

// Added only when more than one page is in the batch. Copied from
// extract-delivery, with the page-range sentence added so the model is not
// asked for header fields that are in another batch.
const MULTIPAGE_PREAMBLE = `
**חשוב — מסמך מרובה עמודים:** כל העמודים המצורפים שייכים ל**מסמך אחד בלבד**, והם מסודרים לפי הסדר.
- אל תתייחס לכל עמוד כאל מסמך נפרד.
- שדות הכותרת (שם הספק, ח.פ, תאריך, מספר מסמך) מופיעים בדרך כלל בעמוד הראשון — קח אותם משם.
- סכום הסה"כ מופיע לעיתים קרובות רק בעמוד האחרון — קח אותו משם.
- אסוף את **כל שורות המוצרים מכל העמודים** לרשימת items אחת, לפי סדר העמודים.
- **אם אותו מוצר מופיע בשתי שורות שונות — השאר את שתיהן, אל תאחד ואל תמחק.** גם אם הן בעמודים שונים.
- אל תשמיט שורה בטענה שהיא כבר הופיעה בעמוד אחר.
`.trim();

// Added when the pages supplied are only PART of a longer document, so the
// model does not report a grand total that belongs to a page it cannot see.
const PARTIAL_PREAMBLE = `
**חשוב — קטע מתוך מסמך ארוך:** העמודים המצורפים הם **חלק** ממסמך גדול יותר.
- חלץ את **כל שורות המוצרים** שמופיעות בעמודים האלה בלבד.
- אם שדה כותרת או סכום סה"כ אינו מופיע בעמודים האלה — החזר null. **אל תשלים ואל תחשב אותו.**
`.trim();

function buildPrompt(pageCount: number, partial: boolean): string {
  const parts: string[] = [];
  if (partial) parts.push(PARTIAL_PREAMBLE);
  if (pageCount > 1) parts.push(MULTIPAGE_PREAMBLE);
  parts.push(BASE_PROMPT);
  return parts.join("\n\n");
}

// Copied unchanged from extract-delivery.
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

type Page = { base64: string; mimeType: string };
type BatchResult =
  | { ok: true; parsed: any }
  | { ok: false; error: string; truncated?: boolean };

/**
 * One Gemini call over one batch of pages. The parsing is copied from
 * extract-delivery, including the fence stripping and the brace slice for
 * trailing prose — and including the rule that MAX_TOKENS is a FAILURE.
 */
async function readBatch(
  apiKey: string,
  pages: Page[],
  partial: boolean,
): Promise<BatchResult> {
  const resp = await callGemini(apiKey, buildPrompt(pages.length, partial), pages);

  if (!resp.ok) {
    const errPayload = await resp.json().catch(() => ({}));
    const msg = (errPayload as any)?.error?.message || `Gemini API ${resp.status}`;
    return { ok: false, error: msg };
  }

  const data = await resp.json();
  const candidate = data?.candidates?.[0];
  if (!candidate) {
    const blockReason = data?.promptFeedback?.blockReason;
    return { ok: false, error: `no_candidates:${blockReason ?? "unknown"}` };
  }

  const rawText = candidate?.content?.parts?.[0]?.text ?? "";
  const finishReason = candidate?.finishReason;
  if (!rawText) {
    return { ok: false, error: `empty_response:${finishReason ?? "unknown"}` };
  }

  // Cut off mid-answer. Salvaging the lines that happened to fit returns a
  // document that looks fine and is missing products, so it is reported as
  // truncated and the caller splits the batch instead.
  if (finishReason === "MAX_TOKENS") {
    return { ok: false, error: "extraction_incomplete", truncated: true };
  }

  const text = String(rawText).replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return { ok: false, error: "לא ניתן לחלץ נתונים מהמסמך" };
    }
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return { ok: false, error: "שגיאה בפענוח תשובת ה-AI" };
    }
  }

  if (!parsed || !Array.isArray(parsed.items)) {
    return { ok: false, error: "מבנה JSON לא צפוי" };
  }
  return { ok: true, parsed };
}

type Collected = {
  items: any[];
  batches: { from_page: number; to_page: number; item_count: number }[];
  header: any | null;   // first successful batch
  footer: any | null;   // last successful batch
};

/**
 * Read `pages` (a slice starting at 1-based `offset`) and append to `out`.
 *
 * On truncation the range is halved and each half read separately; a single
 * page that still truncates propagates the failure. Recursion depth is bounded
 * by log2(MAX_PAGES), so at most four levels.
 *
 * Order is preserved because the halves are awaited in sequence, never in
 * parallel — a concurrent version would be faster and would scramble the line
 * order, which is the one thing that must not happen.
 */
async function readRange(
  apiKey: string,
  pages: Page[],
  offset: number,
  partial: boolean,
  out: Collected,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await readBatch(apiKey, pages, partial);

  if (!res.ok) {
    if (res.truncated && pages.length > 1) {
      const mid = Math.ceil(pages.length / 2);
      // Both halves are now part of a larger document by definition.
      const first = await readRange(apiKey, pages.slice(0, mid), offset, true, out);
      if (!first.ok) return first;
      return await readRange(apiKey, pages.slice(mid), offset + mid, true, out);
    }
    return { ok: false, error: res.error };
  }

  const parsed = res.parsed;
  const items = Array.isArray(parsed.items) ? parsed.items : [];

  // Lines are appended in order and tagged with the page range they came from,
  // so the review screen can show the user where to look. Nothing is merged
  // or deduplicated across batches: the same product on two pages stays two
  // lines, exactly as within one page.
  for (const item of items) {
    out.items.push({ ...item, page_from: offset });
  }
  out.batches.push({ from_page: offset, to_page: offset + pages.length - 1, item_count: items.length });

  // Header fields come from the earliest batch that reported them, totals from
  // the latest — mirroring how documents are actually laid out.
  if (out.header === null) out.header = parsed;
  out.footer = parsed;
  return { ok: true };
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

  // One logical document. A single page is a list of length one, so the
  // single-file shape is a special case rather than a separate path.
  let pages: Page[];
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

  const out: Collected = { items: [], batches: [], header: null, footer: null };

  // Batches are read in page order, one after another. `partial` is true
  // whenever the batch is not the whole document, so the model is not asked to
  // produce a total it cannot see.
  for (let i = 0; i < pages.length; i += BATCH_PAGES) {
    const slice = pages.slice(i, i + BATCH_PAGES);
    const isWholeDocument = pages.length <= BATCH_PAGES;
    const r = await readRange(apiKey, slice, i + 1, !isWholeDocument, out);
    if (!r.ok) {
      // One failed batch fails the whole document. A partial import is exactly
      // the silent data loss this function exists to prevent.
      return json({ ok: false, error: r.error });
    }
  }

  if (out.items.length === 0) {
    return json({ ok: false, error: "no_items_found" });
  }

  // Sequential line numbers across the whole document, assigned here so the
  // review screen and supplier_quote_items.line_no agree.
  const items = out.items.map((item, idx) => ({ ...item, line_no: idx + 1 }));

  // The supplier tax id is validated, never invented: 8 or 9 digits or null.
  // Copied from extract-delivery.
  let supplier = out.header?.supplier ?? null;
  if (supplier && typeof supplier === "object") {
    const rawTax = (supplier as any).tax_id;
    const digits = rawTax == null ? "" : String(rawTax).replace(/\D/g, "");
    (supplier as any).tax_id =
      digits.length === 8 || digits.length === 9 ? digits : null;
  }

  // Header from the first batch, totals from the last, each only if that batch
  // actually reported one. `??` rather than `||` so a legitimate 0 survives.
  const header = out.header ?? {};
  const footer = out.footer ?? {};

  return json({
    ok: true,
    supplier,
    items,
    document_type: header.document_type ?? null,
    document_date: header.document_date ?? null,
    valid_until: header.valid_until ?? null,
    document_number: header.document_number ?? null,
    amount_net: footer.amount_net ?? header.amount_net ?? null,
    vat_amount: footer.vat_amount ?? header.vat_amount ?? null,
    amount_gross: footer.amount_gross ?? header.amount_gross ?? null,
    page_count: pages.length,
    batches: out.batches,
  });
});
