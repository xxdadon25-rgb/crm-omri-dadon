import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Eye, CheckCircle2, XCircle, Clock } from "lucide-react";
import { formatDateTime } from "@/lib/dateUtils";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";

const statusConfig = {
  success: { label: "הצלחה", className: "bg-green-100 text-green-700", icon: CheckCircle2 },
  error: { label: "כשל", className: "bg-red-100 text-red-700", icon: XCircle },
  pending: { label: "ממתין", className: "bg-amber-100 text-amber-700", icon: Clock },
};

export default function InvoiceLogs() {
  const [selected, setSelected] = useState(null);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["invoice-logs"],
    queryFn: () => base44.entities.InvoiceLog.list("-created_date", 100),
  });

  return (
    <div>
      <PageHeader title="לוגי חשבוניות API" description={`${logs.length} רשומות`} />

      {isLoading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>
      ) : logs.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="אין לוגים" description="לוגים ייווצרו לאחר שליחת חשבוניות דרך API" />
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right">תאריך</TableHead>
                  <TableHead className="text-right">לקוח</TableHead>
                  <TableHead className="text-right">מספר חיצוני</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                  <TableHead className="text-right w-20">פרטים</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map(log => {
                  const cfg = statusConfig[log.status] || statusConfig.pending;
                  return (
                    <TableRow key={log.id} className="hover:bg-muted/30">
                      <TableCell className="text-sm">{formatDateTime(log.created_date)}</TableCell>
                      <TableCell>{log.customer_name}</TableCell>
                      <TableCell>{log.external_invoice_number || "—"}</TableCell>
                      <TableCell>
                        <Badge className={cfg.className}>{cfg.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelected(log)}>
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>לוג חשבונית — {selected?.customer_name}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-muted-foreground">סטטוס: </span>
                  <Badge className={statusConfig[selected.status]?.className}>{statusConfig[selected.status]?.label}</Badge>
                </div>
                <div><span className="text-muted-foreground">תאריך: </span>{formatDateTime(selected.created_date)}</div>
                {selected.external_invoice_number && <div><span className="text-muted-foreground">מספר חיצוני: </span><strong>{selected.external_invoice_number}</strong></div>}
                {selected.pdf_url && <div><a href={selected.pdf_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">הורדת PDF</a></div>}
              </div>
              {selected.error_message && (
                <div>
                  <p className="font-medium text-red-600 mb-1">הודעת שגיאה:</p>
                  <div className="bg-red-50 rounded p-2 text-red-700">{selected.error_message}</div>
                </div>
              )}
              <div>
                <p className="font-medium mb-1">בקשה שנשלחה:</p>
                <pre className="bg-muted rounded p-3 text-xs overflow-auto max-h-48 whitespace-pre-wrap">{selected.request_payload}</pre>
              </div>
              <div>
                <p className="font-medium mb-1">תגובה מה-API:</p>
                <pre className={`rounded p-3 text-xs overflow-auto max-h-48 whitespace-pre-wrap ${selected.status === "success" ? "bg-green-50" : "bg-red-50"}`}>{selected.response_payload}</pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}