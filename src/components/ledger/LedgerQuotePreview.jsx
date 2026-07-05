import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Printer, MessageCircle, X } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";
import { formatWhatsAppMessage } from "@/utils/formatWhatsAppMessage";

const statusColors = {
  "טיוטה": "bg-gray-100 text-gray-700",
  "נשלח": "bg-blue-100 text-blue-800",
  "אושר": "bg-green-100 text-green-800",
  "נדחה": "bg-red-100 text-red-800",
  "פגה תוקף": "bg-orange-100 text-orange-700",
  "הומרה להזמנה": "bg-purple-100 text-purple-800",
  "הומרה לחשבונית": "bg-violet-100 text-violet-800",
};

export default function LedgerQuotePreview({ quote, onClose, businessSettings, selectedCustomer }) {
  if (!quote) return null;

  const handlePDF = () => window.open(`/quote-pdf/${quote.id}`, "_blank");

  const handleWhatsApp = () => {
    const url = `${window.location.origin}/quote-pdf/${quote.id}`;
    const customerName = selectedCustomer?.name || quote.customer_name || "";
    const companyName = businessSettings?.business_name || "העסק שלי";
    const msg = formatWhatsAppMessage(businessSettings?.whatsapp_template, { name: customerName, number: quote.quote_number || quote.id, amount: (quote.total || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), docType: "הצעת מחיר" });
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  return (
    <Dialog open={!!quote} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>הצעת מחיר #{quote.quote_number || "—"}</span>
            <Badge className={statusColors[quote.status] || "bg-gray-100 text-gray-700"}>
              {quote.status || "—"}
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
            <p className="font-bold">{quote.customer_name}</p>
            {quote.customer_tax_id && <p>ח.פ: {quote.customer_tax_id}</p>}
            {quote.customer_address && <p>{quote.customer_address}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-muted-foreground">תאריך: </span><span className="font-medium">{formatDate(quote.date)}</span></div>
          {quote.valid_until && (
            <div><span className="text-muted-foreground">תוקף עד: </span><span className="font-medium">{formatDate(quote.valid_until)}</span></div>
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
              {(quote.items || []).map((item, i) => (
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
            {quote.subtotal != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">סה״כ לפני מע״מ</span>
                <span>₪{(quote.subtotal || 0).toLocaleString()}</span>
              </div>
            )}
            {quote.vat_amount != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">מע״מ ({quote.vat_rate || 17}%)</span>
                <span>₪{(quote.vat_amount || 0).toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base border-t border-border pt-1 mt-1">
              <span>סה״כ</span>
              <span>₪{(quote.total || 0).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {quote.notes && (
          <div className="text-sm">
            <span className="font-medium text-muted-foreground">הערות: </span>
            <span>{quote.notes}</span>
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