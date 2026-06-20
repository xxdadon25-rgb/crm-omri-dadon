// Internal use only — never shown to customers
import { TrendingUp } from "lucide-react";

export default function ProfitPanel({ items }) {
  const itemsWithCost = items.filter(i => i.buy_price !== undefined && i.buy_price !== null);
  if (itemsWithCost.length === 0) return null;

  const totalRevenue = items.reduce((s, i) => s + (i.total || 0), 0);
  const totalCost = items.reduce((s, i) => s + ((i.buy_price || 0) * (i.quantity || 0)), 0);
  const totalProfit = totalRevenue - totalCost;
  const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  return (
    <div className="px-4 py-2.5 bg-green-50 border-t border-green-100 text-xs space-y-1">
      <div className="flex items-center gap-1 text-green-700 font-semibold mb-1">
        <TrendingUp className="w-3.5 h-3.5" />
        רווחיות (פנימי)
      </div>
      <div className="flex justify-between text-muted-foreground">
        <span>עלות:</span>
        <span className="font-medium text-foreground">₪{totalCost.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      </div>
      <div className="flex justify-between text-muted-foreground">
        <span>רווח גולמי:</span>
        <span className={`font-medium ${totalProfit >= 0 ? "text-green-700" : "text-red-600"}`}>
          ₪{totalProfit.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
      <div className="flex justify-between text-muted-foreground">
        <span>שולי רווח:</span>
        <span className={`font-bold ${margin >= 20 ? "text-green-700" : margin >= 10 ? "text-yellow-700" : "text-red-600"}`}>
          {margin.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}