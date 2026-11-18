/**
 * Reading and saving a product's permanent packaging facts.
 *
 * ============================================================================
 * THIS REUSES AN EXISTING TABLE ON PURPOSE
 * ============================================================================
 * `supplier_quote_product_packages` was created for the supplier price
 * comparison, and holds exactly the facts needed here: one row per product per
 * user, with units_per_pack and packs_per_carton, under staff-only RLS.
 *
 * Its name says "supplier quote" but its content is a property of the PRODUCT.
 * Order entry therefore reads and writes the SAME rows rather than keeping a
 * second copy:
 *
 *   * packaging already verified while comparing supplier prices is available
 *     the first time the product is sold — the owner is not asked a question
 *     the system already knows the answer to
 *   * an answer given during order entry improves the price comparison too
 *   * there is one row to be right about, so the two features cannot drift
 *
 * The alternative — columns on `products` — would have meant copying the
 * existing rows and deciding which side wins on a conflict. Nothing is copied
 * and no migration was needed.
 *
 * WHAT IS **NOT** HERE
 *   The level a specific order line sold at. That belongs to the line, lives
 *   in orders.items alongside it, and must never be written here: the same
 *   product is sold by the unit to one customer and by the carton to another.
 */
import { supabase } from "@/api/supabaseClient";

export const PACKAGING_TABLE = "supplier_quote_product_packages";

/**
 * Packaging for a set of products, as a Map keyed by product id.
 *
 * Missing products are simply absent from the map — "we have never been told"
 * is a real state and must not be faked as a row of zeros.
 *
 * @returns {Promise<{ok: boolean, map: Map<string, object>, error: string|null}>}
 */
export async function fetchPackaging(productIds = []) {
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (ids.length === 0) return { ok: true, map: new Map(), error: null };

  try {
    const { data, error } = await supabase
      .from(PACKAGING_TABLE)
      .select("product_id,units_per_pack,packs_per_carton,buy_price_level,updated_at")
      .in("product_id", ids);
    if (error) throw error;
    const map = new Map();
    for (const row of data ?? []) map.set(row.product_id, row);
    return { ok: true, map, error: null };
  } catch (e) {
    // A failed read must not become "this product has no packaging": that
    // would ask the owner a question they have already answered, and saving
    // the answer would overwrite the real row. Reported instead.
    console.warn("packaging read failed:", e?.message);
    return { ok: false, map: new Map(), error: "לא ניתן לקרוא נתוני אריזה" };
  }
}

/** Packaging for one product, or null when nothing is on record. */
export async function fetchPackagingFor(productId) {
  const res = await fetchPackaging([productId]);
  return { ...res, packaging: res.map.get(productId) ?? null };
}

/**
 * Save confirmed packaging for one product.
 *
 * ONLY THE FIELDS GIVEN ARE WRITTEN. An answer about pack size never clears a
 * carton figure recorded earlier, so a product can be learned progressively,
 * one question at a time, over as many orders as it takes.
 *
 * Every field is optional by design: a product may have a pack size and no
 * carton, or neither. Nothing is ever required of an old or discontinued
 * product — it is asked about only if and when it is sold again.
 *
 * @param {string} productId
 * @param {{units_per_pack?: number|null, packs_per_carton?: number|null}} fields
 */
export async function savePackaging(productId, fields = {}) {
  if (!productId) return { ok: false, error: "חסר מזהה מוצר" };

  const patch = {};
  // The purchase price's packaging level is a string, validated against the
  // same three levels the database CHECK allows.
  if ("buy_price_level" in fields) {
    const lvl = fields.buy_price_level;
    if (lvl === null || lvl === "") patch.buy_price_level = null;
    else if (["unit", "pack", "carton"].includes(lvl)) patch.buy_price_level = lvl;
    else return { ok: false, error: "רמת אריזה לא חוקית למחיר הקנייה" };
  }

  for (const key of ["units_per_pack", "packs_per_carton"]) {
    if (!(key in fields)) continue;               // untouched: leave as it is
    const raw = fields[key];
    if (raw === null || raw === "") { patch[key] = null; continue; }
    const n = Number(raw);
    // A zero or negative packaging factor is a typo, not a fact, and it would
    // later be divided by. Refused rather than stored.
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, error: "נתוני האריזה חייבים להיות מספר גדול מאפס" };
    }
    patch[key] = n;
  }
  if (Object.keys(patch).length === 0) return { ok: true, error: null, saved: false };

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return { ok: false, error: "נדרשת התחברות מחדש" };

    // The row is unique per (user_id, product_id), so this is an upsert on
    // that key: the first answer inserts, later answers update only what they
    // name. `updated_at` moves so it is always clear when it was last
    // confirmed.
    const { error } = await supabase
      .from(PACKAGING_TABLE)
      .upsert(
        { user_id: user.id, product_id: productId, ...patch, updated_at: new Date().toISOString() },
        { onConflict: "user_id,product_id" },
      );
    if (error) throw error;
    return { ok: true, error: null, saved: true };
  } catch (e) {
    console.warn("packaging save failed:", e?.message);
    return { ok: false, error: "שמירת נתוני האריזה נכשלה" };
  }
}

/**
 * WHY THE PURCHASE LEVEL IS NOT DERIVED FROM SUPPLIER DATA
 *
 * An earlier version read supplier_product_matches.sale_level for an APPROVED
 * match and used it as the basis of products.buy_price. That was unsound, and
 * it was removed after checking what the two values actually are:
 *
 *   supplier_product_matches.sale_level is the level THAT SUPPLIER'S QUOTED
 *   PRICE refers to. It is captured while reviewing a quote, next to that
 *   quote's own price (QuotePackagingEditor passes the invoiced price
 *   alongside it).
 *
 *   products.buy_price is a different number with a different history. It is
 *   typed by hand in the product form, or written from a DELIVERY NOTE line
 *   (DeliveryModal), or copied from another product. Nothing records which
 *   supplier, quote or document it came from — there is no provenance column
 *   anywhere.
 *
 * So an approved match tells us the basis of a price we are not using. Where
 * buy_price was negotiated, taken from an older quote, or entered from a
 * delivery note in different packaging, the derived level would be confidently
 * wrong — and a wrong basis is worse than none, because it produces a margin
 * nobody questions.
 *
 * The basis therefore comes from exactly one place: the owner, asked once,
 * stored in supplier_quote_product_packages.buy_price_level. Until then the
 * margin reads "pending".
 */

/**
 * Everything known about a product's cost basis, with the supplier data used
 * to fill the gap before anyone is asked.
 *
 * Returns the level only if it has been CONFIRMED and stored. A missing level
 * is returned as null so the caller asks; nothing is inferred on the way.
 */
export async function resolveCostBasis(productId) {
  const { ok, packaging } = await fetchPackagingFor(productId);
  if (!ok) return { ok: false, packaging: null, buyLevel: null, derived: false };

  // The stored answer, or nothing. No fallback, by design — see the note
  // above on why supplier data cannot stand in for it.
  return {
    ok: true,
    packaging,
    buyLevel: packaging?.buy_price_level ?? null,
    derived: false,
  };
}
