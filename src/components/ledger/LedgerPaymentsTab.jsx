import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import EmptyState from "@/components/shared/EmptyState";
import { Banknote, Plus, FileText, CalendarDays, MessageCircle, Loader2, ExternalLink } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";
import { supabase } from "@/api/supabaseClient";

const methodIcons = {
  "מזומן": "💵", "כרטיס אשראי": "💳", "העברה בנקאית": "🏦",
  "שיק": "📝", "ביט": "📱", "פייבוקס": "📱", "אחר": "💰",
};

const statusColors = {
  "ממתין": "bg-yellow-100 text-yellow-700",
  "אושר": "bg-green-100 text-green-700",
  "נכשל": "bg-red-100 text-red-700",
  "בוטל": "bg-gray-100 text-gray-700",
};

const MONTHS = ["","ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

function fmtDate(d) {
  if (!d) return "";
  const s = String(d).split("T")[0];
  const [y, m, dd] = s.split("-");
  return `${dd}/${m}/${y}`;
}
function fmt(n) {
  return (parseFloat(n) || 0).toLocaleString("he-IL", { minimumFractionDigits: 2 });
}

function buildReceiptHTML(payment, invoice, businessSettings) {
  const biz = businessSettings || {};
  const items = invoice?.items || [];

  const itemRows = items.map((item, i) => `
    <tr style="height:20px;border-bottom:1px solid #e5e7eb">
      <td style="padding:3px 8px;text-align:center;border-left:1px solid #e5e7eb;color:#666;font-size:9px">${i + 1}</td>
      <td style="padding:3px 8px;text-align:center;border-left:1px solid #e5e7eb;color:#555;font-size:9px">${item.sku || ""}</td>
      <td style="padding:3px 8px;text-align:right;border-left:1px solid #e5e7eb;font-size:9px">${item.name || ""}</td>
      <td style="padding:3px 8px;text-align:center;border-left:1px solid #e5e7eb;font-size:9px">${item.quantity ?? 0}</td>
      <td style="padding:3px 8px;text-align:left;border-left:1px solid #e5e7eb;font-size:9px;direction:ltr">${fmt(item.unit_price || 0)}</td>
      <td style="padding:3px 8px;text-align:left;font-weight:700;font-size:9px;direction:ltr">${fmt(item.total || 0)}</td>
    </tr>`).join("");

  const invoiceTotal = fmt(invoice?.total || 0);
  const invoiceSubtotal = fmt(invoice?.subtotal || 0);
  const invoiceVat = fmt(invoice?.vat_amount || 0);
  const vatRate = invoice?.vat_rate || 17;

  return `
<div style="width:794px;background:#fff;font-family:'Heebo',Arial,sans-serif;direction:rtl;font-size:12px;color:#111;box-sizing:border-box;border:2px solid #111;padding:0">

  <!-- HEADER -->
  <div style="display:flex;align-items:center;height:66px;margin:8px 16px 0;border-bottom:2px solid #111;flex-shrink:0">
    <div style="width:220px;border-left:1px solid #ddd;padding:6px 10px;font-size:10px;color:#333;line-height:1.6;flex-shrink:0">
      ${biz.email   ? `<div>${biz.email}</div>` : ""}
      ${biz.address ? `<div>${biz.address}</div>` : ""}
      ${biz.phone   ? `<div>טלפון: ${biz.phone}</div>` : ""}
      ${biz.tax_id  ? `<div style="font-weight:700;margin-top:2px">עוסק מורשה ${biz.tax_id}</div>` : ""}
    </div>
    <div style="flex:1;padding:6px 10px;display:flex;flex-direction:column;justify-content:center;align-items:flex-end">
      ${biz.logo_url ? `<img src="${biz.logo_url}" style="max-height:32px;max-width:100px;margin-bottom:4px" crossorigin="anonymous" />` : ""}
      <div style="font-size:18px;font-weight:800;color:#111">${biz.business_name || ""}</div>
    </div>
  </div>

  <!-- TITLE BAR -->
  <div style="margin:0 16px;border-bottom:2px solid #111;background:#F5C518;display:flex;align-items:center;padding:0 12px;height:28px;flex-shrink:0">
    <div style="flex:1;font-size:15px;font-weight:800;text-align:right">חשבונית מס קבלה</div>
    <div style="flex:1;font-size:12px;font-weight:700;text-align:center">חשבונית #${payment.invoice_number || "—"}</div>
    <div style="flex:1;font-size:11px;font-weight:700;text-align:left">מקור</div>
  </div>

  <!-- CUSTOMER + PAYMENT META -->
  <div style="margin:0 16px;border-bottom:2px solid #111;display:flex;min-height:64px">
    <div style="flex:6;padding:8px 10px;font-size:10px;border-left:1px solid #ddd;line-height:1.7">
      <div style="font-size:9px;color:#777;margin-bottom:2px">לכבוד:</div>
      <div style="font-size:13px;font-weight:700;margin-bottom:3px">${payment.customer_name || "—"}</div>
      ${invoice?.customer_address ? `<div style="color:#444">${invoice.customer_address}</div>` : ""}
      ${invoice?.customer_tax_id  ? `<div>ע"מ / ת"ז: ${invoice.customer_tax_id}</div>` : ""}
    </div>
    <div style="flex:4;padding:8px 10px;font-size:10px;line-height:1.7">
      <div><span style="font-weight:700">תאריך תשלום:</span> ${fmtDate(payment.payment_date)}</div>
      <div><span style="font-weight:700">אמצעי תשלום:</span> ${payment.payment_method || "—"}</div>
      ${payment.reference ? `<div><span style="font-weight:700">אסמכתא:</span> ${payment.reference}</div>` : ""}
      <div><span style="font-weight:700">תאריך חשבונית:</span> ${fmtDate(invoice?.date)}</div>
    </div>
  </div>

  <!-- ITEMS TABLE -->
  <div style="margin:0 16px;border-bottom:2px solid #111">
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px">
      <colgroup>
        <col style="width:28px">
        <col style="width:56px">
        <col style="width:320px">
        <col style="width:50px">
        <col style="width:96px">
        <col style="width:120px">
      </colgroup>
      <thead>
        <tr style="background:#F5C518;border-bottom:1px solid #111;height:22px">
          <th style="padding:3px 4px;text-align:center;border-left:1px solid #999;font-size:9px">#</th>
          <th style="padding:3px 4px;text-align:center;border-left:1px solid #999;font-size:9px">מס׳ פריט</th>
          <th style="padding:3px 4px;text-align:center;border-left:1px solid #999;font-size:9px">תיאור פריט</th>
          <th style="padding:3px 4px;text-align:center;border-left:1px solid #999;font-size:9px">כמות</th>
          <th style="padding:3px 4px;text-align:center;border-left:1px solid #999;font-size:9px;direction:ltr">ש״ח ליחידה</th>
          <th style="padding:3px 4px;text-align:center;font-size:9px;direction:ltr">סה״כ ש״ח</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows || `<tr><td colspan="6" style="padding:8px;text-align:center;color:#aaa;font-size:9px">אין פריטים</td></tr>`}
      </tbody>
    </table>
  </div>

  <!-- TOTALS + PAYMENT SUMMARY -->
  <div style="margin:0 16px;border-bottom:2px solid #111;display:flex;justify-content:flex-end;padding:6px 0">
    <table style="width:270px;border-collapse:collapse;font-size:10px">
      <tbody>
        <tr style="height:18px">
          <td style="padding:2px 8px;text-align:right;color:#555;border-bottom:1px solid #e5e7eb">סה"כ לפני מע"מ:</td>
          <td style="padding:2px 8px;text-align:left;direction:ltr;border-bottom:1px solid #e5e7eb;font-weight:700">${invoiceSubtotal}</td>
        </tr>
        <tr style="height:18px">
          <td style="padding:2px 8px;text-align:right;color:#555;border-bottom:1px solid #e5e7eb">מע"מ ${vatRate}%:</td>
          <td style="padding:2px 8px;text-align:left;direction:ltr;border-bottom:1px solid #e5e7eb;font-weight:700">${invoiceVat}</td>
        </tr>
        <tr style="height:18px">
          <td style="padding:2px 8px;text-align:right;color:#555;border-bottom:1px solid #e5e7eb">סה"כ חשבונית:</td>
          <td style="padding:2px 8px;text-align:left;direction:ltr;border-bottom:1px solid #e5e7eb;font-weight:700">${invoiceTotal}</td>
        </tr>
        <tr style="background:#d1fae5;height:20px">
          <td style="padding:3px 8px;text-align:right;font-weight:800;font-size:11px;color:#065f46">סכום ששולם:</td>
          <td style="padding:3px 8px;text-align:left;direction:ltr;font-weight:800;font-size:11px;color:#065f46">${fmt(payment.amount)}</td>
        </tr>
        ${(invoice?.total || 0) - (payment.amount || 0) > 0.01 ? `
        <tr style="background:#fee2e2;height:18px">
          <td style="padding:2px 8px;text-align:right;font-weight:700;color:#991b1b">יתרה לתשלום:</td>
          <td style="padding:2px 8px;text-align:left;direction:ltr;font-weight:700;color:#991b1b">${fmt((invoice?.total || 0) - (payment.amount || 0))}</td>
        </tr>` : ""}
      </tbody>
    </table>
  </div>

  ${payment.notes ? `<div style="margin:6px 16px;font-size:10px;color:#555">הערות: ${payment.notes}</div>` : ""}

  <!-- SIGNATURE -->
  <div style="margin:6px 16px 0;border-top:1px solid #ccc;padding-top:5px;display:flex;justify-content:space-between;font-size:9px">
    <div><span style="font-weight:700">מפיק המסמך:</span> ${biz.business_name || ""}&nbsp;&nbsp;____________</div>
    <div style="display:flex;gap:24px">
      <span>שם המקבל _______</span><span>חתימה _______</span><span>תאריך _______</span>
    </div>
  </div>

  <!-- FOOTER -->
  <div style="margin:4px 16px 8px;border-top:1px solid #ccc;padding-top:3px;text-align:center;font-size:8.5px;color:#888">
    ${[biz.business_name, biz.phone ? `טל׳: ${biz.phone}` : "", biz.email, biz.address].filter(Boolean).join(" | ")}
  </div>
</div>`;
}

async function generateReceiptBlob(payment, invoice, businessSettings) {
  const html = buildReceiptHTML(payment, invoice, businessSettings);
  const { default: html2canvas } = await import("html2canvas");
  const { jsPDF } = await import("jspdf");

  const container = document.createElement("div");
  container.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:794px;background:#fff;font-family:'Heebo',Arial,sans-serif;direction:rtl;z-index:-1";
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false });
    const PDF_W = 210;
    const imgH = (canvas.height / canvas.width) * PDF_W;
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, PDF_W, imgH);
    return pdf.output("blob");
  } finally {
    document.body.removeChild(container);
  }
}

