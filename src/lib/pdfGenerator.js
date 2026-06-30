import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

/**
 * Renders a document (quote or invoice) as a PDF Blob.
 * Strategy: build an off-screen HTML div, render with html2canvas,
 * embed canvas image into jsPDF. Browser handles Hebrew/RTL natively.
 */
export async function generateDocumentPDF({ type, doc, businessSettings }) {
  const html = buildDocumentHTML({ type, doc, businessSettings });

  const container = document.createElement("div");
  container.style.cssText = [
    "position:fixed",
    "top:-9999px",
    "left:-9999px",
    "width:794px",
    "background:#fff",
    "font-family:'Heebo',Arial,sans-serif",
    "direction:rtl",
    "z-index:-1",
  ].join(";");
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });

    const PDF_W = 210;
    const PDF_H = 297;
    const pxPerMm = canvas.width / PDF_W;
    const pageHeightPx = PDF_H * pxPerMm;
    const totalPages = Math.ceil(canvas.height / pageHeightPx);
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    for (let page = 0; page < totalPages; page++) {
      if (page > 0) pdf.addPage();
      const srcY = page * pageHeightPx;
      const srcH = Math.min(pageHeightPx, canvas.height - srcY);
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width  = canvas.width;
      pageCanvas.height = srcH;
      pageCanvas.getContext("2d").drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
      pdf.addImage(pageCanvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, PDF_W, srcH / pxPerMm);
    }

    return pdf.output("blob");
  } finally {
    document.body.removeChild(container);
  }
}

// ─── MONTHLY INVOICE HTML ────────────────────────────────────────────────────

