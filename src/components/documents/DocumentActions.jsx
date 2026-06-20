import { useState } from "react";
import { Printer, FileText, MessageCircle, Mail, Loader2, Link2, Share2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateDocumentPDF } from "@/lib/pdfGenerator";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

// Detect whether the device supports native file sharing (Web Share API Level 2)
// This is true on Android Chrome 89+, iOS Safari 15+, iPadOS 15+
const canShareFiles = () => {
  try {
    const testFile = new File(["test"], "test.pdf", { type: "application/pdf" });
    return !!(navigator.canShare && navigator.canShare({ files: [testFile] }));
  } catch {
    return false;
  }
};

const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export default function DocumentActions({ type, doc, businessSettings, customerPhone, customerEmail }) {
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState(null);

  const withLoading = (action, fn) => async () => {
    setLoading(true);
    setLoadingAction(action);
    try { await fn(); } finally { setLoading(false); setLoadingAction(null); }
  };

  const getDocLabel = () => {
    if (type === "quote") return { title: "הצעת מחיר", num: doc.quote_number, fileName: `quote_${doc.quote_number}` };
    if (type === "order") return { title: "הזמנה", num: doc.order_number, fileName: `order_${doc.order_number}` };
    return { title: "חשבונית", num: doc.invoice_number, fileName: `invoice_${doc.invoice_number}` };
  };

  const generatePDF = async () => {
    return await generateDocumentPDF({ type, doc, businessSettings });
  };

  // ─── PRINT ───────────────────────────────────────────────────────────────────
  const handlePrint = withLoading("print", async () => {
    const blob = await generatePDF();
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    setTimeout(() => { if (win) win.print(); }, 800);
  });

  // ─── DOWNLOAD PDF ─────────────────────────────────────────────────────────
  const handlePDF = withLoading("download", async () => {
    const blob = await generatePDF();
    const { fileName } = getDocLabel();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("ה-PDF הורד בהצלחה");
  });

  // ─── MOBILE: NATIVE SHARE SHEET WITH PDF FILE ────────────────────────────
  // Uses Web Share API Level 2 (Android Chrome 89+, iOS Safari 15+)
  // The OS share sheet opens and the user can pick WhatsApp, Email, etc.
  // WhatsApp will receive the actual PDF file — NOT a link.
  const handleNativeSharePDF = withLoading("share", async () => {
    const blob = await generatePDF();
    const { title, num, fileName } = getDocLabel();
    const file = new File([blob], `${fileName}.pdf`, { type: "application/pdf" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: `${title} מספר ${num}`,
          text: `${title} מספר ${num} מ${businessSettings?.business_name || "ERP Pro"}\nסה״כ: ₪${(doc.total || 0).toLocaleString("he-IL", { minimumFractionDigits: 2 })}`,
        });
      } catch (err) {
        // AbortError = user dismissed the share sheet, not an error
        if (err.name !== "AbortError") {
          toast.error("שגיאה בשיתוף: " + err.message);
        }
      }
    } else {
      // Fallback: download the file and instruct the user to attach it manually
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.info("ה-PDF הורד למכשיר. פתח את WhatsApp ושלח את הקובץ ידנית.", { duration: 6000 });
    }
  });

  // ─── DESKTOP: WHATSAPP TEXT LINK ─────────────────────────────────────────
  const handleWhatsAppText = () => {
    const { title, num } = getDocLabel();
    const validLine = doc.valid_until ? `\nתוקף עד: ${doc.valid_until}` : "";
    const notesLine = doc.customer_notes ? `\n\n${doc.customer_notes}` : "";
    const text = `שלום ${doc.customer_name},\n\n${title} מספר ${num} מ${businessSettings?.business_name || "ERP Pro"}\nסה״כ לתשלום: ₪${(doc.total || 0).toLocaleString("he-IL", { minimumFractionDigits: 2 })}${validLine}${notesLine}`;
    const phone = customerPhone?.replace(/[-\s]/g, "").replace(/^0/, "972");
    window.open(`https://wa.me/${phone || ""}?text=${encodeURIComponent(text)}`, "_blank");
  };

  // ─── QUOTES ONLY: UPLOAD & SHARE STABLE PDF LINK ─────────────────────────
  const handleSendPDFLink = withLoading("link", async () => {
    if (type !== "quote" || !doc.id) {
      toast.error("יציאה זו זמינה רק לצעות מחיר");
      return;
    }
    const res = await base44.functions.invoke("uploadQuotePDF", { quoteId: doc.id });
    if (!res.data.file_url) {
      toast.error("שגיאה ביצירת קישור");
      return;
    }
    const pdfUrl = `${window.location.origin}${res.data.file_url}`;
    const { num } = getDocLabel();
    const message = encodeURIComponent(
      `שלום ${doc.customer_name},\n\nהצעת המחיר מספר ${num} בהמתנה לאישורך.\n\nלצפייה והורדת ההצעה:\n${pdfUrl}\n\nבברכה,\n${businessSettings?.business_name || "ERP Pro"}`
    );
    window.open(`https://wa.me/?text=${message}`, "_blank");
  });

  // ─── EMAIL ────────────────────────────────────────────────────────────────
  const handleEmail = async () => {
    if (!customerEmail) { toast.error("ללקוח אין כתובת אימייל"); return; }
    const { title, num } = getDocLabel();
    await base44.integrations.Core.SendEmail({
      to: customerEmail,
      subject: `${title} מספר ${num}`,
      body: `<div dir="rtl"><p>שלום ${doc.customer_name},</p><p>מצורפת ${title} מספר ${num} בסך ₪${(doc.total || 0).toLocaleString()}.</p><p>בברכה,<br>${businessSettings?.business_name || "ERP Pro"}</p></div>`,
    });
    toast.success("האימייל נשלח בהצלחה");
  };

  const mobile = isMobile();
  const nativeShare = canShareFiles();
  const isLoading = (action) => loading && loadingAction === action;

  return (
    <div className="space-y-2">
      {/* ── PRIMARY MOBILE ACTION: Native OS Share Sheet with real PDF file ── */}
      {mobile && (
        <div className="w-full">
          <Button
            className="w-full bg-green-600 hover:bg-green-700 text-white gap-2"
            onClick={handleNativeSharePDF}
            disabled={loading}
          >
            {isLoading("share") ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
            {nativeShare ? "שלח PDF ישירות (WhatsApp / אחר)" : "הורד PDF ושתף ידנית"}
          </Button>
          {nativeShare && (
            <p className="text-xs text-muted-foreground text-center mt-1">
              מייצר PDF ופותח את לוח השיתוף של המכשיר — בחר WhatsApp לשליחת הקובץ ישירות
            </p>
          )}
          {!nativeShare && (
            <p className="text-xs text-amber-600 text-center mt-1">
              הדפדפן אינו תומך בשיתוף ישיר. הקובץ יורד — שלח ידנית מ-WhatsApp
            </p>
          )}
        </div>
      )}

      {/* ── SECONDARY ACTIONS (all platforms) ─────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {/* Desktop WhatsApp text (always available) */}
        <Button size="sm" variant="outline" onClick={handleWhatsAppText} className="text-green-600 border-green-200 hover:bg-green-50">
          <MessageCircle className="w-4 h-4 ml-1" /> וואטסאפ טקסט
        </Button>

        {/* Quotes only: stable link via WhatsApp */}
        {type === "quote" && (
          <Button size="sm" variant="outline" onClick={handleSendPDFLink} disabled={loading} className="text-green-600 border-green-200 hover:bg-green-50">
            {isLoading("link") ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Link2 className="w-4 h-4 ml-1" />}
            קישור WhatsApp
          </Button>
        )}

        {/* On desktop, show the native share button too */}
        {!mobile && (
          <Button size="sm" variant="outline" onClick={handleNativeSharePDF} disabled={loading}>
            {isLoading("share") ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Share2 className="w-4 h-4 ml-1" />}
            שיתוף PDF
          </Button>
        )}

        <Button size="sm" variant="outline" onClick={handlePDF} disabled={loading}>
          {isLoading("download") ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Download className="w-4 h-4 ml-1" />}
          הורדה
        </Button>
        <Button size="sm" variant="outline" onClick={handlePrint} disabled={loading}>
          {isLoading("print") ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Printer className="w-4 h-4 ml-1" />}
          הדפסה
        </Button>
        <Button size="sm" variant="outline" onClick={handleEmail}>
          <Mail className="w-4 h-4 ml-1" /> אימייל
        </Button>
      </div>
    </div>
  );
}