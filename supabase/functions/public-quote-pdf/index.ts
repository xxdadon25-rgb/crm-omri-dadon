/**
 * Staged public-quote-pdf for pre-existing /quote-pdf/:quoteId links.
 *
 * Mirrors the already-deployed public-order-pdf pattern: an unguessable
 * UUID URL is the possession-based share link. A visitor receives ONE
 * document with an explicit display-field allowlist, never table-wide
 * SELECT, pricing costs, supplier data, customer IDs or API credentials.
 * Old UUID links keep their format; no new token or paid service required.
 *
 * NOT DEPLOYED. This function and its frontend integration must be released
 * together with staged quote RLS hardening after explicit owner approval.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://adstock.co.il",
  "https://www.adstock.co.il",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const QUOTE_COLUMNS = [
  "user_id", "quote_number", "customer_name", "date", "status",
  "agent", "items", "subtotal", "discount_amount", "vat_rate",
  "vat_amount", "total", "notes", "customer_notes",
].join(",");
const BUSINESS_COLUMNS = [
  "business_name", "email", "address", "phone", "tax_id", "logo_url",
].join(",");

const allowedQuoteItem = (source: unknown): Record<string, unknown> => {
  const row = source && typeof source === "object" && !Array.isArray(source)
    ? source as Record<string, unknown> : {};
  return {
    name: row.name ?? null,
    sku: row.sku ?? null,
    quantity: row.quantity ?? null,
    unit_price: row.unit_price ?? null,
    discount: row.discount ?? null,
    total: row.total ?? null,
  };
};
const corsHeaders = (origin: string | null): Record<string, string> => {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
};
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status, headers: {
      ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8",
    },
  });

serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405, origin);
  }
  // Browser clients have Origin; disallow untrusted browser origins. CORS
  // is not an authentication mechanism: the UUID itself remains the link key.
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ ok: false, error: "forbidden_origin" }, 403, origin);
  }
  let body: { quote_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_quote_id" }, 400, origin);
  }
  const quoteId = typeof body?.quote_id === "string"
    ? body.quote_id.trim() : "";
  if (!UUID_RE.test(quoteId)) {
    return json({ ok: false, error: "invalid_quote_id" }, 400, origin);
  }
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    return json({ ok: false, error: "internal_error" }, 500, origin);
  }
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: quote, error: quoteError } = await db
    .from("quotes").select(QUOTE_COLUMNS).eq("id", quoteId).maybeSingle();
  if (quoteError) return json({ ok: false, error: "internal_error" }, 500, origin);
  if (!quote) return json({ ok: false, error: "quote_not_found" }, 404, origin);

  // Never return auth owner/user IDs or any API keys in the response.
  const row = quote as Record<string, unknown>;
  const owner = row.user_id;
  if (typeof owner !== "string" || !UUID_RE.test(owner)) {
    return json({ ok: false, error: "internal_error" }, 500, origin);
  }
  const { data: business, error: businessError } = await db
    .from("business_settings").select(BUSINESS_COLUMNS)
    .eq("user_id", owner).order("created_date", { ascending: true })
    .limit(1).maybeSingle();
  if (businessError) {
    return json({ ok: false, error: "internal_error" }, 500, origin);
  }
  const info = (business ?? {}) as Record<string, unknown>;
  return json({
    ok: true,
    quote: {
      quote_number: row.quote_number ?? null,
      customer_name: row.customer_name ?? null,
      date: row.date ?? null,
      status: row.status ?? null,
      agent: row.agent ?? null,
      items: Array.isArray(row.items) ? row.items.map(allowedQuoteItem) : [],
      subtotal: row.subtotal ?? null,
      discount_amount: row.discount_amount ?? null,
      vat_rate: row.vat_rate ?? null,
      vat_amount: row.vat_amount ?? null,
      total: row.total ?? null,
      notes: row.notes ?? null,
      customer_notes: row.customer_notes ?? null,
    },
    business: {
      business_name: info.business_name ?? null,
      email: info.email ?? null,
      address: info.address ?? null,
      phone: info.phone ?? null,
      tax_id: info.tax_id ?? null,
      logo_url: info.logo_url ?? null,
    },
  }, 200, origin);
});
