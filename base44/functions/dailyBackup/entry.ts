import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const ENTITIES = [
  "Product", "Category", "InventoryMovement", "Customer", "Supplier",
  "Quote", "Order", "Invoice", "Payment", "BusinessSettings",
  "ImportLog", "Backup", "Notification", "InvoiceLog", "CrmTask"
];
const ENTITY_LABELS = {
  Product: "מוצרים", Category: "קטגוריות", InventoryMovement: "תנועות מלאי",
  Customer: "לקוחות", Supplier: "ספקים", Quote: "הצעות מחיר", Order: "הזמנות",
  Invoice: "חשבוניות", Payment: "תשלומים", BusinessSettings: "הגדרות עסק",
  ImportLog: "יבואות", Backup: "גיבויים", Notification: "התראות", InvoiceLog: "לוג חשבוניות",
  CrmTask: "משימות CRM",
};

async function fetchAll(base44, entityKey) {
  const records = [];
  let page = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities[entityKey].list(null, 500, page * 500);
    records.push(...batch);
    if (batch.length < 500) break;
    page++;
  }
  return records;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const logEntry = await base44.asServiceRole.entities.Backup.create({
      label: `גיבוי אוטומטי — ${new Date().toLocaleDateString("he-IL")}`,
      backup_type: "אוטומטי",
      status: "בתהליך",
      entities_included: Object.values(ENTITY_LABELS).join(", "),
    });

    const snapshot = {};
    const counts = {};

    for (const key of ENTITIES) {
      const records = await fetchAll(base44, key);
      snapshot[key] = records;
      counts[ENTITY_LABELS[key]] = records.length;
    }

    const json = JSON.stringify({ created_at: new Date().toISOString(), data: snapshot });
    const blob = new Blob([json], { type: "application/json" });
    const file = new File([blob], `backup_auto_${Date.now()}.json`, { type: "application/json" });

    const { file_url } = await base44.asServiceRole.integrations.Core.UploadFile({ file });
    const sizeKb = Math.round(blob.size / 1024);

    await base44.asServiceRole.entities.Backup.update(logEntry.id, {
      status: "הושלם",
      data_url: file_url,
      size_kb: sizeKb,
      record_counts: JSON.stringify(counts),
    });

    return Response.json({ success: true, counts, sizeKb });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});