const MONTH_NAMES = ["","ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

function buildMonthlyInvoiceHTML({ doc, businessSettings }) {
  const biz = {
    name:    businessSettings?.business_name || "",
    address: businessSettings?.address       || "",
    phone:   businessSettings?.phone         || "",
    email:   businessSettings?.email         || "",
    taxId:   businessSettings?.tax_id        || "",
    logo:    businessSettings?.logo_url      || "",
  };

  const items    = doc.items || [];
  const subtotal = parseFloat(doc.subtotal)    || 0;
  const vatRate  = parseFloat(doc.vat_rate)    || 17;
  const vatAmt   = parseFloat(doc.vat_amount)  || 0;
  const total    = parseFloat(doc.total)       || 0;

  const monthLabel = MONTH_NAMES[doc.billing_month] || doc.billing_month || "";
  const title = `חשבונית חודשית — ${monthLabel} ${doc.billing_year || ""}`;

  return `
<div style="width:794px;min-height:1123px;background:#fff;font-family:'Heebo',Arial,sans-serif;direction:rtl;font-size:12px;color:#111;box-sizing:border-box;display:flex;flex-direction:column;border:2px solid #111;margin:0;padding:0">
  <div style="flex:1;display:flex;flex-direction:column">

  <!-- HEADER -->
  <div style="display:flex;align-items:center;height:66px;margin:8px 16px 0;flex-shrink:0;border-bottom:2px solid #111">
    <div style="width:220px;border-left:1px solid #ddd;padding:6px 10px;text-align:right;font-size:10px;color:#333;flex-shrink:0;line-height:1.5">
      ${biz.email   ? `<div>${biz.email}</div>` : ""}
      ${biz.address ? `<div>${biz.address}</div>` : ""}
      ${biz.phone   ? `<div>טלפון: ${biz.phone}</div>` : ""}
      ${biz.taxId   ? `<div style="font-weight:700;margin-top:2px">עוסק מורשה ${biz.taxId}</div>` : ""}
    </div>
    <div style="flex:1;padding:6px 10px;display:flex;flex-direction:column;justify-content:center;align-items:flex-end">
      ${biz.logo ? `<img src="${biz.logo}" style="max-height:32px;max-width:100px;margin-bottom:2px" />` : ""}
      <div style="font-size:18px;font-weight:800;color:#111">${biz.name}</div>
    </div>
  </div>

  <!-- TITLE BAR -->
  <div style="margin:0 16px;border-bottom:2px solid #111;background:#F5C518;display:flex;align-items:center;padding:0 12px;height:28px;flex-shrink:0">
    <div style="flex:1;font-size:15px;font-weight:800;color:#111;text-align:right">${title}</div>
    <div style="flex:1;font-size:12px;font-weight:800;color:#111;text-align:center">מספר: ${doc.invoice_number || "—"}</div>
    <div style="flex:1;font-size:11px;font-weight:700;color:#111;text-align:left">מקור</div>
  </div>

  <!-- CUSTOMER + META -->
  <div style="margin:0 16px;border-bottom:2px solid #111;display:flex;align-items:stretch;flex-shrink:0;min-height:56px">
    <div style="flex:6;padding:6px 10px;font-size:10px;text-align:right;border-left:1px solid #ddd;line-height:1.6">
      <div style="font-size:9.5px;color:#777;margin-bottom:2px">לכבוד:</div>
      <div style="font-size:12px;font-weight:700;margin-bottom:3px">${doc.customer_name || "—"}</div>
      ${doc.customer_address ? `<div style="color:#333">${doc.customer_address}</div>` : ""}
      ${doc.customer_tax_id  ? `<div>ע"מ / ת"ז: ${doc.customer_tax_id}</div>` : ""}
    </div>
    <div style="flex:4;padding:6px 10px;font-size:10px;text-align:right;line-height:1.6">
      <div style="margin-bottom:2px"><span style="font-weight:700">תאריך הפקה:</span> ${fmtDate(doc.date)}</div>
      <div style="margin-bottom:2px"><span style="font-weight:700">תקופת חיוב:</span> ${monthLabel} ${doc.billing_year || ""}</div>
      <div><span style="font-weight:700">סטטוס:</span> ${doc.payment_status || "ממתין לתשלום"}</div>
    </div>
  </div>

  <!-- ORDERS TABLE -->
  <div style="margin:0 16px;border-bottom:2px solid #111">
    <table style="width:100%;border-collapse:collapse;font-size:10px">
      <thead>
        <tr style="background:#F5C518;border-bottom:1px solid #111;height:22px">
          <th style="padding:3px 8px;text-align:right;font-weight:700;border-left:1px solid #999">#</th>
          <th style="padding:3px 8px;text-align:right;font-weight:700;border-left:1px solid #999">פירוט הזמנה</th>
          <th style="padding:3px 8px;text-align:center;font-weight:700;border-left:1px solid #999">כמות</th>
          <th style="padding:3px 8px;text-align:left;font-weight:700;direction:ltr">סה״כ ש״ח (לפני מע״מ)</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item, i) => `
        <tr style="height:20px;border-bottom:1px solid #ddd">
          <td style="padding:2px 8px;text-align:right;border-left:1px solid #ddd;color:#666;font-size:9px">${i + 1}</td>
          <td style="padding:2px 8px;text-align:right;border-left:1px solid #ddd;font-size:9px">${item.name || ""}</td>
          <td style="padding:2px 8px;text-align:center;border-left:1px solid #ddd;font-size:9px">${item.quantity ?? 1}</td>
          <td style="padding:2px 8px;text-align:left;font-size:9px;direction:ltr;font-weight:700">${fmt(item.total || 0)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>

  <!-- TOTALS -->
  <div style="margin:0 16px;border-bottom:2px solid #111;display:flex;justify-content:flex-end;padding:8px 0">
    <div style="width:270px">
      <table style="width:100%;border-collapse:collapse;font-size:10px">
        <tbody>
          <tr style="height:18px">
            <td style="padding:2px 8px;text-align:right;color:#333;border-bottom:1px solid #ddd">סה״כ לפני מע״מ:</td>
            <td style="padding:2px 8px;text-align:left;direction:ltr;border-bottom:1px solid #ddd;font-weight:700">${fmt(subtotal)}</td>
          </tr>
          <tr style="height:18px">
            <td style="padding:2px 8px;text-align:right;color:#333;border-bottom:1px solid #ddd">מע״מ ${vatRate.toFixed(0)}%:</td>
            <td style="padding:2px 8px;text-align:left;direction:ltr;border-bottom:1px solid #ddd;font-weight:700">${fmt(vatAmt)}</td>
          </tr>
          <tr style="background:#F5C518;height:20px">
            <td style="padding:2px 8px;text-align:right;font-weight:800;font-size:11px">סה״כ לתשלום:</td>
            <td style="padding:2px 8px;text-align:left;direction:ltr;font-weight:800;font-size:11px">${fmt(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- SIGNATURE -->
  <div style="margin:6px 16px 0;border-top:1px solid #ccc;padding-top:4px;display:flex;justify-content:space-between;font-size:9px">
    <div><span style="font-weight:700">מפיק המסמך:</span> ${biz.name}&nbsp;&nbsp;____________</div>
    <div style="display:flex;gap:24px">
      <span>שם המקבל _______</span>
      <span>חתימה _______</span>
      <span>תאריך _______</span>
    </div>
  </div>

  </div>
  <div style="margin:4px 16px 8px;border-top:1px solid #ccc;padding-top:3px;text-align:center;font-size:8.5px;color:#888;line-height:1.4">
    ${[biz.name, biz.phone ? `טל׳: ${biz.phone}` : "", biz.email, biz.address].filter(Boolean).join(" | ")}
  </div>
</div>`;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function fmt(n) {
  const num = parseFloat(n) || 0;
  return num.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return "";
  const s = String(d).split("T")[0];
  const [y, m, dd] = s.split("-");
  return `${dd}/${m}/${y}`;
}

// ─── MAIN TEMPLATE ───────────────────────────────────────────────────────────

export function buildDocumentHTML({ type, doc, businessSettings }) {
  if (type === "monthly_invoice") {
    return buildMonthlyInvoiceHTML({ doc, businessSettings });
  }
  const isBusiness = doc.customer_type === "עסקי";
  const docTitle   = type === "quote" ? "הצעת מחיר" : type === "order" ? "הזמנה" : "חשבונית מס";
  const docNum     = type === "quote" ? doc.quote_number : type === "order" ? doc.order_number : doc.invoice_number;
  const items      = doc.items || [];
  const linkedOrder = doc._linkedOrder || null;

  const biz = {
    name:    businessSettings?.business_name || "",
    address: businessSettings?.address       || "",
    phone:   businessSettings?.phone         || "",
    fax:     businessSettings?.fax           || "",
    email:   businessSettings?.email         || "",
    taxId:   businessSettings?.tax_id        || "",
    logo:    businessSettings?.logo_url      || "",
  };

  // ── TOTALS — net-first model: subtotal is post-discount net, total = subtotal + VAT ──
  const grossTotal  = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
  const subtotal    = parseFloat(doc.subtotal)    || 0;
  const discountAmt = grossTotal > 0 ? grossTotal - subtotal : parseFloat(doc.discount_amount) || 0;
  const vatRate     = parseFloat(doc.vat_rate)    || 17;
  const vatAmount   = parseFloat(doc.vat_amount)  || subtotal * (vatRate / 100);
  const total       = parseFloat(doc.total)       || subtotal + vatAmount;
  const discountPct = grossTotal > 0 && discountAmt > 0.001 ? (discountAmt / grossTotal) * 100 : 0;

  const agentName    = doc.agent_name    || "";
  const paymentTerms = doc.payment_terms || businessSettings?.payment_terms || "";

  const notesToShow = [
    doc.customer_notes ? doc.customer_notes : null,
    doc.delivery_notes ? doc.delivery_notes : null,
    (!doc.customer_notes && doc.notes) ? doc.notes : null,
  ].filter(Boolean);

  return `
<div style="width:794px;min-height:1123px;background:#fff;font-family:'Heebo',Arial,sans-serif;direction:rtl;font-size:12px;color:#111;box-sizing:border-box;display:flex;flex-direction:column;border:2px solid #111;margin:0;padding:0">

  <!-- ══ MAIN CONTENT AREA ══════════════════════════════════════════════════ -->
  <div style="flex:1;display:flex;flex-direction:column">

  <!-- ══ COMPANY HEADER ══════════════════════════════════════════════════════ -->
  <div style="display:flex;align-items:center;height:66px;margin:8px 16px 0;flex-shrink:0;border-bottom:2px solid #111">
    <!-- LEFT: Contact info -->
    <div style="width:220px;border-left:1px solid #ddd;padding:6px 10px;text-align:right;font-size:10px;color:#333;flex-shrink:0;line-height:1.5">
      ${biz.email   ? `<div>${biz.email}</div>` : ""}
      ${biz.address ? `<div>${biz.address}</div>` : ""}
      ${biz.phone   ? `<div>טלפון: ${biz.phone}${biz.fax ? "  פקס: " + biz.fax : ""}</div>` : ""}
      ${biz.taxId   ? `<div style="font-weight:700;margin-top:2px;margin-bottom:7px">עוסק מורשה ${biz.taxId}</div>` : ""}
    </div>
    <!-- RIGHT: Name + logo -->
    <div style="flex:1;padding:6px 10px;display:flex;flex-direction:column;justify-content:center;align-items:flex-end">
      ${biz.logo ? `<img src="${biz.logo}" style="max-height:32px;max-width:100px;margin-bottom:2px" />` : ""}
      <div style="font-size:18px;font-weight:800;color:#111">${biz.name}</div>
    </div>
  </div>

  <!-- ══ TITLE BAR ═════════════════════════════════════════════════════════ -->
  <div style="margin:0 16px;border-bottom:2px solid #111;background:#F5C518;display:flex;align-items:center;padding:0 12px;height:28px;flex-shrink:0">
    <!-- RTL: right → center → left -->
    <div style="flex:1;font-size:16px;font-weight:800;color:#111;text-align:right;height:28px;display:flex;align-items:center">${docTitle}</div>
    <div style="flex:1;font-size:12px;font-weight:800;color:#111;text-align:center;height:28px;display:flex;align-items:center;justify-content:center">מספר: ${docNum || "—"}</div>
    <div style="flex:1;font-size:11px;font-weight:700;color:#111;text-align:left;height:28px;display:flex;align-items:center;justify-content:flex-start">מקור</div>
  </div>

  <!-- ══ CUSTOMER + META ════════════════════════════════════════════════════ -->
  <div style="margin:0 16px;border-bottom:2px solid #111;display:flex;align-items:stretch;flex-shrink:0;min-height:60px">
    <!-- RIGHT: Customer (60% width) -->
    <div style="flex:6;padding:6px 10px;font-size:10px;text-align:right;border-left:1px solid #ddd;line-height:1.6">
      <div style="font-size:9.5px;color:#777;margin-bottom:2px">לכבוד:</div>
      <div style="font-size:12px;font-weight:700;margin-bottom:3px">${doc.customer_name || "—"}</div>
      ${doc.customer_address ? `<div style="color:#333;margin-bottom:2px">${doc.customer_address}</div>` : ""}
      ${doc.customer_phone   ? `<div style="margin-bottom:2px">טלפון: ${doc.customer_phone}</div>` : ""}
      ${doc.customer_email   ? `<div style="margin-bottom:2px">דוא"ל: ${doc.customer_email}</div>` : ""}
      ${doc.customer_tax_id  ? `<div style="margin-bottom:2px">ע"מ / ת"ז: ${doc.customer_tax_id}</div>` : ""}
      ${doc.contact_person   ? `<div style="margin-bottom:2px">איש קשר: ${doc.contact_person}</div>` : ""}
      ${doc.customer_type === "עסקי"
        ? `<div style="font-size:9px;color:#1d4ed8;font-weight:600;margin-top:2px">לקוח עסקי</div>`
        : `<div style="font-size:9px;color:#555;font-style:italic;margin-top:2px">לקוח פרטי</div>`}
    </div>
    <!-- LEFT: Doc meta (40% width) -->
    <div style="flex:4;padding:6px 10px;font-size:10px;text-align:right;line-height:1.6">
      <div style="margin-bottom:2px"><span style="font-weight:700">תאריך:</span> ${fmtDate(doc.date)}</div>
      ${agentName    ? `<div style="margin-bottom:2px"><span style="font-weight:700">סוכן:</span> ${agentName}</div>` : ""}
      ${type === "quote" && doc.valid_until ? `<div style="margin-bottom:2px"><span style="font-weight:700">תוקף עד:</span> ${fmtDate(doc.valid_until)}</div>` : ""}
      ${type === "order" && doc.delivery_date ? `<div style="margin-bottom:2px"><span style="font-weight:700">תאריך משלוח:</span> ${fmtDate(doc.delivery_date)}</div>` : ""}
      ${paymentTerms ? `<div style="margin-bottom:2px"><span style="font-weight:700">תנאי תשלום:</span> ${paymentTerms}</div>` : ""}
      ${doc.status   ? `<div style="margin-bottom:2px"><span style="font-weight:700">סטטוס:</span> ${doc.status}</div>` : ""}
      <div>דף 1 מתוך 1</div>
    </div>
  </div>

  <!-- ══ PRODUCTS TABLE ════════════════════════════════════════════════════ -->
  <div style="margin:0 16px;border-bottom:2px solid #111;display:flex;flex-direction:column">
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px">
      <colgroup>
        <col style="width:32px">
        <col style="width:56px">
        <col style="width:320px">
        <col style="width:48px">
        <col style="width:88px">
        <col style="width:120px">
      </colgroup>
      <thead>
        <tr style="background:#F5C518;border-bottom:1px solid #111;height:22px;line-height:22px">
          <th style="padding:3px 4px;text-align:center;vertical-align:middle;font-weight:700;border-left:1px solid #999;font-size:9px;display:table-cell;height:22px">#</th>
          <th style="padding:3px 4px;text-align:center;vertical-align:middle;font-weight:700;border-left:1px solid #999;font-size:9px;display:table-cell;height:22px">מס׳ פריט</th>
          <th style="padding:3px 4px;text-align:center;vertical-align:middle;font-weight:700;border-left:1px solid #999;font-size:9px;display:table-cell;height:22px">תיאור פריט</th>
          <th style="padding:3px 4px;text-align:center;vertical-align:middle;font-weight:700;border-left:1px solid #999;font-size:9px;display:table-cell;height:22px">כמות</th>
          <th style="padding:3px 4px;text-align:center;vertical-align:middle;font-weight:700;border-left:1px solid #999;font-size:9px;direction:ltr;display:table-cell;height:22px">ש״ח ליחידה</th>
          <th style="padding:3px 4px;text-align:center;vertical-align:middle;font-weight:700;font-size:9px;direction:ltr;display:table-cell;height:22px">סה״כ ש״ח</th>
        </tr>
      </thead>
      <tbody>
        ${linkedOrder ? `
        <tr style="background:#e8f0fe;border-bottom:1px solid #bcd">
          <td colspan="6" style="padding:3px 8px;text-align:right;font-size:9px;font-weight:700;color:#1d4ed8">
            הזמנה #${linkedOrder.order_number} — ${fmtDate(linkedOrder.date)}
          </td>
        </tr>` : ""}
        ${items.map((item, i) => `
        <tr style="height:18px;line-height:18px;border-bottom:1px solid #ddd">
          <td style="padding:2px 4px;text-align:center;vertical-align:middle;border-left:1px solid #ddd;color:#666;font-size:8px">${i + 1}</td>
          <td style="padding:2px 4px;text-align:center;vertical-align:middle;border-left:1px solid #ddd;color:#555;font-size:8px">${item.sku || ""}</td>
          <td style="padding:2px 4px;text-align:right;vertical-align:middle;border-left:1px solid #ddd;font-size:9px">${item.name || ""}</td>
          <td style="padding:2px 4px;text-align:center;vertical-align:middle;border-left:1px solid #ddd;font-size:9px">${item.quantity ?? 0}</td>
          <td style="padding:2px 4px;text-align:center;vertical-align:middle;border-left:1px solid #ddd;font-size:9px;direction:ltr">${fmt(item.unit_price || 0)}</td>
          <td style="padding:2px 4px;text-align:center;vertical-align:middle;font-weight:700;font-size:9px;direction:ltr">${fmt(item.total || 0)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>

  <!-- ══ TOTALS + NOTES ════════════════════════════════════════════════════ -->
  <div style="margin:0 16px;border-bottom:2px solid #111;display:flex;align-items:stretch;min-height:80px;flex-shrink:0">

    <!-- Notes (right, fills remaining space) -->
    <div style="flex:1;padding:6px 10px;font-size:9px;color:#444;line-height:1.4;border-left:1px solid #ddd;text-align:right;overflow-y:auto">
      ${notesToShow.map(t => `<div>${t}</div>`).join("")}
    </div>

    <!-- Totals (left, fixed width, compact) -->
    <div style="width:270px;flex-shrink:0">
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px">
        <colgroup>
          <col style="width:160px">
          <col style="width:110px">
        </colgroup>
        <tbody>
          <tr style="height:18px;line-height:18px">
            <td style="padding:2px 8px;text-align:right;color:#333;border-bottom:1px solid #ddd;vertical-align:middle;height:18px">סה"כ ללא מע"מ:</td>
            <td style="padding:2px 8px;text-align:left;direction:ltr;border-bottom:1px solid #ddd;font-weight:700;vertical-align:middle;height:18px">${fmt(grossTotal)}</td>
          </tr>
          ${discountAmt > 0.001 ? `
          <tr style="height:18px;line-height:18px">
            <td style="padding:2px 8px;text-align:right;color:#c00;border-bottom:1px solid #ddd;vertical-align:middle;height:18px">הנחה ${discountPct.toFixed(1)}%:</td>
            <td style="padding:2px 8px;text-align:left;direction:ltr;border-bottom:1px solid #ddd;font-weight:700;color:#c00;vertical-align:middle;height:18px">-${fmt(discountAmt)}</td>
          </tr>
          <tr style="height:18px;line-height:18px">
            <td style="padding:2px 8px;text-align:right;color:#333;border-bottom:1px solid #ddd;vertical-align:middle;height:18px">סה"כ לאחר הנחה:</td>
            <td style="padding:2px 8px;text-align:left;direction:ltr;border-bottom:1px solid #ddd;font-weight:700;vertical-align:middle;height:18px">${fmt(subtotal)}</td>
          </tr>` : ""}
          <tr style="height:18px;line-height:18px">
            <td style="padding:2px 8px;text-align:right;color:#333;border-bottom:1px solid #ddd;vertical-align:middle;height:18px">מע"מ ${vatRate}%:</td>
            <td style="padding:2px 8px;text-align:left;direction:ltr;border-bottom:1px solid #ddd;font-weight:700;vertical-align:middle;height:18px">${fmt(vatAmount)}</td>
          </tr>
          <tr style="background:#F5C518;height:18px;line-height:18px">
            <td style="padding:2px 8px;text-align:right;font-weight:800;font-size:10px;color:#111;border-bottom:none;vertical-align:middle;height:18px">סה"כ לתשלום:</td>
            <td style="padding:2px 8px;text-align:left;font-weight:800;font-size:10px;color:#111;border-bottom:none;direction:ltr;vertical-align:middle;height:18px">${fmt(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>

  </div>

  <!-- ══ SIGNATURE ══════════════════════════════════════════════════════════ -->
  <div style="margin:6px 16px 0;border-top:1px solid #ccc;padding-top:4px;display:flex;justify-content:space-between;align-items:center;font-size:9px;flex-shrink:0">
    <div style="text-align:right">
      <span style="font-weight:700;font-size:9px">מפיק המסמך:</span> ${agentName || biz.name}&nbsp;&nbsp;____________
    </div>
    <div style="display:flex;gap:24px;font-size:9px">
      <span>שם המקבל _______</span>
      <span>חתימה _______</span>
      <span>תאריך _______</span>
    </div>
  </div>

  </div><!-- end flex:1 main content -->

  <!-- ══ FOOTER — pinned to bottom ════════════════════════════════════════ -->
  <div style="margin:4px 16px 8px;border-top:1px solid #ccc;padding-top:3px;text-align:center;font-size:8.5px;color:#888;flex-shrink:0;line-height:1.4">
    ${[biz.name, agentName ? `סוכן: ${agentName}` : "", biz.phone ? `טל׳: ${biz.phone}` : "", biz.email, biz.address].filter(Boolean).join(" | ")}
  </div>

</div>`;
}