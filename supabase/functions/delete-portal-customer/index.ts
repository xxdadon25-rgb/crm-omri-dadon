/**
 * Supabase Edge Function: delete-portal-customer
 *
 * Deletes a portal customer's PORTAL IDENTITY ONLY — the customer_portal_access
 * mapping row and, when one exists, the Supabase Auth user behind it.
 * Only callable by authenticated staff members.
 *
 * WHAT IS NOT TOUCHED
 *   customers, portal_orders, portal_order_items, customer_product_prices,
 *   customer_blocked_products, invoices, sales, quotes, inventory, suppliers,
 *   expenses. The CRM record and the whole commercial history survive: the only
 *   thing removed is the ability to log in to the portal.
 *
 * WHY THE MAPPING ROW MUST BE DELETED EXPLICITLY
 *   customer_portal_access.auth_user_id references auth.users ON DELETE SET
 *   NULL. Deleting only the Auth user would therefore leave the mapping behind
 *   with auth_user_id = NULL — and the signup trigger
 *   link_portal_customer_on_signup() re-links exactly such a row to the next
 *   person who registers with that email, when the row is still is_active.
 *   Deleting the Auth user alone would hand portal access straight back.
 *
 * WHY THE SAME EMAIL BEHAVES AS BRAND NEW AFTERWARDS
 *   With the mapping gone, a later signup fires handle_new_portal_user(), which
 *   inserts a fresh row with customer_id NULL and is_active false — a pending
 *   registration for staff to link. link_portal_customer_on_signup() finds
 *   nothing to re-link, because no active row with a NULL auth_user_id remains.
 *
 * Deploy via Supabase Dashboard → Edge Functions → "Deploy a new function"
 * → name it exactly: delete-portal-customer
 * → paste the contents of this file.
 *
 * No additional secrets are required — SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * are automatically available as Deno env vars inside every Edge Function.
 *
 * Invoke from the frontend:
 *   const { data, error } = await supabase.functions.invoke('delete-portal-customer', {
 *     body: { access_id: '<customer_portal_access uuid>' },
 *   });
 *   // The Supabase JS client automatically sends the caller's session JWT
 *   // in the Authorization header — no manual header construction needed.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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
    return json({ success: false, error: "נדרשת התחברות" }, 401);
  }

  const { data: { user: callerUser }, error: authError } =
    await adminClient.auth.getUser(jwt);
  if (authError || !callerUser) {
    return json({ success: false, error: "אימות נכשל" }, 401);
  }

  const { data: staffRow, error: staffError } = await adminClient
    .from("staff_members")
    .select("id")
    .eq("auth_user_id", callerUser.id)
    .maybeSingle();

  // A failed lookup must never be read as "authorised". Fail closed.
  if (staffError) {
    return json({ success: false, error: "בדיקת הרשאות נכשלה" }, 500);
  }
  if (!staffRow) {
    return json({ success: false, error: "אין הרשאה לביצוע פעולה זו" }, 403);
  }

  // ── 2. Parse and validate request body ────────────────────────────────────
  let body: { access_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "גוף הבקשה אינו תקין" }, 400);
  }

  const accessId = body?.access_id;
  if (typeof accessId !== "string" || !UUID_RE.test(accessId)) {
    return json({ success: false, error: "מזהה גישה חסר או שגוי" }, 400);
  }

  // ── 3. Read the targeted row ──────────────────────────────────────────────
  // The auth user to delete is taken from HERE and nowhere else. The browser
  // never supplies an auth_user_id, so a caller cannot point this function at
  // an arbitrary account.
  const { data: accessRow, error: readError } = await adminClient
    .from("customer_portal_access")
    .select("id, auth_user_id, phone_or_email")
    .eq("id", accessId)
    .maybeSingle();

  if (readError) {
    return json({ success: false, error: "שגיאה בקריאת רשומת הגישה" }, 500);
  }
  if (!accessRow) {
    return json({ success: false, error: "רשומת הגישה לא נמצאה" }, 404);
  }

  const authUserId: string | null = accessRow.auth_user_id ?? null;

  // ── 4. Never delete a staff account ───────────────────────────────────────
  // A staff member could hold a portal access row too. Refuse entirely rather
  // than risk removing the login of someone who administers the system.
  if (authUserId) {
    const { data: staffTarget, error: staffTargetError } = await adminClient
      .from("staff_members")
      .select("id")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (staffTargetError) {
      return json({ success: false, error: "בדיקת הרשאות נכשלה" }, 500);
    }
    if (staffTarget) {
      return json(
        { success: false, error: "לא ניתן למחוק חשבון של איש צוות" },
        403,
      );
    }
  }

  // ── 5. Delete the mapping row FIRST ───────────────────────────────────────
  // Order is deliberate. If the Auth deletion fails afterwards, the customer is
  // already locked out of the portal, which is the safe direction. The reverse
  // order could leave a row with auth_user_id NULL that the signup trigger
  // would later re-link.
  const { error: deleteAccessError } = await adminClient
    .from("customer_portal_access")
    .delete()
    .eq("id", accessId);

  if (deleteAccessError) {
    return json(
      { success: false, error: "שגיאה במחיקת גישת הפורטל" },
      500,
    );
  }

  // ── 6. Delete the Auth user, if there is one ──────────────────────────────
  // A row that was created by staff but never registered has no auth user.
  // That is a complete success, not an error.
  if (!authUserId) {
    return json({ success: true, auth_deleted: false });
  }

  const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(
    authUserId,
  );

  if (deleteUserError) {
    // Deliberately NOT recreating the mapping row. Portal access really is
    // gone, and re-inserting it would restore the customer's access. The
    // caller is told the exact truth so an admin can finish the cleanup.
    return json(
      {
        success: false,
        partial: true,
        access_deleted: true,
        auth_deleted: false,
        error: "גישת הפורטל הוסרה, אך מחיקת חשבון ההתחברות נכשלה",
      },
      500,
    );
  }

  return json({ success: true, auth_deleted: true });
});
