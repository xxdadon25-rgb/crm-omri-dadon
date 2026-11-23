/**
 * Arithmetic ONLY. The trusted server decides whether a receipt was settled,
 * which original order/agent earned it, and whether credit/reversal applies.
 * VAT rate belongs to the historical invoice, never today's global setting.
 */
export const DEFAULT_AGENT_COMMISSION_PERCENT = 8;

export function commissionForSettledGrossPayment(amountIncludingVat, invoiceVatRate, commissionPercent = DEFAULT_AGENT_COMMISSION_PERCENT) {
  // Missing values must not silently turn into zero (Number(null) === 0).
  if ([amountIncludingVat, invoiceVatRate, commissionPercent].some(
    v => v === null || v === undefined || (typeof v === "string" && !v.trim())
  )) return null;
  const amount = Number(amountIncludingVat);
  const vatRate = Number(invoiceVatRate);
  const rate = Number(commissionPercent);
  if (![amount, vatRate, rate].every(Number.isFinite) ||
      amount < 0 || vatRate < 0 || vatRate > 100 || rate < 0 || rate > 100) {
    return null;
  }
  const net = amount / (1 + vatRate / 100);
  return Math.round((net * rate / 100 + Number.EPSILON) * 100) / 100;
}
