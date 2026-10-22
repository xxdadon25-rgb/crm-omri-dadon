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

// ── Scanning: pages, extracted lines and approval ──────────────────────────

/**
 * Is this document already imported?
 *
 * Two independent signals, both checked BEFORE anything is uploaded so a
 * duplicate costs nothing:
 *   * the content hash — the same bytes from the same supplier
 *   * the document reference — a re-photographed copy whose bytes differ but
 *     whose number and date do not
 *
 * The database enforces both with unique indexes; this is the friendly check
 * that lets the UI offer "open the existing import" instead of surfacing a
 * constraint violation.
 */
export async function findExistingQuote({ supplierId, contentHash, documentNumber, quoteDate }) {
  if (contentHash) {
    const { data, error } = await supabase
      .from("supplier_quotes")
      .select("id, quote_date, document_number, status")
      .eq("supplier_id", supplierId)
      .eq("content_hash", contentHash)
      .maybeSingle();
    if (!error && data) return { ...data, matched_on: "content_hash" };
  }
  if (documentNumber && quoteDate) {
    const { data, error } = await supabase
      .from("supplier_quotes")
      .select("id, quote_date, document_number, status")
      .eq("supplier_id", supplierId)
      .eq("document_number", documentNumber)
      .eq("quote_date", quoteDate)
      .maybeSingle();
    if (!error && data) return { ...data, matched_on: "document_reference" };
  }
  return null;
}

/**
 * Store the scanned pages and create the quotation row.
 *
 * ORDER: pages are uploaded first, the row second, the page records third.
 * A row pointing at files that were never stored is worse than an orphaned
 * file, and an orphaned file is cleaned up below.
 *
 * Partial failure is handled rather than hoped away: if the row insert fails,
 * every uploaded object is removed again, so a failed scan leaves nothing
 * behind. If a PAGE record fails after the row was written, the row is deleted
 * too — a quotation whose pages are only half recorded cannot be verified
 * later, which defeats the point of keeping the document.
 */
