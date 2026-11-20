import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/utils/formatCurrency";
import { displayInvoiceNumber } from "@/utils/invoiceDisplay";
import { classifyFinbotOutcome, maySendToFinbot, OUTCOME, OUTCOME_MESSAGE } from "@/lib/finbotOutcome";

/**
 * Issuing a credit note.
 *
 * ============================================================================
 * WHAT THIS USED TO DO, AND WHY THE ORDER WAS WRONG
 * ============================================================================
 * Four un-transacted round trips: insert the credit note, mark the invoice,
 * call Finbot, restore the stock. Every boundary was a place to stop, and the
 * stock came back and the invoice stopped being a debt BEFORE anyone knew
 * whether Finbot had issued the document at all. A credit that exists only
 * here is not a credit — it is a receivable that quietly vanished. And if the
 * invoice update failed, the next click made a SECOND credit note.
 *
 * The work now goes through three database functions, and the uncertainty sits
 * between them rather than inside them:
 *
 *   1. credit_note_reserve   atomic and idempotent on an operation id. Records
 *                            the intent as 'pending'. No stock, no invoice.
 *   2. the Finbot call       outside any transaction, exactly ONCE
 *   3a. credit_note_confirm  with the document number in hand. THIS is where
 *                            stock returns and the invoice is marked.
 *   3b. credit_note_resolve  'failed' (nothing was created) or 'uncertain'
 *                            (we cannot tell) — and nothing is undone, because
 *                            nothing was done.
 *
 * ============================================================================
 * THE OPERATION ID IS GENERATED ONCE PER DIALOG, NOT PER CLICK
 * ============================================================================
 * That is what makes a double click, a second tab, or a retry after a dropped
 * response land on the credit note that already exists instead of creating
 * another. Generated when the dialog opens and held in a ref so a re-render
 * cannot change it.
 *
 * AND NOTHING HERE RETRIES AN 'uncertain' OPERATION. `reserve` reports the
 * status of the row it returned; if that row has already been through Finbot
 * and come back unknown, the Finbot call is skipped and the owner is told to
 * reconcile. The database refuses the transition as well, so neither layer
 * depends on the other remembering.
 */
