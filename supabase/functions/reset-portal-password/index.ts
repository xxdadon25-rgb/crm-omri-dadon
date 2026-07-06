/**
 * Supabase Edge Function: reset-portal-password
 *
 * Resets a portal customer's password using the Supabase Admin Auth API.
 * Only callable by authenticated staff members.
 *
 * Deploy via Supabase Dashboard → Edge Functions → "Deploy a new function"
 * → name it exactly: reset-portal-password
 * → paste the contents of this file.
 *
 * No additional secrets are required — SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * are automatically available as Deno env vars inside every Edge Function.
 *
 * Invoke from the frontend:
 *   const { data, error } = await supabase.functions.invoke('reset-portal-password', {
 *     body: { auth_user_id: '<uuid>', new_password: '<min 6 chars>' },
 *   });
 *   // The Supabase JS client automatically sends the caller's session JWT
 *   // in the Authorization header — no manual header construction needed.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ── 1. Verify caller is an authenticated staff member ──────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!jwt) {
    return new Response(
      JSON.stringify({ success: false, error: "נדרשת התחברות" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: { user: callerUser }, error: authError } = await adminClient.auth.getUser(jwt);
  if (authError || !callerUser) {
    return new Response(
      JSON.stringify({ success: false, error: "אימות נכשל" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: staffRow } = await adminClient
    .from("staff_members")
    .select("id")
    .eq("auth_user_id", callerUser.id)
    .maybeSingle();

  if (!staffRow) {
    return new Response(
      JSON.stringify({ success: false, error: "אין הרשאה לביצוע פעולה זו" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── 2. Parse and validate request body ────────────────────────────────────
  let body: { auth_user_id?: string; new_password?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "גוף הבקשה אינו תקין" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { auth_user_id, new_password } = body;

  if (!auth_user_id) {
    return new Response(
      JSON.stringify({ success: false, error: "חסר מזהה משתמש (auth_user_id)" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  if (!new_password || new_password.length < 6) {
    return new Response(
      JSON.stringify({ success: false, error: "הסיסמה חייבת להכיל לפחות 6 תווים" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── 3. Reset the password ──────────────────────────────────────────────────
  const { error: updateError } = await adminClient.auth.admin.updateUserById(
    auth_user_id,
    { password: new_password }
  );

  if (updateError) {
    return new Response(
      JSON.stringify({ success: false, error: updateError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
