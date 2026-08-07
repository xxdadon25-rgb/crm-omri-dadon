import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import EmptyState from "@/components/shared/EmptyState";
import { Banknote, Plus, FileText, CalendarDays, MessageCircle, Loader2, Trash2, Receipt } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";
import { supabase } from "@/api/supabaseClient";
import { displayInvoiceNumber } from "@/utils/invoiceDisplay";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
  const queryClient = useQueryClient();

  const [deletePaymentId, setDeletePaymentId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const handleDeletePayment = async () => {
    const payment = payments.find(p => p.id === deletePaymentId);
    if (!payment) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("payments").delete().eq("id", payment.id);
      if (error) throw error;

      const invoice = invoiceMap.get(payment.invoice_id);
      if (invoice) {
        const newPaid = Math.max(0, (invoice.paid_amount || 0) - (payment.amount || 0));
        const newStatus = newPaid <= 0 ? "ממתין לתשלום" : newPaid >= (invoice.total || 0) ? "שולם" : "שולם חלקית";
        await supabase.from("invoices").update({ paid_amount: newPaid, payment_status: newStatus }).eq("id", invoice.id);
      }

      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("התשלום נמחק בהצלחה");
    } catch (err) {
      toast.error("שגיאה במחיקת התשלום: " + err.message);
    } finally {
      setDeleting(false);
      setDeletePaymentId(null);
    }
  };

  const handlePaymentWhatsApp = (p, receiptUrl) => {
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
                        <TableCell className="font-medium text-right text-green-700">₪{(p.amount || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right">{methodIcons[p.payment_method] || ""} {p.payment_method}</TableCell>
                        <TableCell className="text-right">#{displayInvoiceNumber(invoiceMap.get(p.invoice_id)) !== "—" ? displayInvoiceNumber(invoiceMap.get(p.invoice_id)) : (p.invoice_number || "—")}</TableCell>
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
                              <Button variant="outline" size="sm" className="text-green-600 border-green-200 hover:bg-green-50 h-7 text-xs px-2 gap-1" onClick={() => handlePaymentWhatsApp(p, p.external_receipt_url)}>
                                <MessageCircle className="w-3 h-3" /> WhatsApp
                              </Button>
                              {p.external_receipt_url && (
                                <Button variant="outline" size="sm" className="text-blue-600 border-blue-200 hover:bg-blue-50 h-7 text-xs px-2 gap-1" onClick={() => window.open(p.external_receipt_url, "_blank")}>
                                  <Receipt className="w-3 h-3" /> הצג קבלה
                                </Button>
                              )}
                              <Button variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50 h-7 text-xs px-2 gap-1" onClick={() => setDeletePaymentId(p.id)}>
                                <Trash2 className="w-3 h-3" /> מחק תשלום
                              </Button>
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

      <AlertDialog open={!!deletePaymentId} onOpenChange={(open) => { if (!open) setDeletePaymentId(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>האם למחוק תשלום זה?</AlertDialogTitle>
            <AlertDialogDescription>
              פעולה זו תמחק את התשלום ותעדכן את יתרת החשבונית בהתאם.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel disabled={deleting}>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePayment} disabled={deleting} className="bg-red-600 hover:bg-red-700">
              {deleting ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : null}
              מחק תשלום
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
