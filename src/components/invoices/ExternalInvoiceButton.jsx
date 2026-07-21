import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { invokeFinbot } from "@/lib/finbot";

// Manual retry for Finbot issuance. The automatic path lives in
// Orders.handleCreateInvoice and MonthlyInvoicesTab.handleGenerate; this
// button is what the user reaches when that automatic call failed.
// Stock decrement is intentionally NOT done here — order processing already
// handled inventory, and retrying must not double-decrement.
// `settings` is kept in the props signature for backwards compatibility with
// existing call sites but is no longer required.
export default function ExternalInvoiceButton({ invoice, customer }) {
  const [loading, setLoading] = useState(false);
  const [logDialog, setLogDialog] = useState(false);
  const [lastLog, setLastLog] = useState(null);
  const queryClient = useQueryClient();

  const handleIssue = async () => {
    setLoading(true);

    let logEntry = {
      invoice_id: invoice.id,
      customer_name: invoice.customer_name,
      request_payload: JSON.stringify({ invoice_id: invoice.id, customer_id: invoice.customer_id }, null, 2),
      status: "pending",
    };

    try {
      const result = await invokeFinbot(invoice, customer || {});

      if (!result.ok) {
        logEntry = {
          ...logEntry,
          response_payload: result.error,
          status: "error",
          error_message: result.error,
        };
        await base44.entities.InvoiceLog.create(logEntry);
        setLastLog({ ...logEntry, success: false });
        toast.error("שגיאה בהפקת חשבונית — ראה לוג");
        setLogDialog(true);
        return;
      }

      const patch = { payment_status: "חשבונית הופקה" };
      if (result.invoiceNumber) patch.external_invoice_number = result.invoiceNumber;
      if (result.pdfUrl) patch.external_pdf_url = result.pdfUrl;

      await base44.entities.Invoice.update(invoice.id, patch);

      logEntry = {
        ...logEntry,
        response_payload: JSON.stringify(result, null, 2),
        status: "success",
        external_invoice_number: result.invoiceNumber ? String(result.invoiceNumber) : "",
        pdf_url: result.pdfUrl || "",
      };
      await base44.entities.InvoiceLog.create(logEntry);
      setLastLog({ ...logEntry, success: true, pdfUrl: result.pdfUrl });

      queryClient.invalidateQueries({ queryKey: ["invoices"] });

      toast.success(`חשבונית הופקה בהצלחה${result.invoiceNumber ? ` — מספר ${result.invoiceNumber}` : ""}`);
      setLogDialog(true);
    } catch (err) {
      logEntry = {
        ...logEntry,
        response_payload: err.message,
        status: "error",
        error_message: err.message,
      };
      await base44.entities.InvoiceLog.create(logEntry);
      setLastLog({ ...logEntry, success: false });
      toast.error("שגיאה בהפקת חשבונית — ראה לוג");
      setLogDialog(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        onClick={handleIssue}
        disabled={loading}
        className="gap-2"
        title="הפקה חוזרת דרך פינבוט"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
        {loading ? "מפיק מחדש..." : "הפק חשבונית מחדש בפינבוט"}
      </Button>

      <Dialog open={logDialog} onOpenChange={setLogDialog}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {lastLog?.success
                ? <CheckCircle2 className="w-5 h-5 text-green-600" />
                : <XCircle className="w-5 h-5 text-red-500" />}
              {lastLog?.success ? "חשבונית הופקה בהצלחה" : "שגיאה בהפקת חשבונית"}
            </DialogTitle>
          </DialogHeader>

          {lastLog && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">סטטוס:</span>
                <Badge className={lastLog.success ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}>
                  {lastLog.success ? "הצלחה" : "כשל"}
                </Badge>
              </div>

              {lastLog.external_invoice_number && (
                <div>
                  <span className="text-muted-foreground">מספר חשבונית חיצוני: </span>
                  <span className="font-medium">{lastLog.external_invoice_number}</span>
                </div>
              )}

              {lastLog.pdfUrl && (
                <a href={lastLog.pdfUrl} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 text-primary hover:underline">
                  <ExternalLink className="w-4 h-4" /> הורדת PDF
                </a>
              )}

              <div>
                <p className="text-muted-foreground mb-1 font-medium">בקשה שנשלחה:</p>
                <pre className="bg-muted rounded p-2 text-xs overflow-auto max-h-32 whitespace-pre-wrap">{lastLog.request_payload}</pre>
              </div>

              <div>
                <p className="text-muted-foreground mb-1 font-medium">תגובה מה-API:</p>
                <pre className={`rounded p-2 text-xs overflow-auto max-h-32 whitespace-pre-wrap ${lastLog.success ? "bg-green-50" : "bg-red-50"}`}>
                  {lastLog.response_payload}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
