import { formatDate } from "@/lib/dateUtils";
import { FileText, ShoppingCart, Receipt, TrendingUp, Wallet, AlertCircle, FolderOpen, Calendar } from "lucide-react";

export default function LedgerSummaryBar({ summary }) {
  const {
    totalQuotes = 0,
    totalOrders = 0,
    totalInvoices = 0,
    totalRevenue = 0,
    totalPaid = 0,
    totalOutstanding = 0,
    openDocs = 0,
    lastActivity = null,
  } = summary;

  const fmt = v => `₪${(v || 0).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const cards = [
    { label: "הצעות מחיר", value: totalQuotes, format: "count", color: "bg-sky-50 border-sky-100", Icon: FileText },
    { label: "הזמנות", value: totalOrders, format: "count", color: "bg-blue-50 border-blue-100", Icon: ShoppingCart },
    { label: "חשבוניות", value: totalInvoices, format: "count", color: "bg-violet-50 border-violet-100", Icon: Receipt },
    { label: "סה״כ הכנסות", value: fmt(totalRevenue), format: "text", color: "bg-green-50 border-green-100", Icon: TrendingUp },
    { label: "שולם", value: fmt(totalPaid), format: "text", color: "bg-emerald-50 border-emerald-100", Icon: Wallet },
    { label: "יתרה פתוחה", value: fmt(totalOutstanding), format: "text", color: totalOutstanding > 0 ? "bg-red-50 border-red-100" : "bg-gray-50 border-gray-100", Icon: AlertCircle },
    { label: "מסמכים פתוחים", value: openDocs, format: "count", color: "bg-orange-50 border-orange-100", Icon: FolderOpen },
    { label: "פעילות אחרונה", value: lastActivity ? formatDate(lastActivity) : "—", format: "text", color: "bg-gray-50 border-gray-100", Icon: Calendar },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map(card => (
        <div key={card.label} className={`${card.color} rounded-xl border p-3`}>
          <div className="flex items-center gap-1.5 mb-1">
            <card.Icon className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">{card.label}</p>
          </div>
          <p className="text-lg font-bold leading-tight">{card.value}</p>
        </div>
      ))}
    </div>
  );
}