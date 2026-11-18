// Internal use only — never shown to customers
//
// The totals used to be `Σ total` against `Σ buy_price × quantity`, with no
// notion of what each line actually sold. A buy price per unit against a
// carton price produced a confident, badly wrong margin, and a line with no
// purchase price at all was counted as costing nothing — which inflated the
// margin rather than admitting the gap.
//
// Now a line is included only when its cost can be normalised to the level it
// sold, and ONE line that cannot be is enough to withhold the percentage. The
// cost and profit of the lines that ARE costed are still shown, because they
// are real; it is only the ratio that would mislead. See
// src/lib/packagingMath.js.
import { TrendingUp, HelpCircle } from "lucide-react";
import { orderProfit, toShekels } from "@/lib/packagingMath";
import { cartLinesForProfit } from "@/lib/cartProfit";

const money = (agorot) =>
  toShekels(agorot).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ProfitPanel({ items }) {
  const lines = items || [];
  // Nothing to say when no line has a purchase price — unchanged behaviour.
  if (lines.filter(i => i.buy_price !== undefined && i.buy_price !== null).length === 0) return null;

  const r = orderProfit(cartLinesForProfit(lines));

  return (
    <div className={`px-4 py-2.5 border-t text-xs space-y-1 ${
      r.ok ? "bg-green-50 border-green-100" : "bg-amber-50 border-amber-100"}`}>
      <div className={`flex items-center gap-1 font-semibold mb-1 ${
        r.ok ? "text-green-700" : "text-amber-700"}`}>
        {r.ok ? <TrendingUp className="w-3.5 h-3.5" /> : <HelpCircle className="w-3.5 h-3.5" />}
        רווחיות (פנימי)
      </div>

      <div className="flex justify-between text-muted-foreground">
        <span>עלות{r.pendingLines > 0 ? " (שורות מחושבות)" : ""}:</span>
        <span className="font-medium text-foreground">₪{money(r.cost)}</span>
      </div>
      <div className="flex justify-between text-muted-foreground">
        <span>רווח גולמי{r.pendingLines > 0 ? " (חלקי)" : ""}:</span>
        <span className={`font-medium ${r.profit >= 0 ? "text-green-700" : "text-red-600"}`}>
          ₪{money(r.profit)}
        </span>
      </div>

      {/* The percentage, or the reason there isn't one. Never both, and never a
          number standing in for a missing fact. */}
      <div className="flex justify-between text-muted-foreground">
        <span>שולי רווח:</span>
        {r.ok ? (
          <span className={`font-bold ${
            r.margin >= 0.2 ? "text-green-700" : r.margin >= 0.1 ? "text-yellow-700" : "text-red-600"}`}>
            {(r.margin * 100).toFixed(1)}%
          </span>
        ) : (
          <span className="font-bold text-amber-700">ממתין להבהרה</span>
        )}
      </div>

      {!r.ok && (
        <p className="text-[11px] text-amber-800 leading-relaxed pt-0.5">
          {r.message}
          {r.pendingLines > 0 && " — יש להשלים את רמת האריזה או נתוני האריזה של המוצר."}
        </p>
      )}

      {/* Stated so the figure is never mistaken for a VAT-inclusive one: both
          sides are net, so this is a pre-VAT margin. */}
      <p className="text-[10px] text-muted-foreground pt-0.5">המחירים והעלויות ללא מע״מ</p>
    </div>
  );
}
