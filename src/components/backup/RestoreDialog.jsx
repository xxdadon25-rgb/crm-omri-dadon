import { useState } from "react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { restoreBackup } from "@/lib/backupEngine";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function RestoreDialog({ backup, onClose, onDone }) {
  const [isRestoring, setIsRestoring] = useState(false);
  const [results, setResults] = useState(null);

  const handleRestore = async () => {
    setIsRestoring(true);
    try {
      const res = await restoreBackup(backup);
      setResults(res);
      toast.success("שחזור הושלם בהצלחה");
      onDone?.();
    } catch (err) {
      toast.error("שחזור נכשל: " + err.message);
      onClose();
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>שחזור רשומות חסרות</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            {!results ? (
              <>
                <p>אתה עומד לשחזר את הגיבוי:</p>
                <p className="font-medium text-foreground">{backup.label}</p>
                <p className="text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-sm">
                  ⚠️ <strong>זהו אינו שחזור ERP מלא לנקודת זמן.</strong> הכלי רק מוסיף רשומות
                  חסרות. הוא אינו מוחק נתונים קיימים, אינו דורס רשומות קיימות, וייתכן
                  שלא ישמור על קשרים בין רשומות (למשל, לקוח ↔ הזמנה) אם הרשומות
                  המקושרות נמחקו ושוחזרו עם מזהים חדשים.
                </p>
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-green-700 font-medium">✅ שחזור הושלם בהצלחה</p>
                <div className="bg-muted rounded-lg p-3 space-y-1">
                  {Object.entries(results).map(([label, count]) => (
                    <div key={label} className="flex justify-between text-sm">
                      <span>{label}</span>
                      <span className="font-medium">{count} רשומות שוחזרו</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>
            {results ? "סגור" : "ביטול"}
          </AlertDialogCancel>
          {!results && (
            <AlertDialogAction onClick={handleRestore} disabled={isRestoring}>
              {isRestoring
                ? <><Loader2 className="w-4 h-4 ml-2 animate-spin" /> משחזר...</>
                : "שחזר רשומות חסרות"
              }
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}