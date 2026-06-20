import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatabaseBackup, Download, RotateCcw, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { formatDateTime } from "@/lib/dateUtils";

const STATUS_CONFIG = {
  "הושלם":  { icon: CheckCircle2, color: "text-green-600", badge: "bg-green-100 text-green-700 border-green-200" },
  "נכשל":   { icon: XCircle,      color: "text-red-500",   badge: "bg-red-100 text-red-700 border-red-200" },
  "בתהליך": { icon: Loader2,      color: "text-blue-500",  badge: "bg-blue-100 text-blue-700 border-blue-200" },
};

export default function BackupCard({ backup, onRestore }) {
  const cfg = STATUS_CONFIG[backup.status] || STATUS_CONFIG["בתהליך"];
  const Icon = cfg.icon;

  let counts = null;
  try { counts = backup.record_counts ? JSON.parse(backup.record_counts) : null; } catch {}

  const dateStr = formatDateTime(backup.created_date);

  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
          <DatabaseBackup className="w-5 h-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{backup.label || "גיבוי"}</span>
            <Badge variant="outline" className={cfg.badge}>
              <Icon className={`w-3 h-3 ml-1 ${backup.status === "בתהליך" ? "animate-spin" : ""}`} />
              {backup.status}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {backup.backup_type}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{dateStr}</p>

          {counts && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {Object.entries(counts).map(([label, count]) => (
                <span key={label} className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                  {label}: <strong>{count}</strong>
                </span>
              ))}
            </div>
          )}

          {backup.size_kb > 0 && (
            <p className="text-xs text-muted-foreground">גודל: {backup.size_kb} KB</p>
          )}

          {backup.error_message && (
            <p className="text-xs text-red-500">{backup.error_message}</p>
          )}
        </div>
      </div>

      <div className="flex gap-2 shrink-0">
        {backup.data_url && (
          <a href={backup.data_url} download target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm">
              <Download className="w-4 h-4" />
            </Button>
          </a>
        )}
        {backup.status === "הושלם" && (
          <Button variant="outline" size="sm" onClick={onRestore}>
            <RotateCcw className="w-4 h-4 ml-1" />
            שחזר רשומות חסרות
          </Button>
        )}
      </div>
    </div>
  );
}