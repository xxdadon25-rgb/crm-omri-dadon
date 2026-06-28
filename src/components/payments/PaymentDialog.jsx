import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Paperclip, Camera, ExternalLink, Trash2 } from "lucide-react";
import { supabase } from "@/api/supabaseClient";

const BUCKET = "payment-attachments";

const METHODS = ["מזומן", "כרטיס אשראי", "העברה בנקאית", "שיק", "ביט", "פייבוקס", "אחר"];

export default function PaymentDialog({ open, onOpenChange, invoice, customer, onSaved }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("העברה בנקאית");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const remaining = invoice ? (invoice.total || 0) - (invoice.paid_amount || 0) : 0;

  useEffect(() => {
    if (open && remaining > 0) setAmount(String(remaining));
    if (open && invoice?.id) fetchAttachments();
    if (!open) setAttachments([]);
  }, [open, invoice?.id]);

  const fetchAttachments = async () => {
    const { data } = await supabase
      .from("invoice_attachments")
      .select("*")
      .eq("invoice_id", invoice.id)
      .order("created_at", { ascending: false });
    if (data) setAttachments(data);
  };

  const uploadFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const filePath = `${invoice.id}/${safeName}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(filePath, file, { upsert: false });
      if (uploadError) { toast.error("שגיאה בהעלאה: " + uploadError.message); return; }
      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
      const { error: dbError } = await supabase.from("invoice_attachments")
        .insert({ invoice_id: invoice.id, file_url: publicUrl, file_name: file.name });
      if (dbError) { toast.error("שגיאה בשמירה: " + dbError.message); return; }
      toast.success("הקובץ צורף");
      fetchAttachments();
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  };

  const handleDeleteAttachment = async (att) => {
    try {
      const url = new URL(att.file_url);
      const pathParts = url.pathname.split(`/${BUCKET}/`);
      if (pathParts[1]) await supabase.storage.from(BUCKET).remove([pathParts[1]]);
      await supabase.from("invoice_attachments").delete().eq("id", att.id);
      setAttachments(prev => prev.filter(a => a.id !== att.id));
    } catch {
      toast.error("שגיאה במחיקת הצרופה");
    }
  };

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

          {/* ── ATTACHMENTS ───────────────────────────────────────────────── */}
          <div className="border border-border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5" /> צירוף אסמכתא
              </span>
              <div className="flex gap-1.5">
                <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileChange} />
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
                <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()} className="h-7 text-xs gap-1">
                  {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}
                  קובץ
                </Button>
                <Button variant="outline" size="sm" disabled={uploading} onClick={() => cameraInputRef.current?.click()} className="h-7 text-xs gap-1">
                  <Camera className="w-3 h-3" /> צילום
                </Button>
              </div>
            </div>
            {attachments.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-1">אין צרופות</p>
            ) : (
              <ul className="space-y-1">
                {attachments.map(att => (
                  <li key={att.id} className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1.5">
                    <span className="truncate flex-1">{att.file_name}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => window.open(att.file_url, "_blank")}>
                      <ExternalLink className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDeleteAttachment(att)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
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