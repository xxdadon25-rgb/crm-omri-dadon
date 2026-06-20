import { CheckCircle, AlertCircle, Loader2, Clock, RefreshCw } from "lucide-react";

function formatTime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} שנ׳`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")} דק׳`;
}

export default function ImportProgress({ progress, stats }) {
  const { done, total, startedAt, retrying } = progress;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isDone = done >= total && total > 0;

  // Estimated time remaining
  let etaText = null;
  if (!isDone && done > 0 && startedAt) {
    const elapsed = (Date.now() - startedAt) / 1000;
    const rate = done / elapsed; // items per second
    const remaining = (total - done) / rate;
    if (remaining > 0 && remaining < 86400) {
      etaText = formatTime(remaining);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-3">
        {isDone ? (
          <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
        ) : retrying ? (
          <RefreshCw className="w-5 h-5 text-yellow-500 animate-spin shrink-0" />
        ) : (
          <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
        )}
        <div className="flex-1">
          <div className="flex justify-between text-sm mb-1.5">
            <span className="font-medium">
              {isDone ? "הייבוא הושלם" : retrying ? "ממתין ומנסה שוב..." : "מייבא מוצרים..."}
            </span>
            <span className="text-muted-foreground">{done} / {total}</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          {!isDone && etaText && (
            <div className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>זמן משוער לסיום: {etaText}</span>
            </div>
          )}
          {retrying && (
            <p className="mt-1.5 text-xs text-yellow-600">
              חריגה ממגבלת קריאות — ממתין 2-3 שניות לפני ניסיון חוזר...
            </p>
          )}
        </div>
        <span className="text-sm font-bold w-10 text-left">{pct}%</span>
      </div>

      <div className="grid grid-cols-4 gap-3 pt-2 border-t border-border">
        {[
          { label: "סה״כ", value: total, color: "text-foreground" },
          { label: "נוצרו", value: stats.created, color: "text-green-600" },
          { label: "עודכנו", value: stats.updated, color: "text-blue-600" },
          { label: "נכשלו", value: stats.failed, color: "text-red-500" },
        ].map((s) => (
          <div key={s.label} className="text-center">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {stats.errors.length > 0 && (
        <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
          {stats.errors.slice(0, 20).map((err, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-red-600 bg-red-50 rounded px-2 py-1">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{err}</span>
            </div>
          ))}
          {stats.errors.length > 20 && (
            <p className="text-xs text-muted-foreground text-center">
              ...ועוד {stats.errors.length - 20} שגיאות
            </p>
          )}
        </div>
      )}
    </div>
  );
}