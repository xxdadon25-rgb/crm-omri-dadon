import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const emptyExpense = {
  date: "",
  category: "",
  payee: "",
  description: "",
  amount_net: "",
  vat_amount: "",
  amount_gross: "",
  document_number: "",
};

const todayISO = () => new Date().toISOString().slice(0, 10);

// Optional fields are stored as null rather than 0 — a receipt that never
// mentioned VAT is not the same as one that charged zero.
const optionalNumber = (v) => {
  if (v === "" || v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export default function ExpenseDialog({ open, onOpenChange, expense, categories = [], onSaved }) {
  const [form, setForm] = useState(emptyExpense);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (expense) {
      setForm({
        ...emptyExpense,
        ...expense,
        date: expense.date || "",
        category: expense.category || "",
        payee: expense.payee || "",
        description: expense.description || "",
        amount_net: expense.amount_net ?? "",
        vat_amount: expense.vat_amount ?? "",
        amount_gross: expense.amount_gross ?? "",
        document_number: expense.document_number || "",
      });
    } else {
      setForm({ ...emptyExpense, date: todayISO() });
    }
  }, [expense, open]);

  const handleChange = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const net = optionalNumber(form.amount_net);
  const vat = optionalNumber(form.vat_amount);
  const gross = optionalNumber(form.amount_gross);
  // Reported only. Nothing is corrected automatically — the numbers stay
  // exactly as they were typed.
  const inconsistent = net != null && vat != null && gross != null
    && Math.abs(net + vat - gross) > 0.02;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (net == null || net < 0) { toast.error("יש להזין סכום לפני מע״מ"); return; }
    if (!form.date) { toast.error("יש להזין תאריך"); return; }
    if (!form.category.trim()) { toast.error("יש להזין קטגוריה"); return; }

    setSaving(true);
    try {
      // supplier_delivery_id is deliberately absent: an expense created from a
      // supplier goods receipt keeps its link untouched through every edit.
      const data = {
        date: form.date,
        category: form.category.trim(),
        payee: form.payee.trim() || null,
        description: form.description.trim() || null,
        amount_net: net,
        vat_amount: vat,
        amount_gross: gross,
        document_number: form.document_number.trim() || null,
        updated_date: new Date().toISOString(),
      };

      if (expense?.id) {
        const updated = await base44.entities.Expense.update(expense.id, data);
        onOpenChange(false);
        onSaved(updated);
        toast.success("ההוצאה עודכנה");
      } else {
        const created = await base44.entities.Expense.create(data);
        onOpenChange(false);
        onSaved(created);
        toast.success("ההוצאה נשמרה");
      }
    } catch (err) {
      toast.error("שגיאה בשמירת ההוצאה");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>{expense?.id ? "עריכת הוצאה" : "הוצאה חדשה"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div className="space-y-1.5">
            <Label>תאריך *</Label>
            <Input type="date" value={form.date} onChange={(e) => handleChange("date", e.target.value)} required />
          </div>

          <div className="space-y-1.5">
            <Label>קטגוריה *</Label>
            <Input value={form.category} onChange={(e) => handleChange("category", e.target.value)}
              list="expense-categories" placeholder="בחר או הקלד קטגוריה" required />
            <datalist id="expense-categories">
              {categories.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>

          <div className="space-y-1.5">
            <Label>ספק / בית עסק</Label>
            <Input value={form.payee} onChange={(e) => handleChange("payee", e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>מספר מסמך</Label>
            <Input value={form.document_number} onChange={(e) => handleChange("document_number", e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>סכום לפני מע״מ *</Label>
            <Input type="number" step="0.01" min="0" value={form.amount_net}
              onChange={(e) => handleChange("amount_net", e.target.value)} required />
          </div>

          <div className="space-y-1.5">
            <Label>מע״מ</Label>
            <Input type="number" step="0.01" value={form.vat_amount}
              onChange={(e) => handleChange("vat_amount", e.target.value)} placeholder="אופציונלי" />
          </div>

          <div className="space-y-1.5">
            <Label>סה״כ כולל מע״מ</Label>
            <Input type="number" step="0.01" value={form.amount_gross}
              onChange={(e) => handleChange("amount_gross", e.target.value)} placeholder="אופציונלי" />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>תיאור</Label>
            <Textarea rows={2} value={form.description} onChange={(e) => handleChange("description", e.target.value)} />
          </div>

          {inconsistent && (
            <p className="sm:col-span-2 text-xs text-amber-600">
              שים לב: לפני מע״מ + מע״מ אינו שווה לסה״כ כולל מע״מ. הסכומים יישמרו כפי שהוזנו.
            </p>
          )}

          <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
            <Button type="submit" disabled={saving}>{saving ? "שומר..." : "שמור"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
