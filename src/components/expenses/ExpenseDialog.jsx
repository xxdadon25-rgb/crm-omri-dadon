import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

// Manual expense attachments only. Supplier-goods-receipt expenses keep reading
// their document through supplier_delivery_id and never touch this bucket.
const ATTACHMENT_BUCKET = "expense-attachments";

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
  // A newly chosen file, and the manual attachment already on the expense (if
  // any). A supplier-delivery expense has no file_path, so `existingFile` stays
  // null for it and its document link is never touched here.
  const [file, setFile] = useState(null);
  const [existingFile, setExistingFile] = useState(null); // { path, name } | null

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
      setExistingFile(
        expense.file_path ? { path: expense.file_path, name: expense.file_name || "מסמך" } : null
      );
    } else {
      setForm({ ...emptyExpense, date: todayISO() });
      setExistingFile(null);
    }
    setFile(null);
  }, [expense, open]);

  const handleChange = (field, value) => setForm(f => ({ ...f, [field]: value }));

  // Upload one manual attachment to a user-scoped, UUID-nested path:
  //   {auth uid}/{uuid}/{sanitized filename}
  // The uid first segment lets a private-bucket RLS policy scope objects to
  // their owner; the uuid folder means an upload can never overwrite another
  // expense's file. The filename is sanitised for the object key, and the
  // original name is kept in file_name for display. Returns { path, name }.
  const uploadAttachment = async (f) => {
    // The existing session's user, read exactly as the entity layer does — no
    // new auth behaviour, and no upload attempted without an authenticated user.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) throw new Error("not_authenticated");
    const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
    const path = `${user.id}/${crypto.randomUUID()}/${safeName}`;
    const { error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(path, f, { upsert: false });
    if (error) throw error;
    return { path, name: f.name };
  };

  const removeQuietly = async (path) => {
    if (!path) return;
    try { await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]); } catch (e) { /* orphan cleanup is best-effort */ }
  };

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

    // Upload FIRST, so a save failure can clean up the orphan; if nothing new
    // was chosen, the attachment stays exactly as it was.
    let uploaded = null; // { path, name } uploaded during THIS submit
    if (file) {
      try {
        uploaded = await uploadAttachment(file);
      } catch (err) {
        toast.error("שגיאה בהעלאת המסמך");
        setSaving(false);
        return;
      }
    }

    // file_path / file_name: the new upload when there is one, otherwise the
    // attachment already on the expense (null for a manual expense with none,
    // and null for a supplier-delivery expense, whose link lives elsewhere).
    const attachment = uploaded
      ? { file_path: uploaded.path, file_name: uploaded.name }
      : { file_path: existingFile?.path ?? null, file_name: existingFile?.name ?? null };

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
      ...attachment,
      updated_date: new Date().toISOString(),
    };

    let saved;
    try {
      saved = expense?.id
        ? await base44.entities.Expense.update(expense.id, data)
        : await base44.entities.Expense.create(data);
    } catch (err) {
      // The DB save failed. Remove ONLY the file we just uploaded; the existing
      // attachment is never touched, so nothing is silently lost.
      if (uploaded) await removeQuietly(uploaded.path);
      toast.error("שגיאה בשמירת ההוצאה");
      setSaving(false);
      return;
    }

    // Save succeeded. If this upload replaced an existing manual attachment,
    // remove the old file now — after the new one is safely persisted.
    if (uploaded && existingFile?.path && existingFile.path !== uploaded.path) {
      await removeQuietly(existingFile.path);
    }

    setSaving(false);
    onOpenChange(false);
    onSaved(saved);
    toast.success(expense?.id ? "ההוצאה עודכנה" : "ההוצאה נשמרה");
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

          <div className="space-y-1.5 sm:col-span-2">
            <Label>צרף מסמך</Label>
            <Input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            {file ? (
              <p className="text-xs text-muted-foreground">קובץ נבחר: {file.name}</p>
            ) : existingFile ? (
              <p className="text-xs text-muted-foreground">
                מסמך מצורף: {existingFile.name} · בחירת קובץ חדש תחליף אותו
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">תמונה או PDF (אופציונלי)</p>
            )}
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
