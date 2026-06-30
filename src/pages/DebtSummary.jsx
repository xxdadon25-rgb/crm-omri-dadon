import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Loader2, BookUser } from "lucide-react";

export default function DebtSummary() {
  const navigate = useNavigate();

  const { data: customers = [], isLoading: loadingCustomers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => base44.entities.Customer.list(),
  });

  const { data: invoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => base44.entities.Invoice.list("-date"),
  });

  const rows = useMemo(() => {
    const debtMap = new Map();
    for (const inv of invoices) {
      if (inv.payment_status === "שולם") continue;
      const debt = (inv.total || 0) - (inv.paid_amount || 0);
      if (debt <= 0) continue;
      debtMap.set(inv.customer_id, (debtMap.get(inv.customer_id) || 0) + debt);
    }

    const customerMap = new Map(customers.map(c => [c.id, c]));

    return Array.from(debtMap.entries())
      .map(([customerId, totalDebt]) => {
        const c = customerMap.get(customerId);
        return {
          id: customerId,
          name: c?.name || "לקוח לא ידוע",
          phone: c?.mobile || c?.phone || "—",
          totalDebt,
        };
      })
      .sort((a, b) => b.totalDebt - a.totalDebt);
  }, [invoices, customers]);

  const grandTotal = rows.reduce((s, r) => s + r.totalDebt, 0);
  const loading = loadingCustomers || loadingInvoices;

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">יתרות חוב</h1>
          <p className="text-muted-foreground text-sm mt-0.5">לקוחות עם חשבוניות שטרם שולמו במלואן</p>
        </div>
        {!loading && rows.length > 0 && (
          <div className="text-left">
            <p className="text-xs text-muted-foreground">סה״כ חוב מצטבר</p>
            <p className="text-2xl font-bold text-red-600">₪{grandTotal.toLocaleString("he-IL", { minimumFractionDigits: 2 })}</p>
          </div>
        )}
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <BookUser className="w-10 h-10" />
            <p className="font-medium">אין יתרות חוב פתוחות</p>
            <p className="text-sm">כל החשבוניות שולמו במלואן</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-right">#</TableHead>
                    <TableHead className="text-right">שם לקוח</TableHead>
                    <TableHead className="text-right">טלפון</TableHead>
                    <TableHead className="text-right">יתרת חוב</TableHead>
                    <TableHead className="text-right">כרטסת</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={row.id} className="hover:bg-muted/30">
                      <TableCell className="text-right text-muted-foreground text-sm">{i + 1}</TableCell>
                      <TableCell className="text-right font-medium">{row.name}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{row.phone}</TableCell>
                      <TableCell className="text-right font-bold text-red-600">
                        ₪{row.totalDebt.toLocaleString("he-IL", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => navigate("/customer-ledger")}
                        >
                          <BookUser className="w-3.5 h-3.5 ml-1" />
                          פתח כרטסת
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="px-4 py-3 border-t border-border bg-muted/30 text-sm text-muted-foreground flex justify-between">
              <span>{rows.length} לקוחות עם חוב פתוח</span>
              <span className="font-semibold text-red-600">
                סה״כ: ₪{grandTotal.toLocaleString("he-IL", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
