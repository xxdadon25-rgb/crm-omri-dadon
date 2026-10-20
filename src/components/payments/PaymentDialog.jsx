import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Paperclip, Camera, ExternalLink, Trash2 } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { displayInvoiceNumber } from "@/utils/invoiceDisplay";

const BUCKET = "payment-attachments";

const METHODS = ["מזומן", "כרטיס אשראי", "העברה בנקאית", "שיק", "ביט", "פייבוקס", "אחר"];

export default function PaymentDialog({ open, onOpenChange, invoice, customer, onSaved }) {
  // Needed so a completed order shows its new status immediately. The dialog's
  // onSaved callback refreshes payments and invoices but not orders, and the
  // ledger reads order status straight from that cache.
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("העברה בנקאית");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  // Check details. Finbot rejects a receipt of payment type "3" without them,
  // which is why every check payment saved but never produced a receipt.
  //
  // Held as STRINGS and never coerced: an Israeli branch or account number can
  // begin with a zero, and Number()/parseInt would silently destroy it.
  const [bankName, setBankName] = useState("");
  const [bankBranch, setBankBranch] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const remaining = invoice ? (invoice.total || 0) - (invoice.paid_amount || 0) : 0;

  useEffect(() => {
    if (open && remaining > 0) setAmount(String(remaining));
    if (open && invoice?.id) fetchAttachments();
    if (!open) {
      setAttachments([]);
      setBankName("");
      setBankBranch("");
      setBankAccount("");
      setCheckNumber("");
    }
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

    // Trimmed once, then used for validation, the payment row and the receipt
    // request, so all three always carry exactly the same values.
    const isCheck = method === "שיק";
    const checkDetails = {
      bank_name: bankName.trim(),
      bank_branch: bankBranch.trim(),
      bank_account: bankAccount.trim(),
      check_number: checkNumber.trim(),
    };

    // Checked BEFORE any write: an incomplete check would save the payment and
    // then fail to produce a receipt, which is the exact split this fixes.
    if (isCheck && Object.values(checkDetails).some(v => !v)) {
      toast.error("יש למלא מספר בנק, סניף, חשבון ומספר צ'ק");
      return;
    }

    setSaving(true);
    try {
      const newPayment = await base44.entities.Payment.create({
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
        // Kept with the payment as audit data. Null for every other method.
        bank_name: isCheck ? checkDetails.bank_name : null,
        bank_branch: isCheck ? checkDetails.bank_branch : null,
        bank_account: isCheck ? checkDetails.bank_account : null,
        check_number: isCheck ? checkDetails.check_number : null,
      });

      const newPaid = (invoice.paid_amount || 0) + numAmount;
      const newStatus = newPaid >= (invoice.total || 0) ? "שולם" : "שולם חלקית";

      await base44.entities.Invoice.update(invoice.id, {
        paid_amount: newPaid,
        payment_status: newStatus,
      });

      // Carried out of the block so the warning is shown AFTER the payment's own
      // success message. The payment really did succeed; the order is a separate
      // fact and must never change that verdict.
      let orderWarning = null;

      // ---- the orders this invoice covers, once it is fully paid ----------
      //
      // Runs ONLY after the invoice update above has succeeded, and only when
      // this payment settled the invoice. A partial payment leaves every order
      // status exactly as it was, which is why there is no else branch.
      //
      // An invoice names its orders in one of two ways and never both: a
      // per-order invoice carries order_id, a monthly invoice carries
      // included_order_ids. No order outside those can be reached from here.
      //
      // The update is scoped by BOTH the ids and the current status, so the
      // condition is decided by the database inside one statement rather than
      // by a read here followed by a write. That is what keeps an order someone
      // deliberately moved to אושר, בהכנה, נשלח or בוטל untouched, and it makes
      // a repeat harmless: an order already הושלם matches nothing.
      if (newStatus === "שולם") {
        const orderIds = [
          ...new Set(
            (invoice.order_id
              ? [invoice.order_id]
              : Array.isArray(invoice.included_order_ids)
                ? invoice.included_order_ids
                : []
            ).filter(Boolean)
          ),
        ];

        if (orderIds.length > 0) {
          // Isolated on purpose. The payment and the invoice are already
          // committed, so a failure here must never be reported as a failed
          // payment. The worst outcome is a warning and an order left at the
          // status it had, which a manual change can still complete.
          try {
            // WHICH ORDERS WERE ELIGIBLE, read before the write.
            //
            // This read does NOT decide the update — the update carries its own
            // status predicate and stays atomic. It exists only to tell the two
            // outcomes apart afterwards: an order that was never eligible
            // because someone had already moved it on, versus one that was
            // eligible and still did not change. Without it, "no rows matched"
            // and "the write was refused" are the same silence.
            const { data: eligibleRows, error: eligibleErr } = await supabase
              .from("orders")
              .select("id")
              .in("id", orderIds)
              .eq("status", "ממתין לאישור");
            if (eligibleErr) throw eligibleErr;

            const eligibleIds = (eligibleRows ?? []).map(r => r.id);

            if (eligibleIds.length > 0) {
              // .select("id") makes the response name the rows it actually
              // changed. The absence of an error only means the statement ran;
              // this is what proves it did something.
              const { data: updatedRows, error: orderErr } = await supabase
                .from("orders")
                .update({ status: "הושלם" })
                .in("id", eligibleIds)
                .eq("status", "ממתין לאישור")
                .select("id");
              if (orderErr) throw orderErr;

              const updatedIds = new Set((updatedRows ?? []).map(r => r.id));
              const missed = eligibleIds.filter(id => !updatedIds.has(id));

              if (updatedIds.size > 0) {
                queryClient.invalidateQueries({ queryKey: ["orders"] });
              }

              // Eligible a moment ago and still unchanged. Either a row-level
              // security policy refused the write, or someone else moved the
              // order in between. Both leave the user looking at an order that
              // does not reflect a paid invoice, so both are worth saying out
              // loud rather than leaving in the console.
              if (missed.length > 0) {
                console.warn("order completion incomplete:", missed);
                orderWarning =
                  missed.length === 1
                    ? "התשלום נרשם, אך לא הצלחנו לעדכן את סטטוס ההזמנה ל\"הושלם\". יש לעדכן אותה ידנית."
                    : `התשלום נרשם, אך לא הצלחנו לעדכן את הסטטוס של ${missed.length} הזמנות ל"הושלם". יש לעדכן אותן ידנית.`;
              }
            }
          } catch (e) {
            console.warn("order completion failed:", e?.message);
            orderWarning =
              "התשלום נרשם, אך עדכון סטטוס ההזמנה נכשל. יש לבדוק את ההזמנה ולעדכן אותה ידנית.";
          }
        }
      }

      try {
        const { data: receiptData } = await supabase.functions.invoke("payment-webhook-", {
          body: {
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            external_invoice_number: invoice.external_invoice_number || null,
            finbot_serial: invoice.finbot_serial || null,
            customer_id: invoice.customer_id,
            customer_name: invoice.customer_name,
            amount: numAmount,
            payment_method: method,
            payment_date: date,
            reference: reference || null,
            invoice_total: invoice.total || 0,
            new_paid_amount: newPaid,
            new_payment_status: newStatus,
            // Spread only for a check, so the request body for every other
            // payment method stays byte-identical to what works today.
            ...(isCheck ? checkDetails : {}),
          },
        });
        if (receiptData?.ok && newPayment?.id) {
          const patch = {};
          if (receiptData.receiptNumber) patch.external_receipt_number = receiptData.receiptNumber;
          if (receiptData.pdfUrl) patch.external_receipt_url = receiptData.pdfUrl;
          if (Object.keys(patch).length) {
            await supabase.from("payments").update(patch).eq("id", newPayment.id);
          }
        }
      } catch (e) { /* receipt creation failed silently */ }

      toast.success("התשלום נרשם בהצלחה");
      if (orderWarning) toast.warning(orderWarning);
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
            חשבונית #{displayInvoiceNumber(invoice)} — {invoice.customer_name}
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

          {/* Check details — rendered ONLY for שיק. Every other payment method
              sees exactly the fields it saw before.

              type="text" with inputMode="numeric" is deliberate: it gives the
              numeric keypad on a phone WITHOUT the value coercion a
              type="number" input performs, so a leading zero survives. */}
          {method === "שיק" && (
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "מספר בנק", value: bankName, set: setBankName },
                { label: "מספר סניף", value: bankBranch, set: setBankBranch },
                { label: "מספר חשבון", value: bankAccount, set: setBankAccount },
                { label: "מספר צ'ק", value: checkNumber, set: setCheckNumber },
              ].map(({ label, value, set }) => (
                <div key={label} className="space-y-1.5">
                  <Label>{label}</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={value}
                    onChange={(e) => set(e.target.value)}
                  />
                </div>
              ))}
            </div>
          )}

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