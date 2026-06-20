const STATUS_STYLES = {
  "ליד חדש":             "bg-sky-100 text-sky-800",
  "בטיפול":              "bg-blue-100 text-blue-800",
  "הצעת מחיר נשלחה":    "bg-purple-100 text-purple-800",
  "ממתין לתשובה":        "bg-yellow-100 text-yellow-800",
  "לקוח פעיל":           "bg-green-100 text-green-800",
  "VIP":                 "bg-amber-100 text-amber-800",
  "לא פעיל":             "bg-gray-100 text-gray-600",
  "לא רלוונטי":          "bg-red-100 text-red-700",
};

const STATUS_ICONS = {
  "ליד חדש":             "✨",
  "בטיפול":              "🔄",
  "הצעת מחיר נשלחה":    "📄",
  "ממתין לתשובה":        "⏳",
  "לקוח פעיל":           "✅",
  "VIP":                 "⭐",
  "לא פעיל":             "😴",
  "לא רלוונטי":          "❌",
};

export default function CustomerStatusBadge({ status, size = "sm" }) {
  if (!status) return null;
  const cls = STATUS_STYLES[status] || "bg-gray-100 text-gray-600";
  const icon = STATUS_ICONS[status] || "";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${size === "lg" ? "text-sm" : "text-xs"} ${cls}`}>
      <span>{icon}</span>
      <span>{status}</span>
    </span>
  );
}

export { STATUS_STYLES, STATUS_ICONS };