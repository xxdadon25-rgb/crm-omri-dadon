import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Printer, MessageCircle, X, Wallet } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";

const paymentColors = {
  "ממתין לתשלום": "bg-orange-100 text-orange-700",
  "שולם חלקית": "bg-yellow-100 text-yellow-700",
  "שולם": "bg-green-100 text-green-700",
  "באיחור": "bg-red-100 text-red-700",
};

export default function LedgerInvoicePreview({ invoice, onClose, businessSettings, selectedCustomer, onRecordPayment }) {
  if (!invoice) return null;

  const handlePDF = () => {
    window.open(`${window.location.origin}/invoice-pdf/${invoice.id}`, "_blank");
  };

  const handleWhatsApp = () => {
    const customerName = selectedCustomer?.name || invoice.customer_name || "";
    const companyName = businessSettings?.business_name || "העסק שלי";
    const invoiceUrl = `${window.location.origin}/invoice-pdf/${invoice.id}`;
    const msg =
`🧾 חשבונית #${invoice.invoice_number || invoice.id}

שלום ${customerName},

מצורפת החשבונית שלך.

${invoiceUrl}

בברכה,
${companyName}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  return (
    <Dialog open={!!invoice} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>חשבונית #{invoice.invoice_number || "—"}</span>
            <Badge className={paymentColors[invoice.payment_status] || "bg-gray-100 text-gray-700"}>
              {invoice.payment_status || "—"}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 text-sm border border-border rounded-lg p-4 bg-muted/30">
          <div>
            <p className="font-semibold text-muted-foreground mb-1">מפרטי</p>
            <p className="font-bold">{businessSettings?.business_name || "העסק שלי"}</p>
            {businessSettings?.address && <p>{businessSettings.address}</p>}
            {businessSettings?.tax_id && <p>ח.פ: {businessSettings.tax_id}</p>}
          </div>
          <div>
            <p className="font-semibold text-muted-foreground mb-1">לקוח</p>
            <p className="font-bold">{invoice.customer_name}</p>
            {invoice.customer_tax_id && <p>ח.פ: {invoice.customer_tax_id}</p>}
            {invoice.customer_address && <p>{invoice.customer_address}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-muted-foreground">תאריך חשבונית: </span><span className="font-medium">{formatDate(invoice.date)}</span></div>
          {invoice.due_date && (
            <div><span className="text-muted-foreground">לתשלום עד: </span><span className="font-medium">{formatDate(invoice.due_date)}</span></div>
          )}
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-right px-3 py-2">פריט</th>
                <th className="text-right px-3 py-2">כמות</th>
                <th className="text-right px-3 py-2">מחיר יחידה</th>
                <th className="text-right px-3 py-2">הנחה %</th>
                <th className="text-right px-3 py-2">סה״כ</th>
              </tr>
            </thead>
            <tbody>
              {(invoice.items || []).map((item, i) => (
                <tr key={i} className="border-t border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{item.name}</td>
                  <td className="px-3 py-2">{item.quantity} {item.unit || ""}</td>
                  <td className="px-3 py-2">₪{(item.unit_price || 0).toLocaleString()}</td>
                  <td className="px-3 py-2">{item.discount ? `${item.discount}%` : "—"}</td>
                  <td className="px-3 py-2 font-medium">₪{(item.total || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            {invoice.subtotal != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">סה״כ לפני מע״מ</span>
                <span>₪{(invoice.subtotal || 0).toLocaleString()}</span>
              </div>
            )}
            {invoice.vat_amount != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">מע״מ ({invoice.vat_rate || 17}%)</span>
                <span>₪{(invoice.vat_amount || 0).toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base border-t border-border pt-1 mt-1">
              <span>סה״כ</span>
              <span>₪{(invoice.total || 0).toLocaleString()}</span>
            </div>
            {invoice.paid_amount > 0 && (
              <div className="flex justify-between text-green-700">
                <span>שולם</span>
                <span>₪{(invoice.paid_amount || 0).toLocaleString()}</span>
              </div>
            )}
            {invoice.payment_status !== "שולם" && (
              <div className="flex justify-between font-bold text-red-600 border-t border-border pt-1 mt-1">
                <span>יתרה לתשלום</span>
                <span>₪{((invoice.total || 0) - (invoice.paid_amount || 0)).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

        {invoice.external_invoice_number && (
          <div className="text-sm bg-blue-50 border border-blue-200 rounded-lg p-3">
            <span className="font-medium text-blue-700">מספר חשבונית חיצוני: </span>
            <span className="text-blue-600">{invoice.external_invoice_number}</span>
          </div>
        )}

        {invoice.notes && (
          <div className="text-sm">
            <span className="font-medium text-muted-foreground">הערות: </span>
            <span>{invoice.notes}</span>
          </div>
        )}

        <div className="flex gap-2 pt-2 border-t border-border flex-wrap">
          <Button onClick={handlePDF} className="gap-2">
            <Printer className="w-4 h-4" />
            PDF
          </Button>
          <Button variant="outline" onClick={handleWhatsApp} className="gap-2 text-green-700 border-green-300 hover:bg-green-50">
            <MessageCircle className="w-4 h-4" />
            WhatsApp
          </Button>
          {invoice.payment_status !== "שולם" && onRecordPayment && (
            <Button variant="default" className="gap-2 bg-green-600 hover:bg-green-700" onClick={() => { onClose(); onRecordPayment(invoice); }}>
              <Wallet className="w-4 h-4" />
              רישום תשלום
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            <X className="w-4 h-4 ml-1" /> סגור
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}