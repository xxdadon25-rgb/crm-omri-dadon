import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { Printer, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const GOLD = "#C8A951";
const GOLD_LIGHT = "#F5E9C4";

function fmt(n) {
  return (parseFloat(n) || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function QuotePDFPreview() {
  const { quoteId } = useParams();
  console.log("[QuotePDF] quoteId:", quoteId, "| pathname:", window.location.pathname);
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
        console.log("[QuotePDF] q.user_id:", q.user_id);
        const { data: settingsRows, error: sErr } = await supabase
          .from("business_settings").select("*").eq("user_id", q.user_id).limit(1);
        console.log("[QuotePDF] settingsRows:", settingsRows, "error:", sErr);
        setQuote(q);
        setBiz(settingsRows?.[0] || {});
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [quoteId]);

  const handlePrint = () => window.print();

  const handleDownload = () => {
    const style = `
      <style>
        body { font-family: Arial, sans-serif; direction: rtl; margin: 0; }
        @page { size: A4; margin: 15mm; }
      </style>
    `;
    const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8">${style}</head><body>${printRef.current.innerHTML}</body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `quote_${quote?.quote_number || quoteId}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
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
  const subtotal = parseFloat(quote.subtotal) || 0;
  const discount = parseFloat(quote.discount_amount) || 0;
  const afterDiscount = subtotal - discount;
  const vatRate = parseFloat(quote.vat_rate) || 18;
  const vatAmount = parseFloat(quote.vat_amount) || afterDiscount * (vatRate / 100);
  const total = parseFloat(quote.total) || afterDiscount + vatAmount;

  return (
    <div dir="rtl" style={{ fontFamily: "Arial, sans-serif", minHeight: "100vh", background: "#f3f4f6" }}>
      {/* Action bar — hidden on print */}
      <div className="print:hidden sticky top-0 z-50 bg-white border-b shadow-sm px-6 py-3 flex items-center gap-3">
        <Button onClick={handlePrint} className="gap-2">
          <Printer className="w-4 h-4" /> הדפסה
        </Button>
        <Button variant="outline" onClick={handleDownload} className="gap-2">
          <Download className="w-4 h-4" /> הורדה
        </Button>
        <span className="mr-auto text-sm text-muted-foreground">הצעת מחיר #{quote.quote_number}</span>
      </div>

      {/* Document */}
      <div className="p-6 pb-16 print:p-0">
        <div ref={printRef} style={{ maxWidth: 800, margin: "0 auto", background: "#fff", boxShadow: "0 2px 16px rgba(0,0,0,0.10)", borderRadius: 8, overflow: "hidden" }}>

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
          <div style={{ background: GOLD, padding: "10px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {/* First = RIGHT in RTL */}
            <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", textDecoration: "underline" }}>הצעת מחיר</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>מספר: {quote.quote_number}</span>
            {/* Last = LEFT in RTL */}
            <span style={{ fontSize: 14, color: "#fff" }}>מקור</span>
          </div>

          {/* INFO ROW: RIGHT=customer, LEFT=doc details */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderTop: "1px solid #e5e7eb", borderBottom: "1px solid #e5e7eb", padding: "12px 32px" }}>
            {/* First = RIGHT in RTL: customer */}
            <div>
              <div style={{ fontSize: 12, color: "#999", marginBottom: 4 }}>לכבוד:</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{quote.customer_name}</div>
              <div style={{ fontSize: 12, color: GOLD, marginTop: 2 }}>לקוח עסקי</div>
            </div>
            {/* Second = LEFT in RTL: doc details */}
            <div style={{ textAlign: "right", fontSize: 13 }}>
              <div style={{ fontWeight: 700, marginBottom: 3 }}>תאריך: {quote.date || "—"}</div>
              <div style={{ fontWeight: 700, marginBottom: 3 }}>סטטוס: {quote.status || "טיוטה"}</div>
              <div>דף 1 מתוך 1</div>
            </div>
          </div>

          {/* ITEMS TABLE */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: GOLD }}>
                <th style={{ padding: "9px 8px", textAlign: "center", fontWeight: 700, color: "#fff", width: 40 }}>#</th>
                <th style={{ padding: "9px 8px", textAlign: "center", fontWeight: 700, color: "#fff", width: 80 }}>מס פריט</th>
                <th style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, color: "#fff" }}>תיאור פריט</th>
                <th style={{ padding: "9px 8px", textAlign: "center", fontWeight: 700, color: "#fff", width: 70 }}>כמות</th>
                <th style={{ padding: "9px 8px", textAlign: "center", fontWeight: 700, color: "#fff", width: 100 }}>ש"ח ליחידה</th>
                <th style={{ padding: "9px 8px", textAlign: "center", fontWeight: 700, color: "#fff", width: 100 }}>סה"כ ש"ח</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} style={{ background: "#fff", borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "8px", textAlign: "center", color: "#888", fontSize: 12 }}>{i + 1}</td>
                  <td style={{ padding: "8px", textAlign: "center", color: "#666", fontSize: 12 }}>{item.sku || "—"}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>
                    <div style={{ fontWeight: 700 }}>{item.name}</div>
                    {item.sku && <div style={{ fontSize: 11, color: "#999", marginTop: 1 }}>{item.sku}</div>}
                  </td>
                  <td style={{ padding: "8px", textAlign: "center" }}>{item.quantity}</td>
                  <td style={{ padding: "8px", textAlign: "center" }}>₪{fmt(item.unit_price)}</td>
                  <td style={{ padding: "8px", textAlign: "center", fontWeight: 600 }}>₪{fmt(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* SUMMARY SECTION */}
          <div style={{ padding: "8px 32px" }}>
            {/* In RTL, flex-end pushes to the LEFT side visually */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <table style={{ width: 280, fontSize: 13, borderCollapse: "collapse" }}>
                <tbody>
                  <tr>
                    <td style={{ padding: "4px 0", color: "#666", textAlign: "right" }}>סה"כ ללא מע"מ:</td>
                    <td style={{ padding: "4px 0", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>₪{fmt(subtotal)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "4px 0", color: "#666", textAlign: "right" }}>הנחה:</td>
                    <td style={{ padding: "4px 0", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>
                      {discount > 0 ? `-₪${fmt(discount)}` : "0.00%"}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "4px 0", color: "#666", textAlign: "right" }}>סה"כ לאחר הנחה:</td>
                    <td style={{ padding: "4px 0", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>₪{fmt(afterDiscount)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "4px 0 8px", color: "#666", textAlign: "right" }}>מע"מ {vatRate}.00%:</td>
                    <td style={{ padding: "4px 0 8px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>₪{fmt(vatAmount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {/* Full-width gold total row */}
            <div style={{ background: GOLD, borderRadius: 4, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
              {/* First = RIGHT in RTL: label */}
              <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>סה"כ לתשלום:</span>
              {/* Second = LEFT in RTL: amount */}
              <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>₪{fmt(total)}</span>
            </div>
          </div>

          {/* Notes */}
          {(quote.notes || quote.customer_notes) && (
            <div style={{ padding: "0 32px 12px", fontSize: 13, color: "#444" }}>
              {quote.customer_notes && <div><span style={{ fontWeight: 600 }}>הערות ללקוח: </span>{quote.customer_notes}</div>}
              {quote.notes && <div style={{ marginTop: 4 }}><span style={{ fontWeight: 600 }}>הערות: </span>{quote.notes}</div>}
            </div>
          )}

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
            מיני סטוק | טל: 054-6479930 | השזיף 5 נשר, ישראל | xxdadon25@gmail.com
          </div>

        </div>
      </div>

      <style>{`@media print { .print\\:hidden { display: none !important; } body { background: white; } }`}</style>
    </div>
  );
}
