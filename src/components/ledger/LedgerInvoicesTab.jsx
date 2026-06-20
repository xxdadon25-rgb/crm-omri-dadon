import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import EmptyState from "@/components/shared/EmptyState";
import { Receipt, Eye, Printer, MessageCircle, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";
import { useState } from "react";
import { generateDocumentPDF } from "@/lib/pdfGenerator";

const paymentColors = {
  "ממתין לתשלום": "bg-orange-100 text-orange-700",
  "שולם חלקית": "bg-yellow-100 text-yellow-700",
  "שולם": "bg-green-100 text-green-700",
  "באיחור": "bg-red-100 text-red-700",
};

export default function LedgerInvoicesTab({ invoices, loading, onPreview, businessSettings, selectedCustomer }) {
  const [loadingId, setLoadingId] = useState(null);

  if (loading) {
    return (
      <div className="bg-card rounded-xl border border-border flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (invoices.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border">
        <EmptyState icon={Receipt} title="אין חשבוניות" description="לא נמצאו חשבוניות עבור הסינון הנוכחי" />
      </div>
    );
  }

  const handlePDF = (invoice) => {
    window.open(`${window.location.origin}/invoice-pdf/${invoice.id}`, "_blank");
  };

  const handleWhatsApp = (invoice) => {
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
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-right">מספר חשבונית</TableHead>
              <TableHead className="text-right">תאריך</TableHead>
              <TableHead className="text-right">לתשלום עד</TableHead>
              <TableHead className="text-right">סכום</TableHead>
              <TableHead className="text-right">שולם</TableHead>
              <TableHead className="text-right">סטטוס תשלום</TableHead>
              <TableHead className="text-right w-28">פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map(invoice => (
              <TableRow key={invoice.id} className="hover:bg-muted/30">
                <TableCell className="font-medium text-right">#{invoice.invoice_number || "—"}</TableCell>
                <TableCell className="text-right">{formatDate(invoice.date)}</TableCell>
                <TableCell className="text-right">{formatDate(invoice.due_date)}</TableCell>
                <TableCell className="font-medium text-right">₪{(invoice.total || 0).toLocaleString()}</TableCell>
                <TableCell className="text-right text-green-700 font-medium">₪{(invoice.paid_amount || 0).toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <Badge className={paymentColors[invoice.payment_status] || "bg-gray-100 text-gray-700"}>
                    {invoice.payment_status || "—"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onPreview(invoice)} title="צפייה">
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handlePDF(invoice)} title="PDF" disabled={!!loadingId}>
                      {loadingId === `pdf-${invoice.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" onClick={() => handleWhatsApp(invoice)} title="WhatsApp">
                      <MessageCircle className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="px-4 py-3 border-t border-border bg-muted/30 text-sm text-muted-foreground text-left">
        סה״כ {invoices.length} חשבוניות |
        סכום כולל: ₪{invoices.reduce((s, i) => s + (i.total || 0), 0).toLocaleString()} |
        שולם: ₪{invoices.reduce((s, i) => s + (i.paid_amount || 0), 0).toLocaleString()}
      </div>
    </div>
  );
}