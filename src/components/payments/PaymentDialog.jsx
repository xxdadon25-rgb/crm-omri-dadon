/**
 * THE payment entry point. One dialog, one place to register a payment.
 *
 * It opens on the invoice whose "רישום תשלום" was clicked, which stays
 * preselected, and optionally allocates the same payment across the customer's
 * other open invoices. There is deliberately no second payment interface: a
 * split payment is this dialog with more than one line filled in.
 *
 * TWO PATHS, AND THE LINE BETWEEN THEM
 *   No other invoice has an amount  ->  the original single-invoice path,
 *   unchanged: Payment.create, Invoice.update, one receipt. Every existing
 *   payment keeps behaving exactly as it did.
 *
 *   Any other invoice has an amount ->  the grouped path: one atomic RPC
 *   (allocate_payment_across_invoices) writes every payment row and every
 *   paid_amount in one transaction, and one LINKED Finbot receipt is issued per
 *   invoice for its own allocated amount.
 *
 * THE AMOUNT FIELD KEEPS ITS MEANING
 *   "סכום תשלום" is the amount applied to THIS invoice, exactly as before, and
 *   is still capped by this invoice's remaining balance. The payment's total is
 *   the sum of the lines and is shown, not typed — so nothing about the
 *   single-invoice flow changes, and a split can never allocate more or less
 *   than it received.
 */
