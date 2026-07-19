/**
 * One-time migration: download ministock.co.il product images → Supabase Storage
 *
 * Usage:
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node scripts/migrate-images.js
 *
 * Requirements: Node 18+ (built-in fetch). No extra packages needed beyond
 * @supabase/supabase-js which is already in package.json.
 *
 * Run from the project root:
 *   node scripts/migrate-images.js
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "product-images";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function extFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
    return match ? match[0].toLowerCase() : ".jpg";
  } catch {
    return ".jpg";
  }
}

function mimeFromExt(ext) {
  const map = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };
  return map[ext] || "image/jpeg";
}

async function downloadImage(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (migration-script)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer);
}

async function main() {
  console.log("Fetching products with ministock.co.il image URLs...");

  const { data: products, error: fetchError } = await supabase
    .from("products")
    .select("id, name, sku, image_url")
    .like("image_url", "%ministock.co.il%");

  if (fetchError) {
    console.error("Failed to fetch products:", fetchError.message);
    process.exit(1);
  }

  console.log(`Found ${products.length} products to migrate.\n`);

  let success = 0;
  let failure = 0;

  for (const product of products) {
    const originalUrl = product.image_url.split(",")[0].trim();
    const label = `[${product.sku || product.id}] ${product.name}`;

    try {
      // Download image
      const imageBuffer = await downloadImage(originalUrl);
      const ext = extFromUrl(originalUrl);
      const filename = (product.sku || product.id).replace(/[^a-zA-Z0-9_-]/g, "_") + ext;
      const storagePath = filename;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, imageBuffer, {
          contentType: mimeFromExt(ext),
          upsert: true,
        });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(storagePath);

      // Update product record
      const { error: updateError } = await supabase
        .from("products")
        .update({ image_url: publicUrl })
        .eq("id", product.id);

      if (updateError) throw new Error(`DB update failed: ${updateError.message}`);

      console.log(`✓ ${label}`);
      console.log(`  ${originalUrl}`);
      console.log(`  → ${publicUrl}`);
      success++;
    } catch (err) {
      console.error(`✗ ${label}`);
      console.error(`  ${originalUrl}`);
      console.error(`  ERROR: ${err.message}`);
      failure++;
    }

    // Small delay to avoid hammering the source server
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nDone. ${success} succeeded, ${failure} failed.`);
}

main();
