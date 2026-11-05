/**
 * Record ONE payment and allocate it manually across several open invoices.
 *
 * The existing single-invoice dialog (PaymentDialog) is untouched and remains
 * the normal path; this is the split-payment path, opened from the ledger's
 * payments tab.
 *
 * HOW IT WRITES
 *   Not with client-side inserts. One RPC —
 *   allocate_payment_across_invoices — performs every insert and every
 *   paid_amount update inside a single transaction, with ownership checks,
 *   SELECT ... FOR UPDATE on each invoice and an overpayment refusal decided
 *   under that lock. A browser that dies mid-request leaves either everything
 *   recorded or nothing.
 *
 * IDEMPOTENCY
 *   The group id is generated ONCE, when the dialog opens, and reused for
 *   every retry. The RPC recognises a group it has already recorded and returns
 *   the existing result instead of inserting a second set of payments. That is
 *   what makes a double click, a flaky network or an impatient retry safe.
 *
 * ONE LINKED RECEIPT PER ALLOCATED INVOICE
 *   Finbot's published OpenAPI spec types `linkedDocument` as a single string
 *   and has no per-invoice allocation field, so one receipt cannot be attached
 *   to several invoices. One receipt per allocation is therefore the only
 *   supported shape that keeps both facts true in Finbot: each receipt is
 *   LINKED to the invoice it settles, and its sum is exactly the amount
 *   allocated to that invoice.
 *
 *   One real payment is still one payment: the rows share one
 *   payment_group_id, the CRM balance and the printed statement show a single
 *   payment, and the several documents exist only in Finbot, which is where an
 *   allocation has to be expressed that way.
 *
 *   Each receipt is independent — one refusal does not cancel the others — and
 *   none is ever retried: the per-row receipt_status records what happened, and
 *   an uncertain attempt is reconciliation work, not a second attempt that
 *   could duplicate a tax document.
 *
 * A SPLIT CHECK
 *   One physical check may be allocated across invoices. Every allocation's
 *   receipt carries the SAME four check fields — bank, branch, account, check
 *   number — and only the amount differs, which is the production
 *   single-invoice request repeated once per invoice. The owner confirmed the
 *   live system already works this way.
 *
 *   What keeps that safe is the allocation rule, not a special case: the
 *   allocations must sum to EXACTLY the amount entered, so the receipts issued
 *   against one check can never total more, or less, than the check is worth.
 *
 * ORDERS
 *   An invoice this payment settles in full completes the orders it covers,
 *   using the same status-scoped update the single-invoice dialog performs.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import { displayInvoiceNumber } from "@/utils/invoiceDisplay";
import {
  validateAllocation, buildAllocationPayload, isAllocatable,
  remainingAgorot, toShekels,
} from "@/lib/paymentAllocation";
import { classifyReceiptOutcome, receiptMessage, receiptPatch, RECEIPT } from "@/lib/receiptLifecycle";

// The same list the single-invoice dialog offers, so a split payment cannot be
// recorded with a method the rest of the system does not know.
const METHODS = ["מזומן", "כרטיס אשראי", "העברה בנקאית", "שיק", "ביט", "פייבוקס", "אחר"];

const fmt = (agorot) =>
  toShekels(agorot).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PaymentAllocationDialog({ open, onOpenChange, invoices = [], customer, onSaved }) {
  // Needed so an order completed by this payment shows its new status at once:
  // onSaved refreshes payments and invoices but not orders, and the ledger
  // reads order status straight from that cache. Same reason as PaymentDialog.
  const queryClient = useQueryClient();
  const [paymentAmount, setPaymentAmount] = useState("");
  const [method, setMethod] = useState("העברה בנקאית");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [amounts, setAmounts] = useState({});          // invoiceId -> shekels as typed
  const [saving, setSaving] = useState(false);

  // Check details, kept identical in shape and validation to the existing
  // dialog so check accounting behaviour is unchanged.
  const [bankName, setBankName] = useState("");
  const [bankBranch, setBankBranch] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const isCheck = method === "שיק";

  // Generated once per opening and reused by every retry — this is the
  // idempotency key the RPC deduplicates on.
  const groupIdRef = useRef(null);

  const open_ = !!open;
  useEffect(() => {
    if (!open_) return;
    groupIdRef.current = (globalThis.crypto?.randomUUID?.() ?? `g-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setPaymentAmount("");
    setAmounts({});
    setReference("");
    setNotes("");
    setBankName(""); setBankBranch(""); setBankAccount(""); setCheckNumber("");
    setDate(new Date().toISOString().slice(0, 10));
  }, [open_]);

  // Only invoices that still owe money and are not credited — the same rules
  // the RPC enforces, so the list cannot offer something the server refuses.
  const openInvoices = useMemo(
    () => invoices.filter(isAllocatable)
      .slice()
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))),
    [invoices],
  );

  const validation = useMemo(
    () => validateAllocation({ invoices: openInvoices, amounts, paymentAmount }),
    [openInvoices, amounts, paymentAmount],
  );

  const errorFor = (invoiceId) =>
    validation.errors.find(e => e.invoiceId === invoiceId)?.message || null;
  const generalErrors = validation.errors.filter(e => !e.invoiceId);

  const checkIncomplete = isCheck && [bankName, bankBranch, bankAccount, checkNumber]
    .some(v => !v.trim());

  /**
   * Complete the orders covered by the invoices this payment settled in full.
   *
   * This is the SAME behaviour the single-invoice dialog performs, and it has
   * to exist here too: a split payment that fully pays an invoice is no less
   * a settlement than a direct one, and without this the order it covers stays
   * at "ממתין לאישור" forever.
   *
   * The rules are copied deliberately, not reinvented:
   *   * only invoices the SERVER reports as fully paid are considered, so a
   *     stale client-side balance cannot complete an order that is still owed
   *   * an invoice names its orders either by order_id (per-order invoice) or
   *     by included_order_ids (monthly invoice), never both
   *   * the update is scoped by BOTH the ids and status = "ממתין לאישור", so
   *     the condition is decided by the database in one statement; an order
   *     someone deliberately moved to אושר/בהכנה/נשלח/בוטל is left alone, and
   *     repeating the update is harmless
   *   * a failure here is isolated and returned as a warning. The payment is
   *     already committed and really did happen; it must never be reported as
   *     failed because an order status lagged behind.
   */
  const completeOrdersFor = async (settledInvoiceIds) => {
    const ids = Array.isArray(settledInvoiceIds) ? settledInvoiceIds.filter(Boolean) : [];
    if (ids.length === 0) return null;

    const settled = invoices.filter(i => ids.includes(i.id));
    const orderIds = [...new Set(
      settled.flatMap(inv => (
        inv.order_id
          ? [inv.order_id]
          : Array.isArray(inv.included_order_ids) ? inv.included_order_ids : []
      )).filter(Boolean),
    )];
    if (orderIds.length === 0) return null;

    try {
      // Read first, only to tell "was never eligible" apart from "was eligible
      // and still did not change". It does not decide the update, which keeps
      // its own status predicate.
      const { data: eligibleRows, error: eligibleErr } = await supabase
        .from("orders").select("id")
        .in("id", orderIds)
        .eq("status", "ממתין לאישור");
      if (eligibleErr) throw eligibleErr;

      const eligibleIds = (eligibleRows ?? []).map(r => r.id);
      if (eligibleIds.length === 0) return null;

      const { data: updatedRows, error: orderErr } = await supabase
        .from("orders").update({ status: "הושלם" })
        .in("id", eligibleIds)
        .eq("status", "ממתין לאישור")
        .select("id");
      if (orderErr) throw orderErr;

      const updatedIds = new Set((updatedRows ?? []).map(r => r.id));
      if (updatedIds.size > 0) queryClient.invalidateQueries({ queryKey: ["orders"] });

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

  const handleSave = async () => {
    if (!validation.ok) {
      toast.error(validation.errors[0]?.message || "ההקצאה אינה תקינה");
      return;
    }
    // Checked BEFORE any write, exactly as the single-invoice dialog does: an
    // incomplete check would record the payment and then fail to produce a
    // receipt.
    if (checkIncomplete) {
      toast.error("יש למלא מספר בנק, סניף, חשבון ומספר צ'ק");
      return;
    }

    setSaving(true);
    try {
      const checkDetails = isCheck ? {
        bank_name: bankName.trim(), bank_branch: bankBranch.trim(),
        bank_account: bankAccount.trim(), check_number: checkNumber.trim(),
      } : null;

      const payload = buildAllocationPayload({
        groupId: groupIdRef.current,
        customerId: customer?.id,
        lines: validation.lines,
        method, date, reference, notes, checkDetails,
      });

      // ONE call. Every insert and update happens inside it, atomically.
      const { data, error } = await supabase.rpc("allocate_payment_across_invoices", payload);
      if (error) throw error;
      if (!data?.ok) throw new Error("רישום התשלום נכשל");

      if (data.already_recorded) {
        // The idempotency guard fired: this group was already recorded, so the
        // money is not recorded twice and no second receipt is issued.
        toast.success("התשלום כבר נרשם קודם לכן — לא בוצע רישום כפול");

        // Orders are still completed on this path. The first attempt may have
        // committed the payment and then lost its response, in which case its
        // orders were never reached; the update is status-scoped, so doing it
        // now is either the missing step or a no-op.
        const retryWarning = await completeOrdersFor(data.settled_invoice_ids);
        if (retryWarning) toast.warning(retryWarning);

        // No receipt is issued here, by design — the first attempt may already
        // have produced one and a second would be a duplicate tax document.
        // But it may equally have died before issuing any, so the rows that
        // have no confirmed receipt are named instead of left in silence.
        const pendingLines = (Array.isArray(data.lines) ? data.lines : [])
          .filter(l => l.receipt_status !== "confirmed");
        toast.warning(pendingLines.length === 0
          ? "לא הופקה קבלה בפעולה זו — לכל ההקצאות קיימת כבר קבלה מאומתת."
          : `לא הופקו קבלות בפעולה זו. ${pendingLines.length} הקצאות (${
              pendingLines.map(l => l.invoice_number ?? "—").join(", ")
            }) ללא קבלה מאומתת — יש לבדוק ב-Finbot לפני הפקה כלשהי.`);

        onOpenChange(false);
        onSaved?.();
        return;
      }

      toast.success(`התשלום נרשם והוקצה ל-${data.payment_count} חשבוניות`);

      // Carried out so the warning is shown AFTER the payment's own success
      // message: the payment succeeded, and an order is a separate fact.
      const orderWarning = await completeOrdersFor(data.settled_invoice_ids);

      // ---- ONE LINKED RECEIPT PER ALLOCATED INVOICE ----------------------
      //
      // Finbot's published OpenAPI spec types `linkedDocument` as a single
      // string and offers no per-invoice allocation field, so one receipt
      // cannot be attached to several invoices. Issuing one receipt per
      // allocation is the only shape the provider supports that keeps BOTH
      // facts true in its books: each receipt is linked to the invoice it
      // settles, and its sum is exactly the amount allocated to that invoice.
      //
      // One real payment is still one payment here: the rows share one
      // payment_group_id, the CRM balance and the customer's statement show a
      // single payment, and the several documents exist only in Finbot, where
      // that is how an allocation is expressed.
      //
      // Each invoice's receipt is independent, so one refusal does not cancel
      // the others. Nothing is ever retried: the per-row state records what
      // happened, and an uncertain attempt is reconciliation work, never an
      // automatic second attempt that could duplicate a tax document.
      //
      // `data.lines` pairs every invoice with the payment row the function
      // actually inserted. Matching by array position would break silently if
      // either order ever changed, so the pairing comes from the server.
      const serverLines = Array.isArray(data.lines) ? data.lines : [];
      const states = [];

      for (const line of serverLines) {
        const inv = openInvoices.find(i => i.id === line.invoice_id);
        let outcome = null;
        try {
          const { data: receiptData, error: receiptError } =
            await supabase.functions.invoke("payment-webhook-", {
              body: {
                invoice_id: line.invoice_id,
                invoice_number: inv?.invoice_number ?? line.invoice_number ?? null,
                external_invoice_number: inv?.external_invoice_number || null,
                // The link. This is what makes the receipt settle the right
                // document in Finbot.
                finbot_serial: inv?.finbot_serial || null,
                customer_id: customer?.id,
                customer_name: customer?.name,
                // The ALLOCATED amount, not the whole payment: the receipt and
                // the invoice it is linked to describe the same money.
                amount: Number(line.amount),
                payment_method: method,
                payment_date: date,
                reference: reference || null,
                // Context for the function's own logs; it ignores these today.
                payment_group_id: groupIdRef.current,
                allocation_count: serverLines.length,
                // The SAME four check fields on every allocation's receipt,
                // with only the amount differing — which is exactly what the
                // production single-invoice flow sends, repeated per invoice.
                // The receipts can never total more than the check is worth,
                // because the allocations must sum to the entered amount
                // exactly before any of this runs.
                ...(isCheck ? checkDetails : {}),
              },
            });
          outcome = classifyReceiptOutcome({ data: receiptData, error: receiptError });
        } catch (e) {
          // The call did not complete. The function may have run and Finbot may
          // already hold this document, so the state is UNCERTAIN, not failed.
          outcome = classifyReceiptOutcome({ thrown: e });
        }

        // Written to THIS allocation's row by its own id, so each invoice
        // carries its own receipt number and its own state.
        try {
          await supabase.from("payments").update(receiptPatch(outcome))
            .eq("id", line.payment_id);
        } catch (e) {
          console.warn("receipt status not stored:", e?.message);
        }
        states.push({ outcome, invoiceNumber: inv?.invoice_number ?? line.invoice_number ?? null });
      }

      // Reported as one summary rather than N toasts, but never reduced to a
      // single verdict: "two issued, one uncertain" is not "it worked".
      const confirmed = states.filter(s => s.outcome.state === RECEIPT.CONFIRMED);
      const failed = states.filter(s => s.outcome.state === RECEIPT.FAILED);
      const uncertain = states.filter(s => s.outcome.state === RECEIPT.UNCERTAIN);

      if (confirmed.length === states.length && states.length > 0) {
        toast.success(states.length === 1
          ? receiptMessage(confirmed[0].outcome).text
          : `הופקו ${states.length} קבלות, אחת לכל חשבונית`);
      } else {
        if (confirmed.length > 0) {
          toast.success(`הופקו ${confirmed.length} קבלות מתוך ${states.length}`);
        }
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
      const friendly =
        raw.includes("overpayment") ? "אחת ההקצאות עולה על היתרה לתשלום של החשבונית. רענן ונסה שוב."
        : raw.includes("invoice_not_found") ? "חשבונית לא נמצאה או אינה שייכת לחשבון זה"
        : raw.includes("invoice_credited") ? "לא ניתן לשלם חשבונית שזוכתה"
        : raw.includes("invoice_customer_mismatch") ? "חשבונית אינה שייכת ללקוח זה"
        : raw.includes("customer_not_found") ? "הלקוח לא נמצא"
        : raw.includes("not_authenticated") ? "נדרשת התחברות מחדש"
        : `שגיאה ברישום התשלום: ${raw}`;
      toast.error(friendly);
    } finally {
      setSaving(false);
    }
  };

  const totalOpenAgorot = openInvoices.reduce((s, i) => s + remainingAgorot(i), 0);

  return (
    <Dialog open={open_} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>תשלום מפוצל בין חשבוניות — {customer?.name || ""}</DialogTitle>
        </DialogHeader>

        {openInvoices.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            אין חשבוניות פתוחות ללקוח זה
          </p>
        ) : (
          <div className="space-y-4">
            {/* ── The payment itself ───────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">סכום התשלום שהתקבל *</Label>
                <Input type="number" step="0.01" min="0" value={paymentAmount}
                  onChange={e => setPaymentAmount(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">אמצעי תשלום</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">תאריך</Label>
                <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="mt-1" />
              </div>
            </div>

            {/* Check details — only for שיק, same four mandatory fields. */}
            {isCheck && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg bg-muted/40">
                <div><Label className="text-xs">בנק *</Label>
                  <Input value={bankName} onChange={e => setBankName(e.target.value)} className="mt-1" /></div>
                <div><Label className="text-xs">סניף *</Label>
                  <Input value={bankBranch} onChange={e => setBankBranch(e.target.value)} className="mt-1" /></div>
                <div><Label className="text-xs">חשבון *</Label>
                  <Input value={bankAccount} onChange={e => setBankAccount(e.target.value)} className="mt-1" /></div>
                <div><Label className="text-xs">מספר צ'ק *</Label>
                  <Input value={checkNumber} onChange={e => setCheckNumber(e.target.value)} className="mt-1" /></div>
              </div>
            )}

            {/* ── Allocation per invoice ───────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-semibold">הקצאה לחשבוניות</Label>
                <span className="text-xs text-muted-foreground">
                  סך היתרות הפתוחות: {fmt(totalOpenAgorot)} ₪
                </span>
              </div>

              <div className="border border-border rounded-lg divide-y divide-border">
                {openInvoices.map(inv => {
                  const rem = remainingAgorot(inv);
                  const err = errorFor(inv.id);
                  return (
                    <div key={inv.id} className="p-3 flex items-center gap-3 flex-wrap">
                      <div className="flex-1 min-w-[180px]">
                        <p className="text-sm font-medium">
                          חשבונית #{displayInvoiceNumber(inv)}
                          {inv.invoice_type === "monthly" && " (מרכזת)"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {inv.date || "—"} · {inv.payment_status} · יתרה: {fmt(rem)} ₪
                        </p>
                      </div>
                      <div className="w-36">
                        <Input
                          type="number" step="0.01" min="0"
                          placeholder="0.00"
                          value={amounts[inv.id] ?? ""}
                          onChange={e => setAmounts(a => ({ ...a, [inv.id]: e.target.value }))}
                          className={err ? "border-destructive" : ""}
                        />
                        {err && <p className="text-[11px] text-destructive mt-1">{err}</p>}
                      </div>
                      {/* Fills this line with its full remaining balance. This
                          is a per-line convenience, not automatic allocation:
                          the owner still chooses every line and every amount. */}
                      <Button type="button" variant="outline" size="sm"
                        onClick={() => setAmounts(a => ({ ...a, [inv.id]: toShekels(rem).toFixed(2) }))}>
                        כל היתרה
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <Label className="text-xs">אסמכתא</Label>
              <Input value={reference} onChange={e => setReference(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">הערות</Label>
              <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className="mt-1" />
            </div>

            {/* ── Running totals, so the remainder is never a surprise ── */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40 text-sm">
              <span>סכום התשלום: <strong>{fmt(validation.paymentAgorot)} ₪</strong></span>
              <span>הוקצו: <strong>{fmt(validation.allocatedAgorot)} ₪</strong></span>
              <span className={validation.unallocatedAgorot === 0 ? "text-green-700" : "text-amber-700"}>
                {validation.unallocatedAgorot === 0
                  ? "מאוזן"
                  : validation.unallocatedAgorot > 0
                    ? `נותרו להקצאה: ${fmt(validation.unallocatedAgorot)} ₪`
                    : `עודף הקצאה: ${fmt(-validation.unallocatedAgorot)} ₪`}
              </span>
            </div>

            {generalErrors.length > 0 && (
              <ul className="text-xs text-destructive list-disc pr-5 space-y-1">
                {generalErrors.map((e, i) => <li key={i}>{e.message}</li>)}
              </ul>
            )}

            <p className="text-[11px] text-muted-foreground leading-relaxed">
              התשלום נרשם כ<strong>תשלום אחד</strong> המפוצל בין החשבוניות שנבחרו, ומופקת
              <strong> קבלה מקושרת אחת לכל חשבונית</strong> בסכום שהוקצה לה — זו הדרך היחידה
              שבה Finbot מאפשר לקשר קבלה לחשבונית. בכרטסת ובחישוב היתרה זה נשאר תשלום אחד.
              סטטוס כל חשבונית יתעדכן ל״שולם״ או ״שולם חלקית״ לפי הסכום שהוקצה לה.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>ביטול</Button>
          <Button onClick={handleSave}
            disabled={saving || !validation.ok || checkIncomplete || openInvoices.length === 0}>
            {saving ? "שומר..." : "רישום התשלום"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
