/**
 * Supabase Edge Function: public-order-pdf
 *
 * Serves ONE order to the public /order-pdf/:orderId page, for a customer who
 * is not logged in.
 *
 * WHY THIS EXISTS
 *   The order link is sent to customers by WhatsApp, so the recipient has no
 *   session. RLS on public.orders allows SELECT only to `authenticated` where
 *   auth.uid() = user_id, so the browser query returned zero rows and the page
 *   showed "Order not found" — on a phone, in a private window, anywhere
 *   without the staff session. It worked on the staff desktop for exactly that
 *   reason, which is what made it look intermittent.
 *
 *   RLS is deliberately NOT weakened. Reading with the service role here keeps
 *   orders private to their owner everywhere else in the product, and confines
 *   public exposure to this one endpoint and the fields listed below.
 *
 * WHAT IT WILL NEVER RETURN
 *   The row is read through an explicit column allowlist, never select("*"), so
 *   a column added to the table later cannot start leaking on its own. Item
 *   objects are rebuilt field by field rather than spread, so buy_price,
 *   product_id, discount, meters_per_roll and unit cannot escape even though
 *   they sit in the same JSONB.
 *
 * ANYONE WITH THE LINK CAN READ THE ORDER
 *   That is the point of a shareable link and is accepted. The id is a UUID and
 *   is validated before any query, so the endpoint cannot be walked by
 *   incrementing an order number.
 *
 * Deploy via Supabase Dashboard → Edge Functions → "Deploy a new function"
 * → name it exactly: public-order-pdf
 * → Verify JWT: OFF (the caller is an unauthenticated customer)
 *
 * No new secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided to
 * every Edge Function automatically. The service-role key is used only to
 * construct the server client and never appears in a response or a log.
 */

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Production CRM origins only. Deliberately NOT "*", unlike the other
// functions in this project: this one answers unauthenticated callers, so the
// set of pages allowed to read its response is kept as small as the feature
// needs. An origin outside this list gets no Access-Control-Allow-Origin
// header at all and the browser discards the response.
const ALLOWED_ORIGINS = new Set([
  "https://adstock.co.il",
  "https://www.adstock.co.il",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The columns the customer-facing order PDF actually renders. Verified against
// the real production table: every name here exists, and nothing here is an
// internal identifier or workflow flag.
//
// Deliberately absent: id, user_id, customer_id, quote_id, monthly_invoice_id,
// created_date, invoiced_at, fulfilled, inventory_processed,
// inventory_deducted, gross_total.
const ORDER_COLUMNS = [
  "order_number",
  "customer_name",
  "customer_tax_id",
  "date",
  "delivery_date",
  // delivery_address is deliberately absent: the current order PDF renders
  // doc.customer_address, which does not exist on this table, and never reads
  // delivery_address. Returning it would publish an address the page cannot
  // display.
  "status",
  "items",
  "subtotal",
  "discount_amount",
  "vat_rate",
  "vat_amount",
  "total",
  "agent",
  "notes",
].join(", ");

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    // Responses differ by Origin, so caches must not serve one origin's
    // response to another.
    "Vary": "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

// Rebuild each item explicitly. NOT a spread: the stored JSONB also carries
// buy_price, product_id, discount, meters_per_roll and unit, none of which a
// customer may see. Listing the five fields by hand is what guarantees that a
// new internal property added to an item later cannot appear here.
function publicItems(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    return {
      name: item.name ?? null,
      quantity: item.quantity ?? null,
      unit_price: item.unit_price ?? null,
      sku: item.sku ?? null,
      total: item.total ?? null,
    };
  });
}

serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405, origin);
  }

  let body: { order_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_order_id" }, 400, origin);
  }

  // Validated BEFORE any query, so a malformed or hostile id never reaches the
  // database and the endpoint cannot be probed with non-uuid input.
  const orderId = typeof body?.order_id === "string" ? body.order_id.trim() : "";
  if (!UUID_RE.test(orderId)) {
    return json({ ok: false, error: "invalid_order_id" }, 400, origin);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    // The database message may name columns or constraints. The caller is a
    // member of the public, so it is never echoed.
    return json({ ok: false, error: "internal_error" }, 500, origin);
  }
  if (!data) {
    return json({ ok: false, error: "order_not_found" }, 404, origin);
  }

  const row = data as Record<string, unknown>;

  // Assembled field by field, mirroring ORDER_COLUMNS. Nothing is spread from
  // the row, so the response cannot inherit a column the allowlist gains later
  // without this list being updated too.
  return json(
    {
      ok: true,
      order: {
        order_number: row.order_number ?? null,
        customer_name: row.customer_name ?? null,
        customer_tax_id: row.customer_tax_id ?? null,
        date: row.date ?? null,
        delivery_date: row.delivery_date ?? null,
        status: row.status ?? null,
        items: publicItems(row.items),
        subtotal: row.subtotal ?? null,
        discount_amount: row.discount_amount ?? null,
        vat_rate: row.vat_rate ?? null,
        vat_amount: row.vat_amount ?? null,
        total: row.total ?? null,
        agent: row.agent ?? null,
        notes: row.notes ?? null,
      },
    },
    200,
    origin,
  );
});
