import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useState } from "react";

export default function BulkActionsBar({ selectedCount, onDelete, isDeleting }) {
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = () => {
    setConfirming(false);
    onDelete();
  };

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 bg-destructive/10 border-t border-destructive/20 p-4 flex items-center justify-between z-30">
        <span className="text-sm font-medium">נבחרו {selectedCount} פריטים</span>
        <Button
          variant="destructive"
          size="sm"
          disabled={isDeleting}
          onClick={() => setConfirming(true)}
          className="gap-2"
        >
          <Trash2 className="w-4 h-4" />
          {isDeleting ? "מוחק..." : "מחק נבחרים"}
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת {selectedCount} פריטים</AlertDialogTitle>
            <AlertDialogDescription>
              האם אתה בטוח שברצונך למחוק את {selectedCount} הפריטים שנבחרו? פעולה זו אינה ניתנת לביטול.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} className="bg-destructive text-destructive-foreground">
              מחק
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}