import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export default function ExternalInvoiceButton({ invoice, customer, settings }) {
  const [loading, setLoading] = useState(false);
  const [logDialog, setLogDialog] = useState(false);
  const [lastLog, setLastLog] = useState(null);
  const queryClient = useQueryClient();

  const apiUrl = settings?.api_url;
  const apiKey = settings?.api_key;
  const apiSecret = settings?.api_secret;
  const companyId = settings?.api_company_id;

  const isConfigured = apiUrl && apiKey;

  const handleIssue = async () => {
    if (!isConfigured) {
      toast.error("יש להגדיר API URL ו-API Key בהגדרות המערכת");
      return;
    }

    setLoading(true);

    const payload = {
      company_id: companyId,
      customer: {
        name: invoice.customer_name,
        phone: customer?.phone || "",
        address: customer?.address || "",
        tax_id: customer?.tax_id || "",
        external_id: invoice.customer_id,
      },
      items: (invoice.items || []).map(item => ({
        name: item.name,
        sku: item.sku || "",
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount: item.discount || 0,
        total: item.total,
      })),
      subtotal: invoice.subtotal,
      vat_rate: invoice.vat_rate,
      vat_amount: invoice.vat_amount,
      total: invoice.total,
      notes: invoice.notes || "",
      invoice_number: invoice.invoice_number,
      date: invoice.date,
    };

    let logEntry = {
      invoice_id: invoice.id,
      customer_name: invoice.customer_name,
      request_payload: JSON.stringify(payload, null, 2),
      status: "pending",
    };

    try {
      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      };
      if (apiSecret) headers["X-Secret-Key"] = apiSecret;

      const response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      let responseData = {};
      try { responseData = JSON.parse(responseText); } catch { responseData = { raw: responseText }; }

      if (!response.ok) {
        throw new Error(`שגיאת API: ${response.status} - ${responseText}`);
      }

      const externalNum = responseData.invoice_number || responseData.id || responseData.doc_number || "";
      const pdfUrl = responseData.pdf_url || responseData.pdf || responseData.download_url || "";

      // Update invoice status and save external data
      await base44.entities.Invoice.update(invoice.id, {
        payment_status: "חשבונית הופקה",
        ...(externalNum && { external_invoice_number: externalNum }),
        ...(pdfUrl && { external_pdf_url: pdfUrl }),
      });

      // Update stock for each item
      for (const item of (invoice.items || [])) {
        if (item.product_id) {
          const products = await base44.entities.Product.filter({ id: item.product_id });
          if (products[0]) {
            const newQty = Math.max(0, (products[0].quantity || 0) - item.quantity);
            await base44.entities.Product.update(item.product_id, { quantity: newQty });
          }
        }
      }

      logEntry = {
        ...logEntry,
        response_payload: JSON.stringify(responseData, null, 2),
        status: "success",
        external_invoice_number: String(externalNum),
        pdf_url: pdfUrl,
      };

      await base44.entities.InvoiceLog.create(logEntry);
      setLastLog({ ...logEntry, success: true, pdfUrl });

      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });

      toast.success(`חשבונית הופקה בהצלחה${externalNum ? ` — מספר ${externalNum}` : ""}`);
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
        disabled={loading || !isConfigured}
        className="gap-2"
        title={!isConfigured ? "יש להגדיר API בהגדרות המערכת" : ""}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
        {loading ? "מפיק חשבונית..." : "הפק חשבונית"}
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