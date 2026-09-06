import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import jsPDF from "jspdf";
import domtoimage from "dom-to-image-more";

const GOLD = "#F5C518";
const GOLD_LIGHT = "#F5E9C4";

// The sheet below is a fixed A4 page — width:210mm. A CSS millimetre is always
// 96/25.4 px, so that is 793.7px on every device, which is the same page width
// OrderPDFPreview scales (it states its own sheet as 794px).
const DOC_WIDTH = 794;

function fmt(n) {
  return (parseFloat(n) || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function QuotePDFPreview() {
  const { quoteId } = useParams();
  const [quote, setQuote] = useState(null);
  const [biz, setBiz] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const printRef = useRef();

  useEffect(() => {
    (async () => {
      try {
        const { data: rows, error: qErr } = await supabase
          .from("quotes").select("*").eq("id", quoteId).limit(1);
        if (qErr) throw qErr;
        const q = rows?.[0] || null;
        if (!q) { setError("הצעת המחיר לא נמצאה"); return; }
        const { data: settingsRows, error: sErr } = await supabase
          .from("business_settings").select("*").eq("user_id", q.user_id).limit(1);
        setQuote(q);
        setBiz(settingsRows?.[0] || {});
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [quoteId]);

  // ── Fit-to-width ──────────────────────────────────────────────────────────
  // Copied from OrderPDFPreview, which is already correct on mobile. The
  // document is NEVER reflowed: it keeps the desktop layout exactly — same
  // sheet, same table, same columns, same proportions — and is scaled down as a
  // single unit when the screen is narrower than the page, the way a PDF viewer
  // does "fit page width". Smaller text is the accepted trade for identical
  // proportions.
  const frameRef = useRef(null); // the box the sheet must fit inside
  const sheetRef = useRef(null); // the wrapper that carries the scale
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
    if (!quote) return undefined;

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
  }, [quote, measure]);

  const handlePrint = () => window.print();

  const handleDownload = async () => {
    const node = printRef.current;
    const scale = 2;
    const imgData = await domtoimage.toPng(node, { scale, style: { margin: "0" } });
    const naturalW = node.offsetWidth * scale;
    const naturalH = node.offsetHeight * scale;
    const a4Width = 210;
    const imgHeight = (naturalH * a4Width) / naturalW;
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [a4Width, imgHeight] });
    pdf.addImage(imgData, "PNG", 0, 0, a4Width, imgHeight);
    pdf.save(`quote_${quote?.quote_number || quoteId}.pdf`);
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </div>
  );

  if (error || !quote) return (
    <div className="flex items-center justify-center min-h-screen text-destructive">{error || "לא נמצא"}</div>
  );

  const items = Array.isArray(quote.items) ? quote.items : [];
  const grossTotal = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
  const subtotal = parseFloat(quote.subtotal) || 0;
  const discount = grossTotal > 0 ? grossTotal - subtotal : parseFloat(quote.discount_amount) || 0;
  const effectivePct = grossTotal > 0 && discount > 0.001 ? (discount / grossTotal * 100) : 0;
  const afterDiscount = subtotal;
  const vatRate = parseFloat(quote.vat_rate) || 18;
  const vatAmount = parseFloat(quote.vat_amount) || afterDiscount * (vatRate / 100);
  const total = parseFloat(quote.total) || afterDiscount + vatAmount;

  return (
    <div dir="rtl" style={{ fontFamily: "Arial, Helvetica, sans-serif", minHeight: "100vh", background: "#f3f4f6" }}>
      {/* Action bar — hidden on print */}
      <div className="print:hidden sticky top-0 z-50 bg-white border-b shadow-sm px-6 py-3 flex items-center gap-3">
        <Button onClick={handleDownload} className="gap-2">
          <Download className="w-4 h-4" /> הורדה
        </Button>
        <span className="mr-auto text-sm text-muted-foreground">הצעת מחיר #{quote.quote_number}</span>
      </div>

      {/* Document.
          The action bar above is outside this frame and is never scaled — it
          stays normal mobile UI size and fully usable. */}
      <div className="p-6 pb-16 print:p-0">
        <div
          ref={frameRef}
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
          {/* The scale lives on this wrapper, NOT on printRef below. dom-to-image
              clones the node it is given together with its transform, so scaling
              the captured node would shrink the downloaded PDF on a phone. The
              wrapper keeps the download byte-identical to today. */}
          <div
            ref={sheetRef}
            style={{
              width: DOC_WIDTH,
              margin: "0 auto",
              // The document is RTL, so it is anchored to the top-RIGHT corner
              // and shrinks toward it — the edge a Hebrew reader starts from.
              // Because scale is exactly frameWidth / 794, the left edge lands
              // precisely on the frame's left edge, so the page is fitted
              // rather than merely aligned.
              ...(fit.scale < 1
                ? { transform: `scale(${fit.scale})`, transformOrigin: "top right" }
                : null),
            }}
          >
        <div ref={printRef} style={{ width: "210mm", minHeight: "297mm", margin: "0 auto", padding: "10mm", boxSizing: "border-box", background: "#fff", boxShadow: "0 2px 16px rgba(0,0,0,0.10)", borderRadius: 8, overflow: "hidden", border: "2px solid #000", display: "flex", flexDirection: "column" }}>

          {/* HEADER: RIGHT=business info, LEFT=logo */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "16px 32px" }}>
            {/* First child = RIGHT in RTL */}
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#1a1a1a", textDecoration: "underline", marginBottom: 6 }}>
                {biz.business_name || "העסק שלי"}
              </div>
              <div style={{ fontSize: 13, color: "#333", lineHeight: 1.9 }}>
                {biz.email && <div>{biz.email}</div>}
                {biz.address && <div>{biz.address}</div>}
                {biz.phone && <div>טלפון: {biz.phone}</div>}
                {biz.tax_id && <div>עוסק מורשה: {biz.tax_id}</div>}
              </div>
            </div>
            {/* Second child = LEFT in RTL */}
            <div style={{ width: 40, height: 40, flexShrink: 0, background: biz.logo_url ? "transparent" : "#e5e7eb", borderRadius: 4, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {biz.logo_url
                ? <img src={biz.logo_url} alt="לוגו" style={{ width: 40, height: 40, objectFit: "contain" }} />
                : <span style={{ fontSize: 10, color: "#999" }}>לוגו</span>}
            </div>
          </div>

          {/* GOLD TITLE BAR: RIGHT="הצעת מחיר", CENTER=number, LEFT="מקור" */}
          <div style={{ background: GOLD, padding: "10px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "2px solid #000", borderBottom: "2px solid #000" }}>
            {/* First = RIGHT in RTL */}
            <span style={{ fontSize: 16, fontWeight: 700, color: "#000", textDecoration: "underline" }}>הצעת מחיר</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#000" }}>מספר: {quote.quote_number}</span>
            {/* Last = LEFT in RTL */}
            <span style={{ fontSize: 16, fontWeight: 700, color: "#000" }}>מקור</span>
          </div>

          {/* INFO ROW: RIGHT=customer, LEFT=doc details */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderTop: "1px solid #ccc", borderBottom: "2px solid #000", padding: "12px 32px" }}>
            {/* First = RIGHT in RTL: customer */}
            <div>
              <div style={{ fontSize: 12, color: "#999", marginBottom: 4 }}>לכבוד:</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{quote.customer_name}</div>
              <div style={{ fontSize: 12, color: "#2563EB", marginTop: 2 }}>לקוח עסקי</div>
            </div>
            {/* Second = LEFT in RTL: doc details */}
            <div style={{ textAlign: "right", fontSize: 13 }}>
              <div style={{ fontWeight: 700, marginBottom: 3 }}>תאריך: {quote.date ? quote.date.split("-").reverse().join("/") : "—"}</div>
              {quote.agent && <div style={{ fontWeight: 700, marginBottom: 3 }}>סוכן: {quote.agent}</div>}
              <div style={{ fontWeight: 700, marginBottom: 3 }}>סטטוס: {quote.status || "טיוטה"}</div>
              <div>דף 1 מתוך 1</div>
            </div>
          </div>

          {/* ITEMS TABLE */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: GOLD, borderTop: "none", borderBottom: "2px solid #000" }}>
                <th style={{ padding: "9px 8px", textAlign: "center", fontWeight: 700, color: "#000", width: 40, borderTop: "none", borderBottom: "2px solid #000", borderLeft: "1px solid #ddd", borderRight: "1px solid #ddd" }}>#</th>
                <th style={{ padding: "9px 8px", textAlign: "center", fontWeight: 700, color: "#000", width: 80, borderTop: "none", borderBottom: "2px solid #000", borderRight: "1px solid #ddd" }}>מס פריט</th>
                <th style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, color: "#000", borderTop: "none", borderBottom: "2px solid #000", borderRight: "1px solid #ddd" }}>תיאור פריט</th>
                <th style={{ padding: "9px 8px", textAlign: "center", fontWeight: 700, color: "#000", width: 70, borderTop: "none", borderBottom: "2px solid #000", borderRight: "1px solid #ddd" }}>כמות</th>
                <th style={{ padding: "9px 8px", textAlign: "center", fontWeight: 700, color: "#000", width: 100, borderTop: "none", borderBottom: "2px solid #000", borderRight: "1px solid #ddd" }}>ש"ח ליחידה</th>
                <th style={{ padding: "9px 8px", textAlign: "center", fontWeight: 700, color: "#000", width: 100, borderTop: "none", borderBottom: "2px solid #000", borderRight: "1px solid #ddd" }}>סה"כ ש"ח</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} style={{ background: "#fff", borderBottom: "1px solid #ddd" }}>
                  <td style={{ padding: "8px", textAlign: "center", color: "#888", fontSize: 12, borderLeft: "1px solid #ddd", borderRight: "1px solid #ddd" }}>{item.sku || "—"}</td>
                  <td style={{ padding: "8px", textAlign: "center", color: "#666", fontSize: 12, borderRight: "1px solid #ddd" }}>{i + 1}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", borderRight: "1px solid #ddd" }}>
                    <div style={{ fontWeight: 700 }}>{item.name}</div>
                  </td>
                  <td style={{ padding: "8px", textAlign: "center", borderRight: "1px solid #ddd" }}>{item.quantity}</td>
                  <td style={{ padding: "8px", textAlign: "center", borderRight: "1px solid #ddd" }}>₪{fmt(item.unit_price)}</td>
                  <td style={{ padding: "8px", textAlign: "center", fontWeight: 600, borderRight: "1px solid #ddd" }}>₪{fmt(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* SUMMARY SECTION */}
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "16px 32px", direction: "rtl" }}>
            <table style={{ width: 300, fontSize: 13, borderCollapse: "collapse", direction: "rtl" }}>
              <colgroup>
                <col />
                <col style={{ width: 120 }} />
              </colgroup>
              <tbody>
                <tr>
                  <td style={{ padding: "4px 8px", color: "#555", textAlign: "right", borderBottom: "1px solid #ddd" }}>סה"כ ללא מע"מ:</td>
                  <td style={{ padding: "4px 8px", textAlign: "left", fontWeight: 600, borderBottom: "1px solid #ddd" }}>₪{fmt(grossTotal)}</td>
                </tr>
                {discount > 0.001 && (
                  <tr>
                    <td style={{ padding: "4px 8px", color: "#c00", textAlign: "right", borderBottom: "1px solid #ddd" }}>הנחה ({effectivePct.toFixed(1)}%):</td>
                    <td style={{ padding: "4px 8px", textAlign: "left", fontWeight: 600, color: "#c00", borderBottom: "1px solid #ddd" }}>-₪{fmt(discount)}</td>
                  </tr>
                )}
                {discount > 0.001 && (
                  <tr>
                    <td style={{ padding: "4px 8px", color: "#555", textAlign: "right", borderBottom: "1px solid #ddd" }}>סה"כ לאחר הנחה:</td>
                    <td style={{ padding: "4px 8px", textAlign: "left", fontWeight: 600, borderBottom: "1px solid #ddd" }}>₪{fmt(afterDiscount)}</td>
                  </tr>
                )}
                <tr>
                  <td style={{ padding: "4px 8px", color: "#555", textAlign: "right", borderBottom: "1px solid #ddd" }}>מע"מ {vatRate}%:</td>
                  <td style={{ padding: "4px 8px", textAlign: "left", fontWeight: 600, borderBottom: "1px solid #ddd" }}>₪{fmt(vatAmount)}</td>
                </tr>
                <tr style={{ background: GOLD }}>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: "#000", borderTop: "2px solid #000", borderBottom: "2px solid #000" }}>סה"כ לתשלום:</td>
                  <td style={{ padding: "6px 8px", textAlign: "left", fontWeight: 700, color: "#000", borderTop: "2px solid #000", borderBottom: "2px solid #000" }}>₪{fmt(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Notes */}
          {(quote.notes || quote.customer_notes) && (
            <div style={{ padding: "0 32px 12px", fontSize: 13, color: "#444" }}>
              {quote.customer_notes && <div><span style={{ fontWeight: 600 }}>הערות ללקוח: </span>{quote.customer_notes}</div>}
              {quote.notes && <div style={{ marginTop: 4 }}><span style={{ fontWeight: 600 }}>הערות: </span>{quote.notes}</div>}
            </div>
          )}

          {/* SIGNATURE + FOOTER — pushed to bottom */}
          <div style={{ marginTop: "auto" }}>
            {/* SIGNATURE ROW */}
            <div style={{ margin: "24px 32px", borderTop: "1px solid #ccc", paddingTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                {[
                  "מפיק המסמך: מיני סטוק",
                  "שם המקבל",
                  "חתימה",
                  "תאריך",
                ].map(label => (
                  <div key={label} style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ height: 30, borderBottom: "1px solid #333", marginBottom: 4 }} />
                    <div style={{ fontSize: 12, color: "#888" }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* FOOTER */}
            <div style={{ borderTop: "1px solid #eee", padding: "8px 32px", textAlign: "center", fontSize: 11, color: "#999" }}>
              מיני סטוק | טל: 053-7650570 | השזיף 5 נשר, ישראל | a.d.shivuk555@gmail.com
            </div>
          </div>

        </div>
          </div>
        </div>
      </div>

      <style>{`@media print { .print\\:hidden { display: none !important; } body { background: white; } @page { size: A4; margin: 10mm; } }`}</style>
    </div>
  );
}
