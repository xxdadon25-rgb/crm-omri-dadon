/**
 * Supabase Edge Function: revach-proxy
 *
 * The single bridge between the QuickStock CRM and the Revach Plus admin API.
 * It holds REVACH_ADMIN_KEY server-side so the browser never sees it, and it is
 * the ONLY thing standing between the internet and full Revach Plus admin: the
 * remote admin-api authorises purely on possession of the x-admin-key header.
 *
 * Because of that, the caller is authenticated and authorised HERE, before the
 * key is ever read:
 *   1. a real Authorization bearer token, resolved through Supabase Auth  -> else 401
 *   2. that exact user present in staff_members                          -> else 403
 *   3. a known action                                                    -> else 400
 * Only then is REVACH_ADMIN_KEY read and the request forwarded.
 *
 * Checking for a header alone would NOT be enough. The Supabase JS client sends
 * `Bearer <anon key>` when there is no session, and the anon key is a valid
 * project JWT that is published in the browser bundle. It resolves to no user,
 * which is exactly why getUser() — not header presence — is the gate.
 *
 * Deploy via Supabase Dashboard → Edge Functions → revach-proxy → paste this file.
 *
 * Secrets: REVACH_ADMIN_URL and REVACH_ADMIN_KEY. SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are injected automatically into every Edge Function.
 *
 * Invoked from src/lib/revachAdmin.js; the JS client attaches the caller's
 * session JWT on its own, so the frontend needs no change.
 */

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Exactly the admin-api actions the CRM uses today. The body is forwarded
// verbatim, so without this list any action a future admin-api gains would be
// reachable from here the moment it is deployed.
const ALLOWED_ACTIONS = new Set([
  "list_customers",
  "approve",
  "cancel",
  "delete_customer",
  "block",
  "delete_price_history",
  "delete_supplier",
  "delete_support_message",
  // Attaches a Grow standing order to a business after an admin has confirmed
  // the match in Grow. Never grants access on its own.
  "bind_recurring_contract",
]);

// revachAdmin.js reads `data.ok` and throws on `data.error`, so every failure
// leaves this function in the shape the existing frontend already handles.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // ── 1. Authenticate the caller ──────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return json({ ok: false, error: "נדרשת התחברות" }, 401);
    }

    const { data: { user: callerUser }, error: authError } =
      await adminClient.auth.getUser(jwt);
    if (authError || !callerUser) {
      return json({ ok: false, error: "אימות נכשל" }, 401);
    }

    // ── 2. Authorise: this user must be CRM staff ───────────────────────────
    // staff_members is the authoritative record. The frontend's isStaff flag
    // and its hard-coded STAFF_EMAILS list are browser state and are not
    // consulted here.
    const { data: staffRow, error: staffError } = await adminClient
      .from("staff_members")
      .select("id")
      .eq("auth_user_id", callerUser.id)
      .maybeSingle();

    // A failed lookup must never be read as "authorised". Fail closed.
    if (staffError) {
      return json({ ok: false, error: "בדיקת הרשאות נכשלה" }, 500);
    }
    if (!staffRow) {
      return json({ ok: false, error: "אין הרשאה לביצוע פעולה זו" }, 403);
    }

    // ── 3. Validate the body and the action ─────────────────────────────────
    let body: { action?: string };
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "גוף הבקשה אינו תקין" }, 400);
    }

    const action = typeof body?.action === "string" ? body.action : "";
    if (!ALLOWED_ACTIONS.has(action)) {
      return json({ ok: false, error: "פעולה לא מוכרת" }, 400);
    }

    // ── 4. Only now is the admin key touched ────────────────────────────────
    const url = Deno.env.get("REVACH_ADMIN_URL");
    const key = Deno.env.get("REVACH_ADMIN_KEY");
    if (!url || !key) {
      return json({ ok: false, error: "missing_config" }, 500);
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": key },
      body: JSON.stringify(body),
    });

    // The remote body is passed through unchanged: revachAdmin.js expects
    // admin-api's own { ok, customers } / { ok, whatsapp_url } shapes.
    const text = await res.text();

    return new Response(text, {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: res.status,
    });
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 400);
  }
});
