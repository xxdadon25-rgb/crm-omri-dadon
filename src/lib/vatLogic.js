/**
 * VAT Logic — NET-FIRST pricing model.
 *
 * All stored prices (buy_price, sell_price, unit_price, item totals) are BEFORE VAT (net).
 * VAT is added only in document summaries.
 *
 * line.total  = quantity × unit_price × (1 - discount/100)   ← net
 * subtotal    = sum of line.total                              ← net
 * vat_amount  = subtotal × vat_rate / 100
 * total       = subtotal + vat_amount                          ← gross
 */

/**
 * Calculate document totals from net-priced line items.
 * @param {Array}  items         - Each item has .total (net)
 * @param {number} vatRate       - e.g. 18
 * @param {number} discountAmount - Global document discount (net)
 * @returns {{ subtotal, vat_amount, total }}
 */
export function calculateDocumentTotals(items, vatRate = 18, discountAmount = 0) {
  const netSubtotal = items.reduce((s, i) => s + (i.total || 0), 0);
  const netAfterDiscount = Math.max(0, netSubtotal - discountAmount);
  const vatAmount = netAfterDiscount * (vatRate / 100);
  return {
    subtotal: netAfterDiscount,
    vat_amount: vatAmount,
    total: netAfterDiscount + vatAmount,
  };
}

/**
 * Calculate a single line total (net).
 * @param {number} unitPrice  - Net unit price (before VAT)
 * @param {number} quantity
 * @param {number} discountPct - Discount percentage (0–100)
 * @returns {number} Net line total
 */
export function calculateLineTotal(unitPrice, quantity, discountPct = 0) {
  return (unitPrice || 0) * (quantity || 0) * (1 - (discountPct || 0) / 100);
}