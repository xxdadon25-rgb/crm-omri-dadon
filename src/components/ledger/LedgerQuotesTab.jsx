import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import EmptyState from "@/components/shared/EmptyState";
import { FileText, Eye, Printer, MessageCircle } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";

const statusColors = {
  "טיוטה": "bg-gray-100 text-gray-700",
  "נשלח": "bg-blue-100 text-blue-800",
  "אושר": "bg-green-100 text-green-800",
  "נדחה": "bg-red-100 text-red-800",
  "פגה תוקף": "bg-orange-100 text-orange-700",
  "הומרה להזמנה": "bg-purple-100 text-purple-800",
  "הומרה לחשבונית": "bg-violet-100 text-violet-800",
};

export default function LedgerQuotesTab({ quotes, loading, onPreview, businessSettings, selectedCustomer }) {
  if (loading) {
    return (
      <div className="bg-card rounded-xl border border-border flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border">
        <EmptyState icon={FileText} title="אין הצעות מחיר" description="לא נמצאו הצעות מחיר עבור הסינון הנוכחי" />
      </div>
    );
  }

  const handlePDF = (quote) => {
    window.open(`/quote-pdf/${quote.id}`, "_blank");
  };

  const handleWhatsApp = (quote) => {
    const url = `${window.location.origin}/quote-pdf/${quote.id}`;
    const customerName = selectedCustomer?.name || quote.customer_name || "";
    const companyName = businessSettings?.business_name || "העסק שלי";
    const msg =
`📄 הצעת מחיר #${quote.quote_number || quote.id}

שלום ${customerName},

מצורפת הצעת המחיר שהוכנה עבורך.

לצפייה במסמך:
${url}

לכל שאלה אנחנו זמינים.

בברכה,
${companyName}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      {/* OLD - can restore: <Table> (without className below) */}
      <div className="overflow-x-auto">
        <Table className="min-w-[640px] [&_td]:py-2 md:[&_td]:py-4 [&_td]:px-2 md:[&_td]:px-4 [&_td]:text-sm md:[&_td]:text-base [&_th]:px-2 md:[&_th]:px-4">
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-right">מספר הצעה</TableHead>
              <TableHead className="text-right">תאריך</TableHead>
              <TableHead className="text-right">תוקף עד</TableHead>
              <TableHead className="text-right">סכום</TableHead>
              <TableHead className="text-right">סטטוס</TableHead>
              <TableHead className="text-right w-28">פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.map(quote => (
              <TableRow key={quote.id} className="hover:bg-muted/30">
                <TableCell className="font-medium text-right">#{quote.quote_number || "—"}</TableCell>
                <TableCell className="text-right">{formatDate(quote.date)}</TableCell>
                <TableCell className="text-right">{formatDate(quote.valid_until)}</TableCell>
                <TableCell className="font-medium text-right">₪{(quote.total || 0).toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <Badge className={statusColors[quote.status] || "bg-gray-100 text-gray-700"}>
                    {quote.status || "—"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onPreview(quote)} title="צפייה">
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handlePDF(quote)} title="PDF">
                      <Printer className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" onClick={() => handleWhatsApp(quote)} title="WhatsApp">
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
        סה״כ {quotes.length} הצעות | סכום כולל: ₪{quotes.reduce((s, q) => s + (q.total || 0), 0).toLocaleString()}
      </div>
    </div>
  );
}