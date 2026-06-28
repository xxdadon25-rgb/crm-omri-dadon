import { useState, useEffect } from "react";
import PageHeader from "@/components/shared/PageHeader";
import BackupCard from "@/components/backup/BackupCard";
import RestoreDialog from "@/components/backup/RestoreDialog";
import { Button } from "@/components/ui/button";
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

  return (
    <div>
      <PageHeader title="גיבוי ושחזור" description="גיבוי ידני של כל נתוני המערכת">
        <Button onClick={handleManualBackup} disabled={isRunning}>
          {isRunning
            ? <><RefreshCw className="w-4 h-4 ml-2 animate-spin" /> מגבה...</>
            : <><DatabaseBackup className="w-4 h-4 ml-2" /> גיבוי ידני</>
          }
        </Button>
      </PageHeader>

      <div className="space-y-4 max-w-3xl">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          <strong>גיבוי ידני</strong> — מוריד קובץ JSON עם כל הנתונים: מוצרים, לקוחות, הזמנות, חשבוניות, תשלומים, ספקים, הצעות מחיר, קריאות שירות, הגדרות עסק וצרופות חשבוניות.
        </div>

        {backups.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <DatabaseBackup className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>אין גיבויים עדיין. לחץ על "גיבוי ידני" להתחיל.</p>
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
