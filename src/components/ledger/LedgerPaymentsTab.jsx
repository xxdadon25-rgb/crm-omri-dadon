import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import EmptyState from "@/components/shared/EmptyState";
import { Banknote, Plus, FileText, CalendarDays, MessageCircle } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";

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
