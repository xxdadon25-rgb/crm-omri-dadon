import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, MessageCircle, X, Wallet, Paperclip, Camera, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";

// const paymentColors = {
//   "ממתין לתשלום": "bg-orange-100 text-orange-700",
//   "שולם חלקית": "bg-yellow-100 text-yellow-700",
//   "שולם": "bg-green-100 text-green-700",
//   "באיחור": "bg-red-100 text-red-700",
// };
import { getPaymentStatusColor } from "@/utils/statusColors";
import { formatWhatsAppMessage } from "@/utils/formatWhatsAppMessage";
import { displayInvoiceNumber } from "@/utils/invoiceDisplay";
import { hasFinbotPdf, downloadFinbotPdf } from "@/utils/finbotPdfActions";

const BUCKET = "payment-attachments";

export default function LedgerInvoicePreview({ invoice, onClose, businessSettings, selectedCustomer, onRecordPayment }) {
  const [attachments, setAttachments] = useState([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  useEffect(() => {
    if (invoice?.id) fetchAttachments();
  }, [invoice?.id]);

  const fetchAttachments = async () => {
    setLoadingAttachments(true);
    try {
      const { data, error } = await supabase
        .from("invoice_attachments")
        .select("*")
        .eq("invoice_id", invoice.id)
        .order("created_at", { ascending: false });
      if (!error) setAttachments(data || []);
    } finally {
      setLoadingAttachments(false);
    }
  };

  const uploadFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const filePath = `${invoice.id}/${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, file, { upsert: false });

      if (uploadError) {
        toast.error("שגיאה בהעלאת הקובץ: " + uploadError.message);
        return;
      }

      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(filePath);

      const { error: dbError } = await supabase
        .from("invoice_attachments")
        .insert({ invoice_id: invoice.id, file_url: publicUrl, file_name: file.name });

      if (dbError) {
        toast.error("שגיאה בשמירת הקובץ: " + dbError.message);
        return;
      }

      toast.success("הקובץ צורף בהצלחה");
      fetchAttachments();
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  };

  const handleDelete = async (attachment) => {
    try {
      const url = new URL(attachment.file_url);
      const pathParts = url.pathname.split(`/${BUCKET}/`);
      if (pathParts[1]) {
        await supabase.storage.from(BUCKET).remove([pathParts[1]]);
      }
      await supabase.from("invoice_attachments").delete().eq("id", attachment.id);
      setAttachments(prev => prev.filter(a => a.id !== attachment.id));
      toast.success("הצרופה נמחקה");
    } catch {
      toast.error("שגיאה במחיקת הצרופה");
    }
  };

  if (!invoice) return null;

  const handlePDF = () => {
    downloadFinbotPdf(invoice);
  };

  const handleWhatsApp = () => {
    const customerName = selectedCustomer?.name || invoice.customer_name || "";
    const msg = formatWhatsAppMessage(businessSettings?.whatsapp_template, { name: customerName, number: displayInvoiceNumber(invoice) !== "—" ? displayInvoiceNumber(invoice) : invoice.id, amount: (invoice.total || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), docType: "חשבונית" });
    const finalMsg = invoice.external_pdf_url ? `${msg}\n\n${invoice.external_pdf_url}` : msg;
    window.open(`https://wa.me/?text=${encodeURIComponent(finalMsg)}`, "_blank");
  };

  return (
    <Dialog open={!!invoice} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>חשבונית #{displayInvoiceNumber(invoice)}</span>
            <Badge className={getPaymentStatusColor(invoice.payment_status)}>
              {invoice.payment_status || "—"}
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
            <p className="font-bold">{invoice.customer_name}</p>
            {invoice.customer_tax_id && <p>ח.פ: {invoice.customer_tax_id}</p>}
            {invoice.customer_address && <p>{invoice.customer_address}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-muted-foreground">תאריך חשבונית: </span><span className="font-medium">{formatDate(invoice.date)}</span></div>
          {invoice.due_date && (
            <div><span className="text-muted-foreground">לתשלום עד: </span><span className="font-medium">{formatDate(invoice.due_date)}</span></div>
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
              {(invoice.items || []).map((item, i) => (
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
            {invoice.subtotal != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">סה״כ לפני מע״מ</span>
                <span>₪{(invoice.subtotal || 0).toLocaleString()}</span>
              </div>
            )}
            {invoice.vat_amount != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">מע״מ ({invoice.vat_rate || 17}%)</span>
                <span>₪{(invoice.vat_amount || 0).toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base border-t border-border pt-1 mt-1">
              <span>סה״כ</span>
              <span>₪{(invoice.total || 0).toLocaleString()}</span>
            </div>
            {invoice.paid_amount > 0 && (
              <div className="flex justify-between text-green-700">
                <span>שולם</span>
                <span>₪{(invoice.paid_amount || 0).toLocaleString()}</span>
              </div>
            )}
            {invoice.payment_status !== "שולם" && (
              <div className="flex justify-between font-bold text-red-600 border-t border-border pt-1 mt-1">
                <span>יתרה לתשלום</span>
                <span>₪{((invoice.total || 0) - (invoice.paid_amount || 0)).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

        {invoice.notes && (
          <div className="text-sm">
            <span className="font-medium text-muted-foreground">הערות: </span>
            <span>{invoice.notes}</span>
          </div>
        )}

        {/* ── PAYMENT ATTACHMENTS ─────────────────────────────────────────── */}
        <div className="border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Paperclip className="w-4 h-4" /> צירוף תשלום
            </h4>
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="gap-1.5 text-xs"
              >
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                העלאת קובץ
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => cameraInputRef.current?.click()}
                className="gap-1.5 text-xs"
              >
                <Camera className="w-3.5 h-3.5" />
                צילום
              </Button>
            </div>
          </div>

          {loadingAttachments ? (
            <div className="flex justify-center py-3">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : attachments.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">אין צרופות עדיין</p>
          ) : (
            <ul className="space-y-1.5">
              {attachments.map(att => (
                <li key={att.id} className="flex items-center justify-between gap-2 text-sm bg-muted/30 rounded-lg px-3 py-2">
                  <span className="truncate flex-1 text-xs">{att.file_name}</span>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => window.open(att.file_url, "_blank")}
                      title="פתח"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(att)}
                      title="מחק"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-2 pt-2 border-t border-border flex-wrap">
          <Button onClick={handlePDF} className="gap-2" disabled={!hasFinbotPdf(invoice)} title={hasFinbotPdf(invoice) ? undefined : "אין חשבונית פינבוט"}>
            <Download className="w-4 h-4" />
            הורדת PDF
          </Button>
          <Button variant="outline" onClick={handleWhatsApp} className="gap-2 text-green-700 border-green-300 hover:bg-green-50">
            <MessageCircle className="w-4 h-4" />
            WhatsApp
          </Button>
          {invoice.payment_status !== "שולם" && onRecordPayment && (
            <Button variant="default" className="gap-2 bg-green-600 hover:bg-green-700" onClick={() => { onClose(); onRecordPayment(invoice); }}>
              <Wallet className="w-4 h-4" />
              רישום תשלום
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            <X className="w-4 h-4 ml-1" /> סגור
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
