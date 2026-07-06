import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, FileText, Loader2, CheckCircle2, Link2 } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";
import DocumentActions from "@/components/documents/DocumentActions";
import DocumentTotals from "@/components/documents/DocumentTotals";

// const statusColors = {
//   "טיוטה": "bg-gray-100 text-gray-700",
//   "ממתין לאישור": "bg-yellow-100 text-yellow-800",
//   "אושר": "bg-blue-100 text-blue-800",
//   "בהכנה": "bg-purple-100 text-purple-800",
//   "הושלם": "bg-green-100 text-green-800",
//   "בוטל": "bg-red-100 text-red-800",
// };
import { getOrderStatusColor } from "@/utils/statusColors";

export default function OrderViewModal({ open, onOpenChange, order, onEdit, onDocument, onBackToQuote, onCreateInvoice, creatingInvoice, customers, quotes, businessSettings }) {
  if (!order) return null;

  const customer = customers?.find(c => c.id === order.customer_id);
  const quote = quotes?.find(q => q.id === order.quote_id);

  const handleWhatsAppLink = () => {
    const phone = customer?.mobile || customer?.phone || "";
    const cleaned = phone.replace(/\D/g, "");
    const intlPhone = cleaned.startsWith("0") ? "972" + cleaned.slice(1) : cleaned;
    const pdfUrl = `${window.location.origin}/order-pdf/${order.id}`;
    const total = (order.total || 0).toLocaleString("he-IL", { minimumFractionDigits: 2 });
    const msg = `שלום ${order.customer_name},\n\nהזמנה מספר #${order.order_number} ממיני סטוק\nסה"כ לתשלום: ${total}₪\n\nלצפייה בהזמנה: ${pdfUrl}\n\nלפרטים נוספים צרו קשר.`;
    window.open(`https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>הזמנה #{order.order_number || "---"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Header Info */}
          <div className="grid grid-cols-2 gap-4 pb-4 border-b">
            <div>
              <p className="text-xs text-muted-foreground">לקוח</p>
              <p className="font-medium">{order.customer_name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">תאריך הזמנה</p>
              <p className="font-medium">{formatDate(order.date)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">סטטוס</p>
              <Badge className={getOrderStatusColor(order.status)}>
                {order.status}
              </Badge>
            </div>
            {order.delivery_date && (
              <div>
                <p className="text-xs text-muted-foreground">תאריך אספקה</p>
                <p className="font-medium">{formatDate(order.delivery_date)}</p>
              </div>
            )}
          </div>

          {/* Items Table */}
          {order.items && order.items.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3">פרטי הזמנה</h3>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-right">שם מוצר</TableHead>
                      <TableHead className="text-right">SKU</TableHead>
                      <TableHead className="text-center">כמות</TableHead>
                      <TableHead className="text-center">מחיר</TableHead>
                      <TableHead className="text-center">סה"כ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.items.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-right">{item.name}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{item.sku || "-"}</TableCell>
                        <TableCell className="text-center">{item.quantity}</TableCell>
                        <TableCell className="text-center">₪{item.unit_price?.toLocaleString()}</TableCell>
                        <TableCell className="text-center font-medium">₪{item.total?.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Totals */}
          {(() => {
            const items = order.items || [];
            const computedGross = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
            const grossTotal = order.gross_total != null ? order.gross_total : computedGross;
            const subtotal = order.subtotal || 0;
            const discountTotal = order.discount_amount != null ? order.discount_amount : grossTotal - subtotal;
            const effectivePct = grossTotal > 0 ? (discountTotal / grossTotal) * 100 : 0;
            return (
              <DocumentTotals
                grossTotal={grossTotal}
                netSubtotal={subtotal}
                discountTotal={discountTotal}
                effectiveDiscountPercent={effectivePct}
                vatRate={order.vat_rate || 17}
                total={order.total}
              />
            );
          })()}

          {/* Notes */}
          {order.notes && (
            <div>
              <h3 className="text-sm font-semibold mb-2">הערות</h3>
              <p className="text-sm text-muted-foreground bg-muted/30 rounded p-3">{order.notes}</p>
            </div>
          )}

          {/* Delivery Address */}
          {order.delivery_address && (
            <div>
              <h3 className="text-sm font-semibold mb-2">כתובת משלוח</h3>
              <p className="text-sm text-muted-foreground">{order.delivery_address}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col gap-2 pt-4 border-t">
            <Button variant="outline" size="sm" onClick={onEdit} className="w-full">
              ✏️ עריכה
            </Button>

            {/* PDF sharing — uses native share sheet on mobile */}
            <DocumentActions
              type="order"
              doc={order}
              businessSettings={businessSettings}
              customerPhone={customer?.mobile || customer?.phone}
              customerEmail={customer?.email}
            />

            <Button
              variant="outline"
              size="sm"
              onClick={handleWhatsAppLink}
              className="w-full text-green-600 border-green-200 hover:bg-green-50"
            >
              <Link2 className="w-4 h-4 ml-1" /> קישור WhatsApp להזמנה
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={onCreateInvoice}
              disabled={creatingInvoice}
              className="w-full text-primary border-primary/30 bg-primary/5 hover:bg-primary/10"
            >
              {creatingInvoice
                ? <Loader2 className="w-4 h-4 ml-1 animate-spin" />
                : <FileText className="w-4 h-4 ml-1" />}
              צור חשבונית
            </Button>
            {quote && (
              <Button variant="outline" size="sm" onClick={onBackToQuote} className="w-full text-blue-700 border-blue-200">
                <ArrowLeft className="w-4 h-4 ml-1" /> חזור להצעת המחיר המקורית
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}