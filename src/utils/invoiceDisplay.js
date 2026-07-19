// One place to control how invoice numbers render across the whole app.
// Preference: Finbot's external number (what customers see) over the local
// counter. Falls back to internal to keep legacy rows non-blank, then to "—".
export function displayInvoiceNumber(inv) {
  if (!inv) return "—";
  return inv.external_invoice_number || inv.invoice_number || "—";
}
