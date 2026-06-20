import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const DEVICE_TYPES = ["סמארטפון", "מחשב נייד", "מחשב שולחני", "טאבלט", "שעון חכם", "מדפסת", "אחר"];
const STATUSES = ["נכנס", "בבדיקה", "בתיקון", "ממתין לחלקים", "מוכן לאיסוף", "נמסר", "בוטל"];
const PRIORITIES = ["נמוכה", "רגילה", "גבוהה", "דחופה"];

const emptyForm = {
  customer_id: "",
  customer_name: "",
  customer_phone: "",
  device_type: "סמארטפון",
  device_brand: "",
  device_model: "",
  serial_number: "",
  problem_description: "",
  status: "נכנס",
  priority: "רגילה",
  technician: "",
  received_date: new Date().toISOString().slice(0, 10),
  estimated_completion_date: "",
  cost_estimate: "",
  parts_cost: "",
  labor_cost: "",
  final_cost: "",
  deposit_paid: "",
  notes: "",
  customer_notes: "",
};

export default function RepairTicketDialog({ open, onOpenChange, ticket, onSaved }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerList, setShowCustomerList] = useState(false);

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => base44.entities.Customer.list("-created_date"),
  });

  useEffect(() => {
    if (open) {
      if (ticket) {
        setForm({ ...emptyForm, ...ticket });
      } else {
        setForm(emptyForm);
      }
      setCustomerSearch("");
      setShowCustomerList(false);
    }
  }, [open, ticket]);

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const filteredCustomers = customers.filter(c =>
    c.name?.toLowerCase().includes(customerSearch.toLowerCase()) ||
    c.phone?.includes(customerSearch) ||
    c.mobile?.includes(customerSearch)
  ).slice(0, 8);

  const selectCustomer = (c) => {
    setForm(f => ({ ...f, customer_id: c.id, customer_name: c.name, customer_phone: c.phone || c.mobile || "" }));
    setCustomerSearch(c.name);
    setShowCustomerList(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.customer_name || !form.device_type || !form.problem_description) {
      toast.error("יש למלא שם לקוח, סוג מכשיר ותיאור הבעיה");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        cost_estimate: form.cost_estimate ? Number(form.cost_estimate) : undefined,
        parts_cost: form.parts_cost ? Number(form.parts_cost) : 0,
        labor_cost: form.labor_cost ? Number(form.labor_cost) : 0,
        final_cost: form.final_cost ? Number(form.final_cost) : undefined,
        deposit_paid: form.deposit_paid ? Number(form.deposit_paid) : 0,
      };
      let saved;
      if (ticket?.id) {
        saved = await base44.entities.RepairTicket.update(ticket.id, payload);
        toast.success("קריאת שירות עודכנה");
      } else {
        const existing = await base44.entities.RepairTicket.list();
        const maxNum = existing.reduce((m, t) => Math.max(m, t.ticket_number || 0), 0);
        saved = await base44.entities.RepairTicket.create({ ...payload, ticket_number: maxNum + 1 });
        toast.success("קריאת שירות נפתחה");
      }
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      toast.error("שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>{ticket ? `עריכת קריאה #${ticket.ticket_number}` : "קריאת שירות חדשה"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Customer */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>לקוח *</Label>
              <div className="relative">
                <Input
                  value={customerSearch || form.customer_name}
                  onChange={e => { setCustomerSearch(e.target.value); set("customer_name", e.target.value); setShowCustomerList(true); }}
                  onFocus={() => setShowCustomerList(true)}
                  placeholder="חיפוש או שם לקוח..."
                />
                {showCustomerList && customerSearch && filteredCustomers.length > 0 && (
                  <div className="absolute top-full right-0 left-0 z-50 bg-popover border border-border rounded-md shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {filteredCustomers.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectCustomer(c)}
                        className="w-full text-right px-3 py-2 text-sm hover:bg-muted flex justify-between"
                      >
                        <span>{c.name}</span>
                        <span className="text-muted-foreground">{c.phone || c.mobile || ""}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div>
              <Label>טלפון לקוח</Label>
              <Input value={form.customer_phone} onChange={e => set("customer_phone", e.target.value)} placeholder="05x-xxxxxxx" />
            </div>
            <div>
              <Label>עדיפות</Label>
              <Select value={form.priority} onValueChange={v => set("priority", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {/* Device */}
          <div className="border border-border rounded-lg p-4 space-y-3">
            <p className="font-medium text-sm">פרטי מכשיר</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>סוג מכשיר *</Label>
                <Select value={form.device_type} onValueChange={v => set("device_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DEVICE_TYPES.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>יצרן</Label>
                <Input value={form.device_brand} onChange={e => set("device_brand", e.target.value)} placeholder="Apple, Samsung..." />
              </div>
              <div>
                <Label>דגם</Label>
                <Input value={form.device_model} onChange={e => set("device_model", e.target.value)} placeholder="iPhone 15 Pro..." />
              </div>
            </div>
            <div>
              <Label>מספר סריאלי / IMEI</Label>
              <Input value={form.serial_number} onChange={e => set("serial_number", e.target.value)} />
            </div>
          </div>

          {/* Problem */}
          <div>
            <Label>תיאור הבעיה *</Label>
            <Textarea value={form.problem_description} onChange={e => set("problem_description", e.target.value)} rows={3} placeholder="תאר את הבעיה..." />
          </div>

          {/* Status & Tech */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>סטטוס</Label>
              <Select value={form.status} onValueChange={v => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>טכנאי</Label>
              <Input value={form.technician} onChange={e => set("technician", e.target.value)} />
            </div>
            <div>
              <Label>תאריך קבלה</Label>
              <Input type="date" value={form.received_date} onChange={e => set("received_date", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>תאריך השלמה משוער</Label>
              <Input type="date" value={form.estimated_completion_date} onChange={e => set("estimated_completion_date", e.target.value)} />
            </div>
            <div>
              <Label>תאריך השלמה בפועל</Label>
              <Input type="date" value={form.completion_date} onChange={e => set("completion_date", e.target.value)} />
            </div>
          </div>

          {/* Costs */}
          <div className="border border-border rounded-lg p-4 space-y-3">
            <p className="font-medium text-sm">עלויות ותשלום</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>הערכת מחיר ₪</Label>
                <Input type="number" value={form.cost_estimate} onChange={e => set("cost_estimate", e.target.value)} />
              </div>
              <div>
                <Label>עלות חלקים ₪</Label>
                <Input type="number" value={form.parts_cost} onChange={e => set("parts_cost", e.target.value)} />
              </div>
              <div>
                <Label>עלות עבודה ₪</Label>
                <Input type="number" value={form.labor_cost} onChange={e => set("labor_cost", e.target.value)} />
              </div>
              <div>
                <Label>מחיר סופי ₪</Label>
                <Input type="number" value={form.final_cost} onChange={e => set("final_cost", e.target.value)} />
              </div>
              <div>
                <Label>מקדמה שהתקבלה ₪</Label>
                <Input type="number" value={form.deposit_paid} onChange={e => set("deposit_paid", e.target.value)} />
              </div>
              <div className="flex items-end">
                <div className="text-sm text-muted-foreground">
                  {form.final_cost && form.deposit_paid
                    ? `יתרה לתשלום: ₪${(Number(form.final_cost) - Number(form.deposit_paid)).toLocaleString()}`
                    : ""}
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>הערות פנימיות</Label>
              <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} />
            </div>
            <div>
              <Label>הערות ללקוח</Label>
              <Textarea value={form.customer_notes} onChange={e => set("customer_notes", e.target.value)} rows={2} />
            </div>
          </div>

          <DialogFooter className="flex-row-reverse gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
            <Button type="submit" disabled={saving}>{saving ? "שומר..." : ticket ? "עדכן" : "פתח קריאה"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
