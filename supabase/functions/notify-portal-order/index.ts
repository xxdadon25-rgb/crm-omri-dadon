/**
 * Supabase Edge Function: notify-portal-order
 *
 * Sends one Telegram message after a portal customer's order has been saved.
 *
 * WHAT THE BROWSER IS ALLOWED TO SAY
 *   Exactly one thing: { order_id }. The customer name, the total and the item
 *   count are NEVER taken from the request — they are read back from the
 *   database by this function. A browser can therefore misreport an order id,
 *   but it cannot forge the contents of the notification.
 *
 * WHY verify_jwt IS NOT ENOUGH ON ITS OWN
 *   This project carries pre-existing broad "Internal users full access"
 *   policies written as auth.role() = 'authenticated'. Under those, ANY signed-in
 *   user — including every portal customer — satisfies RLS on these tables. So
 *   "the JWT is valid" says nothing about whether this caller owns this order.
 *
 *   Ownership is therefore proved explicitly, in full, before anything is sent:
 *
 *     jwt -> auth user id
 *          -> customer_portal_access.auth_user_id = that user
 *             AND customer_portal_access.customer_id = portal_orders.customer_id
 *             AND customer_portal_access.is_active = true
 *
 *   Every lookup failure is treated as "not authorised", never as "allowed".
 *
 * WHAT IT NEVER RETURNS
 *   The Telegram bot token and Telegram's own API response stay server-side.
 *   The caller gets { ok: true } or a short generic error, nothing else.
 *
 * Deploy via Supabase Dashboard -> Edge Functions -> Deploy a new function
 *   -> name it exactly: notify-portal-order
 *   -> Verify JWT: ON (the caller is an authenticated portal customer)
 *
 * Secrets used, the first two already present in this project:
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 *   TELEGRAM_CHAT_ID_2   (OPTIONAL — a second recipient, same bot, same message)
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function formatAmount(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n)
    ? n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
}

// ONE recipient, ONE request.
//
// Returns whether the message was delivered and NEVER throws. That is the
// whole point: a rejected promise from one recipient would propagate and the
// other recipient's outcome would be lost with it. Reporting failure as a
// value keeps the recipients genuinely independent.
//
// `label` identifies the recipient in the logs without naming the chat id,
// which, like the bot token and Telegram's own response body, stays
// server-side and is never echoed to the caller.
async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string,
  orderId: string,
  label: string,
): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    if (!res.ok) {
      // Logged for us; the body may name the bot or the chat, so it is never
      // echoed to the caller.
      console.error("[notify-portal-order] telegram rejected", {
        recipient: label,
        httpStatus: res.status,
        response: (await res.text()).slice(0, 500),
        orderId,
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error("[notify-portal-order] telegram request failed", {
      recipient: label,
      message: (err as Error).message,
      orderId,
    });
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!botToken || !chatId) {
    return json({ ok: false, error: "not_configured" }, 500);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // ---- 1. Who is calling -----------------------------------------------
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const { data: { user }, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !user) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // ---- 2. What they are asking about ------------------------------------
  let body: { order_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_order_id" }, 400);
  }

  const orderId = typeof body?.order_id === "string" ? body.order_id.trim() : "";
  if (!UUID_RE.test(orderId)) {
    return json({ ok: false, error: "invalid_order_id" }, 400);
  }

  // ---- 3. The order, read server-side -----------------------------------
  const { data: order, error: orderError } = await admin
    .from("portal_orders")
    .select("id, customer_id, total_amount")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError) {
    return json({ ok: false, error: "internal_error" }, 500);
  }
  if (!order || !order.customer_id) {
    return json({ ok: false, error: "order_not_found" }, 404);
  }

  // ---- 4. Ownership ------------------------------------------------------
  // The link is proved in one query: this caller's own access row must name
  // this order's customer and still be active. A read failure is a refusal,
  // not a pass — the check fails closed.
  const { data: access, error: accessError } = await admin
    .from("customer_portal_access")
    .select("id")
    .eq("auth_user_id", user.id)
    .eq("customer_id", order.customer_id)
    .eq("is_active", true)
    .maybeSingle();

  if (accessError) {
    return json({ ok: false, error: "forbidden" }, 403);
  }
  if (!access) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  // ---- 5. Message contents, all from the database ------------------------
  const { data: customer } = await admin
    .from("customers")
    .select("name")
    .eq("id", order.customer_id)
    .maybeSingle();

  // Distinct order lines, not total units: head+count returns the row count
  // without transferring the rows themselves.
  const { count: itemCount } = await admin
    .from("portal_order_items")
    .select("id", { count: "exact", head: true })
    .eq("portal_order_id", order.id);

  // Sent as PLAIN TEXT: no parse_mode, so Telegram renders the message
  // literally and a customer name containing markup characters needs no
  // escaping and cannot alter how the message is displayed.
  const text =
    "🛒 הזמנה חדשה מהפורטל\n" +
    `לקוח: ${customer?.name || "לא ידוע"}\n` +
    `סכום: ${formatAmount(order.total_amount)} ₪\n` +
    `מספר הזמנה: ${order.id}\n` +
    `פריטים: ${itemCount ?? 0}`;

  // ---- 6. Send -----------------------------------------------------------
  // The second recipient is OPTIONAL and read here rather than alongside the
  // other secrets at the top, because its absence must NOT be a configuration
  // error: with the secret unset this function issues one request and behaves
  // exactly as it did before, which is what makes it safe to deploy before the
  // second chat id is configured.
  //
  // A new secret rather than a list inside TELEGRAM_CHAT_ID: Telegram's
  // sendMessage takes `chat_id` as a single id, so "111,222" is not a valid
  // chat and would have broken delivery to the EXISTING recipient too.
  const secondChatId = Deno.env.get("TELEGRAM_CHAT_ID_2")?.trim();

  // One `text`, built once above, sent to both — the notifications are
  // identical by construction and cannot drift apart.
  //
  // Both requests are in flight before either resolves, and neither can
  // cancel, abort or mask the other. Promise.all is safe here ONLY because
  // sendTelegram reports failure as `false` instead of rejecting; with a
  // throwing helper this would have to be allSettled.
  const [primaryOk, secondaryOk] = await Promise.all([
    sendTelegram(botToken, chatId, text, order.id, "primary"),
    secondChatId
      ? sendTelegram(botToken, secondChatId, text, order.id, "secondary")
      : Promise.resolve(true),
  ]);

  // The PRIMARY recipient alone decides the response, exactly as before this
  // change. A secondary-only failure is logged and nothing more: a
  // notification that WAS delivered must not be reported to the caller as a
  // failure, and the portal's own handler only logs either way.
  if (!primaryOk) {
    return json({ ok: false, error: "notify_failed" }, 502);
  }
  if (secondChatId && !secondaryOk) {
    console.error("[notify-portal-order] secondary recipient not notified", {
      orderId: order.id,
    });
  }

  return json({ ok: true });
});
