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
import { deleteAttachmentLink } from "@/lib/attachmentLinks";
import {
  validateAllocation, buildAllocationPayload, isAllocatable, autoAllocate,
  compareForAllocation, remainingAgorot, toAgorot, toShekels,
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
  // Automatic allocation is the default. Manual stays available for the cases
  // the rule cannot know about — a customer who says which invoice a payment is
  // for, a disputed invoice to skip.
  const [autoMode, setAutoMode] = useState(true);
  // In automatic mode this is the TOTAL received, not the amount for this
  // invoice. Kept in its own state so the two modes can never reinterpret each
  // other's number.
  const [totalAmount, setTotalAmount] = useState("");
  // The idempotency key for a grouped payment. Generated once per opening and
  // reused by every retry, so a double click or a lost response cannot record
  // the money twice.
  const groupIdRef = useRef(null);
  // Files uploaded in THIS dialog session: { file_url, file_name }. The check
  // image is stored once and these are the rows to point at it from every
  // invoice the payment settles.
  const sessionUploadsRef = useRef([]);
  // True once the operator has typed in any of the three bank fields. The
  // remembered details are never written over something a person entered.
  const bankTouchedRef = useRef(false);
  // Whether the lookup has already run for this opening, so switching the
  // method back and forth does not re-query or re-fill.
  const bankLookupRef = useRef(false);
  const [bankSuggested, setBankSuggested] = useState(false);

  const isCheck = method === "שיק";
  const open_ = !!open;

  const remaining = invoice ? (invoice.total || 0) - (invoice.paid_amount || 0) : 0;

  useEffect(() => {
    if (open && remaining > 0) setAmount(String(remaining));
    if (open && invoice?.id) fetchAttachments();
    if (open) {
      setExtra({});
      setAllocOpen(false);
      setAutoMode(true);
      setTotalAmount(remaining > 0 ? String(remaining) : "");
      groupIdRef.current = globalThis.crypto?.randomUUID?.()
        ?? `g-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    if (open) {
      sessionUploadsRef.current = [];
      bankTouchedRef.current = false;
      bankLookupRef.current = false;
      setBankSuggested(false);
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

  // ---- automatic allocation -------------------------------------------
  // Every open invoice of this customer, INCLUDING the one the dialog was
  // opened on, in the order the money is applied. The invoice clicked is not
  // privileged: the oldest debt is settled first, which is the rule a customer
  // paying "on account" expects, and the preview below shows exactly where the
  // money lands so it is never a surprise.
  const eligible = useMemo(() => {
    const pool = invoice
      ? [invoice, ...otherInvoices]
      : otherInvoices;
    return pool.filter(isAllocatable).slice().sort(compareForAllocation);
  }, [invoice, otherInvoices]);

  // Automatic allocation only means anything when there is more than one
  // invoice to allocate across. With a single open invoice the dialog shows,
  // and uses, the original per-invoice amount field — otherwise handleSave
  // would read a total the operator never saw.
  const canAuto = otherInvoices.length > 0;
  const autoActive = autoMode && canAuto;

  const autoTotalAgorot = toAgorot(totalAmount);
  const auto = useMemo(
    () => autoAllocate({ invoices: eligible, totalAgorot: autoTotalAgorot }),
    [eligible, autoTotalAgorot]);

  // The lines this payment will actually write, whichever mode produced them.
  // handleSave decides the path from the same shape: exactly one line, for the
  // invoice this dialog was opened on, is the original single-invoice flow.
  const effectiveLines = autoActive ? auto.lines : validation.lines;

  /**
   * THIS CUSTOMER'S LAST CHEQUE, REMEMBERED FROM THE PAYMENTS THEMSELVES
   *
   * A customer pays by cheque from the same account month after month, and the
   * bank, branch and account were retyped every time — four fields, and Finbot
   * refuses a receipt if any of them is wrong.
   *
   * There is nothing new to store. A payment row is only written when a
   * payment is actually recorded, so the most recent cheque payment of this
   * customer IS the last known-good set of details. That answers "update the
   * remembered values only after a successful payment" for free: they update
   * exactly when a payment row appears, never while typing and never while an
   * attachment is uploaded. No column and no migration.
   *
   * THE RULES
   *   * scoped by customer_id, so details can never cross customers
   *   * read as the TEXT they were stored as — an Israeli branch or account
   *     number can begin with a zero, and any numeric coercion destroys it
   *   * the CHEQUE NUMBER is never suggested: it is different on every cheque,
   *     and a prefilled one is a wrong one waiting to be accepted
   *   * nothing the operator typed is ever written over
   *   * every field stays editable
   */
  const suggestBankDetails = async () => {
    if (bankLookupRef.current) return;         // once per opening
    bankLookupRef.current = true;
    if (!invoice?.customer_id) return;
    try {
      const { data, error } = await supabase
        .from("payments")
        .select("bank_name,bank_branch,bank_account")
        .eq("customer_id", invoice.customer_id)
        .eq("payment_method", "שיק")
        .eq("status", "אושר")
        .not("bank_name", "is", null)
        .order("created_date", { ascending: false })
        .limit(1);
      if (error) throw error;
      const last = (data ?? [])[0];
      if (!last) return;

      // Re-checked at the moment of writing, not only when the lookup started:
      // the operator may have typed while the query was in flight.
      if (bankTouchedRef.current) return;
      const asText = (v) => (v === null || v === undefined ? "" : String(v));
      const offered = {
        bank: asText(last.bank_name),
        branch: asText(last.bank_branch),
        account: asText(last.bank_account),
      };
      // `prev ? prev : …` inside the updater, so a value already in the field
      // wins even if it was entered while the query was in flight.
      setBankName(prev => prev || offered.bank);
      setBankBranch(prev => prev || offered.branch);
      setBankAccount(prev => prev || offered.account);
      // The cheque number is deliberately left alone.
      //
      // Decided here rather than inside the updaters above: a state updater
      // runs during the NEXT render, so a flag set inside one is still false
      // by the time this line is reached.
      if (offered.bank || offered.branch || offered.account) setBankSuggested(true);
    } catch (e) {
      // A suggestion that cannot be made is not a problem worth a toast: the
      // fields are simply filled by hand, as before.
      console.warn("bank details lookup failed:", e?.message);
    }
  };

  // Runs when the method becomes שיק, not when the dialog opens: a cash or
  // transfer payment has no reason to query anything.
  useEffect(() => {
    if (open_ && isCheck) suggestBankDetails();
  }, [open_, isCheck]);

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
      // Remembered so the SAME stored object can be linked to the other
      // invoices this payment settles, once it is actually recorded.
      //
      // Only files uploaded in THIS dialog session are remembered. The invoice
      // may already carry attachments from earlier payments, and those belong
      // to those payments — copying them onto other invoices would attach the
      // wrong evidence to the wrong debt.
      sessionUploadsRef.current = [
        ...sessionUploadsRef.current,
        { file_url: publicUrl, file_name: file.name },
      ];
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
    // One cheque's image can be shared by several invoices, so this removes
    // THIS invoice's link and deletes the stored file only if it was the last
    // one pointing at it. See src/lib/attachmentLinks.js.
    const res = await deleteAttachmentLink({ supabase, bucket: BUCKET, attachment: att });
    if (!res.ok) {
      toast.error(res.error || "שגיאה במחיקת הצרופה");
      return;
    }
    setAttachments(prev => prev.filter(a => a.id !== att.id));
    // Not offered to the other invoices of this payment any more. The file
    // itself may still exist for invoices that already link to it.
    sessionUploadsRef.current =
      sessionUploadsRef.current.filter(u => u.file_url !== att.file_url);
    if (res.warning) toast.warning(res.warning);
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
   * Point the files uploaded here at every OTHER invoice this payment settled.
   *
   * THE PROBLEM THIS SOLVES
   *   An attachment is uploaded while the dialog is open, so it can only be
   *   filed under the invoice the dialog was opened on. For one check paying
   *   three invoices that is wrong by two: open either of the others and the
   *   image of the cheque that paid it is nowhere to be seen.
   *
   * ONE FILE, SEVERAL LINKS
   *   The object in storage is NOT copied. Every row carries the same
   *   file_url, so the three invoices share one stored image. Deleting the
   *   object from any one of them removes the file for all of them, which is
   *   the honest consequence of there being one cheque.
   *
   * ONLY AFTER THE MONEY IS RECORDED
   *   Called after the write has succeeded, never before. A payment that was
   *   refused leaves the image attached to the invoice it was uploaded under
   *   and to nothing else — the state it was in before, with no claim about
   *   invoices that were never paid.
   *
   * SAFE TO REPEAT
   *   The pairs that already exist are read first and skipped, so a retry — or
   *   the already_recorded path finishing what a lost response started — adds
   *   no duplicate link.
   *
   * @returns {Promise<string|null>} a Hebrew warning, or null.
   */
  const linkAttachmentsTo = async (invoiceIds) => {
    const uploads = sessionUploadsRef.current;
    // The opened invoice already has its row from the upload itself, which is
    // why the single-invoice flow reaches this and does nothing at all.
    const targets = [...new Set((invoiceIds || []).filter(id => id && id !== invoice.id))];
    if (uploads.length === 0 || targets.length === 0) return null;

    try {
      const urls = uploads.map(u => u.file_url);
      const { data: existing, error: readErr } = await supabase
        .from("invoice_attachments")
        .select("invoice_id,file_url")
        .in("invoice_id", targets)
        .in("file_url", urls);
      if (readErr) throw readErr;

      // A NUL separator, so an id or a url containing the separator cannot
      // make two different pairs collide into one key.
      const have = new Set((existing ?? []).map(r => `${r.invoice_id}\u0000${r.file_url}`));
      const rows = [];
      for (const id of targets) {
        for (const u of uploads) {
          if (have.has(`${id}\u0000${u.file_url}`)) continue;
          rows.push({ invoice_id: id, file_url: u.file_url, file_name: u.file_name });
        }
      }
      if (rows.length === 0) return null;

      const { error: insErr } = await supabase.from("invoice_attachments").insert(rows);
      if (insErr) throw insErr;
      return null;
    } catch (e) {
      // Isolated like the order update: the payment is committed and really
      // happened, and a missing attachment link must never be reported as a
      // failed payment.
      console.warn("attachment linking failed:", e?.message);
      return "התשלום נרשם, אך לא הצלחנו לשייך את הצרופה לכל החשבוניות. יש לצרף אותה ידנית לחשבוניות הנוספות.";
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
  const saveSplit = async ({ isCheck, checkDetails, lines }) => {
    try {
      const payload = buildAllocationPayload({
        groupId: groupIdRef.current,
        customerId: invoice.customer_id,
        lines,
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
        // The money is recorded, so the links belong on those invoices. The
        // first attempt may have died before writing them, and the pairs that
        // already exist are skipped, so this adds nothing twice.
        const retryAttachWarning = await linkAttachmentsTo(
          (Array.isArray(data.lines) ? data.lines : []).map(l => l.invoice_id));
        if (retryAttachWarning) toast.warning(retryAttachWarning);
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

      // The invoices that actually received money, as the SERVER reports them —
      // not as the client hoped. Only these get a link to the cheque image.
      const attachWarning = await linkAttachmentsTo(serverLines.map(l => l.invoice_id));

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
      if (attachWarning) toast.warning(attachWarning);
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
    // ---- which lines is this payment made of? --------------------------
    // Resolved once, here, for both modes. Everything after this point cares
    // only about the lines, not about how they were chosen.
    let lines;
    if (autoActive) {
      // The surplus refusal lives in autoAllocate, so a total above what the
      // customer owes is rejected with the exact amount that does not fit
      // rather than quietly becoming unallocated credit.
      if (!auto.ok) {
        toast.error(auto.message || "לא ניתן להקצות את הסכום");
        return;
      }
      lines = auto.lines;
    } else {
      const numAmount = parseFloat(amount);
      if (!numAmount || numAmount <= 0) {
        toast.error("יש להזין סכום תקין");
        return;
      }
      if (numAmount > remaining) {
        toast.error(`הסכום המקסימלי לתשלום הוא ₪${remaining.toLocaleString()}`);
        return;
      }
      if (!validation.ok) {
        toast.error(validation.errors[0]?.message || "ההקצאה אינה תקינה");
        return;
      }
      lines = validation.lines;
    }

    // Trimmed once, then used for validation, the payment row and the receipt
    // request, so all three always carry exactly the same values.
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
    // Taken whenever the payment is not simply "this invoice, this amount":
    // more than one line, or a single line that belongs to a DIFFERENT invoice
    // than the one the dialog was opened on. The branch below it is the
    // original single-invoice flow, untouched.
    if (!(lines.length === 1 && lines[0].invoice_id === invoice.id)) {
      setSaving(true);
      try {
        await saveSplit({ isCheck, checkDetails, lines });
      } finally {
        setSaving(false);
      }
      return;
    }

    // One line, for this invoice: the amount that line allocates is the amount
    // this payment records, whichever mode produced it.
    const numAmount = toShekels(lines[0].amountAgorot);

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
      {/* ── Height, and why the layout is a column ───────────────────────
          With automatic allocation expanded and the four cheque fields shown,
          the form is taller than a short laptop screen. The shared
          DialogContent is a `grid` with no max height and does not scroll, so
          it simply grew past the viewport and took "שמור תשלום" and "ביטול"
          with it — off screen, with nothing to scroll.

          Three local changes, all on this dialog so no other dialog in the app
          is affected:
            * a height ceiling, so the dialog can never exceed the viewport
            * a flex COLUMN instead of the inherited grid, so the header and
              the footer size to their content and the body takes the rest
            * overflow-hidden here, so the only thing that scrolls is the body

          maxHeight is declared TWICE on purpose. The inline value uses dvh,
          which excludes the mobile browser's collapsing toolbars; where dvh is
          not supported that declaration is dropped and the vh class below
          applies instead. */}
      <DialogContent
        className="max-w-md max-h-[90vh] flex flex-col overflow-hidden"
        style={{ maxHeight: "90dvh" }}
        dir="rtl">
        {/* Stays put while the body scrolls, so the dialog is always titled —
            which is also what Radix points aria-labelledby at. */}
        <DialogHeader className="shrink-0">
          <DialogTitle>רישום תשלום</DialogTitle>
          <DialogDescription>
            חשבונית #{displayInvoiceNumber(invoice)} — {invoice.customer_name}
          </DialogDescription>
        </DialogHeader>

        {/* THE ONLY SCROLLING REGION.
            min-h-0 is what makes it work: a flex child's default minimum size
            is its content, so without it the body refuses to shrink and
            pushes the footer out of the dialog again — the bug, with extra
            steps.

            overscroll-contain keeps a wheel or a swipe that reaches the end of
            this list from scrolling the page behind the dialog.

            tabIndex makes the region focusable, so arrow keys, Page Up/Down
            and Home/End scroll it. Radix still moves initial focus to the
            first field, and Tab through the fields scrolls them into view on
            its own; this is for someone who wants to read rather than type. */}
        <div
          className="space-y-4 mt-2 flex-1 min-h-0 overflow-y-auto overscroll-contain px-1 -mx-1"
          tabIndex={0}>
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

          {/* ── How the payment is applied ─────────────────────────────
              Automatic is the default. Manual stays available for what a rule
              cannot know: a customer who names the invoice they are paying, or
              a disputed invoice to leave alone. */}
          {canAuto && (
            <div className="flex gap-2">
              {[
                { on: true, label: "הקצאה אוטומטית", hint: "מהחשבונית הישנה ביותר" },
                { on: false, label: "הקצאה ידנית", hint: "סכום לכל חשבונית" },
              ].map(({ on, label, hint }) => (
                <button key={label} type="button" onClick={() => setAutoMode(on)}
                  className={`flex-1 rounded-lg border p-2 text-right ${
                    autoMode === on
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/40"}`}>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-[10px] text-muted-foreground">{hint}</span>
                </button>
              ))}
            </div>
          )}

          {autoActive ? (
            <>
              <div className="space-y-1.5">
                <Label>סכום התשלום שהתקבל</Label>
                <Input
                  type="number" step="0.01" min="0"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  placeholder="הזן סכום"
                />
                <p className="text-[11px] text-muted-foreground">
                  סך היתרות הפתוחות של הלקוח: {fmtAg(auto.eligibleAgorot)} ₪
                </p>
              </div>

              {/* ── Live preview ─────────────────────────────────────────
                  What will be written, before it is written: which invoice,
                  how much it receives, and what it will still owe. The order
                  is the order the money is applied in. */}
              {autoTotalAgorot > 0 && (
                auto.ok ? (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-muted/40 text-xs font-semibold flex justify-between">
                      <span>הקצאה אוטומטית — {auto.lines.length} חשבוניות</span>
                      <span>סה״כ {fmtAg(auto.allocatedAgorot)} ₪</span>
                    </div>
                    <div className="divide-y divide-border">
                      {auto.lines.map((l, i) => {
                        const left = l.remainingAgorot - l.amountAgorot;
                        return (
                          <div key={l.invoice_id} className="px-3 py-2 flex items-center gap-2 text-xs">
                            <span className="w-4 text-muted-foreground">{i + 1}</span>
                            <span className="flex-1 min-w-0">
                              חשבונית #{displayInvoiceNumber(l.invoice)}
                              {l.invoice?.id === invoice.id && (
                                <span className="bg-green-100 text-green-700 rounded-full px-1.5 py-0.5 mr-1 text-[9px]">
                                  זו שנבחרה
                                </span>
                              )}
                              <span className="block text-[10px] text-muted-foreground">
                                {l.invoice?.date || "—"} · יתרה לפני: {fmtAg(l.remainingAgorot)} ₪
                              </span>
                            </span>
                            <span className="font-bold whitespace-nowrap">{fmtAg(l.amountAgorot)} ₪</span>
                            <span className={`w-24 text-left whitespace-nowrap ${
                              left === 0 ? "text-green-700" : "text-amber-700"}`}>
                              {left === 0 ? "נסגרת" : `נותר ${fmtAg(left)} ₪`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-destructive border border-destructive/40 rounded-lg p-3 bg-destructive/5 leading-relaxed">
                    {auto.message}
                  </p>
                )
              )}
            </>
          ) : (
            <div className="space-y-1.5">
                <Label>סכום תשלום{canAuto ? " — לחשבונית זו" : ""}</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="הזן סכום"
              />
            </div>
          )}

          {/* ── The same payment, across more of this customer's invoices ──
              Collapsed by default, so a plain single-invoice payment looks and
              behaves exactly as it did. Opening it does nothing on its own:
              the split path is taken only once another invoice is given an
              amount. */}
          {!autoActive && canAuto && (
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

          {effectiveLines.length > 1 && (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              התשלום יירשם כ<strong>תשלום אחד</strong> המפוצל בין {effectiveLines.length} חשבוניות,
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
                // `remembered` marks the three fields that may be suggested
                // from this customer's last cheque. The cheque number is not
                // one of them: it differs on every cheque, so a prefilled one
                // would be a wrong one waiting to be accepted.
                { label: "מספר בנק", value: bankName, set: setBankName, remembered: true },
                { label: "מספר סניף", value: bankBranch, set: setBankBranch, remembered: true },
                { label: "מספר חשבון", value: bankAccount, set: setBankAccount, remembered: true },
                { label: "מספר צ'ק", value: checkNumber, set: setCheckNumber, remembered: false },
              ].map(({ label, value, set, remembered }) => (
                <div key={label} className="space-y-1.5">
                  <Label>{label}</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={value}
                    onChange={(e) => {
                      // Typing in any remembered field makes this payment's
                      // details the operator's, so a suggestion arriving late
                      // or on a later switch to שיק must not overwrite them.
                      if (remembered) bankTouchedRef.current = true;
                      set(e.target.value);
                    }}
                  />
                </div>
              ))}
              {bankSuggested && (
                <p className="col-span-2 text-[10px] text-muted-foreground">
                  פרטי הבנק הושלמו מהשיק האחרון של לקוח זה. מספר הצ'ק תמיד נותר ריק. ניתן לערוך הכול.
                </p>
              )}
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

        {/* Never scrolls away. shrink-0 keeps it at its natural height even
            when the body is far taller than the dialog, and the background is
            explicit so the scrolling content cannot show through it. */}
        <div className="flex gap-2 pt-3 border-t border-border shrink-0 bg-background">
          {/* Disabled for an allocation that cannot be written: a total above
              what the customer owes, or a manual line above its invoice's
              balance. A plain single-invoice payment with no other invoices to
              allocate to keeps exactly the enablement it had. */}
          <Button onClick={handleSave} className="flex-1"
            disabled={saving
              || (autoActive && autoTotalAgorot > 0 && !auto.ok)
              || (!autoActive && isSplit && !validation.ok)}>
            {saving && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
            שמור תשלום
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}