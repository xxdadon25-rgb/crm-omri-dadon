import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock } from "lucide-react";
import { toast } from "sonner";

export default function ProfitabilityAccessDialog({ open, onOpenChange, correctCode, onSuccess }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = () => {
    if (code === correctCode) {
      onSuccess();
      setCode("");
      setError("");
    } else {
      setError("קוד שגוי");
      setCode("");
    }
  };

  const handleOpenChange = (newOpen) => {
    if (!newOpen) {
      setCode("");
      setError("");
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="w-5 h-5" />
            הזן קוד גישה
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>קוד גישה</Label>
            <Input
              type="password"
              placeholder="הקלד קוד גישה"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              autoFocus
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </div>
        <DialogFooter className="flex-row-reverse gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            ביטול
          </Button>
          <Button onClick={handleSubmit}>
            כניסה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}