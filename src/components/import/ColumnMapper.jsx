import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FIELD_LABELS } from "@/lib/csvParser";
import { CheckCircle } from "lucide-react";

const TARGET_FIELDS = Object.entries(FIELD_LABELS);

export default function ColumnMapper({ headers, mapping, onChange }) {
  const mappedCount = Object.values(mapping).filter(Boolean).length;

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">מיפוי עמודות</h3>
        <Badge variant="secondary">
          <CheckCircle className="w-3 h-3 ml-1 text-green-500" />
          {mappedCount} ממופות
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground mb-4">בדוק שהעמודות ממופות נכון. המיפוי מ-WooCommerce זוהה אוטומטית.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto pl-1">
        {headers.map((csvCol) => (
          <div key={csvCol} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
            <span className="text-xs font-medium truncate flex-1 min-w-0" title={csvCol}>{csvCol}</span>
            <span className="text-muted-foreground text-xs">→</span>
            <Select
              value={mapping[csvCol] || "__none__"}
              onValueChange={(val) => onChange({ ...mapping, [csvCol]: val === "__none__" ? "" : val })}
            >
              <SelectTrigger className="h-7 text-xs w-36 shrink-0">
                <SelectValue placeholder="דלג" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— דלג —</SelectItem>
                {TARGET_FIELDS.map(([field, label]) => (
                  <SelectItem key={field} value={field}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  );
}