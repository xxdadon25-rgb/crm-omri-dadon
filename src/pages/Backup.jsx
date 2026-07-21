import { useState, useEffect } from "react";
import BackupCard from "@/components/backup/BackupCard";
import RestoreDialog from "@/components/backup/RestoreDialog";
import { DatabaseBackup, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { runBackup } from "@/lib/backupEngine";

const STORAGE_KEY = "localBackups";

function loadBackups() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveBackups(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

export default function Backup() {
  const [backups, setBackups] = useState(loadBackups);
  const [isRunning, setIsRunning] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState(null);

  useEffect(() => {
    saveBackups(backups);
  }, [backups]);

  const handleManualBackup = async () => {
    setIsRunning(true);
    const id = "backup-" + Date.now();
    const now = new Date();
    const isoNow = now.toISOString();

    // Add in-progress entry immediately so the user sees it
    const pendingEntry = {
      id,
      label: `גיבוי ידני — ${now.toLocaleDateString("he-IL")}`,
      backup_type: "ידני",
      status: "בתהליך",
      data_url: null,
      size_kb: 0,
      record_counts: null,
      created_date: isoNow,
      updated_date: isoNow,
    };
    setBackups((prev) => [pendingEntry, ...prev]);

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("גיבוי חרג מ-30 שניות")), 30000)
    );

    try {
      const result = await Promise.race([runBackup("ידני"), timeout]);

      setBackups((prev) =>
        prev.map((b) =>
          b.id === id
            ? { ...b, status: "הושלם", data_url: result.file_url, size_kb: result.sizeKb, record_counts: JSON.stringify(result.counts), updated_date: new Date().toISOString() }
            : b
        )
      );
      toast.success("גיבוי הושלם — הקובץ הורד");
    } catch (err) {
      console.error("[Backup] runBackup failed:", err);
      setBackups((prev) =>
        prev.map((b) =>
          b.id === id
            ? { ...b, status: "נכשל", error_message: err.message, updated_date: new Date().toISOString() }
            : b
        )
      );
      toast.error("גיבוי נכשל: " + err.message);
    } finally {
      setIsRunning(false);
    }
  };

  const MUTED  = "#B2B0B1";
  const DARK   = "#120F1C";
  const ACCENT = "#F5885E";

  return (
    /* OLD: <div> */
    <div className="heillo-page" dir="rtl" style={{ maxWidth: 760 }}>

      {/* OLD: <PageHeader title="גיבוי ושחזור" ...><Button onClick={handleManualBackup}...></PageHeader> */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--heillo-text-primary)", margin: 0, fontFamily: "'Heebo', sans-serif" }}>גיבוי ושחזור</h1>
          <p style={{ fontSize: 13, color: MUTED, margin: "3px 0 0", fontFamily: "'Heebo', sans-serif" }}>גיבוי ידני של כל נתוני המערכת</p>
        </div>
        <button
          className="heillo-btn-primary"
          onClick={handleManualBackup}
          disabled={isRunning}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, opacity: isRunning ? 0.7 : 1 }}
        >
          {isRunning
            ? <><RefreshCw style={{ width: 14, height: 14, animation: "spin 0.8s linear infinite" }} /> מגבה...</>
            : <><DatabaseBackup style={{ width: 14, height: 14 }} /> גיבוי ידני</>
          }
        </button>
      </div>

      {/* OLD: <div className="space-y-4 max-w-3xl"> */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* OLD: <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800"> */}
        <div style={{ background: "rgba(245,136,94,0.08)", borderRight: `3px solid ${ACCENT}`, borderRadius: 12, padding: "14px 18px", fontSize: 13, color: DARK, fontFamily: "'Heebo', sans-serif", lineHeight: 1.6 }}>
          <strong style={{ fontWeight: 700 }}>גיבוי ידני</strong> — מוריד קובץ JSON עם כל הנתונים: מוצרים, לקוחות, הזמנות, חשבוניות, תשלומים, ספקים, הצעות מחיר, קריאות שירות, הגדרות עסק וצרופות חשבוניות.
        </div>

        {backups.length === 0 && (
          /* OLD: <div className="text-center py-16 text-muted-foreground"> */
          <div className="heillo-card" style={{ padding: 48, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
            <DatabaseBackup style={{ width: 44, height: 44, color: MUTED, opacity: 0.4 }} />
            <p style={{ fontSize: 14, color: MUTED, margin: 0, fontFamily: "'Heebo', sans-serif" }}>אין גיבויים עדיין. לחץ על "גיבוי ידני" להתחיל.</p>
          </div>
        )}

        {backups.map((backup) => (
          <BackupCard
            key={backup.id}
            backup={backup}
            onRestore={() => setRestoreTarget(backup)}
          />
        ))}
      </div>

      {restoreTarget && (
        <RestoreDialog
          backup={restoreTarget}
          onClose={() => setRestoreTarget(null)}
          onDone={() => setRestoreTarget(null)}
        />
      )}
    </div>
  );
}
