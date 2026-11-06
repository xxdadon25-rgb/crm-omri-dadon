import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import EmptyState from "@/components/shared/EmptyState";
import { Banknote, Plus, FileText, CalendarDays, MessageCircle, Receipt } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import {
  resolveReceiptHref, hasReceipt, SHARE_TTL_SECONDS,
} from "@/lib/receiptStorage";
import { displayInvoiceNumber } from "@/utils/invoiceDisplay";

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

export default function LedgerPaymentsTab({ payments, loading, onRecordPayment, invoices, selectedCustomer, businessSettings }) {
  const unpaidInvoices = invoices.filter(i => i.payment_status !== "שולם");
  const invoiceMap = new Map(invoices.map(i => [i.id, i]));

  // A payment split across invoices is stored as several payment rows sharing
  // one payment_group_id. Counting the rows per group lets each line say it is
  // part of one real payment, so the same ₪1,000 is never read as three
  // separate receipts of ₪1,000.
  const groupSizes = new Map();
  for (const p of payments) {
    if (!p.payment_group_id) continue;
    groupSizes.set(p.payment_group_id, (groupSizes.get(p.payment_group_id) || 0) + 1);
  }
  const groupTotals = new Map();
  for (const p of payments) {
    if (!p.payment_group_id) continue;
    groupTotals.set(p.payment_group_id,
      (groupTotals.get(p.payment_group_id) || 0) + (parseFloat(p.amount) || 0));
  }
  /**
   * Open a receipt.
   *
   * A privately stored receipt has to be signed first, and the await would cost
   * us the click gesture — a popup blocker refuses a window opened after one.
   * So the tab is opened SYNCHRONOUSLY, while the gesture is still ours, and
   * navigated once the address is known. A public url needs none of this, but
   * takes the same path so there is only one code path to be right about.
   */
  const handleShowReceipt = async (p) => {
    const tab = window.open("", "_blank");
    const res = await resolveReceiptHref({ supabase, value: p.external_receipt_url });
    if (!res.ok || !res.href) {
      if (tab) tab.close();
      toast.error(res.error || "לא ניתן לפתוח את הקבלה");
      return;
    }
    if (tab) tab.location.href = res.href;
    else window.open(res.href, "_blank");   // the browser blocked the tab
  };

  /**
   * Send the payment confirmation, with a link to the receipt when there can
   * be one.
   *
   * A private receipt is signed for longer here than for a click: the customer
   * has to be able to open it after reading the message. If it cannot be
   * signed the line is LEFT OUT — a message carrying `payment-receipts/...`
   * would be worse than one with no link at all.
   */
  const handlePaymentWhatsApp = async (p) => {
    let receiptUrl = null;
    if (hasReceipt(p.external_receipt_url)) {
      const res = await resolveReceiptHref({
        supabase, value: p.external_receipt_url, expiresIn: SHARE_TTL_SECONDS,
      });
      if (res.ok) receiptUrl = res.href;
      else toast.warning("ההודעה נשלחת ללא קישור לקבלה — לא ניתן להפיק קישור כרגע.");
    }
    const customerName = selectedCustomer?.name || p.customer_name || "";
    const companyName = businessSettings?.business_name || "העסק שלי";
    const msg = [
      `שלום ${customerName},`,
      ``,
      `אישור קבלת תשלום עבור חשבונית #${displayInvoiceNumber(invoiceMap.get(p.invoice_id)) !== "—" ? displayInvoiceNumber(invoiceMap.get(p.invoice_id)) : (p.invoice_number || "—")}`,
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
    const isMonthly = inv.invoice_type === "monthly";
    const label = isMonthly
      ? `חשבונית חודשית #${displayInvoiceNumber(inv)} — ${MONTHS[inv.billing_month] || ""} ${inv.billing_year || ""}`
      : `חשבונית #${displayInvoiceNumber(inv)}`;
    const remaining = ((inv.total || 0) - (inv.paid_amount || 0)).toLocaleString("he-IL", { minimumFractionDigits: 2 });
    const linkLine = inv.external_pdf_url ? `\n\nלצפייה בחשבונית: ${inv.external_pdf_url}` : "";
    const msg = `שלום ${customerName},\n\n${label}\nיתרה לתשלום: ₪${remaining}${linkLine}\n\nבברכה,\n${companyName}`;
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
          {/* There is ONE payment entry point: the per-invoice button below,
              which opens the payment dialog. A payment split across invoices
              is that same dialog with more than one line filled in, so no
              separate action belongs here. */}
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
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
                          ? `חשבונית חודשית #${displayInvoiceNumber(inv)} — ${MONTHS[inv.billing_month] || ""} ${inv.billing_year || ""}`
                          : `חשבונית #${displayInvoiceNumber(inv)}`}
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
                    return (
                      <TableRow key={p.id} className="hover:bg-muted/30">
                        <TableCell className="text-right">{formatDate(p.payment_date)}</TableCell>
                        <TableCell className="font-medium text-right text-green-700">
                          ₪{(p.amount || 0).toLocaleString()}
                          {/* This row is one slice of a larger payment. Saying
                              so, with the real total, prevents the group from
                              being read as several separate payments. */}
                          {p.payment_group_id && groupSizes.get(p.payment_group_id) > 1 && (
                            <span className="block text-[10px] font-normal text-muted-foreground">
                              מתוך תשלום של ₪{(groupTotals.get(p.payment_group_id) || 0).toLocaleString()}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{methodIcons[p.payment_method] || ""} {p.payment_method}</TableCell>
                        <TableCell className="text-right">
                          #{displayInvoiceNumber(invoiceMap.get(p.invoice_id)) !== "—" ? displayInvoiceNumber(invoiceMap.get(p.invoice_id)) : (p.invoice_number || "—")}
                          {p.payment_group_id && groupSizes.get(p.payment_group_id) > 1 && (
                            <Badge className="bg-blue-100 text-blue-700 mr-1 text-[10px] font-normal">
                              תשלום מפוצל · {groupSizes.get(p.payment_group_id)} חשבוניות
                            </Badge>
                          )}
                        </TableCell>
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
                              <Button variant="outline" size="sm" className="text-green-600 border-green-200 hover:bg-green-50 h-7 text-xs px-2 gap-1" onClick={() => handlePaymentWhatsApp(p)}>
                                <MessageCircle className="w-3 h-3" /> WhatsApp
                              </Button>
                              {hasReceipt(p.external_receipt_url) && (
                                <Button variant="outline" size="sm" className="text-blue-600 border-blue-200 hover:bg-blue-50 h-7 text-xs px-2 gap-1" onClick={() => handleShowReceipt(p)}>
                                  <Receipt className="w-3 h-3" /> הצג קבלה
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
