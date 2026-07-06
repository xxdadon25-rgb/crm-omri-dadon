import { useState } from "react";
import { Printer, FileText, MessageCircle, Mail, Loader2, Link2, Share2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateDocumentPDF } from "@/lib/pdfGenerator";
import { toast } from "sonner";
import { formatWhatsAppMessage } from "@/utils/formatWhatsAppMessage";

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

  // ─── SHARE PDF LINK ───────────────────────────────────────────────────────
  const handleNativeSharePDF = withLoading("share", async () => {
    if (type !== "quote" || !doc.id) {
      toast.error("שיתוף זמין רק להצעות מחיר");
      return;
    }
    const { num } = getDocLabel();
    const pdfUrl = `${window.location.origin}/quote-pdf/${doc.id}`;
    const shareTitle = `הצעת מחיר ${num}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, url: pdfUrl });
      } catch (err) {
        if (err.name !== "AbortError") {
          toast.error("שגיאה בשיתוף: " + err.message);
        }
      }
    } else {
      await navigator.clipboard.writeText(pdfUrl);
      toast.success("הקישור הועתק");
    }
  });

  // ─── DESKTOP: WHATSAPP TEXT LINK ─────────────────────────────────────────
  const handleWhatsAppText = () => {
    const { title, num } = getDocLabel();
    const text = formatWhatsAppMessage(businessSettings?.whatsapp_template, {
      name: doc.customer_name,
      number: num,
      amount: (doc.total || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      docType: title,
    });
    const phone = customerPhone?.replace(/[-\s]/g, "").replace(/^0/, "972");
    window.open(`https://wa.me/${phone || ""}?text=${encodeURIComponent(text)}`, "_blank");
  };

  // ─── QUOTES ONLY: SHARE STABLE PDF LINK ─────────────────────────────────
  const handleSendPDFLink = withLoading("link", async () => {
    if (type !== "quote" || !doc.id) {
      toast.error("יציאה זו זמינה רק להצעות מחיר");
      return;
    }
    const pdfUrl = `${window.location.origin}/quote-pdf/${doc.id}`;
    const { num } = getDocLabel();
    const message = encodeURIComponent(
      `הצעת מחיר מספר ${num}\n\nשלום ${doc.customer_name},\n\nמצורפת הצעת המחיר שהוכנה עבורך.\n\nלצפייה במסמך:\n${pdfUrl}\n\nלכל שאלה אנחנו זמינים.\n\nבברכה,\n${businessSettings?.business_name || "העסק שלי"}`
    );
    const phone = customerPhone?.replace(/[-\s]/g, "").replace(/^0/, "972");
    window.open(`https://wa.me/${phone || ""}?text=${message}`, "_blank");
  });

  // ─── EMAIL ────────────────────────────────────────────────────────────────
  const handleEmail = withLoading("email", async () => {
    if (!customerEmail) { toast.error("ללקוח אין כתובת אימייל"); return; }
    const { num } = getDocLabel();
    const pdfUrl = `${window.location.origin}/quote-pdf/${doc.id}`;
    const bizName = businessSettings?.business_name || "העסק שלי";
    const res = await fetch(`${window.location.origin}/api/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: customerEmail,
        subject: `הצעת מחיר מספר ${num}`,
        html: `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:14px;line-height:1.8"><p>שלום ${doc.customer_name},</p><p>מצורפת הצעת המחיר שהוכנה עבורך.</p><p>לצפייה במסמך:<br><a href="${pdfUrl}">${pdfUrl}</a></p><p>לכל שאלה אנחנו זמינים.</p><p>בברכה,<br>${bizName}</p></div>`,
      }),

    });
    if (res.ok) {
      toast.success("האימייל נשלח בהצלחה");
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data?.message || "שגיאה בשליחת האימייל");
    }
  });

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

        <Button size="sm" variant="outline" onClick={handlePDF} disabled={loading}>
          {isLoading("download") ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Download className="w-4 h-4 ml-1" />}
          הורדת PDF
        </Button>
        <Button size="sm" variant="outline" onClick={handlePrint} disabled={loading}>
          {isLoading("print") ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Printer className="w-4 h-4 ml-1" />}
          הדפסה
        </Button>
        <Button size="sm" variant="outline" onClick={handleEmail} disabled={loading}>
          {isLoading("email") ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Mail className="w-4 h-4 ml-1" />}
          אימייל
        </Button>
      </div>
    </div>
  );
}