export async function createScannedQuote({ supplierId, files, pages, contentHash, document }) {
  if (!supplierId) throw new Error("supplierId is required");
  if (!files?.length) throw new Error("no_pages");

  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error("not signed in");

  const uploaded = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const safeName = String(f.name || `page-${i + 1}`)
        .replace(/[^\w.\-֐-׿]+/g, "_")
        .slice(-80);
      const path = `${supplierId}/${Date.now()}_${i + 1}_${safeName}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, f, { upsert: false });
      if (error) throw error;
      uploaded.push({ page_no: i + 1, file_path: path, byte_size: f.size ?? null });
    }
  } catch (err) {
    await cleanupObjects(uploaded.map(u => u.file_path));
    throw err;
  }

  const { data: quote, error: quoteErr } = await supabase
    .from("supplier_quotes")
    .insert({
      user_id: userId,
      supplier_id: supplierId,
      quote_date: document?.quote_date || null,
      valid_until: document?.valid_until || null,
      document_type: document?.document_type || null,
      document_number: document?.document_number || null,
      amount_net: document?.amount_net ?? null,
      vat_amount: document?.vat_amount ?? null,
      amount_gross: document?.amount_gross ?? null,
      vat_rate: document?.vat_rate ?? null,
      vat_basis: document?.vat_basis || "unknown",
      content_hash: contentHash || null,
      page_count: files.length,
      // The lines exist but nobody has approved them yet.
      extraction_status: "done",
      extracted_at: new Date().toISOString(),
      // The first page doubles as the document's headline file, so the phase-1
      // list view keeps working unchanged.
      file_path: uploaded[0]?.file_path ?? null,
      status: "draft",
    })
    .select("id")
    .single();

  if (quoteErr) {
    await cleanupObjects(uploaded.map(u => u.file_path));
    throw quoteErr;
  }

  const { error: pagesErr } = await supabase
    .from("supplier_quote_pages")
    .insert(uploaded.map(u => ({ ...u, user_id: userId, supplier_quote_id: quote.id })));

  if (pagesErr) {
    await supabase.from("supplier_quotes").delete().eq("id", quote.id).catch(() => {});
    await cleanupObjects(uploaded.map(u => u.file_path));
    throw pagesErr;
  }

  return { id: quote.id, pages: uploaded };
}

/** Best effort: a cleanup failure must not replace the original error with a
 *  less useful one. */
async function cleanupObjects(paths) {
  if (!paths?.length) return;
  try { await supabase.storage.from(BUCKET).remove(paths); } catch { /* ignore */ }
}

/**
 * Write the reviewed lines.
 *
 * Called ONCE, after a human has looked at every line. Rows arrive already
 * corrected and matched by the review screen; this function only persists
 * them, so there is no place for it to quietly decide anything.
 *
 * `comparable_price` is NOT written: it is a GENERATED column, computed by the
 * database from price_before_vat and base_qty_per_pack. Sending it would be
 * rejected, which is exactly the protection we want.
 */
export async function saveReviewedItems({ quoteId, items }) {
  if (!quoteId) throw new Error("quoteId is required");
  if (!items?.length) throw new Error("no_items");

  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error("not signed in");
  const now = new Date().toISOString();

  const rows = items.map((i, idx) => ({
    user_id: userId,
    supplier_quote_id: quoteId,
    line_no: i.line_no ?? idx + 1,
    page_no: i.page_no ?? null,
    product_id: i.match_status === "approved" ? i.product_id ?? null : null,
    supplier_sku: i.supplier_sku ?? null,
    supplier_name_raw: i.supplier_name_raw || "—",
    quantity: i.quantity ?? null,
    unit: i.unit ?? null,
    pack_size: i.pack_size ?? null,
    list_price: i.list_price ?? null,
    discount_percent: i.discount_percent ?? null,
    discount_amount: i.discount_amount ?? null,
    unit_price: i.unit_price ?? null,
    price_before_vat: i.price_before_vat ?? null,
    base_unit: i.base_unit ?? null,
    base_qty_per_pack: i.base_qty_per_pack ?? null,
    line_total: i.line_total ?? null,
    confidence: i.confidence ?? null,
    match_status: i.match_status ?? "pending",
    extracted_raw: i.extracted_raw ?? null,
    reviewed_by: userId,
    reviewed_at: now,
  }));

  const { error } = await supabase.from("supplier_quote_items").insert(rows);
  if (error) throw error;

  // The document is 'reviewed' once every line has been accepted or rejected.
  const stillPending = rows.some(r => r.match_status === "pending");
  await supabase
    .from("supplier_quotes")
    .update({ status: stillPending ? "draft" : "reviewed", updated_at: now })
    .eq("id", quoteId);

  return { inserted: rows.length };
}

/**
 * Remember an approved SKU -> product mapping, so the same supplier line is
 * never reviewed twice.
 *
 * The packaging is stored WITH the mapping, because that is what makes
 * auto-applying it safe later: canAutoApplyMatch() requires the SKU, the base
 * unit and the pack size all to agree before it reuses a decision.
 */
export async function approveMatch({ supplierId, item, productId }) {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error("not signed in");

  const key = supplierMatchKey(item);
  const { error } = await supabase
    .from("supplier_product_matches")
    .upsert({
      user_id: userId,
      supplier_id: supplierId,
      supplier_key: key,
      product_id: productId,
      status: "approved",
      supplier_sku: item.supplier_sku ?? null,
      supplier_description: item.supplier_name_raw ?? null,
      base_unit: item.base_unit ?? null,
      base_qty_per_pack: item.base_qty_per_pack ?? null,
      approved_by: userId,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,supplier_id,supplier_key" });
  if (error) throw error;
}

/** Remembered mappings for one supplier, for auto-applying to new lines. */
export async function listMatchesForSupplier(supplierId) {
  const { data, error } = await supabase
    .from("supplier_product_matches")
    .select("supplier_key, supplier_sku, product_id, status, base_unit, base_qty_per_pack, supplier_description")
    .eq("supplier_id", supplierId);
  if (error) throw error;
  return data || [];
}

/**
 * Products, for the matching picker. READ-ONLY: this feature never writes to
 * products, never touches product images, and never reads or writes buy_price.
 *
 * Searching and paging run in the DATABASE, so a catalogue of any size costs
 * one page per scroll rather than a full download on open. `image_url` is the
 * product's existing field — no new image storage, and the comma-separated
 * convention the rest of the CRM uses is honoured by the picker.
 *
 * THE SEARCH TERM IS SANITISED, and not for show: PostgREST's `or` filter is
 * parsed as a comma-separated list of conditions wrapped in parentheses, so a
 * term containing `,` `(` `)` or `*` would break out of the pattern and either
 * error or match something unintended. Stripping those characters keeps the
 * filter a filter.
 */
export async function listProductsForMatching({ search = "", limit = 30, offset = 0 } = {}) {
  let q = supabase
    .from("products")
    .select("id, name, sku, barcode, unit, image_url, category")
    .eq("is_active", true)
    .order("name", { ascending: true })
    .order("id", { ascending: true })      // stable tiebreak, so pages cannot repeat a row
    .range(offset, offset + limit - 1);

  const term = String(search || "").replace(/[,()*%\\]/g, " ").trim();
  if (term) {
    q = q.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`);
  }

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** One product by id, so the review screen can show the chosen product's name
 *  and image without holding the whole catalogue in memory. */
export async function getProductsByIds(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return [];
  const { data, error } = await supabase
    .from("products")
    .select("id, name, sku, unit, image_url")
    .in("id", unique);
  if (error) throw error;
  return data || [];
}

/** The stored page images of one document, for inspecting it while reviewing.
 *  Signed on demand, because the bucket is private. */
export async function listQuotePages(quoteId) {
  const { data, error } = await supabase
    .from("supplier_quote_pages")
    .select("page_no, file_path")
    .eq("supplier_quote_id", quoteId)
    .order("page_no");
  if (error) throw error;
  const pages = [];
  for (const p of data || []) {
    pages.push({ ...p, url: await quoteFileUrl(p.file_path).catch(() => null) });
  }
  return pages;
}

/** The selected price per supplier+product — the phase-2 view, read as-is.
 *  The lowest approved historical price unless a manual override is active. */
export async function listSelectedPrices({ supplierId = null, productId = null } = {}) {
  let q = supabase.from("supplier_product_selected_price_v").select("*");
  if (supplierId) q = q.eq("supplier_id", supplierId);
  if (productId) q = q.eq("product_id", productId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
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