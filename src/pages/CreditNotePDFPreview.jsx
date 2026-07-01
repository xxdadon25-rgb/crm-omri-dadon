import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { Printer, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import jsPDF from "jspdf";
import domtoimage from "dom-to-image-more";
import { useRef } from "react";

const GOLD = "#F5C518";

function fmt(n) {
  return (parseFloat(n) || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return "—";
  return d.slice(0, 10).split("-").reverse().join("/");
}

export default function CreditNotePDFPreview() {
  const { creditNoteId } = useParams();
  const [creditNote, setCreditNote] = useState(null);
  const [biz, setBiz] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const printRef = useRef();

  useEffect(() => {
    (async () => {
      try {
        const { data: rows, error: cnErr } = await supabase
          .from("credit_notes").select("*").eq("id", creditNoteId).limit(1);
        if (cnErr) throw cnErr;
        const cn = rows?.[0] || null;
        if (!cn) { setError("זיכוי לא נמצא"); return; }
        const { data: settingsRows } = await supabase
          .from("business_settings").select("*").eq("user_id", cn.user_id).limit(1);
        setCreditNote(cn);
        setBiz(settingsRows?.[0] || {});
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [creditNoteId]);

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
    pdf.save(`credit_note_${creditNote?.credit_note_number || creditNoteId}.pdf`);
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" /></div>;
  if (error) return <div className="flex items-center justify-center min-h-screen"><p className="text-red-600">{error}</p></div>;
  if (!creditNote) return null;

  const items = creditNote.items || [];
  // Calculate from items since subtotal/vat_amount columns don't exist in schema
  const subtotal = items.reduce((s, i) => s + Math.abs((i.unit_price || 0) * (i.quantity || 0)), 0);
  const vatRate = 17;
  const vatAmount = subtotal * (vatRate / 100);
  const total = subtotal + vatAmount;
  // Extract original invoice number from reason field (format: "זיכוי עבור חשבונית מספר X")
  const invoiceNumberMatch = creditNote.reason?.match(/(\d+)$/);
  const originalInvoiceNumber = invoiceNumberMatch ? invoiceNumberMatch[1] : null;

  return (
    <div className="min-h-screen bg-gray-100" style={{ direction: "rtl" }}>
      {/* Action bar — hidden on print */}
      <div className="sticky top-0 z-50 bg-white shadow-md p-4 border-b print:hidden">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex gap-2">
            <Button onClick={handlePrint} className="flex items-center gap-2">
              <Printer className="w-4 h-4" /> הדפסה
            </Button>
            <Button onClick={handleDownload} variant="outline" className="flex items-center gap-2">
              <FileText className="w-4 h-4" /> הורדה
            </Button>
          </div>
          <span className="text-sm text-gray-600">זיכוי {creditNote.credit_note_number}</span>
        </div>
      </div>

      <div className="p-4 pb-12">
        <div ref={printRef} className="max-w-4xl mx-auto bg-white shadow-lg" style={{ fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl", fontSize: 12, color: "#111", border: "2px solid #111" }}>

          {/* Company header */}
          <div style={{ display: "flex", alignItems: "center", height: 66, margin: "8px 16px 0", borderBottom: "2px solid #111" }}>
            <div style={{ width: 220, borderLeft: "1px solid #ddd", padding: "6px 10px", textAlign: "right", fontSize: 10, color: "#333", lineHeight: 1.5 }}>
              {biz.email && <div>{biz.email}</div>}
              {biz.address && <div>{biz.address}</div>}
              {biz.phone && <div>טלפון: {biz.phone}</div>}
              {biz.tax_id && <div style={{ fontWeight: 700 }}>עוסק מורשה {biz.tax_id}</div>}
            </div>
            <div style={{ flex: 1, padding: "6px 10px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end" }}>
              {biz.logo_url && <img src={biz.logo_url} alt="לוגו" style={{ maxHeight: 32, maxWidth: 100, marginBottom: 2 }} />}
              <div style={{ fontSize: 18, fontWeight: 800 }}>{biz.business_name || "העסק שלי"}</div>
            </div>
          </div>

          {/* Title bar */}
          <div style={{ margin: "0 16px", borderBottom: "2px solid #111", background: GOLD, display: "flex", alignItems: "center", padding: "0 12px", height: 36 }}>
            <div style={{ flex: 1, fontSize: 18, fontWeight: 800, textAlign: "right" }}>הודעת זיכוי</div>
            <div style={{ flex: 1, fontSize: 16, fontWeight: 800, textAlign: "center" }}>{creditNote.credit_note_number}</div>
            <div style={{ flex: 1, fontSize: 11, fontWeight: 700, textAlign: "left" }}>
              {originalInvoiceNumber ? `מקור: חשבונית #${originalInvoiceNumber}` : ""}
            </div>
          </div>

          {/* Customer + meta */}
          <div style={{ margin: "0 16px", borderBottom: "2px solid #111", display: "flex", minHeight: 60 }}>
            <div style={{ flex: 6, padding: "6px 10px", fontSize: 10, textAlign: "right", borderLeft: "1px solid #ddd", lineHeight: 1.6 }}>
              {creditNote.reason && (
                <div style={{ fontSize: 12, fontWeight: 700, color: "#b91c1c" }}>{creditNote.reason}</div>
              )}
            </div>
            <div style={{ flex: 4, padding: "6px 10px", fontSize: 10, textAlign: "right", lineHeight: 1.6 }}>
              <div><span style={{ fontWeight: 700 }}>תאריך:</span> {fmtDate(creditNote.created_at)}</div>
              {originalInvoiceNumber && <div><span style={{ fontWeight: 700 }}>חשבונית מקורית:</span> #{originalInvoiceNumber}</div>}
              <div>דף 1 מתוך 1</div>
            </div>
          </div>

          {/* Items table */}
          <div style={{ margin: "0 16px", borderBottom: "2px solid #111" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
              <thead>
                <tr style={{ background: GOLD, borderBottom: "1px solid #111", height: 22 }}>
                  <th style={{ padding: "3px 4px", textAlign: "center", fontWeight: 700, borderLeft: "1px solid #999", width: 32 }}>#</th>
                  <th style={{ padding: "3px 4px", textAlign: "right", fontWeight: 700, borderLeft: "1px solid #999" }}>תיאור פריט</th>
                  <th style={{ padding: "3px 4px", textAlign: "center", fontWeight: 700, borderLeft: "1px solid #999", width: 48 }}>כמות</th>
                  <th style={{ padding: "3px 4px", textAlign: "center", fontWeight: 700, borderLeft: "1px solid #999", width: 88 }}>מחיר ליחידה</th>
                  <th style={{ padding: "3px 4px", textAlign: "center", fontWeight: 700, width: 100 }}>סה״כ</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} style={{ background: "#fff", borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "6px 4px", textAlign: "center", color: "#888" }}>{i + 1}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{item.name}</td>
                    <td style={{ padding: "6px 4px", textAlign: "center" }}>{item.quantity}</td>
                    <td style={{ padding: "6px 4px", textAlign: "center", direction: "ltr" }}>
                      {fmt(Math.abs(item.unit_price || 0))} ₪
                    </td>
                    <td style={{ padding: "6px 4px", textAlign: "center", fontWeight: 600, direction: "ltr", color: "#b91c1c" }}>
                      ({fmt(Math.abs(item.total || 0))}) ₪
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div style={{ margin: "0 16px", padding: "12px 16px", display: "flex", justifyContent: "flex-start", borderBottom: "2px solid #111" }}>
            <div style={{ width: 240, fontSize: 11, lineHeight: 2 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>סכום לפני מע״מ:</span>
                <span style={{ direction: "ltr" }}>({fmt(subtotal)}) ₪</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>מע״מ ({vatRate}%):</span>
                <span style={{ direction: "ltr" }}>({fmt(vatAmount)}) ₪</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 13, borderTop: "2px solid #111", marginTop: 4, paddingTop: 4, color: "#b91c1c" }}>
                <span>סה״כ לזיכוי:</span>
                <span style={{ direction: "ltr" }}>({fmt(total)}) ₪</span>
              </div>
            </div>
          </div>

          <div style={{ margin: "8px 16px 16px", textAlign: "center", fontSize: 9, color: "#999" }}>
            מסמך זה הופק אוטומטית — {biz.business_name || ""}
          </div>
        </div>
      </div>
    </div>
  );
}