export default function CreditNoteButton({ invoice }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();
  // One id for the whole attempt, including every retry of it.
  const operationIdRef = useRef(null);

  if (!invoice || invoice.credited_at) return null;

  const items = invoice.items || [];

  const openDialog = () => {
    operationIdRef.current = (globalThis.crypto?.randomUUID?.())
      // A fallback only for environments without webcrypto. Collision here
      // would mean two different credits sharing an operation, so it is
      // deliberately wide rather than pretty.
      ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
    setOpen(true);
  };

  const invalidate = () => {
    queryClient.removeQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
    queryClient.invalidateQueries({ queryKey: ["credit_notes"] });
    queryClient.invalidateQueries({ queryKey: ["customers"] });
  };

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const displayNum = displayInvoiceNumber(invoice);
      const creditNoteNumber = `זיכוי-${displayNum}`;
      // The stored lines keep the shape the table already holds: quantities
      // positive, money negative. `kind` is what tells the confirm function
      // whether goods come back; a whole-invoice credit is a return of all of
      // them.
      const creditedItems = items.map((item, index) => ({
        ...item,
        total: -Math.abs(item.total || 0),
        unit_price: -Math.abs(item.unit_price || 0),
        kind: "return",
        // WHICH INVOICE LINE THIS REVERSES. Without it a full credit cannot be
        // attributed to the lines it covers, so the partial-credit screen would
        // show every line as still creditable while the amount cap refused the
        // whole thing — a correct refusal with a message about money when the
        // real answer is "that line is already credited".
        //
        // invoices.items is a JSON array with no stable id, so the index IS the
        // identifier. It is safe because invoices are immutable: a line cannot
        // move after a credit has pointed at it.
        source_line_index: index,
      }));

      // ---- 1. RESERVE ----------------------------------------------------
      // Atomic, idempotent, and side-effect free. It also enforces the cap, so
      // an invoice cannot be credited past its total however many partial
      // credits it already carries.
      const { data: reserved, error: reserveErr } = await supabase.rpc("credit_note_reserve", {
        p_operation_id: operationIdRef.current,
        p_invoice_id: invoice.id,
        p_credit_note_number: creditNoteNumber,
        p_items: creditedItems,
        p_total: invoice.total || 0,
        p_reason: `זיכוי עבור חשבונית מספר ${displayNum}`,
        p_order_id: invoice.order_id ?? null,
        p_created_by: null,
      });
      if (reserveErr) throw reserveErr;

      const creditNoteId = reserved?.credit_note_id;
      if (!creditNoteId) throw new Error("credit_note_reserve returned no credit note");

      // Already settled by an earlier submission of this same operation.
      if (reserved.finbot_status === "confirmed") {
        invalidate();
        setOpen(false);
        toast.success(`זיכוי ${reserved.credit_note_number} כבר הופק (מסמך ${reserved.external_credit_note_number})`);
        return;
      }

      // ---- the one thing that is never done automatically ----------------
      if (!maySendToFinbot(reserved.finbot_status)) {
        invalidate();
        setOpen(false);
        toast.error(OUTCOME_MESSAGE[OUTCOME.UNCERTAIN]);
        return;
      }

      // ---- 2. FINBOT, once -----------------------------------------------
      const serial = invoice.finbot_serial ? String(invoice.finbot_serial).trim() : "";
      if (!serial) {
        // linkedDocument needs the parent invoice's internal serial. Without it
        // the credit cannot be linked, so nothing is sent — and that is a
        // definite 'failed': no document was created, and a retry once the
        // serial exists is safe.
        await supabase.rpc("credit_note_resolve", {
          p_credit_note_id: creditNoteId,
          p_status: "failed",
          p_error: "missing finbot_serial on the parent invoice",
          p_evidence: null,
        });
        invalidate();
        setOpen(false);
        toast.error("לא ניתן להפיק זיכוי בפינבוט — חסר מזהה מסמך פנימי בחשבונית המקורית. הזיכוי נרשם ומחכה לטיפול.");
        return;
      }

      // THE DATE THE DOCUMENT IS ASKED TO CARRY. Held in a variable because it
      // is also what gets recorded as the credit's accounting date on
      // confirmation — Finbot's reply has no date field, so the date we sent is
      // the only fact about the document's date that exists.
      const documentDate = new Date().toISOString().split("T")[0];
      const { data: fbData, error: fbErr } = await supabase.functions.invoke(
        "finbot-invoice",
        {
          body: {
            invoice: {
              date: documentDate,
              items: invoice.items || [],
              total: invoice.total,
              customer_name: invoice.customer_name,
              customer_tax_id: invoice.customer_tax_id,
              customer_address: invoice.customer_address,
            },
            customer: {
              name: invoice.customer_name,
              tax_id: invoice.customer_tax_id,
              address: invoice.customer_address,
            },
            overrides: {
              type: "4",
              credit: Math.abs(invoice.total || 0),
              linkedDocument: serial,
            },
          },
        },
      );

      // ---- 3. RECORD WHAT HAPPENED ---------------------------------------
      const outcome = classifyFinbotOutcome({ invokeError: fbErr, data: fbData });

      if (outcome.kind === OUTCOME.CONFIRMED) {
        // The only path that restores stock and marks the invoice, and it runs
        // inside one transaction in the database.
        const { error: confirmErr } = await supabase.rpc("credit_note_confirm", {
          p_credit_note_id: creditNoteId,
          p_external_number: outcome.number,
          p_external_url: outcome.url,
          p_source: "api",
          // Not read back from the document — Finbot returns no date — so it is
          // recorded as what we sent, which is what it is.
          p_document_date: documentDate,
        });
        if (confirmErr) throw confirmErr;
        invalidate();
        setOpen(false);
        toast.success(`זיכוי ${reserved.credit_note_number} נוצר, והמלאי הוחזר`);
        return;
      }

      // 'failed' or 'uncertain'. No evidence is passed: this is the FIRST
      // finding about the attempt, not a human resolving one, and 'uncertain'
      // may only become 'failed' later with evidence a person supplies.
      const { error: resolveErr } = await supabase.rpc("credit_note_resolve", {
        p_credit_note_id: creditNoteId,
        p_status: outcome.kind,
        p_error: outcome.error,
        p_evidence: null,
      });
      if (resolveErr) throw resolveErr;

      invalidate();
      setOpen(false);
      toast.error(OUTCOME_MESSAGE[outcome.kind]);
    } catch (err) {
      // The credit note, if one was reserved, is left exactly as it is. It is
      // 'pending' or already resolved, it reduced nothing and restored
      // nothing, and the reconciliation screen lists it.
      //
      // THE CAP IS NOT A BUG, so it does not read like one. Its commonest cause
      // is the safety behaviour itself: an earlier attempt on this invoice came
      // back uncertain, that credit still holds its share of the invoice, and a
      // fresh attempt is refused rather than issuing a second one. Matched on
      // the SQL error code rather than its text, which is wording.
      if (err?.code === "23514" || /past its total/.test(err?.message || "")) {
        toast.error("לא ניתן לזכות מעל סכום החשבונית. ייתכן שקיים זיכוי שממתין לבדיקה בפינבוט — בדוק אותו לפני יצירת זיכוי נוסף.");
      } else {
        toast.error("שגיאה ביצירת זיכוי: " + (err?.message || String(err)));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 text-xs text-amber-700 hover:bg-amber-50 hover:text-amber-800 shrink-0"
        onClick={openDialog}
        title="צור זיכוי"
      >
        <RotateCcw className="w-3.5 h-3.5 ml-1" />
        זיכוי
      </Button>

      <AlertDialog open={open} onOpenChange={(v) => { if (!loading) setOpen(v); }}>
        <AlertDialogContent dir="rtl" className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>אישור יצירת זיכוי</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-foreground">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                  <div><span className="text-muted-foreground">חשבונית:</span> <span className="font-semibold">#{displayInvoiceNumber(invoice)}</span></div>
                  <div><span className="text-muted-foreground">לקוח:</span> <span className="font-semibold">{invoice.customer_name}</span></div>
                  <div><span className="text-muted-foreground">סכום לזיכוי:</span> <span className="font-bold text-amber-700">{formatCurrency(invoice.total)}</span></div>
                </div>

                {items.filter(i => i.product_id).length > 0 && (
                  <div>
                    <p className="font-medium mb-1.5">פריטים שיוחזרו למלאי:</p>
                    <div className="bg-muted/30 rounded-lg divide-y divide-border text-xs">
                      {items.filter(i => i.product_id || i.name).map((item, idx) => (
                        <div key={idx} className="flex justify-between px-3 py-1.5">
                          <span>{item.name}</span>
                          <span className="text-muted-foreground">כמות: {item.quantity}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* The sequence stated plainly, because it is the part that
                    changed: nothing comes back to stock until Finbot has
                    actually issued the document. */}
                <p className="text-xs text-muted-foreground">
                  הזיכוי יירשם, יישלח לפינבוט, ורק לאחר שפינבוט יפיק את המסמך
                  תוחזר הסחורה למלאי והחשבונית תסומן כזוכה. אם פינבוט לא יענה
                  בוודאות — הזיכוי יחכה לבדיקה ולא יישלח שוב מעצמו.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel disabled={loading}>ביטול</AlertDialogCancel>
            <AlertDialogAction
              disabled={loading}
              onClick={handleConfirm}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              {loading ? "מעבד..." : "אשר זיכוי"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