import { useState, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Paperclip, Camera, ExternalLink, Trash2, Layers, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { displayInvoiceNumber } from "@/utils/invoiceDisplay";
import { classifyReceiptOutcome, receiptMessage, receiptPatch, RECEIPT } from "@/lib/receiptLifecycle";
import {
  validateAllocation, buildAllocationPayload, isAllocatable,
  remainingAgorot, toAgorot, toShekels,
} from "@/lib/paymentAllocation";

const BUCKET = "payment-attachments";

const METHODS = ["מזומן", "כרטיס אשראי", "העברה בנקאית", "שיק", "ביט", "פייבוקס", "אחר"];

const fmtAg = (agorot) =>
  toShekels(agorot).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PaymentDialog({ open, onOpenChange, invoice, customer, invoices = [], onSaved }) {
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

  // Amounts allocated to the customer's OTHER open invoices: { id: shekels }.
  const [extra, setExtra] = useState({});
  const [allocOpen, setAllocOpen] = useState(false);
  // The idempotency key for a grouped payment. Generated once per opening and
  // reused by every retry, so a double click or a lost response cannot record
  // the money twice.
  const groupIdRef = useRef(null);

  const remaining = invoice ? (invoice.total || 0) - (invoice.paid_amount || 0) : 0;

  useEffect(() => {
    if (open && remaining > 0) setAmount(String(remaining));
    if (open && invoice?.id) fetchAttachments();
    if (open) {
      setExtra({});
      setAllocOpen(false);
      groupIdRef.current = globalThis.crypto?.randomUUID?.()
        ?? `g-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    if (!open) {
      setAttachments([]);
      setBankName("");
      setBankBranch("");
      setBankAccount("");
      setCheckNumber("");
    }
  }, [open, invoice?.id]);

  // The customer's other open invoices, offered for allocation. The invoice the
  // dialog was opened on is excluded because it is already the primary line.
  const otherInvoices = useMemo(() => {
    if (!invoice) return [];
    return invoices
      .filter(i => i.id !== invoice.id)
      .filter(i => i.customer_id === invoice.customer_id)
      .filter(isAllocatable)
      .slice()
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  }, [invoices, invoice]);

  // All the lines of this payment: this invoice first, then the extras. The
  // total is DERIVED from them, never typed, so it cannot disagree with them.
  const primaryAgorot = toAgorot(amount);
  const amounts = useMemo(() => {
    const m = {};
    if (invoice && primaryAgorot > 0) m[invoice.id] = amount;
    for (const [id, v] of Object.entries(extra)) {
      if (toAgorot(v) > 0) m[id] = v;
    }
    return m;
  }, [invoice, amount, primaryAgorot, extra]);

  const allInvoices = useMemo(
    () => (invoice ? [invoice, ...otherInvoices] : otherInvoices), [invoice, otherInvoices]);

  const totalAgorot = Object.values(amounts).reduce((s, v) => s + toAgorot(v), 0);
  const extraLineCount = Object.keys(amounts).filter(id => id !== invoice?.id).length;
  const isSplit = extraLineCount > 0;

  // Reuses the validator the grouped path already had: with the derived total
  // as the payment amount, its "lines must equal the payment" rule holds by
  // construction and its per-line rules — positive, within the invoice's
  // remaining balance, not credited — are the ones doing the work.
  const validation = useMemo(
    () => validateAllocation({ invoices: allInvoices, amounts, paymentAmount: toShekels(totalAgorot) }),
    [allInvoices, amounts, totalAgorot]);

  const extraErrorFor = (id) => validation.errors.find(e => e.invoiceId === id)?.message || null;

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

  /**
   * Complete the orders covered by invoices this payment settled in full.
   *
   * ONE implementation, used by both paths — a split payment that fully pays an
   * invoice is no less a settlement than a direct one.
   *
   *   * an invoice names its orders either by order_id (per-order invoice) or
   *     by included_order_ids (monthly invoice), never both
   *   * the update is scoped by BOTH the ids and status = "ממתין לאישור", so
   *     the condition is decided by the database inside one statement. An order
   *     someone deliberately moved to אושר, בהכנה, נשלח or בוטל is left alone,
   *     and a repeat is harmless: an order already הושלם matches nothing
   *   * a failure here is isolated and returned as a warning. The payment is
   *     already committed; it must never be reported as failed because an order
   *     status lagged behind.
   *
   * @returns {Promise<string|null>} a Hebrew warning, or null when all is well.
   */
  const completeOrdersFor = async (settledInvoiceIds) => {
    const ids = (settledInvoiceIds || []).filter(Boolean);
    if (ids.length === 0) return null;

    const settled = allInvoices.filter(i => ids.includes(i.id));
    const orderIds = [...new Set(
      settled.flatMap(inv => (
        inv.order_id
          ? [inv.order_id]
          : Array.isArray(inv.included_order_ids) ? inv.included_order_ids : []
      )).filter(Boolean),
    )];
    if (orderIds.length === 0) return null;

    try {
      // WHICH ORDERS WERE ELIGIBLE, read before the write.
      //
      // This read does NOT decide the update — the update carries its own
      // status predicate and stays atomic. It exists only to tell two outcomes
      // apart afterwards: an order that was never eligible because someone had
      // already moved it on, versus one that was eligible and still did not
      // change. Without it, "no rows matched" and "the write was refused" are
      // the same silence.
      const { data: eligibleRows, error: eligibleErr } = await supabase
        .from("orders").select("id")
        .in("id", orderIds)
        .eq("status", "ממתין לאישור");
      if (eligibleErr) throw eligibleErr;

      const eligibleIds = (eligibleRows ?? []).map(r => r.id);
      if (eligibleIds.length === 0) return null;

      // .select("id") makes the response name the rows it actually changed.
      // The absence of an error only means the statement ran; this is what
      // proves it did something.
      const { data: updatedRows, error: orderErr } = await supabase
        .from("orders").update({ status: "הושלם" })
        .in("id", eligibleIds)
        .eq("status", "ממתין לאישור")
        .select("id");
      if (orderErr) throw orderErr;

      const updatedIds = new Set((updatedRows ?? []).map(r => r.id));
      if (updatedIds.size > 0) queryClient.invalidateQueries({ queryKey: ["orders"] });

      // Eligible a moment ago and still unchanged. Either a row-level security
      // policy refused the write, or someone else moved the order in between.
      // Both leave the user looking at an order that does not reflect a paid
      // invoice, so both are worth saying out loud.
      const missed = eligibleIds.filter(id => !updatedIds.has(id));
      if (missed.length > 0) {
        console.warn("order completion incomplete:", missed);
        return missed.length === 1
          ? "התשלום נרשם, אך לא הצלחנו לעדכן את סטטוס ההזמנה ל\"הושלם\". יש לעדכן אותה ידנית."
          : `התשלום נרשם, אך לא הצלחנו לעדכן את הסטטוס של ${missed.length} הזמנות ל"הושלם". יש לעדכן אותן ידנית.`;
      }
      return null;
    } catch (e) {
      console.warn("order completion failed:", e?.message);
      return "התשלום נרשם, אך עדכון סטטוס ההזמנה נכשל. יש לבדוק את ההזמנה ולעדכן אותה ידנית.";
    }
  };

  /**
   * Ask the webhook for ONE receipt, classify what came back, and record the
   * result on the payment row(s) it belongs to.
   *
   * Shared by both paths so the rules that matter — a call that did not
   * complete is UNCERTAIN rather than failed, the state is always written, and
   * nothing is ever retried — exist in exactly one place.
   */
  const issueReceipt = async (body, applyPatch) => {
    let outcome;
    try {
      const { data, error } = await supabase.functions.invoke("payment-webhook-", { body });
      outcome = classifyReceiptOutcome({ data, error });
    } catch (e) {
      // The call did not complete. The function may have run and Finbot may
      // already hold the document, so this is UNCERTAIN, not failed.
      outcome = classifyReceiptOutcome({ thrown: e });
    }
    try {
      await applyPatch(receiptPatch(outcome));
    } catch (e) {
      console.warn("receipt status not stored:", e?.message);
    }
    return outcome;
  };

  /**
   * One payment, allocated across this invoice and the others chosen.
   *
   * Every insert and every paid_amount update happens inside ONE transaction in
   * allocate_payment_across_invoices, with ownership checks, SELECT ... FOR
   * UPDATE on each invoice, overpayment refused under that lock, and
   * idempotency on the group id. Then one LINKED receipt per invoice, for its
   * own allocated amount.
   */
  const saveSplit = async ({ isCheck, checkDetails }) => {
    try {
      const payload = buildAllocationPayload({
        groupId: groupIdRef.current,
        customerId: invoice.customer_id,
        lines: validation.lines,
        method, date, reference, notes,
        checkDetails: isCheck ? checkDetails : null,
      });

      const { data, error } = await supabase.rpc("allocate_payment_across_invoices", payload);
      if (error) throw error;
      if (!data?.ok) throw new Error("רישום התשלום נכשל");

      if (data.already_recorded) {
        // The idempotency guard fired: the money is not recorded twice, and no
        // receipt is issued — the first attempt may already have produced one.
        toast.success("התשלום כבר נרשם קודם לכן — לא בוצע רישום כפול");
        const retryWarning = await completeOrdersFor(data.settled_invoice_ids);
        if (retryWarning) toast.warning(retryWarning);
        const pending = (Array.isArray(data.lines) ? data.lines : [])
          .filter(l => l.receipt_status !== "confirmed");
        toast.warning(pending.length === 0
          ? "לא הופקה קבלה בפעולה זו — לכל ההקצאות קיימת כבר קבלה מאומתת."
          : `לא הופקו קבלות בפעולה זו. ${pending.length} הקצאות (${
              pending.map(l => l.invoice_number ?? "—").join(", ")
            }) ללא קבלה מאומתת — יש לבדוק ב-Finbot לפני הפקה כלשהי.`);
        onOpenChange(false);
        onSaved?.();
        return;
      }

      toast.success(`התשלום נרשם והוקצה ל-${data.payment_count} חשבוניות`);

      const orderWarning = await completeOrdersFor(data.settled_invoice_ids);

      // `data.lines` pairs every invoice with the row the function actually
      // inserted. Matching by array position would break silently if either
      // order ever changed, so the pairing comes from the server.
      const serverLines = Array.isArray(data.lines) ? data.lines : [];
      const states = [];
      for (const line of serverLines) {
        const inv = allInvoices.find(i => i.id === line.invoice_id);
        const outcome = await issueReceipt({
          invoice_id: line.invoice_id,
          invoice_number: inv?.invoice_number ?? line.invoice_number ?? null,
          external_invoice_number: inv?.external_invoice_number || null,
          // The link: this is what makes the receipt settle the right document.
          finbot_serial: inv?.finbot_serial || null,
          customer_id: invoice.customer_id,
          customer_name: invoice.customer_name,
          // The ALLOCATED amount, so the receipt and the invoice it is linked
          // to describe the same money.
          amount: Number(line.amount),
          payment_method: method,
          payment_date: date,
          reference: reference || null,
          payment_group_id: groupIdRef.current,
          allocation_count: serverLines.length,
          // The same four check fields on every allocation's receipt, with only
          // the amount differing. The lines sum to the payment exactly, so the
          // receipts can never total more than the check is worth.
          ...(isCheck ? checkDetails : {}),
        }, (patch) => supabase.from("payments").update(patch).eq("id", line.payment_id));
        states.push({ outcome, invoiceNumber: inv?.invoice_number ?? line.invoice_number ?? null });
      }

      // Never reduced to a single verdict: "two issued, one uncertain" is not
      // "it worked".
      const confirmed = states.filter(s => s.outcome.state === RECEIPT.CONFIRMED);
      const failed = states.filter(s => s.outcome.state === RECEIPT.FAILED);
      const uncertain = states.filter(s => s.outcome.state === RECEIPT.UNCERTAIN);
      if (confirmed.length === states.length && states.length > 0) {
        toast.success(`הופקו ${states.length} קבלות, אחת לכל חשבונית`);
      } else {
        if (confirmed.length > 0) toast.success(`הופקו ${confirmed.length} קבלות מתוך ${states.length}`);
        if (failed.length > 0) {
          toast.warning(`הפקת הקבלה נדחתה עבור ${failed.length} חשבוניות (${
            failed.map(s => s.invoiceNumber ?? "—").join(", ")}). לא נוצר מסמך — יש להפיק ידנית.`);
        }
        if (uncertain.length > 0) {
          toast.warning(`עבור ${uncertain.length} חשבוניות (${
            uncertain.map(s => s.invoiceNumber ?? "—").join(", ")
          }) לא ניתן לאמת אם הופקה קבלה. אין להפיק קבלה נוספת לפני בדיקה ב-Finbot.`);
        }
      }

      if (orderWarning) toast.warning(orderWarning);
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      // The RPC's own refusals are surfaced in Hebrew; anything else is shown
      // as-is so a real fault is not disguised as a validation message.
      const raw = String(err?.message || err);
      toast.error(
        raw.includes("overpayment") ? "אחת ההקצאות עולה על היתרה לתשלום של החשבונית. רענן ונסה שוב."
        : raw.includes("invoice_not_found") ? "חשבונית לא נמצאה או אינה שייכת לחשבון זה"
        : raw.includes("invoice_credited") ? "לא ניתן לשלם חשבונית שזוכתה"
        : raw.includes("invoice_customer_mismatch") ? "חשבונית אינה שייכת ללקוח זה"
        : raw.includes("customer_not_found") ? "הלקוח לא נמצא"
        : raw.includes("not_authenticated") ? "נדרשת התחברות מחדש"
        : `שגיאה ברישום התשלום: ${raw}`);
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

    // ---- the split path -------------------------------------------------
    // Taken only when another invoice was actually given an amount. Everything
    // below this branch is the original single-invoice flow, untouched.
    if (isSplit) {
      if (!validation.ok) {
        toast.error(validation.errors[0]?.message || "ההקצאה אינה תקינה");
        return;
      }
      setSaving(true);
      try {
        await saveSplit({ isCheck, checkDetails });
      } finally {
        setSaving(false);
      }
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

      // Carried out of the call so the warning is shown AFTER the payment's own
      // success message. The payment really did succeed; the order is a separate
      // fact and must never change that verdict.
      //
      // Runs only when this payment settled the invoice. A partial payment
      // leaves every order status exactly as it was.
      const orderWarning = newStatus === "שולם"
        ? await completeOrdersFor([invoice.id])
        : null;

      // ---- the receipt, and what we actually know about it ---------------
      //
      // This used to be `catch (e) { /* silently */ }` with no else branch on
      // `ok`, so a Finbot refusal and a lost connection both ended in total
      // silence: the payment was recorded, no receipt existed, and nothing —
      // not a toast, not a column — said so. A missing tax receipt that nobody
      // is told about is worse than a visible failure.
      //
      // The outcome is now classified. The distinction that matters is
      // "refused, so no document was created" versus "unknown, so a document
      // MAY exist": the second must never be retried, because a blind retry
      // against a provider that did create the document issues a SECOND
      // receipt for one payment.
      const outcome = await issueReceipt({
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
        // Spread only for a check, so the request body for every other payment
        // method stays byte-identical to what works today.
        ...(isCheck ? checkDetails : {}),
      }, async (full) => {
        if (!newPayment?.id) return;
        // The full patch carries receipt_status, which exists only once
        // 20261105110000_add_receipt_lifecycle_status.sql has been applied. If
        // it has not, that write is refused and we fall back to the number and
        // url alone — so a frontend deployed ahead of the migration still
        // records the receipt exactly as it does today, instead of breaking the
        // single-invoice flow that works in production.
        const { error: patchErr } = await supabase.from("payments").update(full).eq("id", newPayment.id);
        if (patchErr) {
          const legacy = { ...full };
          delete legacy.receipt_status;
          if (Object.keys(legacy).length) {
            await supabase.from("payments").update(legacy).eq("id", newPayment.id);
          }
          console.warn("receipt_status not stored:", patchErr.message);
        }
      });

      toast.success("התשלום נרשם בהצלחה");
      if (orderWarning) toast.warning(orderWarning);

      // Never silent, whatever happened.
      const receiptMsg = receiptMessage(outcome);
      if (outcome.state === RECEIPT.CONFIRMED) toast.success(receiptMsg.text);
      else toast.warning(receiptMsg.text);
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
            <Label>סכום תשלום{otherInvoices.length > 0 ? " — לחשבונית זו" : ""}</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="הזן סכום"
            />
          </div>

          {/* ── The same payment, across more of this customer's invoices ──
              Collapsed by default, so a plain single-invoice payment looks and
              behaves exactly as it did. Opening it does nothing on its own:
              the split path is taken only once another invoice is given an
              amount. */}
          {otherInvoices.length > 0 && (
            <div className="border border-border rounded-lg">
              <button type="button"
                onClick={() => setAllocOpen(o => !o)}
                className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-muted/40 rounded-lg">
                <span className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-muted-foreground" />
                  פיצול התשלום בין חשבוניות נוספות
                  {isSplit && (
                    <span className="text-[10px] font-normal bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">
                      {extraLineCount + 1} חשבוניות
                    </span>
                  )}
                </span>
                {allocOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {allocOpen && (
                <div className="border-t border-border divide-y divide-border">
                  {/* This invoice, shown as the line it is: preselected, not
                      re-entered. Its amount is the field above. */}
                  <div className="p-3 flex items-center justify-between gap-3 bg-muted/30">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        חשבונית #{displayInvoiceNumber(invoice)}
                        <span className="text-[10px] font-normal bg-green-100 text-green-700 rounded-full px-2 py-0.5 mr-2">
                          החשבונית שנבחרה
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        יתרה: {remaining.toLocaleString("he-IL", { minimumFractionDigits: 2 })} ₪
                      </p>
                    </div>
                    <span className="text-sm font-bold whitespace-nowrap">
                      {fmtAg(primaryAgorot)} ₪
                    </span>
                  </div>

                  {otherInvoices.map(inv => {
                    const rem = remainingAgorot(inv);
                    const err = extraErrorFor(inv.id);
                    return (
                      <div key={inv.id} className="p-3 flex items-center gap-3 flex-wrap">
                        <div className="flex-1 min-w-[150px]">
                          <p className="text-sm font-medium">
                            חשבונית #{displayInvoiceNumber(inv)}
                            {inv.invoice_type === "monthly" && " (מרכזת)"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {inv.date || "—"} · יתרה: {fmtAg(rem)} ₪
                          </p>
                        </div>
                        <div className="w-28">
                          <Input
                            type="number" step="0.01" min="0" placeholder="0.00"
                            value={extra[inv.id] ?? ""}
                            onChange={(e) => setExtra(a => ({ ...a, [inv.id]: e.target.value }))}
                            className={err ? "border-destructive" : ""}
                          />
                          {err && <p className="text-[11px] text-destructive mt-1">{err}</p>}
                        </div>
                        <Button type="button" variant="outline" size="sm" className="h-8 text-xs"
                          onClick={() => setExtra(a => ({ ...a, [inv.id]: toShekels(rem).toFixed(2) }))}>
                          כל היתרה
                        </Button>
                      </div>
                    );
                  })}

                  {/* The payment's total is DERIVED from the lines, never
                      typed, so it can never disagree with them. */}
                  <div className="p-3 flex items-center justify-between bg-muted/40 text-sm">
                    <span>סה״כ התשלום</span>
                    <span className="font-bold">{fmtAg(totalAgorot)} ₪</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {isSplit && (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              התשלום יירשם כ<strong>תשלום אחד</strong> המפוצל בין {extraLineCount + 1} חשבוניות,
              ותופק <strong>קבלה מקושרת אחת לכל חשבונית</strong> בסכום שהוקצה לה.
              בכרטסת ובחישוב היתרה זה נשאר תשלום אחד.
            </p>
          )}

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
          {/* Disabled only for an INVALID split. A plain single-invoice
              payment keeps exactly the enablement it had. */}
          <Button onClick={handleSave} disabled={saving || (isSplit && !validation.ok)} className="flex-1">
            {saving && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
            שמור תשלום
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}