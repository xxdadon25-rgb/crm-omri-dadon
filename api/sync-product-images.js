import { createClient } from "@supabase/supabase-js";

const WC_BASE = "https://ministock.co.il/wp-json/wc/v3/products";
const WC_KEY = "ck_880cb5976a207218a7f8c2b6e6494bf7a78f4872";
const WC_SECRET = "cs_3e7c81032dec2b085b87e4a2c1ed0697bd16b597";
const WC_AUTH = "Basic " + Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString("base64");

function normalizeName(name) {
  return name
    .trim()
    .replace(/\s+/g, " ")           // collapse multiple spaces
    .replace(/׳/g, "'")             // Hebrew geresh → ASCII apostrophe
    .replace(/״/g, '"')             // Hebrew gershayim → ASCII double quote
    .replace(/"/g, '"')             // curly left double quote
    .replace(/"/g, '"')             // curly right double quote
    .replace(/'/g, "'")             // curly left single quote
    .replace(/'/g, "'")             // curly right single quote
    .toLowerCase();
}

async function fetchAllWooProducts() {
  const products = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${WC_BASE}?per_page=100&page=${page}`, {
      headers: { Authorization: WC_AUTH },
    });
    if (!res.ok) throw new Error(`WooCommerce fetch failed: ${res.status} ${await res.text()}`);
    const batch = await res.json();
    if (!batch.length) break;
    products.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return products;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  let wooProducts;
  try {
    wooProducts = await fetchAllWooProducts();
  } catch (err) {
    console.error("[sync-product-images] WooCommerce fetch error:", err.message);
    return res.status(500).json({ error: err.message });
  }

  const { data: supabaseProducts, error: fetchError } = await supabase
    .from("products")
    .select("id, name");

  if (fetchError) {
    console.error("[sync-product-images] Supabase fetch error:", fetchError.message);
    return res.status(500).json({ error: fetchError.message });
  }

  // Build a name → supabase id map (lowercase for fuzzy matching)
  const nameMap = {};
  for (const p of supabaseProducts) {
    nameMap[normalizeName(p.name)] = p.id;
  }

  const debug = req.query.debug === "true";
  let updated = 0;
  let skipped = 0;
  const errors = [];
  const skippedList = [];

  for (const woo of wooProducts) {
    const imageUrl = woo.images?.[0]?.src;
    if (!imageUrl) {
      skipped++;
      if (debug) skippedList.push({ woo_name: woo.name, woo_image: null, reason: "no_image" });
      continue;
    }

    const supabaseId = nameMap[normalizeName(woo.name)];
    if (!supabaseId) {
      skipped++;
      if (debug) skippedList.push({ woo_name: woo.name, woo_image: imageUrl, reason: "no_match_in_supabase" });
      continue;
    }

    const { error: updateError } = await supabase
      .from("products")
      .update({ image_url: imageUrl })
      .eq("id", supabaseId);

    if (updateError) {
      errors.push({ name: woo.name, error: updateError.message });
    } else {
      updated++;
    }
  }

  console.log(`[sync-product-images] updated=${updated} skipped=${skipped} errors=${errors.length}`);
  return res.status(200).json({
    woo_total: wooProducts.length,
    supabase_total: supabaseProducts.length,
    updated,
    skipped,
    errors,
    ...(debug && { skipped_details: skippedList }),
  });
}
