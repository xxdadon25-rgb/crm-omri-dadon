import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { generateDocumentPDF } from "@/lib/pdfGenerator";
import { Printer, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildDocumentHTML } from "@/lib/pdfGenerator";

export default function QuotePDFPreview() {
  const { quoteId } = useParams();
  const [quote, setQuote] = useState(null);
  const [businessSettings, setBusinessSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generatingPDF, setGeneratingPDF] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const quoteData = await base44.entities.Quote.get(quoteId);
        if (!quoteData) {
          setError("Quote not found");
          return;
        }
        setQuote(quoteData);

        const settingsRecords = await base44.entities.BusinessSettings.list();
        setBusinessSettings(settingsRecords[0] || {});
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [quoteId]);

  const handlePrint = async () => {
    if (!quote || !businessSettings) return;
    setGeneratingPDF(true);
    try {
      const blob = await generateDocumentPDF({ type: "quote", doc: quote, businessSettings });
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
    if (!quote || !businessSettings) return;
    setGeneratingPDF(true);
    try {
      const blob = await generateDocumentPDF({ type: "quote", doc: quote, businessSettings });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quote_${quote.quote_number}.pdf`;
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

  if (!quote || !businessSettings) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-600 mb-2">Quote Not Found</h1>
        </div>
      </div>
    );
  }

  const documentHTML = buildDocumentHTML({ type: "quote", doc: quote, businessSettings });

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
          <span className="text-sm text-gray-600">הצעת מחיר #{quote.quote_number}</span>
        </div>
      </div>

      {/* Document View */}
      <div className="p-4 pb-12">
        <div className="max-w-6xl mx-auto bg-white shadow-lg">
          <div
            dangerouslySetInnerHTML={{ __html: documentHTML }}
            style={{ direction: "rtl" }}
          />
        </div>
      </div>
    </div>
  );
}