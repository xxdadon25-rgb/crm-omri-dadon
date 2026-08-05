/**
 * Supabase Edge Function: payment-webhook
 *
 * Forwards payment data to a Make webhook URL stored in
 * MAKE_PAYMENT_WEBHOOK_URL secret. Fire-and-forget — always
 * returns ok:true to the client so payment flow is never blocked.
 *
 * Deploy: Supabase Dashboard → Edge Functions → Deploy new function
 *   → name: payment-webhook
 *   → paste this file
 *   → Settings → Verify JWT = OFF
 *
 * Required secret: MAKE_PAYMENT_WEBHOOK_URL
 */

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const webhookUrl = Deno.env.get("MAKE_PAYMENT_WEBHOOK_URL");
  if (!webhookUrl) {
    return json({ ok: false, error: "MAKE_PAYMENT_WEBHOOK_URL not configured" }, 500);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("[payment-webhook] Make request failed:", (err as Error).message);
  }

  return json({ ok: true });
});
