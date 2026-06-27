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
        <div
          ref={printRef}
          style={{
            maxWidth: 800,
            margin: "0 auto",
            background: "#fff",
            boxShadow: "0 2px 16px rgba(0,0,0,0.10)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {/* ── Business header ── */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "24px 32px 16px" }}>
            {/* Left: business name */}
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#1a1a1a" }}>{biz.business_name || "העסק שלי"}</div>
              {biz.logo_url && <img src={biz.logo_url} alt="לוגו" style={{ height: 48, marginTop: 6, objectFit: "contain" }} />}
            </div>
            {/* Right: contact details */}
            <div style={{ textAlign: "right", fontSize: 13, color: "#555", lineHeight: 1.8 }}>
              {biz.tax_id && <div>ח.פ: {biz.tax_id}</div>}
              {biz.phone && <div>טל: {biz.phone}</div>}
              {biz.email && <div>{biz.email}</div>}
              {biz.address && <div>{biz.address}</div>}
            </div>
          </div>

          {/* ── Gold title bar ── */}
          <div style={{ background: GOLD, padding: "12px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: "#fff", letterSpacing: 1 }}>הצעת מחיר</span>
            <span style={{ fontSize: 18, fontWeight: 600, color: "#fff" }}>#{quote.quote_number}</span>
          </div>

          {/* ── Customer + date row ── */}
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #e5e7eb" }}>
            {/* Customer */}
            <div style={{ flex: 1, padding: "20px 32px", borderLeft: "1px solid #e5e7eb" }}>
              <div style={{ fontSize: 11, color: "#999", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>פרטי לקוח</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{quote.customer_name}</div>
              {quote.customer_tax_id && <div style={{ fontSize: 13, color: "#555", marginTop: 2 }}>ח.פ: {quote.customer_tax_id}</div>}
              {quote.customer_address && <div style={{ fontSize: 13, color: "#555" }}>{quote.customer_address}</div>}
            </div>
            {/* Dates */}
            <div style={{ width: 220, padding: "20px 32px" }}>
              <div style={{ fontSize: 11, color: "#999", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>פרטי מסמך</div>
              <table style={{ fontSize: 13, borderCollapse: "collapse", width: "100%" }}>
                <tbody>
                  <tr>
                    <td style={{ color: "#666", paddingBottom: 4, paddingLeft: 12 }}>תאריך:</td>
                    <td style={{ fontWeight: 600 }}>{quote.date || "—"}</td>
                  </tr>
                  {quote.valid_until && (
                    <tr>
                      <td style={{ color: "#666", paddingBottom: 4, paddingLeft: 12 }}>תוקף עד:</td>
                      <td style={{ fontWeight: 600 }}>{quote.valid_until}</td>
                    </tr>
                  )}
                  <tr>
                    <td style={{ color: "#666", paddingLeft: 12 }}>סטטוס:</td>
                    <td style={{ fontWeight: 600 }}>{quote.status || "טיוטה"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Products table ── */}
          <div style={{ padding: "0 0 0 0" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: GOLD_LIGHT }}>
                  <th style={{ padding: "10px 16px", textAlign: "center", fontWeight: 700, width: 50, borderBottom: `2px solid ${GOLD}` }}>מס' פריט</th>
                  <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 700, borderBottom: `2px solid ${GOLD}` }}>תיאור פריט</th>
                  <th style={{ padding: "10px 16px", textAlign: "center", fontWeight: 700, width: 70, borderBottom: `2px solid ${GOLD}` }}>כמות</th>
                  <th style={{ padding: "10px 16px", textAlign: "center", fontWeight: 700, width: 110, borderBottom: `2px solid ${GOLD}` }}>מחיר ליחידה</th>
                  <th style={{ padding: "10px 16px", textAlign: "center", fontWeight: 700, width: 110, borderBottom: `2px solid ${GOLD}` }}>סה"כ ש"ח</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa", borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "10px 16px", textAlign: "center", color: "#666" }}>{i + 1}</td>
                    <td style={{ padding: "10px 16px" }}>
                      <div style={{ fontWeight: 600 }}>{item.name}</div>
                      {item.sku && <div style={{ fontSize: 11, color: "#999" }}>מק"ט: {item.sku}</div>}
                    </td>
                    <td style={{ padding: "10px 16px", textAlign: "center" }}>{item.quantity}</td>
                    <td style={{ padding: "10px 16px", textAlign: "center" }}>₪{fmt(item.unit_price)}</td>
                    <td style={{ padding: "10px 16px", textAlign: "center", fontWeight: 600 }}>₪{fmt(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Summary ── */}
          <div style={{ display: "flex", justifyContent: "flex-start", padding: "16px 32px 24px" }}>
            <table style={{ width: 280, fontSize: 13, borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td style={{ padding: "5px 12px 5px 0", color: "#555" }}>סה"כ ללא מע"מ:</td>
                  <td style={{ padding: "5px 0", textAlign: "left", fontWeight: 600 }}>₪{fmt(subtotal)}</td>
                </tr>
                <tr>
                  <td style={{ padding: "5px 12px 5px 0", color: "#555" }}>הנחה:</td>
                  <td style={{ padding: "5px 0", textAlign: "left", fontWeight: 600 }}>
                    {discount > 0 ? `-₪${fmt(discount)}` : "0.00%"}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: "5px 12px 5px 0", color: "#555" }}>סה"כ לאחר הנחה:</td>
                  <td style={{ padding: "5px 0", textAlign: "left", fontWeight: 600 }}>₪{fmt(afterDiscount)}</td>
                </tr>
                <tr>
                  <td style={{ padding: "5px 12px 5px 0", color: "#555" }}>מע"מ {vatRate}%:</td>
                  <td style={{ padding: "5px 0", textAlign: "left", fontWeight: 600 }}>₪{fmt(vatAmount)}</td>
                </tr>
                <tr>
                  <td colSpan={2} style={{ paddingTop: 6 }}>
                    <div style={{ background: GOLD, borderRadius: 6, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>סה"כ לתשלום:</span>
                      <span style={{ color: "#fff", fontWeight: 700, fontSize: 17 }}>₪{fmt(total)}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── Notes ── */}
          {(quote.notes || quote.customer_notes) && (
            <div style={{ padding: "0 32px 20px", fontSize: 13, color: "#444" }}>
              {quote.customer_notes && <div><span style={{ fontWeight: 600 }}>הערות ללקוח: </span>{quote.customer_notes}</div>}
              {quote.notes && <div style={{ marginTop: 4 }}><span style={{ fontWeight: 600 }}>הערות: </span>{quote.notes}</div>}
            </div>
          )}

          {/* ── Signature ── */}
          <div style={{ margin: "0 32px 32px", borderTop: "1px solid #e5e7eb", paddingTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              {["מפיק המסמך", "שם המקבל", "חתימה", "תאריך"].map(label => (
                <div key={label} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ height: 40, borderBottom: "1.5px solid #aaa", marginBottom: 6 }} />
                  <div style={{ fontSize: 12, color: "#777" }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`@media print { .print\\:hidden { display: none !important; } body { background: white; } }`}</style>
    </div>
  );
}
