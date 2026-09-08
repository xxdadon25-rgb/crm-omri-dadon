/**
 * One-off migration: base64 product images -> Supabase Storage URLs.
 *
 * WHY
 *   22 rows in public.products hold the whole image inline as a
 *   `data:image/...;base64,...` URI in image_url. Those 22 values account for
 *   ~21 MB of the products table, which every page that reads the catalogue
 *   downloads in full. This moves the bytes into the product-images bucket and
 *   replaces image_url with the ordinary public URL every other product uses.
 *
 * WHAT IT WILL NOT DO
 *   * It never touches a row whose image_url is not `data:image/%`.
 *   * It never overwrites a Storage object. Uploads use upsert:false, and a
 *     pre-existing object at the target path is only reused when its bytes hash
 *     identically; otherwise that row is skipped and reported.
 *   * It never updates the database before the uploaded bytes have been
 *     downloaded back and verified by SHA-256.
 *   * It never writes anything at all unless DRY_RUN is explicitly "false".
 *
 * WHY THE TARGET PREFIX IS products/base64-migrated/
 *   Three of the 22 products already have an object at products/<id>.png whose
 *   bytes are NOT the base64 image. Writing there would destroy a real product
 *   image. This prefix was verified collision-free in production.
 *
 * USAGE
 *   Dry run (default, writes nothing but the local backup):
 *     SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-base64-product-images.js
 *
 *   Execute:
 *     SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DRY_RUN=false node scripts/migrate-base64-product-images.js
 *
 *   The credential is read from the environment only. Never paste it into a
 *   file, never commit it, and never echo it — this script prints neither.
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BUCKET = "product-images";
const TARGET_PREFIX = "products/base64-migrated";

// Ends in .local, which .gitignore already excludes, so a backup containing
// full image payloads can never be committed by accident.
const BACKUP_DIR = join("scripts", "base64-migration.local");

// Default is a dry run. Only the exact string "false" turns writes on, so a
// typo, an empty value or an unset variable all stay safe.
const DRY_RUN = process.env.DRY_RUN !== "false";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// Only these four are produced by the app's own upload paths, and they cover
// the verified production set (19 png, 2 jpg, 1 webp).
const EXT_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const DATA_URI = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Splits a data URI into its declared MIME type and decoded bytes. */
function parseDataUri(value) {
  const m = String(value || "").match(DATA_URI);
  if (!m) return { error: "not a base64 data URI" };

  const mime = m[1].toLowerCase();
  const ext = EXT_BY_MIME[mime];
  if (!ext) return { error: `unsupported mime: ${mime}` };

  let bytes;
  try {
    bytes = Buffer.from(m[2], "base64");
  } catch (e) {
    return { error: `base64 decode failed: ${e.message}` };
  }
  if (bytes.length === 0) return { error: "decoded to zero bytes" };

  return { mime, ext, bytes };
}

/** Returns the object's bytes, or null when it does not exist. */
async function downloadIfExists(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) return null;
  return Buffer.from(await data.arrayBuffer());
}

async function main() {
  console.log(`mode: ${DRY_RUN ? "DRY RUN — nothing will be written" : "EXECUTE — Storage and database WILL be written"}`);
  console.log(`bucket: ${BUCKET}  target prefix: ${TARGET_PREFIX}/\n`);

  const { data: rows, error } = await supabase
    .from("products")
    .select("id, image_url")
    .like("image_url", "data:image/%");

  if (error) {
    console.error("select failed:", error.message);
    process.exit(1);
  }
  console.log(`rows with a base64 image_url: ${rows.length}\n`);
  if (rows.length === 0) return;

  // ---- Backup FIRST -------------------------------------------------------
  // image_url IS the image for these rows: once it is replaced, the only copies
  // are this file and the Storage object. It is written before any other work,
  // in dry run as well as execute, so a rollback source always exists.
  const parsed = rows.map((r) => ({ row: r, ...parseDataUri(r.image_url) }));

  mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = join(BACKUP_DIR, `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(
    backupPath,
    JSON.stringify(
      parsed.map(({ row, mime, bytes, error: parseError }) => ({
        id: row.id,
        image_url: row.image_url,          // complete original value
        mime: mime ?? null,
        byteLength: bytes ? bytes.length : null,
        sha256: bytes ? sha256(bytes) : null,
        parseError: parseError ?? null,
      })),
      null,
      2,
    ),
  );
  console.log(`backup written: ${backupPath}\n`);

  const summary = { migrated: 0, reused: 0, skipped: 0, failed: 0 };

  for (const { row, mime, ext, bytes, error: parseError } of parsed) {
    const id = row.id;

    if (parseError) {
      console.log(`SKIP     ${id}  ${parseError}`);
      summary.skipped++;
      continue;
    }

    const hash = sha256(bytes);
    const path = `${TARGET_PREFIX}/${id}.${ext}`;

    // ---- Collision check: never overwrite ---------------------------------
    const existing = await downloadIfExists(path);
    if (existing) {
      if (sha256(existing) !== hash) {
        console.log(`SKIP     ${id}  target exists with DIFFERENT bytes — not overwritten: ${path}`);
        summary.skipped++;
        continue;
      }
      console.log(`REUSE    ${id}  identical object already at ${path}`);
      summary.reused++;
    } else if (DRY_RUN) {
      console.log(`WOULD    ${id}  ${mime}  ${bytes.length}B  sha=${hash.slice(0, 12)}…  -> ${path}`);
      summary.migrated++;
      continue;
    } else {
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: mime, upsert: false });
      if (upErr) {
        console.log(`FAIL     ${id}  upload failed (row untouched): ${upErr.message}`);
        summary.failed++;
        continue;
      }
    }

    if (DRY_RUN) {
      console.log(`WOULD    ${id}  reuse existing object and update image_url`);
      continue;
    }

    // ---- Verify the stored bytes BEFORE touching the database -------------
    const check = await downloadIfExists(path);
    if (!check || sha256(check) !== hash) {
      console.log(`FAIL     ${id}  verification failed (row untouched, object left at ${path})`);
      summary.failed++;
      continue;
    }

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path);

    // Guarded on the exact original value: if someone edited this product's
    // image between the select and now, the update matches nothing and their
    // change survives instead of being clobbered.
    const { data: updated, error: updErr } = await supabase
      .from("products")
      .update({ image_url: publicUrl })
      .eq("id", id)
      .eq("image_url", row.image_url)
      .select("id");

    if (updErr) {
      console.log(`FAIL     ${id}  DB update failed — object remains at ${path}: ${updErr.message}`);
      summary.failed++;
      continue;
    }
    if (!updated || updated.length === 0) {
      console.log(`SKIP     ${id}  image_url changed concurrently — object remains at ${path}`);
      summary.skipped++;
      continue;
    }

    console.log(`MIGRATED ${id}  ${mime}  ${bytes.length}B  sha=${hash}  ${path}  ${publicUrl}`);
    summary.migrated++;
  }

  console.log(`\n${DRY_RUN ? "would migrate" : "migrated"}: ${summary.migrated}  reused: ${summary.reused}  skipped: ${summary.skipped}  failed: ${summary.failed}`);
  if (DRY_RUN) console.log("dry run — no Storage object and no product row was written.");
}

main().catch((e) => {
  console.error("unexpected failure:", e.message);
  process.exit(1);
});
