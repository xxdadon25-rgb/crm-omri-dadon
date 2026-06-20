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

  const eligibleInvoices = allInvoices.filter(inv =>
    inv.customer_id === selectedCustomer?.id &&
    inv.invoice_type !== "monthly" &&
    !inv.monthly_invoice_id &&
    inv.date &&
    new Date(inv.date).getMonth() + 1 === selectedMonth &&
    new Date(inv.date).getFullYear() === selectedYear
  );

  const handleGenerate = async () => {
    if (!selectedCustomer) return;
    setGenerating(true);
    try {
      // Re-fetch guard: verify eligibility server-side before creating
      const freshInvoices = await base44.entities.Invoice.filter({
        customer_id: selectedCustomer.id,
      });
      const eligible = freshInvoices.filter(inv =>
        inv.invoice_type !== "monthly" &&
        !inv.monthly_invoice_id &&
        inv.date &&
        new Date(inv.date).getMonth() + 1 === selectedMonth &&
        new Date(inv.date).getFullYear() === selectedYear
      );

      if (eligible.length === 0) {
        toast({ title: "אין חשבוניות פנויות", description: "כל החשבוניות לחודש זה כבר כלולות בחשבונית חודשית.", variant: "destructive" });
        return;
      }

      // Build items for display — use original values from invoices, no VAT recalculation
      const items = [];
      eligible.forEach(inv => {
        items.push({
          name: `חשבונית #${inv.invoice_number || inv.id} — ${formatDate(inv.date)}`,
          quantity: 0,
          unit_price: 0,
          discount: 0,
          total: 0,
          is_header: true,
        });

        (inv.items || []).forEach(item => {
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

      // Use included invoice totals directly — no recalculation from items
      const subtotal = parseFloat(eligible.reduce((s, inv) => s + (inv.subtotal || 0), 0).toFixed(2));
      const vatRate = businessSettings?.vat_rate || 17;
      const vatAmount = parseFloat(eligible.reduce((s, inv) => s + (inv.vat_amount || 0), 0).toFixed(2));
      const total = parseFloat(eligible.reduce((s, inv) => s + (inv.total || 0), 0).toFixed(2));

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
        included_invoice_ids: eligible.map(inv => inv.id),
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
        notes: `חשבונית חודשית — ${monthLabel} ${selectedYear} | כולל ${eligible.length} חשבוניות`,
      });

      sessionStorage.setItem("pendingInvoice", JSON.stringify(invoice));

      // Link each regular invoice to this monthly invoice
      const updateResults = await Promise.allSettled(
        eligible.map(inv => base44.entities.Invoice.update(inv.id, { monthly_invoice_id: invoice.id }))
      );

      const failedUpdates = updateResults.filter(r => r.status === "rejected");
      if (failedUpdates.length > 0) {
        toast({
          title: "שגיאה בקישור חשבוניות",
          description: `${failedUpdates.length} מתוך ${eligible.length} חשבוניות לא עודכנו. ייתכן שחשבונית חודשית #${invoiceNumber} נוצרה ללא קישור.`,
          variant: "destructive",
        });
        await queryClient.refetchQueries({ queryKey: ["invoices"] });
        await queryClient.refetchQueries({ queryKey: ["settings"] });
        return;
      }

      // Update local cache so eligible invoices immediately show monthly_invoice_id
      queryClient.setQueryData(["invoices"], (old) => {
        if (!old) return old;
        return old.map(inv =>
          eligible.some(e => e.id === inv.id) ? { ...inv, monthly_invoice_id: invoice.id } : inv
        );
      });

      await queryClient.refetchQueries({ queryKey: ["settings"] });

      toast({ title: "חשבונית חודשית נוצרה", description: `חשבונית #${invoiceNumber} נוצרה עם ${eligible.length} חשבוניות.` });
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
              {eligibleInvoices.length > 0
                ? `${eligibleInvoices.length} חשבוניות פנויות | סה״כ: ₪${eligibleInvoices.reduce((s, inv) => s + (inv.total || 0), 0).toLocaleString()}`
                : "אין חשבוניות פנויות לחודש זה"}
            </span>
            <Button
              onClick={handleGenerate}
              disabled={generating || eligibleInvoices.length === 0}
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
                    <TableHead className="text-right">חשבוניות</TableHead>
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
                        <TableCell className="text-right text-muted-foreground">{(inv.included_invoice_ids || inv.included_order_ids || []).length} חשבוניות</TableCell>
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