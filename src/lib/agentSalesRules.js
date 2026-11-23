/**
 * Sales-agent business rules. Pure UI-facing decision helpers, never an
 * authorization boundary. Every rule MUST also be enforced by the trusted
 * database order RPC before agents are activated.
 *
 * Gross margin is (net revenue - normalized acquisition cost) / net revenue.
 * Reuse documentProfit; never substitute buy_price * quantity.
 */
import { documentProfit } from "@/lib/documentProfit";

export const AGENT_MIN_GROSS_MARGIN = 40;
export const DEFAULT_AGENT_COMMISSION_PERCENT = 8;

/**
 * @returns {{allowed:boolean, requiresException:boolean, reason:string|null, profit:object}}
 * "allowed" is only a display decision. It must never authorize DB writes.
 */
export function evaluateAgentOrder(items) {
  const profit = documentProfit(items);
  if (!profit.ok || !Number.isFinite(profit.profitMargin)) {
    return {
      allowed: false,
      requiresException: false,
      reason: profit.message || "לא ניתן לשמור הזמנה: נתוני העלות חסרים או אינם מאומתים",
      profit,
    };
  }

  if (profit.totalSalesNet <= 0) {
    return { allowed: false, requiresException: false, reason: "סכום המכירה חייב להיות חיובי", profit };
  }

  // Guard precision near exactly 40%, keeping the UI tolerant of
  // floating-point representation without rounding a genuinely lower margin up.
  const allowed = profit.profitMargin + 1e-9 >= AGENT_MIN_GROSS_MARGIN;
  return {
    allowed,
    requiresException: !allowed,
    reason: allowed ? null : "הרווחיות מתחת ל־40% — נדרש אישור חריגה של מנהל",
    profit,
  };
}

/**
 * Calculate commission on a VERIFIED received payment's taxable base.
 * Callers must confirm settlement and invoice attribution server-side;
 * do not use this helper to treat pending checks as collected cash.
 *
 * Use the historical invoice VAT rate, not the current global VAT setting.
 * Currency rounding occurs only at the final commission amount.
 */
export function commissionForSettledGrossPayment(amountIncludingVat, invoiceVatRate, commissionPercent = DEFAULT_AGENT_COMMISSION_PERCENT) {
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
