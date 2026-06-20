/**
 * Parse a CSV file into array of row objects.
 * Handles BOM, quoted fields, and Hebrew headers.
 */
export function parseCSV(text) {
  // Strip BOM
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = splitCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i]);
    if (values.every((v) => !v.trim())) continue;
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
    });
    rows.push(row);
  }
  return { headers, rows };
}

function splitCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// WooCommerce column → internal field mapping
export const WOOCOMMERCE_MAP = {
  'שם': 'name',
  'מק"ט': 'sku',
  'מחיר רגיל': 'sell_price',
  'מחיר מבצע': 'sale_price',
  'קטגוריות': 'category',
  'תיאור': 'description',
  'תיאור קצר': 'short_description',
  'מלאי': 'quantity',
  'במלאי?': 'stock_status',
  'תמונות': 'image_url',
  'תגיות': 'tags',
  'משקל (ק"ג)': 'weight',
  'מזהה': 'external_id',
};

export const FIELD_LABELS = {
  name: 'שם מוצר',
  sku: 'מק״ט',
  sell_price: 'מחיר מכירה',
  sale_price: 'מחיר מבצע',
  category: 'קטגוריה',
  description: 'תיאור',
  short_description: 'תיאור קצר',
  quantity: 'כמות במלאי',
  stock_status: 'סטטוס מלאי',
  image_url: 'תמונה',
  tags: 'תגיות',
  weight: 'משקל',
  external_id: 'מזהה חיצוני',
};

export function autoDetectMapping(headers) {
  const mapping = {};
  headers.forEach((h) => {
    const stripped = h.replace(/^\uFEFF/, "").trim();
    if (WOOCOMMERCE_MAP[stripped]) {
      mapping[stripped] = WOOCOMMERCE_MAP[stripped];
    }
  });
  return mapping;
}

export function applyMapping(row, mapping) {
  const mapped = {};
  Object.entries(mapping).forEach(([csvCol, field]) => {
    if (field && row[csvCol] !== undefined) {
      mapped[field] = row[csvCol];
    }
  });
  return mapped;
}

export function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}