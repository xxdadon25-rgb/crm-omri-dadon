import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TrendingUp } from "lucide-react";

/**
 * The profitability popup.
 *
 * `profitMargin` may be NULL, and that is not an edge case to paper over: it
 * means at least one line could not be costed — no sale level, no purchase
 * level, or no purchase price — so any percentage shown here would be
 * invented. The popup then says so instead, and still shows what the document
 * sold, because revenue is never the uncertain part.
 */
export default function ProfitabilityModal({
  open,
  onOpenChange,
  totalCostNet,
  totalSalesNet,
  totalProfit,
  profitMargin,
  itemCount,
  avgProfitPerItem,
  pendingLines = 0,
  pendingMessage = null,
}) {
  const pending = profitMargin === null || profitMargin === undefined;
  const money = (v) => (v ?? 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const getProfitColor = (margin) => {
    if (margin === null || margin === undefined) return "text-amber-700";
    if (margin >= 30) return "text-green-700";
    if (margin >= 15) return "text-amber-700";
    return "text-red-600";
  };

  const getProfitBg = (margin) => {
    if (margin === null || margin === undefined) return "bg-amber-50";
    if (margin >= 30) return "bg-green-50";
    if (margin >= 15) return "bg-amber-50";
    return "bg-red-50";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-600" />
            📊 נתוני רווחיות
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-6">
          <div className="p-4 bg-muted rounded-lg text-center">
            <p className="text-xs text-muted-foreground mb-2">
              עלות כוללת (ללא מע״מ){pendingLines > 0 ? " — שורות מחושבות בלבד" : ""}
            </p>
            <p className="font-bold text-lg">₪{money(totalCostNet)}</p>
          </div>
          <div className="p-4 bg-muted rounded-lg text-center">
            <p className="text-xs text-muted-foreground mb-2">מכירה כוללת (ללא מע״מ)</p>
            <p className="font-bold text-lg">₪{money(totalSalesNet)}</p>
          </div>
          <div className={`p-4 ${getProfitBg(profitMargin)} rounded-lg text-center`}>
            <p className={`text-xs ${getProfitColor(profitMargin)} mb-2`}>
              רווח גולמי{pendingLines > 0 ? " (חלקי)" : ""}
            </p>
            <p className={`font-bold text-lg ${getProfitColor(profitMargin)}`}>
              ₪{money(totalProfit)}
            </p>
          </div>
          <div className={`p-4 ${getProfitBg(profitMargin)} rounded-lg text-center`}>
            {/* A gross margin, over revenue — or an honest refusal. */}
            <p className={`text-xs ${getProfitColor(profitMargin)} mb-2`}>רווחיות % (מתוך המכירה)</p>
            <p className={`font-bold text-lg ${getProfitColor(profitMargin)}`}>
              {pending ? "ממתין להבהרה" : `${profitMargin.toFixed(1)}%`}
            </p>
            {pending && pendingMessage && (
              <p className="text-[11px] text-amber-800 mt-1 leading-relaxed">{pendingMessage}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground mb-1">מספר פריטים</p>
              <p className="font-bold text-base">{itemCount}</p>
            </div>
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground mb-1">רווח ממוצע לפריט</p>
              {/* Withheld with the margin: an average of a profit we could
                  not compute would be the same invention in smaller type. */}
              <p className="font-bold text-base">
                {pending ? "—" : `₪${money(avgProfitPerItem)}`}
              </p>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-4 text-center">נתונים אלה מוצפנים לשימוש פנימי בלבד</p>
      </DialogContent>
    </Dialog>
  );
}