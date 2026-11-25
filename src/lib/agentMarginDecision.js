/**
 * Pure decision rule; input is a trusted `documentProfit` calculation.
 * This remains a UI hint, NOT a server authorization primitive.
 */
export const AGENT_MIN_GROSS_MARGIN = 40;

export function evaluateMarginResult(profit) {
  if (!profit?.ok || !Number.isFinite(profit.profitMargin)) {
    return {
      allowed: false,
      requiresException: false,
      reason: profit?.message || "לא ניתן לשמור הזמנה: נתוני העלות חסרים או אינם מאומתים",
      profit,
    };
  }
  if (!Number.isFinite(profit.totalSalesNet) || profit.totalSalesNet <= 0) {
    return { allowed: false, requiresException: false, reason: "סכום המכירה חייב להיות חיובי", profit };
  }
  const allowed = profit.profitMargin + 1e-9 >= AGENT_MIN_GROSS_MARGIN;
  return {
    allowed,
    requiresException: !allowed,
    reason: allowed ? null : "הרווחיות מתחת ל־40% — נדרש אישור חריגה של מנהל",
    profit,
  };
}
