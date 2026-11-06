/**
 * Deleting an attachment when the file behind it may be SHARED.
 *
 * ============================================================================
 * WHY THIS IS NOT A ONE-LINER
 * ============================================================================
 * One cheque can pay several invoices, and its image is stored ONCE: each
 * invoice gets a row in invoice_attachments carrying the same file_url. That
 * makes a row a LINK, not the file.
 *
 * Both delete paths used to remove the storage object FIRST and then the row.
 * With a shared file that destroys the image for every other invoice that
 * still points at it: open one of them afterwards and the attachment is listed
 * with a URL that 404s. The row survives, the evidence does not.
 *
 * So the order is inverted and made conditional:
 *
 *   1. delete THIS invoice's row, and nothing else
 *   2. ask how many rows still reference that file_url
 *   3. remove the stored object ONLY when the answer is zero
 *
 * ============================================================================
 * WHAT HAPPENS WHEN A STEP FAILS
 * ============================================================================
 * The dangerous direction is deleting a file another invoice still needs, so
 * every uncertainty resolves towards KEEPING the file:
 *
 *   * the row delete fails      -> nothing else is attempted; the link stands
 *   * the reference count fails -> the file is KEPT. An orphaned object costs
 *                                  storage; a deleted shared one costs the
 *                                  business its proof of payment.
 *   * the object delete fails   -> the row is already gone, which is what the
 *                                  user asked for. Reported, not retried.
 *
 * A file is therefore never removed while another reference exists, and never
 * removed on a guess.
 */

/** The object path inside `bucket`, parsed from a public URL. Null if it is
 *  not a URL of this bucket — in which case nothing is ever deleted. */
export function storagePathFromUrl(fileUrl, bucket) {
  if (!fileUrl || !bucket) return null;
  let pathname;
  try {
    pathname = new URL(String(fileUrl)).pathname;
  } catch {
    return null;
  }
  const marker = `/${bucket}/`;
  const at = pathname.indexOf(marker);
  if (at === -1) return null;
  const path = pathname.slice(at + marker.length);
  if (!path) return null;
  // A public URL is percent-encoded; the storage API expects the real key.
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * Remove one invoice's link to an attachment, and the stored file only if that
 * was the last link to it.
 *
 * @param {object} input
 * @param {object} input.supabase    the client
 * @param {string} input.bucket      storage bucket name
 * @param {object} input.attachment  the invoice_attachments row { id, file_url }
 * @param {string} input.table       defaults to "invoice_attachments"
 * @returns {Promise<{
 *   ok: boolean, linkRemoved: boolean, fileRemoved: boolean,
 *   hasOtherLinks: boolean|null, warning: string|null, error: string|null
 * }>}
 *
 * `hasOtherLinks` is a question, not a count: the decision needs only "is
 * anything else still pointing at this file", so the query stops at the first
 * row it finds. null means the question could not be answered.
 */
export async function deleteAttachmentLink({
  supabase, bucket, attachment, table = "invoice_attachments",
} = {}) {
  const out = {
    ok: false, linkRemoved: false, fileRemoved: false,
    hasOtherLinks: null, warning: null, error: null,
  };
  if (!supabase || !attachment?.id) {
    out.error = "שגיאה במחיקת הצרופה";
    return out;
  }

  // ---- 1. this invoice's link, and only this one --------------------------
  try {
    const { error } = await supabase.from(table).delete().eq("id", attachment.id);
    if (error) throw error;
    out.linkRemoved = true;
  } catch (e) {
    out.error = "שגיאה במחיקת הצרופה";
    console.warn("attachment link delete failed:", e?.message);
    return out;
  }

  const path = storagePathFromUrl(attachment.file_url, bucket);
  if (!path) {
    // Nothing identifiable to delete. The link is gone, which is what was
    // asked for, so this is a success with no file step.
    out.ok = true;
    return out;
  }

  // ---- 2. is anything still pointing at the file? -------------------------
  // One row is enough to answer it, so the query stops there rather than
  // counting rows nobody needs the number of.
  let hasOthers;
  try {
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .eq("file_url", attachment.file_url)
      .limit(1);
    if (error) throw error;
    hasOthers = (data ?? []).length > 0;
  } catch (e) {
    // Unknown. Keeping an orphan is recoverable; deleting a file another
    // invoice still shows is not.
    console.warn("attachment reference count failed:", e?.message);
    out.ok = true;
    out.hasOtherLinks = null;
    out.warning = "הצרופה הוסרה מהחשבונית. לא ניתן היה לבדוק אם הקובץ משויך לחשבוניות אחרות, ולכן הקובץ נשמר.";
    return out;
  }

  out.hasOtherLinks = hasOthers;

  // ---- 3. the file, only when nothing references it any more --------------
  if (hasOthers) {
    out.ok = true;
    return out;
  }

  try {
    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) throw error;
    out.fileRemoved = true;
  } catch (e) {
    console.warn("attachment file delete failed:", e?.message);
    out.warning = "הצרופה הוסרה מהחשבונית, אך מחיקת הקובץ מהאחסון נכשלה.";
  }
  out.ok = true;
  return out;
}
