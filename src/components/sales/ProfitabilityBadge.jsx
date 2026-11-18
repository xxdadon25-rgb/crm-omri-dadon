// Internal use only — never shown to customers
//
// The margin used to be `(total - buy_price * quantity) / total`, which is
// right only when the line sells the same thing the buy price is quoted in. A
// buy price per unit against a carton price reads as a ~2,000% margin, and the
// badge said so confidently. It now shows a percentage only when the cost can
// actually be normalised to what the line sold, and says it is pending
// otherwise. See src/lib/packagingMath.js.
import { lineProfit } from "@/lib/packagingMath";
import { cartLineForProfit } from "@/lib/cartProfit";

export default function ProfitabilityBadge({ item }) {
  if (!item) return null;

  const r = lineProfit(cartLineForProfit(item));

  if (!r.ok) {
    // No number at all. A badge is small, so it carries the short form and the
    // full reason in its tooltip.
    return (
      <div className="text-xs px-1.5 py-0.5 rounded font-medium text-amber-700 bg-amber-50"
        title={r.message || "רווח ממתין להבהרה"}>
        ממתין
      </div>
    );
  }

  const margin = r.margin * 100;
  const color =
    margin >= 30 ? "text-green-700 bg-green-50" :
    margin >= 15 ? "text-yellow-700 bg-yellow-50" :
    "text-red-700 bg-red-50";

  return (
    <div className={`text-xs px-1.5 py-0.5 rounded font-medium ${color}`} title="רווחיות (פנימי)">
      {margin.toFixed(0)}%
    </div>
  );
}
