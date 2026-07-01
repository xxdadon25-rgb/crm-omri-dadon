import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Printer, MessageCircle, X } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";

// const statusColors = {
//   "טיוטה": "bg-gray-100 text-gray-700",
//   "ממתין לאישור": "bg-yellow-100 text-yellow-800",
//   "אושר": "bg-blue-100 text-blue-800",
//   "בהכנה": "bg-purple-100 text-purple-800",
//   "הושלם": "bg-green-100 text-green-800",
//   "בוטל": "bg-red-100 text-red-800",
// };
import { getOrderStatusColor } from "@/utils/statusColors";

export default function LedgerOrderPreview({ order, onClose, invoices, businessSettings, selectedCustomer }) {
  if (!order) return null;

  const invoice = invoices?.find(i => i.order_id === order.id);

  const handlePDF = () => window.open(`/order-pdf/${order.id}`, "_blank");

  const handleWhatsApp = () => {
    const url = `${window.location.origin}/order-pdf/${order.id}`;
    const customerName = selectedCustomer?.name || order.customer_name || "";
    const companyName = businessSettings?.business_name || "העסק שלי";
    const msg =
`📦 הזמנה #${order.order_number || order.id}

שלום ${customerName},

מצורפים פרטי ההזמנה שלך.

לצפייה במסמך:
${url}

תודה שבחרת לעבוד איתנו.

בברכה,
${companyName}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  return (
    <Dialog open={!!order} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>הזמנה #{order.order_number || "—"}</span>
            <Badge className={getOrderStatusColor(order.status)}>
              {order.status}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 text-sm border border-border rounded-lg p-4 bg-muted/30">
          <div>
            <p className="font-semibold text-muted-foreground mb-1">מפרטי</p>
            <p className="font-bold">{businessSettings?.business_name || "העסק שלי"}</p>
            {businessSettings?.address && <p>{businessSettings.address}</p>}
            {businessSettings?.tax_id && <p>ח.פ: {businessSettings.tax_id}</p>}
            {businessSettings?.phone && <p>{businessSettings.phone}</p>}
          </div>
          <div>
            <p className="font-semibold text-muted-foreground mb-1">לקוח</p>
            <p className="font-bold">{order.customer_name}</p>
            {order.customer_tax_id && <p>ח.פ: {order.customer_tax_id}</p>}
            {order.delivery_address && <p>{order.delivery_address}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-muted-foreground">תאריך הזמנה: </span><span className="font-medium">{formatDate(order.date)}</span></div>
          {order.delivery_date && (
            <div><span className="text-muted-foreground">תאריך אספקה: </span><span className="font-medium">{formatDate(order.delivery_date)}</span></div>
          )}
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-right px-3 py-2">פריט</th>
                <th className="text-right px-3 py-2">מק״ט</th>
                <th className="text-right px-3 py-2">כמות</th>
                <th className="text-right px-3 py-2">מחיר יחידה</th>
                <th className="text-right px-3 py-2">הנחה %</th>
                <th className="text-right px-3 py-2">סה״כ</th>
              </tr>
            </thead>
            <tbody>
              {(order.items || []).map((item, i) => (
                <tr key={i} className="border-t border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{item.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{item.sku || "—"}</td>
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
            {order.subtotal != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">סה״כ לפני מע״מ</span>
                <span>₪{(order.subtotal || 0).toLocaleString()}</span>
              </div>
            )}
            {order.vat_amount != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">מע״מ ({order.vat_rate || 17}%)</span>
                <span>₪{(order.vat_amount || 0).toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base border-t border-border pt-1 mt-1">
              <span>סה״כ לתשלום</span>
              <span>₪{(order.total || 0).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {invoice && (
          <div className="border border-border rounded-lg p-3 bg-green-50 text-sm">
            <span className="font-medium text-green-700">חשבונית #{invoice.invoice_number} — </span>
            <span className="text-green-600">{invoice.payment_status}</span>
            {invoice.paid_amount > 0 && (
              <span className="text-muted-foreground mr-2">| שולם: ₪{invoice.paid_amount.toLocaleString()}</span>
            )}
          </div>
        )}

        {order.notes && (
          <div className="text-sm">
            <span className="font-medium text-muted-foreground">הערות: </span>
            <span>{order.notes}</span>
          </div>
        )}

        <div className="flex gap-2 pt-2 border-t border-border">
          <Button onClick={handlePDF} className="gap-2">
            <Printer className="w-4 h-4" /> הדפס / PDF
          </Button>
          <Button variant="outline" onClick={handleWhatsApp} className="gap-2 text-green-700 border-green-300 hover:bg-green-50">
            <MessageCircle className="w-4 h-4" /> WhatsApp
          </Button>
          <Button variant="outline" onClick={onClose}>
            <X className="w-4 h-4 ml-1" /> סגור
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}