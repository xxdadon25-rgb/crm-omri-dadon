/**
 * Supplier quotation comparison — data access.
 *
 * Every read and write for the new "השוואת הצעות מחיר" window goes through
 * here, so the feature touches the database in exactly one file.
 *
 * WHAT THIS MODULE WILL NEVER DO
 *   It does not write to supplier_price_history, products.buy_price,
 *   supplier_deliveries, inventory or supplier orders. A quotation is an OFFER;
 *   those tables record what was actually received and paid. Keeping the two
 *   apart is the whole reason the quotation tables exist separately, and the
 *   boundary is easiest to hold if it is visible in one place.
 *
 * Authorization is NOT enforced here. It is enforced by RLS, which requires a
 * staff_members row for every one of these tables and grants portal customers
 * nothing. The checks below are for the user interface only.
 */
import { supabase } from "@/api/supabaseClient";

const BUCKET = "supplier-quotes";

/** Signed-URL lifetime. Short on purpose: a price list should not be reachable
 *  from a link pasted into a chat an hour later. */
const SIGNED_URL_TTL_SECONDS = 60 * 10;

/**
 * The key an approved match is remembered under: the supplier's own sku, or its
 * product name when it gives no sku. Normalised so that trailing spaces and
 * double spaces do not create a second pending match for the same line.
 *
 * Kept here, next to the queries, because the database stores the RESULT of
 * this function and a second implementation elsewhere would silently split the
 * key space in two.
 */
export function supplierMatchKey({ supplier_sku, supplier_name_raw }) {
  const raw = (supplier_sku ?? "").trim() || (supplier_name_raw ?? "");
  return String(raw).toLowerCase().replace(/\s+/g, " ").trim();
}

/** Is the signed-in user CRM staff? The window is staff-only, and this decides
 *  whether to render it at all — RLS decides whether it returns data. */
export async function isStaffUser() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) return false;
  const { data, error } = await supabase
    .from("staff_members")
    .select("id")
    .eq("auth_user_id", session.user.id)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

/**
 * Quotations, newest first, with the supplier's name.
 *
 * The supplier is read through the FK and never written: `suppliers` is reused
 * by reference, exactly as the existing windows do.
 */
export async function listQuotes({ supplierId = null, limit = 100 } = {}) {
  let q = supabase
    .from("supplier_quotes")
    .select("id, supplier_id, quote_date, valid_until, file_url, file_path, status, notes, created_at, suppliers(name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (supplierId) q = q.eq("supplier_id", supplierId);

  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(row => ({ ...row, supplier_name: row.suppliers?.name ?? "—" }));
}

/** Line counts per quotation, for the list view. One query for all of them
 *  rather than one per row. */
export async function countItemsByQuote(quoteIds) {
  if (!quoteIds?.length) return {};
  const { data, error } = await supabase
    .from("supplier_quote_items")
    .select("supplier_quote_id, match_status")
    .in("supplier_quote_id", quoteIds);
  if (error) throw error;

  const out = {};
  for (const row of data || []) {
    const bucket = (out[row.supplier_quote_id] ||= { total: 0, pending: 0, approved: 0 });
    bucket.total += 1;
    if (row.match_status === "pending") bucket.pending += 1;
    if (row.match_status === "approved") bucket.approved += 1;
  }
  return out;
}

export async function listQuoteItems(quoteId) {
  const { data, error } = await supabase
    .from("supplier_quote_items")
    .select("id, product_id, supplier_sku, supplier_name_raw, unit_price, unit, pack_size, currency, match_status, created_at")
    .eq("supplier_quote_id", quoteId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Upload a quotation document and create its row.
 *
 * ORDER MATTERS: the file is stored first, and the row is written second with
 * the path already in hand. The reverse order can leave a quotation row
 * pointing at a file that was never stored. If the row insert fails, the
 * orphaned object is removed again, so a failed upload leaves nothing behind.
 *
 * The bucket is PRIVATE, so no public URL is taken. `file_path` is the durable
 * reference; a signed URL is minted on demand by quoteFileUrl().
 */
export async function createQuote({ supplierId, quoteDate, validUntil, notes, file }) {
  if (!supplierId) throw new Error("supplierId is required");

  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error("not signed in");

  let filePath = null;
  if (file) {
    // Supplier-scoped, timestamped, and the original name is sanitised rather
    // than trusted: it reaches a storage key.
    const safeName = String(file.name || "quote")
      .replace(/[^\w.\-֐-׿]+/g, "_")
      .slice(-80);
    filePath = `${supplierId}/${Date.now()}_${safeName}`;

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, file, { upsert: false });
    if (upErr) throw upErr;
  }

  const { data, error } = await supabase
    .from("supplier_quotes")
    .insert({
      user_id: userId,          // also required by the INSERT policy
      supplier_id: supplierId,
      quote_date: quoteDate || null,
      valid_until: validUntil || null,
      notes: notes || null,
      file_path: filePath,
      status: "draft",
    })
    .select("id")
    .single();

  if (error) {
    if (filePath) {
      // Best effort: the insert already failed, and a failure to clean up must
      // not replace that error with a less useful one.
      await supabase.storage.from(BUCKET).remove([filePath]).catch(() => {});
    }
    throw error;
  }

  return data;
}

/** A short-lived signed URL for a stored quotation document. */
export async function quoteFileUrl(filePath) {
  if (!filePath) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

/**
 * Delete a quotation, its items and its file.
 *
 * The items go with the row via ON DELETE CASCADE. The object is removed FIRST,
 * because a deleted row leaves no record of the path to clean up later.
 */
export async function deleteQuote({ id, filePath }) {
  if (filePath) {
    await supabase.storage.from(BUCKET).remove([filePath]).catch(() => {});
  }
  const { error } = await supabase.from("supplier_quotes").delete().eq("id", id);
  if (error) throw error;
}

export async function updateQuoteStatus({ id, status }) {
  const { error } = await supabase
    .from("supplier_quotes")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Suppliers, for the upload form's picker. Read-only — this feature never
 *  creates or edits a supplier. */
export async function listSuppliersForPicker() {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name")
    .order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}
