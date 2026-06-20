import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const METHODS = ["מזומן", "כרטיס אשראי", "העברה בנקאית", "שיק", "ביט", "פייבוקס", "אחר"];

export default function PaymentDialog({ open, onOpenChange, invoice, customer, onSaved }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("העברה בנקאית");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const remaining = invoice ? (invoice.total || 0) - (invoice.paid_amount || 0) : 0;

  useEffect(() => {
    if (open && remaining > 0) setAmount(String(remaining));
  }, [open, remaining]);

  const handleSave = async () => {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      toast.error("יש להזין סכום תקין");
      return;
    }
    if (numAmount > remaining) {
      toast.error(`הסכום המקסימלי לתשלום הוא ₪${remaining.toLocaleString()}`);
      return;
    }

    setSaving(true);
    try {
      await base44.entities.Payment.create({
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        customer_id: invoice.customer_id,
        customer_name: invoice.customer_name,
        amount: numAmount,
        payment_method: method,
        payment_date: date,
        reference: reference || null,
        notes: notes || null,
        status: "אושר",
      });

      const newPaid = (invoice.paid_amount || 0) + numAmount;
      const newStatus = newPaid >= (invoice.total || 0) ? "שולם" : "שולם חלקית";

      await base44.entities.Invoice.update(invoice.id, {
        paid_amount: newPaid,
        payment_status: newStatus,
      });

      toast.success("התשלום נרשם בהצלחה");
      onOpenChange(false);
      if (onSaved) onSaved();
    } catch (err) {
      toast.error("שגיאה בשמירת התשלום: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!invoice) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>רישום תשלום</DialogTitle>
          <DialogDescription>
            חשבונית #{invoice.invoice_number} — {invoice.customer_name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3 text-sm bg-muted/40 rounded-lg p-3">
            <div>
              <span className="text-muted-foreground">סה״כ חשבונית:</span>
              <span className="font-bold mr-2">₪{(invoice.total || 0).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-muted-foreground">שולם עד כה:</span>
              <span className="font-bold text-green-700 mr-2">₪{(invoice.paid_amount || 0).toLocaleString()}</span>
            </div>
            <div className="col-span-2 border-t border-border pt-2">
              <span className="text-muted-foreground">יתרה לתשלום:</span>
              <span className="font-bold text-red-600 mr-2">₪{remaining.toLocaleString()}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>סכום תשלום</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="הזן סכום"
            />
          </div>

          <div className="space-y-1.5">
            <Label>אמצעי תשלום</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>תאריך תשלום</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>אסמכתא / מספר אישור</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="אופציונלי" />
          </div>

          <div className="space-y-1.5">
            <Label>הערות</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="אופציונלי" />
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t border-border">
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            {saving && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
            שמור תשלום
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}