export default function LedgerPaymentsTab({ payments, loading, onRecordPayment, invoices, selectedCustomer, businessSettings }) {
  const unpaidInvoices = invoices.filter(i => i.payment_status !== "שולם");
  const invoiceMap = new Map(invoices.map(i => [i.id, i]));

  // receiptState: { [paymentId]: { loading: bool, url: string|null } }
  const [receiptState, setReceiptState] = useState({});

  const handleGenerateReceipt = async (p) => {
    setReceiptState(prev => ({ ...prev, [p.id]: { loading: true, url: null } }));
    try {
      const invoice = invoiceMap.get(p.invoice_id) || null;
      const blob = await generateReceiptBlob(p, invoice, businessSettings);
      const filePath = `receipts/${p.invoice_id}/receipt_${p.invoice_number || p.id}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from("payment-attachments")
        .upload(filePath, blob, { contentType: "application/pdf", upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from("payment-attachments").getPublicUrl(filePath);
      setReceiptState(prev => ({ ...prev, [p.id]: { loading: false, url: publicUrl } }));
    } catch (err) {
      console.error("[receipt]", err);
      setReceiptState(prev => ({ ...prev, [p.id]: { loading: false, url: null } }));
    }
  };

  const handlePaymentWhatsApp = (p, receiptUrl) => {
    const customerName = selectedCustomer?.name || p.customer_name || "";
    const companyName = businessSettings?.business_name || "העסק שלי";
    const msg = [
      `שלום ${customerName},`,
      ``,
      `אישור קבלת תשלום עבור חשבונית #${p.invoice_number || "—"}`,
      `סכום: ₪${fmt(p.amount)}`,
      `אמצעי תשלום: ${p.payment_method || "—"}`,
      `תאריך: ${fmtDate(p.payment_date)}`,
      p.reference ? `אסמכתא: ${p.reference}` : null,
      ``,
      receiptUrl ? `חשבונית מס קבלה: ${receiptUrl}` : null,
      ``,
      `בברכה,`,
      companyName,
    ].filter(l => l !== null).join("\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const handleWhatsApp = (inv) => {
    const customerName = selectedCustomer?.name || inv.customer_name || "";
    const companyName = businessSettings?.business_name || "העסק שלי";
    const invoiceUrl = `${window.location.origin}/invoice-pdf/${inv.id}`;
    const isMonthly = inv.invoice_type === "monthly";
    const label = isMonthly
      ? `חשבונית חודשית #${inv.invoice_number} — ${MONTHS[inv.billing_month] || ""} ${inv.billing_year || ""}`
      : `חשבונית #${inv.invoice_number}`;
    const remaining = ((inv.total || 0) - (inv.paid_amount || 0)).toLocaleString("he-IL", { minimumFractionDigits: 2 });
    const msg = `שלום ${customerName},\n\n${label}\nיתרה לתשלום: ₪${remaining}\n\nלצפייה בחשבונית: ${invoiceUrl}\n\nבברכה,\n${companyName}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  if (loading) {
    return (
      <div className="bg-card rounded-xl border border-border flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {unpaidInvoices.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">חשבוניות לתשלום ({unpaidInvoices.length})</h3>
          </div>
          <div className="grid gap-2">
            {unpaidInvoices.map(inv => {
              const remaining = (inv.total || 0) - (inv.paid_amount || 0);
              const isMonthly = inv.invoice_type === "monthly";
              return (
                <div key={inv.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
                  <div className="flex items-center gap-3">
                    {isMonthly
                      ? <CalendarDays className="w-4 h-4 text-blue-500" />
                      : <FileText className="w-4 h-4 text-muted-foreground" />}
                    <div>
                      <p className="text-sm font-medium">
                        {isMonthly
                          ? `חשבונית חודשית #${inv.invoice_number || "—"} — ${MONTHS[inv.billing_month] || ""} ${inv.billing_year || ""}`
                          : `חשבונית #${inv.invoice_number || "—"}`}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDate(inv.date)} · {inv.payment_status}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-red-600">₪{remaining.toLocaleString()}</span>
                    <Button size="sm" onClick={() => onRecordPayment(inv)}>
                      <Plus className="w-3.5 h-3.5 ml-1" /> תשלום
                    </Button>
                    <Button size="sm" variant="outline" className="text-green-600 border-green-200 hover:bg-green-50 px-2" onClick={() => handleWhatsApp(inv)} title="WhatsApp">
                      <MessageCircle className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {payments.length === 0 ? (
          <EmptyState icon={Banknote} title="אין תשלומים" description="לא נמצאו תשלומים עבור לקוח זה" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-right">תאריך</TableHead>
                    <TableHead className="text-right">סכום</TableHead>
                    <TableHead className="text-right">אמצעי</TableHead>
                    <TableHead className="text-right">חשבונית</TableHead>
                    <TableHead className="text-right">אסמכתא</TableHead>
                    <TableHead className="text-right">סטטוס</TableHead>
                    <TableHead className="text-right">הערות</TableHead>
                    <TableHead className="text-right">פעולות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map(p => {
                    const rs = receiptState[p.id];
                    return (
                      <TableRow key={p.id} className="hover:bg-muted/30">
                        <TableCell className="text-right">{formatDate(p.payment_date)}</TableCell>
                        <TableCell className="font-medium text-right text-green-700">₪{(p.amount || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right">{methodIcons[p.payment_method] || ""} {p.payment_method}</TableCell>
                        <TableCell className="text-right">#{p.invoice_number || "—"}</TableCell>
                        <TableCell className="text-right text-muted-foreground text-sm">{p.reference || "—"}</TableCell>
                        <TableCell className="text-right">
                          <Badge className={statusColors[p.status] || "bg-gray-100 text-gray-700"}>
                            {p.status || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground text-sm">{p.notes || "—"}</TableCell>
                        <TableCell className="text-right">
                          {p.status === "אושר" && (
                            <div className="flex flex-col gap-1 items-end">
                              <Button variant="outline" size="sm" className="text-green-600 border-green-200 hover:bg-green-50 h-7 text-xs px-2 gap-1" onClick={() => handlePaymentWhatsApp(p, rs?.url)}>
                                <MessageCircle className="w-3 h-3" /> WhatsApp
                              </Button>
                              {rs?.url ? (
                                <Button variant="outline" size="sm" className="text-blue-600 border-blue-200 hover:bg-blue-50 h-7 text-xs px-2 gap-1" onClick={() => window.open(rs.url, "_blank")}>
                                  <ExternalLink className="w-3 h-3" /> פתח חשבונית מס קבלה
                                </Button>
                              ) : (
                                <Button variant="outline" size="sm" className="h-7 text-xs px-2 gap-1" disabled={rs?.loading} onClick={() => handleGenerateReceipt(p)}>
                                  {rs?.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                  הפק חשבונית מס קבלה
                                </Button>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="px-4 py-3 border-t border-border bg-muted/30 text-sm text-muted-foreground text-left">
              סה״כ {payments.length} תשלומים |
              סה״כ שולם: ₪{payments.reduce((s, p) => s + (p.amount || 0), 0).toLocaleString()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
