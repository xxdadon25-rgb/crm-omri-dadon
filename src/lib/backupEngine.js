import { createClient } from '@base44/sdk';
import { base44 } from "@/api/base44Client";
import { appParams } from '@/lib/app-params';

const ENTITIES = [
  { key: "Product",           label: "מוצרים" },
  { key: "Category",          label: "קטגוריות" },
  { key: "InventoryMovement", label: "תנועות מלאי" },
  { key: "Customer",          label: "לקוחות" },
  { key: "Supplier",          label: "ספקים" },
  { key: "Quote",             label: "הצעות מחיר" },
  { key: "Order",             label: "הזמנות" },
  { key: "Invoice",           label: "חשבוניות" },
  { key: "Payment",           label: "תשלומים" },
  { key: "BusinessSettings",  label: "הגדרות עסק" },
  { key: "ImportLog",         label: "יבואות" },
  { key: "Backup",            label: "גיבויים" },
  { key: "Notification",      label: "התראות" },
  { key: "InvoiceLog",        label: "לוג חשבוניות" },
  { key: "CrmTask",           label: "משימות CRM" },
];

// Fetch all records for an entity (paginated)
// client parameter: defaults to shared singleton; pass a fresh client to bypass cache
async function fetchAll(entityKey, client = base44) {
  const records = [];
  let page = 0;
  while (true) {
    const batch = await client.entities[entityKey].list(null, 500, page * 500);
    records.push(...batch);
    if (batch.length < 500) break;
    page++;
  }

  return records;
}

export async function runBackup(type = "ידני") {
  console.log("[runBackup] ===== START =====");
  console.log("[runBackup] type:", type);

  // Create a fresh SDK client to bypass the singleton's in-memory cache.
  // This guarantees fetchAll reads current server data, not stale cached responses.
  const freshClient = createClient({
    appId: appParams.appId,
    token: appParams.token,
    requiresAuth: false,
    functionsVersion: appParams.functionsVersion,
    appBaseUrl: appParams.appBaseUrl,
  });

  // Create a log entry
  const payload = {
    label: `גיבוי ${type} — ${new Date().toLocaleDateString("he-IL")}`,
    backup_type: type,
    status: "בתהליך",
    entities_included: ENTITIES.map((e) => e.label).join(", "),
  };
  console.log("[runBackup] Backup.create payload:", JSON.stringify(payload, null, 2));

  const logEntry = await base44.entities.Backup.create(payload);
  console.log("[runBackup] Backup.create returned:", JSON.stringify(logEntry, null, 2));

  try {
    const snapshot = {};
    const counts = {};

    for (const { key, label } of ENTITIES) {
      const records = await fetchAll(key, freshClient);
      snapshot[key] = records;
      counts[label] = records.length;
      console.log(`[runBackup] fetchAll("${key}") → ${records.length} records → counts["${label}"] = ${records.length}`);
    }

    console.log("[runBackup] full counts object:", JSON.stringify(counts, null, 2));

    // Serialize to JSON and upload as a file
    const json = JSON.stringify({ created_at: new Date().toISOString(), data: snapshot }, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const file_url = `data:application/json;base64,${btoa(unescape(encodeURIComponent(json)))}`;

    const sizeKb = Math.round(blob.size / 1024);

    const updatePayload = {
      status: "הושלם",
      data_url: file_url,
      size_kb: sizeKb,
      record_counts: JSON.stringify(counts),
    };
    console.log("[runBackup] Backup.update payload:", JSON.stringify(updatePayload, null, 2));

    const updated = await base44.entities.Backup.update(logEntry.id, updatePayload);
    console.log("[runBackup] Backup.update returned:", JSON.stringify(updated, null, 2));

    const result = { file_url, counts, sizeKb, created_date: updated.created_date, updated_date: updated.updated_date };
    console.log("[runBackup] return value:", JSON.stringify(result, null, 2));
    console.log("[runBackup] ===== END =====");

    return result;
  } catch (err) {
    console.error("[runBackup] ERROR:", err.message);
    await base44.entities.Backup.update(logEntry.id, {
      status: "נכשל",
      error_message: err.message,
    });
    throw err;
  }
}

export async function restoreBackup(backup) {
  if (!backup.data_url) throw new Error("קובץ גיבוי לא נמצא");

  const res = await fetch(backup.data_url);
  if (!res.ok) throw new Error("לא ניתן להוריד את קובץ הגיבוי");
  const { data } = await res.json();

  const results = {};

  for (const { key, label } of ENTITIES) {
    if (!data[key] || data[key].length === 0) {
      results[label] = 0;
      continue;
    }

    // Load existing records to avoid duplicates — use id as key
    const existing = await fetchAll(key);
    const existingIds = new Set(existing.map((r) => r.id));

    let restored = 0;
    const toCreate = data[key].filter((r) => !existingIds.has(r.id));

    // Bulk create in batches of 50
    for (let i = 0; i < toCreate.length; i += 50) {
      const batch = toCreate.slice(i, i + 50).map(({ id, created_date, updated_date, created_by_id, ...rest }) => rest);
      await base44.entities[key].bulkCreate(batch);
    }

    results[label] = toCreate.length;
  }

  return results;
}