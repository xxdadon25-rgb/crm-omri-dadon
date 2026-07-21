import { supabase } from "@/api/supabaseClient";

const TABLES = [
  "products",
  "customers",
  "orders",
  "invoices",
  "payments",
  "suppliers",
  "quotes",
  "service_calls",
  "business_settings",
  "invoice_attachments",
];

export async function runBackup(type = "ידני") {
  const snapshot = {};
  const counts = {};

  for (const table of TABLES) {
    try {
      const { data, error } = await supabase.from(table).select("*");
      if (error) {
        console.error(`[backup] ERROR on table "${table}":`, error.code, error.message, error.details, error.hint);
        snapshot[table] = [];
        counts[table] = 0;
      } else {
        snapshot[table] = data ?? [];
        counts[table] = (data ?? []).length;
      }
    } catch (err) {
      console.error(`[backup] EXCEPTION on table "${table}":`, err);
      snapshot[table] = [];
      counts[table] = 0;
    }
  }


  const now = new Date();
  const json = JSON.stringify({ created_at: now.toISOString(), type, data: snapshot }, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const sizeKb = Math.round(blob.size / 1024);

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backup_${now.toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  const isoNow = now.toISOString();
  const result = { file_url: url, counts, sizeKb, created_date: isoNow, updated_date: isoNow };
  return result;
}

export async function restoreBackup(backup) {
  if (!backup.data_url) throw new Error("קובץ גיבוי לא נמצא");

  const res = await fetch(backup.data_url);
  if (!res.ok) throw new Error("לא ניתן להוריד את קובץ הגיבוי");
  const { data } = await res.json();

  const results = {};

  for (const table of TABLES) {
    const rows = data[table];
    if (!rows || rows.length === 0) {
      results[table] = 0;
      continue;
    }

    const { data: existing } = await supabase.from(table).select("id");
    const existingIds = new Set((existing ?? []).map((r) => r.id));
    const toInsert = rows.filter((r) => !existingIds.has(r.id));

    for (let i = 0; i < toInsert.length; i += 50) {
      const batch = toInsert.slice(i, i + 50);
      await supabase.from(table).insert(batch).catch((e) => console.warn(`[restore] ${table}:`, e.message));
    }

    results[table] = toInsert.length;
  }

  return results;
}
