import { base44 } from "@/api/base44Client";

const ENTITIES = [
  { key: "Product",          label: "מוצרים" },
  { key: "Category",         label: "קטגוריות" },
  { key: "InventoryMovement",label: "תנועות מלאי" },
  { key: "Customer",         label: "לקוחות" },
  { key: "Supplier",         label: "ספקים" },
  { key: "Quote",            label: "הצעות מחיר" },
  { key: "Order",            label: "הזמנות" },
  { key: "Invoice",          label: "חשבוניות" },
  { key: "Payment",          label: "תשלומים" },
  { key: "BusinessSettings", label: "הגדרות עסק" },
  { key: "ImportLog",        label: "יבואות" },
  { key: "Notification",     label: "התראות" },
  { key: "InvoiceLog",       label: "לוג חשבוניות" },
  { key: "CrmTask",          label: "משימות CRM" },
];

async function fetchAll(entityKey) {
  const records = [];
  let page = 0;
  while (true) {
    const batch = await base44.entities[entityKey].list(null, 500, page * 500);
    records.push(...batch);
    if (batch.length < 500) break;
    page++;
  }
  return records;
}

export async function runBackup(type = "ידני") {
  const snapshot = {};
  const counts = {};

  for (const { key, label } of ENTITIES) {
    try {
      if (!base44.entities[key]) {
        snapshot[key] = [];
        counts[label] = 0;
        continue;
      }
      const records = await fetchAll(key);
      snapshot[key] = records;
      counts[label] = records.length;
    } catch {
      snapshot[key] = [];
      counts[label] = 0;
    }
  }

  const now = new Date();
  const json = JSON.stringify({ created_at: now.toISOString(), type, data: snapshot }, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const sizeKb = Math.round(blob.size / 1024);

  // Trigger browser download
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backup_${now.toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  const isoNow = now.toISOString();
  return { file_url: url, counts, sizeKb, created_date: isoNow, updated_date: isoNow };
}

export async function restoreBackup(backup) {
  if (!backup.data_url) throw new Error("קובץ גיבוי לא נמצא");

  const res = await fetch(backup.data_url);
  if (!res.ok) throw new Error("לא ניתן להוריד את קובץ הגיבוי");
  const { data } = await res.json();

  const results = {};

  for (const { key, label } of ENTITIES) {
    if (!data[key] || data[key].length === 0 || !base44.entities[key]) {
      results[label] = 0;
      continue;
    }

    const existing = await fetchAll(key).catch(() => []);
    const existingIds = new Set(existing.map((r) => r.id));
    const toCreate = data[key].filter((r) => !existingIds.has(r.id));

    for (let i = 0; i < toCreate.length; i += 50) {
      const batch = toCreate.slice(i, i + 50).map(({ id, created_date, updated_date, created_by_id, ...rest }) => rest);
      await base44.entities[key].bulkCreate(batch).catch(() => {});
    }

    results[label] = toCreate.length;
  }

  return results;
}
