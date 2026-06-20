import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import PageHeader from "@/components/shared/PageHeader";
import BackupCard from "@/components/backup/BackupCard";
import RestoreDialog from "@/components/backup/RestoreDialog";
import { Button } from "@/components/ui/button";
import { DatabaseBackup, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { runBackup } from "@/lib/backupEngine";
import { addPendingBackup, mergePendingBackups } from "@/lib/pendingBackups";

const ENTITIES_LABELS = "מוצרים, קטגוריות, תנועות מלאי, לקוחות, ספקים, הצעות מחיר, הזמנות, חשבוניות, תשלומים, הגדרות עסק, יבואות, גיבויים, התראות, לוג חשבוניות, משימות CRM";

export default function Backup() {
  const queryClient = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState(null);

  const { data: backups = [], isLoading } = useQuery({
    queryKey: ["backups"],
    queryFn: async () => {
      console.log("[Backup queryFn] ===== START =====");
      const server = await base44.entities.Backup.list("-created_date", 50);
      console.log("[Backup queryFn] Backup.list returned", server.length, "records");
      server.forEach((b) => {
        console.log(`[Backup queryFn]   id=${b.id} data_url=${b.data_url} label=${b.label} created_date=${b.created_date}`);
      });
      const merged = mergePendingBackups(server);
      console.log("[Backup queryFn] merged result count:", merged.length);
      console.log("[Backup queryFn] ===== END =====");
      return merged;
    },
  });

  const handleManualBackup = async () => {
    setIsRunning(true);
    try {
      console.log("[Backup.handleManualBackup] ===== START =====");
      const result = await runBackup("ידני");
      console.log("[Backup.handleManualBackup] runBackup returned:", JSON.stringify(result, null, 2));

      const label = `גיבוי ידני — ${new Date().toLocaleDateString("he-IL")}`;
      const synthetic = {
        id: "tmp-" + Date.now(),
        label,
        backup_type: "ידני",
        status: "הושלם",
        entities_included: ENTITIES_LABELS,
        record_counts: JSON.stringify(result.counts),
        data_url: result.file_url,
        size_kb: result.sizeKb,
        created_date: result.created_date,
        updated_date: result.updated_date,
      };

      console.log("[Backup.handleManualBackup] synthetic backup:", JSON.stringify(synthetic, null, 2));

      addPendingBackup(synthetic);

      queryClient.setQueryData(["backups"], (old) => {
        console.log("[Backup.handleManualBackup] setQueryData — old cache length:", old?.length);
        if (!old) return [synthetic];
        return [synthetic, ...old];
      });

      console.log("[Backup.handleManualBackup] ===== END =====");
      toast.success("גיבוי הושלם בהצלחה");
    } catch (err) {
      console.error("[Backup.handleManualBackup] ERROR:", err.message);
      toast.error("גיבוי נכשל: " + err.message);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div>
      <PageHeader title="גיבוי ושחזור" description="גיבוי אוטומטי ויומי של כל נתוני המערכת">
        <Button onClick={handleManualBackup} disabled={isRunning}>
          {isRunning
            ? <><RefreshCw className="w-4 h-4 ml-2 animate-spin" /> מגבה...</>
            : <><DatabaseBackup className="w-4 h-4 ml-2" /> גיבוי ידני</>
          }
        </Button>
      </PageHeader>

      <div className="space-y-4 max-w-3xl">
        {/* Info banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          <strong>גיבוי אוטומטי יומי</strong> — מופעל אוטומטית אחת ליום. כולל: מוצרים, קטגוריות, מלאי, לקוחות, ספקים, הצעות מחיר, הזמנות, חשבוניות, תשלומים, הגדרות עסק, יבואות, גיבויים, התראות, לוג חשבוניות.
        </div>

        {isLoading && (
          <div className="flex justify-center py-12">
            <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && backups.length === 0 && (
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
          onDone={() => {
            setRestoreTarget(null);
            queryClient.invalidateQueries({ queryKey: ["backups"] });
          }}
        />
      )}
    </div>
  );
}