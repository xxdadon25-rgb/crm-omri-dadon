import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TrendingUp } from "lucide-react";

export default function ProfitabilityModal({
  open,
  onOpenChange,
  totalCostNet,
  totalSalesNet,
  totalProfit,
  profitMargin,
  itemCount,
  avgProfitPerItem
}) {
  const getProfitColor = (margin) => {
    if (margin >= 30) return "text-green-700";
    if (margin >= 15) return "text-amber-700";
    return "text-red-600";
  };

  const getProfitBg = (margin) => {
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
            <p className="text-xs text-muted-foreground mb-2">עלות כוללת (ללא מע״מ)</p>
            <p className="font-bold text-lg">₪{totalCostNet.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div className="p-4 bg-muted rounded-lg text-center">
            <p className="text-xs text-muted-foreground mb-2">מכירה כוללת (ללא מע״מ)</p>
            <p className="font-bold text-lg">₪{totalSalesNet.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div className={`p-4 ${getProfitBg(profitMargin)} rounded-lg text-center`}>
            <p className={`text-xs ${getProfitColor(profitMargin)} mb-2`}>רווח גולמי</p>
            <p className={`font-bold text-lg ${getProfitColor(profitMargin)}`}>
              ₪{totalProfit.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className={`p-4 ${getProfitBg(profitMargin)} rounded-lg text-center`}>
            <p className={`text-xs ${getProfitColor(profitMargin)} mb-2`}>רווחיות %</p>
            <p className={`font-bold text-lg ${getProfitColor(profitMargin)}`}>
              {profitMargin.toFixed(1)}%
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground mb-1">מספר פריטים</p>
              <p className="font-bold text-base">{itemCount}</p>
            </div>
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground mb-1">רווח ממוצע לפריט</p>
              <p className="font-bold text-base">₪{avgProfitPerItem.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-4 text-center">נתונים אלה מוצפנים לשימוש פנימי בלבד</p>
      </DialogContent>
    </Dialog>
  );
}