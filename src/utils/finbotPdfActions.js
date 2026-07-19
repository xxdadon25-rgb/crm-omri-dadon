import { toast } from "sonner";
import { finbotPdfFileUrl } from "@/lib/finbot";
import { displayInvoiceNumber } from "@/utils/invoiceDisplay";

// Single source of truth for the "open Finbot PDF" actions used from the main
// invoice dialog and the customer-ledger surfaces. Every caller relies on the
// same fetch/fallback semantics and the same disabled-guard predicate.

export function hasFinbotPdf(invoice) {
  return !!finbotPdfFileUrl(invoice?.external_pdf_url);
}

export function printFinbotPdf(invoice) {
  const url = finbotPdfFileUrl(invoice?.external_pdf_url);
  if (!url) return;
  const win = window.open(url, "_blank");
  setTimeout(() => { try { win?.print(); } catch { /* ignore */ } }, 800);
}

export async function downloadFinbotPdf(invoice) {
  const url = finbotPdfFileUrl(invoice?.external_pdf_url);
  if (!url) return;
  const fileName = `invoice_${displayInvoiceNumber(invoice)}.pdf`;
  // Prefer fetch→blob so the saved file uses our filename. Finbot may not send
  // CORS headers; on failure, fall back to opening the URL so the user can
  // still get the file from the PDF viewer.
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(objectUrl);
    toast.success("ה-PDF הורד בהצלחה");
  } catch {
    window.open(url, "_blank");
    toast.info("ה-PDF נפתח בכרטיסייה חדשה — לחץ 'הורד' בקורא ה-PDF כדי לשמור");
  }
}
