/**
 * Supabase Edge Function: delete-portal-customer
 *
 * Removes a portal customer's PORTAL IDENTITY ONLY — it blanks the
 * customer_portal_access row and deletes the Supabase Auth user behind it.
 * Only callable by authenticated staff members.
 *
 * WHAT IS NOT TOUCHED
 *   customers, portal_orders, portal_order_items, customer_product_prices,
 *   customer_blocked_products, invoices, sales, quotes, inventory, suppliers,
 *   expenses. The CRM record and the whole commercial history survive: the only
 *   thing removed is the ability to log in to the portal.
 *
 * WHY THE ROW IS BLANKED AND KEPT, NOT DELETED
 *   The portal-access screen lists CRM customers and LEFT JOINs their access
 *   row, so a missing row renders as "אין גישה / הפעל גישה לפורטל" — the same
 *   as a customer who was never configured. Deleting the row therefore could
 *   not express "this one was removed on purpose", and a removed customer
 *   reappeared as an un-configured one.
 *
 *   The row is kept, cleared, and stamped with portal_deleted_at. The screen
 *   hides those rows and lists them under "לקוחות שהוסרו מהפורטל", where staff
 *   can restore them by clearing the stamp.
 *
 * WHY phone_or_email IS CLEARED
 *   customer_portal_access.auth_user_id references auth.users ON DELETE SET
 *   NULL, so deleting the Auth user leaves the row with auth_user_id = NULL —
 *   and link_portal_customer_on_signup() re-links exactly such a row to whoever
 *   next registers with that email, when phone_or_email still matches and
 *   is_active is true. Clearing the address AND is_active removes both halves
 *   of that predicate, so a removed customer can never be silently re-linked.
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

  // ── 5. Blank the mapping row FIRST ────────────────────────────────────────
  // Order is deliberate. If the Auth deletion fails afterwards, the customer is
  // already locked out of the portal, which is the safe direction.
  //
  // customer_id is deliberately NOT cleared: it is what ties the removed row to
  // its CRM customer, so the removed-customers view can still name them and a
  // restore puts the right customer back in the list.
  const { error: blankAccessError } = await adminClient
    .from("customer_portal_access")
    .update({
      auth_user_id: null,
      is_active: false,
      first_login_completed: false,
      phone_or_email: null,
      portal_deleted_at: new Date().toISOString(),
    })
    .eq("id", accessId);

  if (blankAccessError) {
    return json(
      { success: false, error: "שגיאה בהסרת גישת הפורטל" },
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
    // Deliberately NOT restoring the row. Portal access really is gone, and
    // undoing the blanking would give the customer their access back.
    // portal_deleted_at stays set. The caller is told the exact truth so an
    // admin can finish removing the login account by hand.
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
