import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { generateDocumentPDF } from "@/lib/pdfGenerator";
import { Printer, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildDocumentHTML } from "@/lib/pdfGenerator";

// The generated sheet is a fixed A4 page — buildDocumentHTML emits
// width:794px. That is the whole document as one unit: header, customer block,
// items table, totals, signature.
const DOC_WIDTH = 794;

export default function OrderPDFPreview() {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [businessSettings, setBusinessSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generatingPDF, setGeneratingPDF] = useState(false);

  // ── Fit-to-width ──────────────────────────────────────────────────────────
  // The document is NEVER reflowed. It keeps the desktop layout exactly — same
  // sheet, same table, same columns, same proportions — and is scaled down as a
  // single unit when the screen is narrower than the page, the way a PDF viewer
  // does "fit page width". Smaller text is the accepted trade for identical
  // proportions.
  const frameRef = useRef(null); // the box the sheet must fit inside
  const sheetRef = useRef(null); // the generated 794px document
  const [fit, setFit] = useState({ scale: 1, height: null });

  const measure = useCallback(() => {
    const frame = frameRef.current;
    const sheet = sheetRef.current;
    if (!frame || !sheet) return;

    const available = frame.clientWidth;
    if (!available) return;

    // Only ever shrink. A screen wide enough for the real page gets scale 1.
    const scale = available < DOC_WIDTH ? available / DOC_WIDTH : 1;

    // A transform does not change the layout box, so the frame would still
    // reserve the sheet's full unscaled height and leave a long blank gap
    // beneath it. offsetHeight is the pre-transform layout height, which is
    // exactly what has to be multiplied.
    const height = scale < 1 ? sheet.offsetHeight * scale : null;

    setFit((prev) =>
      prev.scale === scale && prev.height === height ? prev : { scale, height },
    );
  }, []);

  // Declared above every early return so hook order can never change.
  useEffect(() => {
    if (!order || !businessSettings) return undefined;

    measure();

    // The sheet's height changes after the logo image loads and after fonts
    // settle, and its width changes when the viewport does. ResizeObserver
    // catches both without polling; the window events cover orientation
    // changes on browsers that do not resize the element itself.
    const observer = new ResizeObserver(measure);
    if (frameRef.current) observer.observe(frameRef.current);
    if (sheetRef.current) observer.observe(sheetRef.current);

    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [order, businessSettings, measure]);

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

      {/* Document View.
          The toolbar above is outside this frame and is never scaled — it stays
          normal mobile UI size and fully usable. */}
      <div className="p-4 pb-12">
        <div
          ref={frameRef}
          className="max-w-6xl mx-auto bg-white shadow-lg"
          style={
            // Set only while shrinking. At scale 1 this is undefined, so the
            // element keeps exactly the styles it had before this change.
            fit.scale < 1
              ? {
                  // The scaled sheet is exactly as wide as the frame, so both
                  // its edges land on the frame's edges: nothing is clipped and
                  // there is nothing to scroll sideways.
                  overflow: "hidden",
                  height: fit.height ?? undefined,
                }
              : undefined
          }
        >
          <div
            ref={sheetRef}
            dangerouslySetInnerHTML={{ __html: documentHTML }}
            style={{
              direction: "rtl",
              // The document is RTL, so it is anchored to the top-RIGHT corner
              // and shrinks toward it — the edge a Hebrew reader starts from.
              // Because scale is exactly frameWidth / 794, the left edge lands
              // precisely on the frame's left edge, so the page is fitted
              // rather than merely aligned.
              ...(fit.scale < 1
                ? {
                    transform: `scale(${fit.scale})`,
                    transformOrigin: "top right",
                  }
                : null),
            }}
          />
        </div>
      </div>
    </div>
  );
}