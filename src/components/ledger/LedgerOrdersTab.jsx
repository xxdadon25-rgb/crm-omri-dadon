import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import EmptyState from "@/components/shared/EmptyState";
import { ShoppingCart, Eye, Printer, MessageCircle } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";

// const statusColors = {
//   "טיוטה": "bg-gray-100 text-gray-700",
//   "ממתין לאישור": "bg-yellow-100 text-yellow-800",
//   "אושר": "bg-blue-100 text-blue-800",
//   "בהכנה": "bg-purple-100 text-purple-800",
//   "הושלם": "bg-green-100 text-green-800",
//   "בוטל": "bg-red-100 text-red-800",
// };
// const paymentColors = {
//   "ממתין לתשלום": "bg-orange-100 text-orange-700",
//   "שולם חלקית": "bg-yellow-100 text-yellow-700",
//   "שולם": "bg-green-100 text-green-700",
//   "באיחור": "bg-red-100 text-red-700",
// };
import { getOrderStatusColor, getPaymentStatusColor } from "@/utils/statusColors";

export default function LedgerOrdersTab({ orders, invoices, loading, onPreview, businessSettings, selectedCustomer, allMonthlyInvoices }) {
  if (loading) {
    return (
      <div className="bg-card rounded-xl border border-border flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border">
        <EmptyState icon={ShoppingCart} title="אין הזמנות" description="לא נמצאו הזמנות עבור הסינון הנוכחי" />
      </div>
    );
  }

  const handlePDF = (order) => {
    window.open(`/order-pdf/${order.id}`, "_blank");
  };

  const handleWhatsApp = (order) => {
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
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      {/* OLD - can restore: <Table> (without className below) */}
      <div className="overflow-x-auto">
        <Table className="[&_td]:py-4 [&_td]:px-4 [&_td]:text-base [&_th]:px-4">
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-right">מספר הזמנה</TableHead>
              <TableHead className="text-right">תאריך</TableHead>
              <TableHead className="text-right">סכום</TableHead>
              <TableHead className="text-right">סטטוס הזמנה</TableHead>
              <TableHead className="text-right">סטטוס תשלום</TableHead>
              <TableHead className="text-right w-28">פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map(order => {
              const invoice = invoices.find(i => i.order_id === order.id);
              return (
                <TableRow key={order.id} className="hover:bg-muted/30">
                  <TableCell className="font-medium text-right">#{order.order_number || "—"}</TableCell>
                  <TableCell className="text-right">{formatDate(order.date)}</TableCell>
                  <TableCell className="font-medium text-right">₪{(order.total || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <Badge className={getOrderStatusColor(order.status)}>
                      {order.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {order.monthly_invoice_id ? (
                      <Badge className="bg-purple-100 text-purple-700">חשבונית חודשית</Badge>
                    ) : invoice ? (
                      <Badge className={getPaymentStatusColor(invoice.payment_status)}>
                        {invoice.payment_status}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">אין חשבונית</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onPreview(order)} title="צפייה">
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handlePDF(order)} title="PDF">
                        <Printer className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" onClick={() => handleWhatsApp(order)} title="WhatsApp">
                        <MessageCircle className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="px-4 py-3 border-t border-border bg-muted/30 text-sm text-muted-foreground text-left">
        סה״כ {orders.length} הזמנות | סכום כולל: ₪{orders.reduce((s, o) => s + (o.total || 0), 0).toLocaleString()}
      </div>
    </div>
  );
}