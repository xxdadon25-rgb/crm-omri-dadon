import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const empty = {
  name: "", phone: "", mobile: "", email: "", address: "", city: "",
  tax_id: "", notes: "", customer_type: "פרטי", crm_status: "ליד חדש",
  contact_person: "", payment_terms: "שוטף+30", discount_percent: 0,
};

const CRM_STATUSES = ["ליד חדש", "בטיפול", "הצעת מחיר נשלחה", "ממתין לתשובה", "לקוח פעיל", "VIP", "לא פעיל", "לא רלוונטי"];

export default function CustomerDialog({ open, onOpenChange, customer, onSaved }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(customer ? { ...empty, ...customer } : empty);
  }, [customer, open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    if (customer?.id) {
      const updated = await base44.entities.Customer.update(customer.id, form);
      onSaved(updated);
    } else {
      const created = await base44.entities.Customer.create(form);
      sessionStorage.setItem("pendingCustomer", JSON.stringify(created));
      onSaved(created);
    }
    setSaving(false);
    onOpenChange(false);
  };

  const f = (field) => ({
    value: form[field] ?? "",
    onChange: (e) => setForm({ ...form, [field]: e.target.value }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>{customer?.id ? "עריכת לקוח" : "לקוח חדש"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>שם לקוח *</Label>
              <Input {...f("name")} required />
            </div>
            <div className="space-y-1.5">
              <Label>סוג לקוח</Label>
              <Select value={form.customer_type} onValueChange={v => setForm({ ...form, customer_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="פרטי">👤 פרטי</SelectItem>
                  <SelectItem value="עסקי">🏢 עסקי</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>סטטוס CRM</Label>
              <Select value={form.crm_status || "ליד חדש"} onValueChange={v => setForm({ ...form, crm_status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CRM_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>איש קשר</Label>
              <Input {...f("contact_person")} />
            </div>
            <div className="space-y-1.5">
              <Label>טלפון</Label>
              <Input {...f("phone")} />
            </div>
            <div className="space-y-1.5">
              <Label>נייד</Label>
              <Input {...f("mobile")} />
            </div>
            <div className="space-y-1.5">
              <Label>אימייל</Label>
              <Input {...f("email")} />
            </div>
            <div className="space-y-1.5">
              <Label>ח.פ / ת.ז</Label>
              <Input {...f("tax_id")} />
            </div>
            <div className="space-y-1.5">
              <Label>כתובת</Label>
              <Input {...f("address")} />
            </div>
            <div className="space-y-1.5">
              <Label>עיר</Label>
              <Input {...f("city")} />
            </div>
            <div className="space-y-1.5">
              <Label>תנאי תשלום</Label>
              <Select value={form.payment_terms || "שוטף+30"} onValueChange={v => setForm({ ...form, payment_terms: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["מזומן", "שוטף", "שוטף+30", "שוטף+60", "שוטף+90"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>הנחה קבועה %</Label>
              <Input type="number" value={form.discount_percent ?? 0} onChange={e => setForm({ ...form, discount_percent: parseFloat(e.target.value) || 0 })} min="0" max="100" />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label>הערות</Label>
              <Textarea {...f("notes")} rows={2} />
            </div>
            <div className="sm:col-span-2 flex items-center gap-3 pt-1">
              <input
                type="checkbox"
                id="is_blocked"
                checked={!!form.is_blocked}
                onChange={e => setForm({ ...form, is_blocked: e.target.checked })}
                className="h-4 w-4 accent-red-500 cursor-pointer"
              />
              <label htmlFor="is_blocked" className="text-sm font-medium text-red-600 cursor-pointer select-none">
                🚫 לקוח חסום
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
            <Button type="submit" disabled={saving}>{saving ? "שומר..." : "שמירה"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}