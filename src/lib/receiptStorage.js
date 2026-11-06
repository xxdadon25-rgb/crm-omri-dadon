/**
 * Where a receipt document lives, and how it is opened.
 *
 * ============================================================================
 * TWO KINDS OF RECEIPT LINK, AND WHY BOTH MUST KEEP WORKING
 * ============================================================================
 * payments.external_receipt_url has always held a URL that the ledger opens
 * directly — a Finbot-hosted document, or a file in a PUBLIC bucket. Those
 * links exist, they work, and nothing here changes them: anything that is
 * already an http(s) URL is opened exactly as before.
 *
 * A receipt stored privately cannot be a URL. A private object has no durable
 * address: the only way in is a SIGNED url, which expires. Storing one in the
 * column would mean storing a link that stops working, and "הצג קבלה" would
 * break weeks later with no way to tell why.
 *
 * So a privately stored receipt is recorded as the OBJECT REFERENCE itself —
 * `payment-receipts/<path>` — and the signed url is minted at the moment of
 * the click, lasting only as long as the person needs to read it. The column
 * holds a durable pointer; the credential is temporary.
 *
 * ============================================================================
 * WHY THE BUCKET IS CHECKED AGAINST A LIST
 * ============================================================================
 * The value in that column decides which bucket and object get signed. A row
 * holding `logos/secret.png`, whether by mistake or otherwise, would otherwise
 * mint a working url for a file this feature has no business reaching. Only the
 * buckets named below can be signed, and a reference to anything else is
 * refused rather than guessed at.
 */

/** The private bucket receipts are stored in. */
export const RECEIPT_BUCKET = "payment-receipts";

/** Buckets a receipt reference is allowed to name. Nothing else can be signed. */
export const SIGNABLE_BUCKETS = [RECEIPT_BUCKET];

/** A view link lives only as long as the reader needs it. */
export const VIEW_TTL_SECONDS = 300;            // 5 minutes

/**
 * A link sent to a customer has to outlive the message being read. Seven days
 * is long enough for that and short enough that a forwarded message does not
 * become a permanent public address.
 */
export const SHARE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Is this value already a usable address? */
export function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? "").trim());
}

/**
 * Parse a stored object reference of the form `bucket/path/to/file`.
 *
 * @returns {{bucket: string, path: string}|null} null when it is not a
 *   reference to a signable bucket — including an empty value, a bare
 *   filename with no bucket, and any bucket not on the allowlist.
 */
export function parseObjectRef(value) {
  const raw = String(value ?? "").trim();
  if (!raw || isHttpUrl(raw)) return null;
  // A leading slash is tolerated; anything else is taken literally, because an
  // object key may legitimately contain almost any character.
  const trimmed = raw.replace(/^\/+/, "");
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return null;
  const bucket = trimmed.slice(0, slash);
  const path = trimmed.slice(slash + 1);
  if (!path) return null;
  if (!SIGNABLE_BUCKETS.includes(bucket)) return null;
  // `..` could otherwise be used to climb out of the intended prefix.
  if (path.split("/").some(seg => seg === "." || seg === "..")) return null;
  return { bucket, path };
}

/** What kind of receipt link this is: an address, a private object, or nothing. */
export function resolveReceiptLink(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { kind: "none" };
  if (isHttpUrl(raw)) return { kind: "url", href: raw };
  const ref = parseObjectRef(raw);
  if (ref) return { kind: "object", ...ref };
  return { kind: "invalid", value: raw };
}

/** Is there a receipt to show at all? */
export function hasReceipt(value) {
  const kind = resolveReceiptLink(value).kind;
  return kind === "url" || kind === "object";
}

/**
 * The object key a receipt is stored under.
 *
 * Grouped by payment id, so one payment's documents stay together, and the
 * receipt number is in the name so the file is identifiable in the bucket
 * listing without opening it. The name is sanitised because an object key
 * ends up in a URL path.
 */
export function receiptObjectPath({ paymentId, receiptNumber, fileName = "receipt.pdf" } = {}) {
  const safeId = String(paymentId ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "");
  const num = String(receiptNumber ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  const ext = /\.([a-zA-Z0-9]{1,8})$/.exec(String(fileName))?.[1]?.toLowerCase() || "pdf";
  const stem = num ? `receipt-${num}` : "receipt";
  return `${safeId}/${stem}.${ext}`;
}

/** The value to store in payments.external_receipt_url for a private object. */
export function receiptRefFor(args) {
  return `${RECEIPT_BUCKET}/${receiptObjectPath(args)}`;
}

/**
 * Turn a stored receipt value into an address that can be opened right now.
 *
 * A public URL is returned unchanged — no network call, no behaviour change
 * for every receipt that exists today. A private object is signed for as long
 * as `expiresIn` says.
 *
 * @returns {Promise<{ok: boolean, href: string|null, kind: string, error: string|null}>}
 */
export async function resolveReceiptHref({
  supabase, value, expiresIn = VIEW_TTL_SECONDS,
} = {}) {
  const link = resolveReceiptLink(value);

  if (link.kind === "url") return { ok: true, href: link.href, kind: "url", error: null };
  if (link.kind === "none") {
    return { ok: false, href: null, kind: "none", error: "אין קבלה מצורפת" };
  }
  if (link.kind === "invalid") {
    return {
      ok: false, href: null, kind: "invalid",
      error: "הקישור לקבלה אינו תקין",
    };
  }
  if (!supabase) {
    return { ok: false, href: null, kind: "object", error: "הקישור לקבלה אינו תקין" };
  }

  try {
    const { data, error } = await supabase.storage
      .from(link.bucket)
      .createSignedUrl(link.path, expiresIn);
    if (error) throw error;
    const href = data?.signedUrl || data?.signedURL || null;
    if (!href) throw new Error("no signed url returned");
    return { ok: true, href, kind: "object", error: null };
  } catch (e) {
    console.warn("receipt signing failed:", e?.message);
    return {
      ok: false, href: null, kind: "object",
      error: "לא ניתן לפתוח את הקבלה כרגע. נסה שוב.",
    };
  }
}
