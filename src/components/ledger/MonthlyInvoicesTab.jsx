import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import EmptyState from "@/components/shared/EmptyState";
import { CalendarDays, Eye, Printer, MessageCircle, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";
import { useToast } from "@/components/ui/use-toast";

const MONTHS = [
  { value: 1, label: "ינואר" }, { value: 2, label: "פברואר" },
  { value: 3, label: "מרץ" }, { value: 4, label: "אפריל" },
  { value: 5, label: "מאי" }, { value: 6, label: "יוני" },
  { value: 7, label: "יולי" }, { value: 8, label: "אוגוסט" },
  { value: 9, label: "ספטמבר" }, { value: 10, label: "אוקטובר" },
  { value: 11, label: "נובמבר" }, { value: 12, label: "דצמבר" },
];

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;
const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - i);

export default function MonthlyInvoicesTab({
  selectedCustomer,
  allInvoices,
  allOrders,
  monthlyInvoices,
  loadingInvoices,
  businessSettings,
  onPreview,
}) {
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [generating, setGenerating] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invoicedOrderIds = new Set((allInvoices || []).map(inv => inv.order_id).filter(Boolean));

  const monthOrders = (allOrders || []).filter(o =>
    o.customer_id === selectedCustomer?.id &&
    o.date &&
    new Date(o.date).getMonth() + 1 === selectedMonth &&
    new Date(o.date).getFullYear() === selectedYear
  );
  const eligibleOrders = monthOrders.filter(o => !invoicedOrderIds.has(o.id));
  const excludedCount = monthOrders.length - eligibleOrders.length;

  const handleGenerate = async () => {
    if (!selectedCustomer) return;
    setGenerating(true);
    try {
      // Re-fetch orders and invoices fresh before creating
      const [freshOrders, freshInvoices] = await Promise.all([
        base44.entities.Order.filter({ customer_id: selectedCustomer.id }),
        base44.entities.Invoice.filter({ customer_id: selectedCustomer.id }),
      ]);
      const freshInvoicedIds = new Set(freshInvoices.map(inv => inv.order_id).filter(Boolean));
      const monthCandidates = freshOrders.filter(o =>
        o.date &&
        new Date(o.date).getMonth() + 1 === selectedMonth &&
        new Date(o.date).getFullYear() === selectedYear
      );
      const eligible = monthCandidates.filter(o => !freshInvoicedIds.has(o.id));
      const skipped = monthCandidates.length - eligible.length;

      if (eligible.length === 0) {
        const reason = skipped > 0
          ? `כל ${skipped} ההזמנות לחודש זה כבר מקושרות לחשבוניות קיימות.`
          : "לא נמצאו הזמנות עבור הלקוח בחודש שנבחר.";
        toast({ title: "אין הזמנות פנויות", description: reason, variant: "destructive" });
        return;
      }

      // Build items grouped by order — header row per order then its items
      const items = [];
      eligible.forEach(order => {
        items.push({
          name: `הזמנה #${order.order_number || order.id} — ${formatDate(order.date)}`,
          quantity: 0,
          unit_price: 0,
          discount: 0,
          total: 0,
          is_header: true,
        });
        (order.items || []).forEach(item => {
          items.push({
            product_id: item.product_id || null,
            name: item.name || "",
            sku: item.sku || "",
            quantity: item.quantity || 0,
            unit: item.unit || "",
            unit_price: item.unit_price || 0,
            discount: item.discount || 0,
            total: item.total || 0,
          });
        });
      });

      // Sum totals directly from orders
      const subtotal = parseFloat(eligible.reduce((s, o) => s + (o.subtotal || 0), 0).toFixed(2));
      const vatRate = businessSettings?.vat_rate || 17;
      const vatAmount = parseFloat(eligible.reduce((s, o) => s + (o.vat_amount || 0), 0).toFixed(2));
      const total = parseFloat(eligible.reduce((s, o) => s + (o.total || 0), 0).toFixed(2));

      const monthLabel = MONTHS.find(m => m.value === selectedMonth)?.label || selectedMonth;

      // Increment invoice counter
      const settingsList = await base44.entities.BusinessSettings.list();
      const settings = settingsList[0];
      const invoiceNumber = (settings?.invoice_counter || 1000) + 1;
      if (settings?.id) {
        await base44.entities.BusinessSettings.update(settings.id, { invoice_counter: invoiceNumber });
      }

      const today = new Date().toISOString().split("T")[0];

      const invoice = await base44.entities.Invoice.create({
        invoice_type: "monthly",
        billing_month: selectedMonth,
        billing_year: selectedYear,
        included_order_ids: eligible.map(o => o.id),
        invoice_number: invoiceNumber,
        customer_id: selectedCustomer.id,
        customer_name: selectedCustomer.name,
        customer_tax_id: selectedCustomer.tax_id || "",
        customer_address: selectedCustomer.address || "",
        date: today,
        items,
        subtotal,
        vat_rate: vatRate,
        vat_amount: vatAmount,
        total,
        paid_amount: 0,
        payment_status: "ממתין לתשלום",
        notes: `חשבונית חודשית — ${monthLabel} ${selectedYear} | כולל ${eligible.length} הזמנות`,
      });

      sessionStorage.setItem("pendingInvoice", JSON.stringify(invoice));
      await queryClient.refetchQueries({ queryKey: ["invoices"] });
      await queryClient.refetchQueries({ queryKey: ["settings"] });

      const skippedNote = skipped > 0 ? ` (${skipped} הזמנות דולגו — כבר מקושרות לחשבונית)` : "";
      toast({ title: "חשבונית חודשית נוצרה", description: `חשבונית #${invoiceNumber} נוצרה עם ${eligible.length} הזמנות.${skippedNote}` });
    } finally {
      setGenerating(false);
    }
  };

  const handlePDF = (invoice) => {
    window.open(`${window.location.origin}/invoice-pdf/${invoice.id}`, "_blank");
  };

  const handleWhatsApp = (invoice) => {
    const companyName = businessSettings?.business_name || "העסק שלי";
    const invoiceUrl = `${window.location.origin}/invoice-pdf/${invoice.id}`;
    const monthLabel = MONTHS.find(m => m.value === invoice.billing_month)?.label || invoice.billing_month;
    const msg =
`🧾 חשבונית חודשית #${invoice.invoice_number}

שלום ${selectedCustomer?.name || invoice.customer_name},

מצורפת החשבונית החודשית שלך עבור ${monthLabel} ${invoice.billing_year}.

${invoiceUrl}

בברכה,
${companyName}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const paymentColors = {
    "ממתין לתשלום": "bg-orange-100 text-orange-700",
    "שולם חלקית": "bg-yellow-100 text-yellow-700",
    "שולם": "bg-green-100 text-green-700",
    "באיחור": "bg-red-100 text-red-700",
  };

  return (
    <div className="space-y-4">
      {/* Generator Panel */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">צור חשבונית חודשית חדשה</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">חודש</label>
            <Select value={String(selectedMonth)} onValueChange={v => setSelectedMonth(Number(v))}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map(m => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">שנה</label>
            <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              {eligibleOrders.length > 0
                ? `${eligibleOrders.length} הזמנות פנויות | סה״כ: ₪${eligibleOrders.reduce((s, o) => s + (o.total || 0), 0).toLocaleString()}${excludedCount > 0 ? ` | ${excludedCount} דולגו (כבר חויבו)` : ""}`
                : monthOrders.length > 0
                  ? `כל ${monthOrders.length} ההזמנות לחודש זה כבר מקושרות לחשבוניות`
                  : "אין הזמנות לחודש זה"}
            </span>
            <Button
              onClick={handleGenerate}
              disabled={generating || eligibleOrders.length === 0}
              className="gap-2"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />}
              צור חשבונית חודשית
            </Button>
          </div>
        </div>
      </div>

      {/* Existing Monthly Invoices List */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <h3 className="text-sm font-semibold">חשבוניות חודשיות קיימות</h3>
        </div>
        {loadingInvoices ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : monthlyInvoices.length === 0 ? (
          <EmptyState icon={CalendarDays} title="אין חשבוניות חודשיות" description="לא נוצרו עדיין חשבוניות חודשיות ללקוח זה" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-right">מספר חשבונית</TableHead>
                    <TableHead className="text-right">חודש/שנה</TableHead>
                    <TableHead className="text-right">תאריך הפקה</TableHead>
                    <TableHead className="text-right">הזמנות</TableHead>
                    <TableHead className="text-right">סכום</TableHead>
                    <TableHead className="text-right">סטטוס תשלום</TableHead>
                    <TableHead className="text-right w-28">פעולות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlyInvoices.map(inv => {
                    const monthLabel = MONTHS.find(m => m.value === inv.billing_month)?.label || inv.billing_month;
                    return (
                      <TableRow key={inv.id} className="hover:bg-muted/30">
                        <TableCell className="font-medium text-right">#{inv.invoice_number || "—"}</TableCell>
                        <TableCell className="text-right">{monthLabel} {inv.billing_year}</TableCell>
                        <TableCell className="text-right">{formatDate(inv.date)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{(inv.included_order_ids || inv.included_invoice_ids || []).length} הזמנות</TableCell>
                        <TableCell className="font-medium text-right">₪{(inv.total || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          <Badge className={paymentColors[inv.payment_status] || "bg-gray-100 text-gray-700"}>
                            {inv.payment_status || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onPreview(inv)} title="צפייה">
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handlePDF(inv)} title="PDF">
                              <Printer className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" onClick={() => handleWhatsApp(inv)} title="WhatsApp">
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
              סה״כ {monthlyInvoices.length} חשבוניות חודשיות |
              סכום כולל: ₪{monthlyInvoices.reduce((s, i) => s + (i.total || 0), 0).toLocaleString()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}