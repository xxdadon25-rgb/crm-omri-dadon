import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { generateDocumentPDF } from "@/lib/pdfGenerator";
import { Printer, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildDocumentHTML } from "@/lib/pdfGenerator";

// Mobile-only reflow for the preview.
//
// buildDocumentHTML emits an A4 sheet: a fixed 794px box with inline pixel
// sizes throughout (10px sections, 8–9px table cells, fixed column widths).
// That is correct for the PDF and correct on a desktop screen. On a phone it is
// roughly twice the viewport, and shrinking the whole sheet to fit would leave
// 9px text rendering at about 4px — legible only by pinching.
//
// So the sheet is REFLOWED rather than scaled: it fills the phone's width, the
// side-by-side blocks stack, the fixed table columns are released so long
// product names wrap, and every small font size is stepped up to something
// readable. No information is removed — the same header, customer block, items,
// totals, notes and signature area are all present.
//
// HOW IT TARGETS GENERATED MARKUP
//   The document is injected as HTML with inline styles, and an inline style
//   beats a stylesheet rule. Each rule therefore matches on the inline style it
//   needs to override — [style*="margin:0 16px"] and so on — and uses
//   !important. That is surgical, and it means pdfGenerator.js is untouched.
//
// WHY DESKTOP CANNOT BE AFFECTED
//   Every rule lives inside @media (max-width: 820px) AND under .qs-order-doc,
//   a class used only on this page. Above that width not one rule applies, so
//   the desktop preview keeps exactly the styles the generator emitted.
//
// PRINT AND DOWNLOAD ARE UNTOUCHED
//   Both call generateDocumentPDF, which rebuilds the document from the data.
//   Neither reads this DOM node, so the output is identical at any screen size.
const MOBILE_DOC_CSS = `
@media (max-width: 820px) {
  /* The sheet itself: fill the phone, drop the A4 height floor. */
  .qs-order-doc > div {
    width: 100% !important;
    min-height: 0 !important;
    font-size: 13px !important;
  }

  /* 16px side gutters are a print margin; a phone cannot spare them. */
  .qs-order-doc [style*="margin:0 16px"]     { margin-left: 6px !important; margin-right: 6px !important; }
  .qs-order-doc [style*="margin:8px 16px 0"] { margin: 6px 6px 0 !important; }
  .qs-order-doc [style*="margin:6px 16px 0"] { margin: 6px 6px 0 !important; }
  .qs-order-doc [style*="margin:4px 16px 8px"] { margin: 4px 6px 8px !important; }

  /* Company header: stack the business block above the contact block. */
  .qs-order-doc [style*="height:66px"] {
    height: auto !important;
    flex-direction: column-reverse !important;
    align-items: stretch !important;
  }
  .qs-order-doc [style*="width:220px"] {
    width: auto !important;
    border-left: none !important;
    border-top: 1px solid #ddd !important;
  }

  /* Title bar: let the three cells wrap instead of squeezing to 28px. */
  .qs-order-doc [style*="height:28px"] {
    height: auto !important;
    min-height: 28px !important;
    flex-wrap: wrap !important;
  }

  /* Customer + meta, and Notes + totals: stack the side-by-side columns. */
  .qs-order-doc [style*="min-height:60px"],
  .qs-order-doc [style*="min-height:80px"] { flex-direction: column !important; }
  .qs-order-doc [style*="flex:6"] {
    border-left: none !important;
    border-bottom: 1px solid #ddd !important;
  }
  .qs-order-doc [style*="width:270px"] { width: 100% !important; }
  .qs-order-doc [style*="border-left:1px solid #ddd"] { border-left: none !important; }

  /* Items table: release the fixed A4 column widths so descriptions wrap
     instead of forcing the sheet wider than the screen. */
  .qs-order-doc table { table-layout: auto !important; width: 100% !important; }
  .qs-order-doc col   { width: auto !important; }
  .qs-order-doc th,
  .qs-order-doc td {
    padding: 5px 4px !important;
    height: auto !important;
    white-space: normal !important;
    word-break: break-word !important;
  }
  .qs-order-doc tr { height: auto !important; line-height: 1.4 !important; }

  /* Step every print-size font up to something readable on a phone. */
  .qs-order-doc [style*="font-size:8px"]   { font-size: 11px !important; }
  .qs-order-doc [style*="font-size:8.5px"] { font-size: 11px !important; }
  .qs-order-doc [style*="font-size:9px"]   { font-size: 12px !important; }
  .qs-order-doc [style*="font-size:9.5px"] { font-size: 12px !important; }
  .qs-order-doc [style*="font-size:10px"]  { font-size: 13px !important; }
  .qs-order-doc [style*="font-size:11px"]  { font-size: 13px !important; }
  .qs-order-doc [style*="font-size:12px"]  { font-size: 14px !important; }

  /* Signature line: three fields that no longer fit on one row. */
  .qs-order-doc [style*="justify-content:space-between"] {
    flex-wrap: wrap !important;
    gap: 8px !important;
  }
  .qs-order-doc [style*="gap:24px"] { gap: 10px !important; flex-wrap: wrap !important; }
}
`;

