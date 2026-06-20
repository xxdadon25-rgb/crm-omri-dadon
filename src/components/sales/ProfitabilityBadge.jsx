// Internal use only — never shown to customers
export default function ProfitabilityBadge({ item }) {
  if (!item.buy_price && item.buy_price !== 0) return null;

  const cost = (item.buy_price || 0) * item.quantity;
  const revenue = item.total || 0;
  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

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