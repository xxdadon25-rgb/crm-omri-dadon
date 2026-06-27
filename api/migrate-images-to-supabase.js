import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // 1. Fetch products with ministock.co.il image URLs
  const { data: products, error: fetchError } = await supabase
    .from("products")
    .select("id, name, image_url")
    .like("image_url", "https://ministock.co.il%");

  if (fetchError) {
    console.error("[migrate-images] fetch error:", fetchError.message);
    return res.status(500).json({ error: fetchError.message });
  }

  console.log(`[migrate-images] found ${products.length} products to migrate`);

  let migrated = 0;
  let skipped = 0;
  const errors = [];

  for (const product of products) {
    try {
      // 2. Download image from WooCommerce
      const imgRes = await fetch(product.image_url);
      if (!imgRes.ok) {
        errors.push({ id: product.id, name: product.name, error: `download failed: ${imgRes.status}` });
        continue;
      }

      const contentType = imgRes.headers.get("content-type") || "image/jpeg";
      const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const arrayBuffer = await imgRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const filePath = `products/${product.id}.${ext}`;

      // 3. Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from("product-images")
        .upload(filePath, buffer, {
          contentType,
          upsert: true,
        });

      if (uploadError) {
        errors.push({ id: product.id, name: product.name, error: `upload failed: ${uploadError.message}` });
        continue;
      }

      // 4. Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("product-images")
        .getPublicUrl(filePath);

      // 5. Update product image_url in Supabase
      const { error: updateError } = await supabase
        .from("products")
        .update({ image_url: publicUrl })
        .eq("id", product.id);

      if (updateError) {
        errors.push({ id: product.id, name: product.name, error: `update failed: ${updateError.message}` });
        continue;
      }

      console.log(`[migrate-images] migrated: "${product.name}" → ${publicUrl}`);
      migrated++;
    } catch (err) {
      errors.push({ id: product.id, name: product.name, error: err.message });
    }
  }

  console.log(`[migrate-images] done: migrated=${migrated} skipped=${skipped} errors=${errors.length}`);
  return res.status(200).json({
    total: products.length,
    migrated,
    skipped,
    errors,
  });
}
