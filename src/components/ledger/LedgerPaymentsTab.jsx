import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import EmptyState from "@/components/shared/EmptyState";
import { Banknote, Plus, FileText, CalendarDays, MessageCircle, Receipt } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";
async function downloadReceiptPDF(payment, businessSettings) {
  const fmtDate = (d) => {
    if (!d) return "";
    const s = String(d).split("T")[0];
    const [y, m, dd] = s.split("-");
    return `${dd}/${m}/${y}`;
  };
  const fmt = (n) => (parseFloat(n) || 0).toLocaleString("he-IL", { minimumFractionDigits: 2 });
  const biz = businessSettings || {};
  const html = `
<div style="width:794px;min-height:500px;background:#fff;font-family:'Heebo',Arial,sans-serif;direction:rtl;font-size:12px;color:#111;box-sizing:border-box;border:2px solid #111;padding:0">
  <!-- HEADER -->
  <div style="display:flex;align-items:center;height:66px;margin:8px 16px 0;border-bottom:2px solid #111">
    <div style="width:220px;border-left:1px solid #ddd;padding:6px 10px;font-size:10px;color:#333;line-height:1.5">
      ${biz.email   ? `<div>${biz.email}</div>` : ""}
      ${biz.address ? `<div>${biz.address}</div>` : ""}
      ${biz.phone   ? `<div>טלפון: ${biz.phone}</div>` : ""}
      ${biz.tax_id  ? `<div style="font-weight:700;margin-top:2px">עוסק מורשה ${biz.tax_id}</div>` : ""}
    </div>
    <div style="flex:1;padding:6px 10px;display:flex;flex-direction:column;justify-content:center;align-items:flex-end">
      ${biz.logo_url ? `<img src="${biz.logo_url}" style="max-height:32px;max-width:100px;margin-bottom:2px" />` : ""}
      <div style="font-size:18px;font-weight:800">${biz.business_name || ""}</div>
    </div>
  </div>
  <!-- TITLE -->
  <div style="margin:0 16px;border-bottom:2px solid #111;background:#F5C518;display:flex;align-items:center;padding:0 12px;height:28px">
    <div style="flex:1;font-size:15px;font-weight:800;text-align:right">חשבונית מס קבלה</div>
    <div style="flex:1;font-size:12px;font-weight:700;text-align:center">חשבונית #${payment.invoice_number || "—"}</div>
    <div style="flex:1;font-size:11px;font-weight:700;text-align:left">מקור</div>
  </div>
  <!-- META -->
  <div style="margin:0 16px;border-bottom:2px solid #111;display:flex;min-height:56px">
    <div style="flex:6;padding:8px 10px;font-size:11px;border-left:1px solid #ddd;line-height:1.8">
      <div style="font-size:9.5px;color:#777">לכבוד:</div>
      <div style="font-size:13px;font-weight:700">${payment.customer_name || "—"}</div>
    </div>
    <div style="flex:4;padding:8px 10px;font-size:11px;line-height:1.8">
      <div><span style="font-weight:700">תאריך תשלום:</span> ${fmtDate(payment.payment_date)}</div>
      <div><span style="font-weight:700">אמצעי תשלום:</span> ${payment.payment_method || "—"}</div>
      ${payment.reference ? `<div><span style="font-weight:700">אסמכתא:</span> ${payment.reference}</div>` : ""}
    </div>
  </div>
  <!-- PAYMENT ROW -->
  <div style="margin:0 16px;border-bottom:2px solid #111">
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead>
        <tr style="background:#F5C518;height:22px;border-bottom:1px solid #111">
          <th style="padding:3px 8px;text-align:right;border-left:1px solid #999">פירוט</th>
          <th style="padding:3px 8px;text-align:left;direction:ltr">סכום ש״ח</th>
        </tr>
      </thead>
      <tbody>
        <tr style="height:28px;border-bottom:1px solid #ddd">
          <td style="padding:4px 8px;text-align:right;border-left:1px solid #ddd">קבלה עבור חשבונית #${payment.invoice_number || "—"}</td>
          <td style="padding:4px 8px;text-align:left;direction:ltr;font-weight:700">${fmt(payment.amount)}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <!-- TOTAL -->
  <div style="margin:0 16px;border-bottom:2px solid #111;display:flex;justify-content:flex-end;padding:8px 0">
    <table style="width:270px;border-collapse:collapse;font-size:11px">
      <tr style="background:#F5C518;height:22px">
        <td style="padding:3px 8px;text-align:right;font-weight:800;font-size:12px">סה״כ שולם:</td>
        <td style="padding:3px 8px;text-align:left;direction:ltr;font-weight:800;font-size:12px">${fmt(payment.amount)}</td>
      </tr>
    </table>
  </div>
  <!-- NOTES -->
  ${payment.notes ? `<div style="margin:8px 16px;font-size:10px;color:#555">הערות: ${payment.notes}</div>` : ""}
  <!-- SIGNATURE -->
  <div style="margin:8px 16px;border-top:1px solid #ccc;padding-top:6px;display:flex;justify-content:space-between;font-size:9px">
    <div><span style="font-weight:700">מפיק המסמך:</span> ${biz.business_name || ""}&nbsp;&nbsp;____________</div>
    <div style="display:flex;gap:24px"><span>שם המקבל _______</span><span>חתימה _______</span><span>תאריך _______</span></div>
  </div>
  <!-- FOOTER -->
  <div style="margin:4px 16px 8px;border-top:1px solid #ccc;padding-top:3px;text-align:center;font-size:8.5px;color:#888">
    ${[biz.business_name, biz.phone ? `טל׳: ${biz.phone}` : "", biz.email, biz.address].filter(Boolean).join(" | ")}
  </div>
</div>`;

  const { default: html2canvas } = await import("html2canvas");
  const { jsPDF } = await import("jspdf");

  const container = document.createElement("div");
  container.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:794px;background:#fff;font-family:'Heebo',Arial,sans-serif;direction:rtl;z-index:-1";
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const PDF_W = 210;
    const imgH = (canvas.height / canvas.width) * PDF_W;
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, PDF_W, imgH);
    pdf.save(`receipt_${payment.invoice_number || payment.id}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}

const methodIcons = {
  "מזומן": "💵",
  "כרטיס אשראי": "💳",
  "העברה בנקאית": "🏦",
  "שיק": "📝",
  "ביט": "📱",
  "פייבוקס": "📱",
  "אחר": "💰",
};

const statusColors = {
  "ממתין": "bg-yellow-100 text-yellow-700",
  "אושר": "bg-green-100 text-green-700",
  "נכשל": "bg-red-100 text-red-700",
  "בוטל": "bg-gray-100 text-gray-700",
};

const MONTHS = ["","ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

export default function LedgerPaymentsTab({ payments, loading, onRecordPayment, invoices, selectedCustomer, businessSettings }) {
  const unpaidInvoices = invoices.filter(i => i.payment_status !== "שולם");
  const invoiceMap = new Map(invoices.map(i => [i.id, i]));

  const handlePaymentWhatsApp = (p) => {
    const customerName = selectedCustomer?.name || p.customer_name || "";
    const companyName = businessSettings?.business_name || "העסק שלי";
    const inv = invoiceMap.get(p.invoice_id);
    const invoiceUrl = inv ? `${window.location.origin}/invoice-pdf/${inv.id}` : "";
    const fmt = (n) => (parseFloat(n) || 0).toLocaleString("he-IL", { minimumFractionDigits: 2 });
    const fmtDate = (d) => {
      if (!d) return "";
      const s = String(d).split("T")[0];
      const [y, m, dd] = s.split("-");
      return `${dd}/${m}/${y}`;
    };
    const msg = [
      `שלום ${customerName},`,
      ``,
      `אישור קבלת תשלום עבור חשבונית #${p.invoice_number || "—"}`,
      `סכום: ₪${fmt(p.amount)}`,
      `אמצעי תשלום: ${p.payment_method || "—"}`,
      `תאריך: ${fmtDate(p.payment_date)}`,
      p.reference ? `אסמכתא: ${p.reference}` : null,
      ``,
      invoiceUrl ? `לצפייה בחשבונית: ${invoiceUrl}` : null,
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
                    <TableHead className="text-right w-24">פעולות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map(p => (
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
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" title="WhatsApp" onClick={() => handlePaymentWhatsApp(p)}>
                              <MessageCircle className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600" title="חשבונית מס קבלה" onClick={() => downloadReceiptPDF(p, businessSettings)}>
                              <Receipt className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
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