export default function OrderPDFPreview() {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [businessSettings, setBusinessSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generatingPDF, setGeneratingPDF] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        // This page is a PUBLIC link: it is sent to customers by WhatsApp, so
        // the viewer has no session. Reading public.orders directly meant RLS
        // (authenticated + auth.uid() = user_id) hid the row from everyone but
        // the staff member who created it, which is why the same URL worked on
        // the office desktop and failed on the customer's phone.
        //
        // public-order-pdf reads the row server-side and returns only the
        // fields this PDF renders. RLS is unchanged.
        const { data: orderResponse, error: orderError } = await supabase.functions.invoke(
          "public-order-pdf",
          { body: { order_id: orderId } },
        );
        if (orderError || !orderResponse?.ok || !orderResponse.order) {
          setError("Order not found");
          return;
        }
        setOrder(orderResponse.order);

        // Read directly rather than through base44.entities.BusinessSettings.
        // That helper scopes every list() to `.eq('user_id', user?.id)`, and on
        // this public page there is no user — so it sent the literal string
        // "undefined" as a uuid and Postgres rejected the request. The failure
        // was invisible before, because the orders query used to fail first.
        //
        // business_settings has a public SELECT policy, and only the eight
        // fields the PDF actually renders are requested.
        const { data: settingsRows } = await supabase
          .from("business_settings")
          .select("business_name, address, phone, fax, email, tax_id, logo_url, payment_terms")
          .limit(1);
        setBusinessSettings(settingsRows?.[0] || {});
      } catch {
        // The viewer is a customer, not a developer: a database message must
        // never reach this page. Any failure reads as the same thing it always
        // did — the order could not be shown.
        setError("Order not found");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [orderId]);

  const handlePrint = async () => {
    if (!order || !businessSettings) return;
    setGeneratingPDF(true);
    try {
      const blob = await generateDocumentPDF({ type: "order", doc: order, businessSettings });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      setTimeout(() => { if (win) win.print(); }, 800);
    } catch (err) {
      setError("Failed to print: " + err.message);
    } finally {
      setGeneratingPDF(false);
    }
  };

  const handleDownload = async () => {
    if (!order || !businessSettings) return;
    setGeneratingPDF(true);
    try {
      const blob = await generateDocumentPDF({ type: "order", doc: order, businessSettings });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `order_${order.order_number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError("Failed to download: " + err.message);
    } finally {
      setGeneratingPDF(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-2">Error</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!order || !businessSettings) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-600 mb-2">Order Not Found</h1>
        </div>
      </div>
    );
  }

  const documentHTML = buildDocumentHTML({ type: "order", doc: order, businessSettings });

  return (
    <div className="min-h-screen bg-gray-100" style={{ direction: "rtl" }}>
      {/* Fixed Action Bar */}
      <div className="sticky top-0 z-50 bg-white shadow-md p-4 border-b">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex gap-2">
            <Button onClick={handlePrint} disabled={generatingPDF} className="flex items-center gap-2">
              {generatingPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              הדפסה
            </Button>
            <Button onClick={handleDownload} disabled={generatingPDF} variant="outline" className="flex items-center gap-2">
              {generatingPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              הורדה
            </Button>
          </div>
          <span className="text-sm text-gray-600">הזמנה #{order.order_number}</span>
        </div>
      </div>

      {/* Mobile-only reflow. Scoped to .qs-order-doc and to a max-width media
          query, so it cannot reach the desktop preview or any other page. */}
      <style>{MOBILE_DOC_CSS}</style>

      {/* Document View */}
      <div className="p-4 pb-12">
        {/* overflow-x-auto is a safety net, not the layout: the rules above are
            meant to make the sheet fit. If some future content still cannot,
            it pans instead of being clipped. */}
        <div className="max-w-6xl mx-auto bg-white shadow-lg overflow-x-auto">
          <div
            className="qs-order-doc"
            dangerouslySetInnerHTML={{ __html: documentHTML }}
            style={{ direction: "rtl" }}
          />
        </div>
      </div>
    </div>
  );
}