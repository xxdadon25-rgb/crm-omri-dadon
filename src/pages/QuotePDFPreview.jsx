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

          {/* 1 ── Business header: logo LEFT, name+details RIGHT */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "24px 32px 16px" }}>
            {/* Left: logo */}
            <div>
              {biz.logo_url && <img src={biz.logo_url} alt="לוגו" style={{ height: 56, objectFit: "contain" }} />}
            </div>
            {/* Right: business name + contact details */}
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#1a1a1a", marginBottom: 4 }}>{biz.business_name || "העסק שלי"}</div>
              <div style={{ fontSize: 13, color: "#555", lineHeight: 1.8 }}>
                {biz.email && <div>{biz.email}</div>}
                {biz.address && <div>{biz.address}</div>}
                {biz.phone && <div>טל׳: {biz.phone}</div>}
                {biz.tax_id && <div>ח.פ: {biz.tax_id}</div>}
              </div>
            </div>
          </div>

          {/* 2 ── Gold title bar: "הצעת מחיר" right | number center | "מקור" left */}
          <div style={{ background: GOLD, padding: "10px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: "#fff", letterSpacing: 1 }}>הצעת מחיר</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>#{quote.quote_number}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>מקור</span>
          </div>

          {/* 3 ── Info row: right=customer | center=doc details | left=empty */}
          <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb" }}>
            {/* Right column: customer */}
            <div style={{ flex: 1, padding: "16px 24px", borderLeft: "1px solid #e5e7eb", textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#999", marginBottom: 4, fontWeight: 600, letterSpacing: 0.5 }}>לכבוד</div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{quote.customer_name}</div>
              {quote.customer_tax_id && <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>ח.פ: {quote.customer_tax_id}</div>}
              {quote.customer_address && <div style={{ fontSize: 12, color: "#555" }}>{quote.customer_address}</div>}
            </div>
            {/* Center column: doc details */}
            <div style={{ width: 200, padding: "16px 24px", borderLeft: "1px solid #e5e7eb", textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#999", marginBottom: 4, fontWeight: 600, letterSpacing: 0.5 }}>פרטי מסמך</div>
              <table style={{ fontSize: 12, borderCollapse: "collapse", width: "100%" }}>
                <tbody>
                  <tr>
                    <td style={{ color: "#666", paddingBottom: 3, paddingLeft: 8 }}>תאריך:</td>
                    <td style={{ fontWeight: 600 }}>{quote.date || "—"}</td>
                  </tr>
                  {quote.valid_until && (
                    <tr>
                      <td style={{ color: "#666", paddingBottom: 3, paddingLeft: 8 }}>תוקף עד:</td>
                      <td style={{ fontWeight: 600 }}>{quote.valid_until}</td>
                    </tr>
                  )}
                  <tr>
                    <td style={{ color: "#666", paddingLeft: 8 }}>סטטוס:</td>
                    <td style={{ fontWeight: 600 }}>{quote.status || "טיוטה"}</td>
                  </tr>
                  <tr>
                    <td style={{ color: "#666", paddingLeft: 8 }}>עמוד:</td>
                    <td style={{ fontWeight: 600 }}>1 / 1</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {/* Left column: empty */}
            <div style={{ width: 160, padding: "16px 24px" }} />
          </div>

          {/* 4 ── Items table */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: GOLD }}>
                <th style={{ padding: "9px 12px", textAlign: "center", fontWeight: 700, color: "#fff", width: 36 }}>#</th>
                <th style={{ padding: "9px 12px", textAlign: "center", fontWeight: 700, color: "#fff", width: 80 }}>מס׳ פריט</th>
                <th style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, color: "#fff" }}>תיאור פריט</th>
                <th style={{ padding: "9px 12px", textAlign: "center", fontWeight: 700, color: "#fff", width: 60 }}>כמות</th>
                <th style={{ padding: "9px 12px", textAlign: "center", fontWeight: 700, color: "#fff", width: 100 }}>ש"כ ליחידה</th>
                <th style={{ padding: "9px 12px", textAlign: "center", fontWeight: 700, color: "#fff", width: 100 }}>סה"כ ש"ח</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f7f7f7", borderBottom: "1px solid #efefef" }}>
                  <td style={{ padding: "9px 12px", textAlign: "center", color: "#888", fontSize: 12 }}>{i + 1}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center", color: "#666", fontSize: 12 }}>{item.sku || "—"}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 600 }}>{item.name}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center" }}>{item.quantity}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center" }}>₪{fmt(item.unit_price)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center", fontWeight: 600 }}>₪{fmt(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 5 ── Summary full width */}
          <div style={{ padding: "20px 32px 8px" }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td style={{ padding: "5px 0 5px 16px", color: "#555", textAlign: "right" }}>סה"כ ללא מע"מ:</td>
                  <td style={{ padding: "5px 0", textAlign: "left", fontWeight: 600 }}>₪{fmt(subtotal)}</td>
                </tr>
                <tr>
                  <td style={{ padding: "5px 0 5px 16px", color: "#555", textAlign: "right" }}>הנחה:</td>
                  <td style={{ padding: "5px 0", textAlign: "left", fontWeight: 600 }}>
                    {discount > 0 ? `-₪${fmt(discount)}` : "0.00%"}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: "5px 0 5px 16px", color: "#555", textAlign: "right" }}>סה"כ לאחר הנחה:</td>
                  <td style={{ padding: "5px 0", textAlign: "left", fontWeight: 600 }}>₪{fmt(afterDiscount)}</td>
                </tr>
                <tr>
                  <td style={{ padding: "5px 0 5px 16px", color: "#555", textAlign: "right" }}>מע"מ {vatRate}%:</td>
                  <td style={{ padding: "5px 0", textAlign: "left", fontWeight: 600 }}>₪{fmt(vatAmount)}</td>
                </tr>
                <tr>
                  <td colSpan={2} style={{ paddingTop: 8 }}>
                    <div style={{ background: GOLD, borderRadius: 6, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>₪{fmt(total)}</span>
                      <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>:סה"כ לתשלום</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Notes */}
          {(quote.notes || quote.customer_notes) && (
            <div style={{ padding: "0 32px 16px", fontSize: 13, color: "#444" }}>
              {quote.customer_notes && <div><span style={{ fontWeight: 600 }}>הערות ללקוח: </span>{quote.customer_notes}</div>}
              {quote.notes && <div style={{ marginTop: 4 }}><span style={{ fontWeight: 600 }}>הערות: </span>{quote.notes}</div>}
            </div>
          )}

          {/* 6 ── Signature row */}
          <div style={{ margin: "8px 32px 32px", borderTop: "1px solid #e5e7eb", paddingTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              {["מפיק המסמך", "שם המקבל", "חתימה", "תאריך"].map(label => (
                <div key={label} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ height: 36, borderTop: "1.5px solid #aaa", marginBottom: 6 }} />
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
