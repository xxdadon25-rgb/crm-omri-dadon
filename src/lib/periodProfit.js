/**
 * Financial reporting credit reversal. Credits are NOT new sales and their
 * negative item lines must reverse BOTH revenue and historical cost.
 * The accounting period is the credit document's own date, not its invoice.
 * No current catalog price is ever consulted.
 */
import { documentProfit } from "@/lib/documentProfit";
import { isConfirmedCredit } from "@/lib/invoiceBalance";

export const monthKey = value =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 7) : null;

export function creditProfit(credit) {
  if (!isConfirmedCredit(credit) || !Array.isArray(credit.items) || !credit.items.length) {
    return { ok: false, totalSalesNet: null, totalCostNet: null, totalProfit: null };
  }
  const items = credit.items.map(line => ({
    ...line,
    // Credits encode the returned sold units as NEGATIVE prices and totals.
    // Reuse the exact original per-item cost logic against their magnitude.
    unit_price: Math.abs(Number(line.unit_price)),
    total: Math.abs(Number(line.total)),
  }));
  const result = documentProfit(items);
  const gross = Math.abs(Number(credit.total));
  const expectedGross = Math.round(result.totalSalesNet * 1.18 * 100) / 100;
  // A full credit with missing/mismatched lines cannot safely reverse profit.\n  // Allow up to ₪1 document-level rounding, as invoice 10129 was rounded\n  // from ₪195.41 to ₪195.00 without changing its net line amounts.
  if (!result.ok || !Number.isFinite(gross) ||
      Math.abs(expectedGross - gross) > 1.00) {
    return { ok: false, totalSalesNet: null, totalCostNet: null, totalProfit: null };
  }
  return result;
}

/**
 * Gross profit, before business overhead, using invoices and confirmed credit
 * notes within the SAME accounting date window. A missing credit cost never
 * silently counts as free returned stock.
 */
export function periodGrossProfit(invoices, creditNotes, inPeriod) {
  let salesAg = 0, costAg = 0;
  let pending = 0, invoiceCount = 0, creditCount = 0;
  for (const inv of invoices || []) {
    if (!inPeriod(inv.date)) continue;
    invoiceCount++;
    const result = documentProfit(inv.items || []);
    if (!result.ok) { pending++; continue; }
    salesAg += Math.round(result.totalSalesNet * 100);
    costAg += Math.round(result.totalCostNet * 100);
  }
  for (const cn of creditNotes || []) {
    if (!isConfirmedCredit(cn) || !inPeriod(cn.date)) continue;
    creditCount++;
    const result = creditProfit(cn);
    if (!result.ok) { pending++; continue; }
    salesAg -= Math.round(result.totalSalesNet * 100);
    costAg -= Math.round(result.totalCostNet * 100);
  }
  const netSales = salesAg / 100;
  const netCost = costAg / 100;
  return {
    ok: pending === 0, pending,
    invoiceCount, creditCount,
    totalSalesNet: pending ? null : netSales,
    totalCostNet: pending ? null : netCost,
    totalProfit: pending ? null : (salesAg - costAg) / 100,
    // Reports UI/export legacy field names. All point at the same verified sum.
    totalSales: pending ? null : netSales,
    totalCost: pending ? null : netCost,
    profit: pending ? null : (salesAg - costAg) / 100,
    pendingInvoices: pending,
    profitMargin: pending || netSales <= 0 ? null : ((salesAg - costAg) / salesAg) * 100,
  };
}
