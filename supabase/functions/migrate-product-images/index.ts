/**
 * Supabase Edge Function: migrate-product-images
 *
 * Downloads product images from ministock.co.il URLs, uploads them to
 * Supabase Storage bucket 'product-images', and updates image_url in the DB.
 *
 * Deploy via Supabase Dashboard → Edge Functions → Deploy a new function
 * (paste this file contents), then invoke it once.
 *
 * Or deploy with CLI:
 *   supabase functions deploy migrate-product-images
 *
 * Invoke (once deployed):
 *   curl -X POST https://<project-ref>.supabase.co/functions/v1/migrate-product-images \
 *     -H "Authorization: Bearer <anon-or-service-role-key>"
 *
 * The function uses the built-in service role credentials available inside
 * Edge Functions via Deno.env — no secrets need to be passed at call time.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "product-images";

function extFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
    return match ? match[0].toLowerCase() : ".jpg";
  } catch {
    return ".jpg";
  }
}

function mimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };
  return map[ext] ?? "image/jpeg";
}

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Fetch all products with ministock.co.il image URLs
  const { data: products, error: fetchError } = await supabase
    .from("products")
    .select("id, name, sku, image_url")
    .like("image_url", "%ministock.co.il%");

  if (fetchError) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch products", detail: fetchError.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const results: { id: string; name: string; status: string; newUrl?: string; error?: string }[] = [];

  for (const product of products ?? []) {
    const originalUrl = (product.image_url as string).split(",")[0].trim();
    const label = product.sku || product.id;

    try {
      // Download image
      const res = await fetch(originalUrl, {
        headers: { "User-Agent": "Supabase-Migration/1.0" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
      const imageBuffer = await res.arrayBuffer();

      const ext = extFromUrl(originalUrl);
      const filename = String(label).replace(/[^a-zA-Z0-9_-]/g, "_") + ext;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(filename, imageBuffer, {
          contentType: mimeFromExt(ext),
          upsert: true,
        });
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      // Get public URL
      const urlResult = supabase.storage.from(BUCKET).getPublicUrl(filename);
      const publicUrl = urlResult.data?.publicUrl;
      if (!publicUrl) throw new Error("Failed to get public URL");

      // Update product record
      const { error: updateError } = await supabase
        .from("products")
        .update({ image_url: publicUrl })
        .eq("id", product.id);
      if (updateError) throw new Error(`DB update failed: ${updateError.message}`);

      results.push({ id: product.id, name: product.name, status: "success", newUrl: publicUrl });
    } catch (err) {
      results.push({ id: product.id, name: product.name, status: "failed", error: (err as Error).message });
    }

    // Small delay to avoid hammering the source server
    await new Promise((r) => setTimeout(r, 300));
  }

  const succeeded = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return new Response(
    JSON.stringify({ summary: { total: results.length, succeeded, failed }, results }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
