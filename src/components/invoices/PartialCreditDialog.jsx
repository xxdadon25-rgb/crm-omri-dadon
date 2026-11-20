import { useState, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Lock } from "lucide-react";
import { formatCurrency } from "@/utils/formatCurrency";
import { displayInvoiceNumber } from "@/utils/invoiceDisplay";
import { creditableInvoice, buildPartialCredit, CREDIT_KIND } from "@/lib/partialCredit";
import { buildFinbotCreditRequest, describeFinbotCreditRequest } from "@/lib/finbotCreditPayload";
import { PARTIAL_CREDIT_ISSUE_ENABLED, PARTIAL_CREDIT_BLOCKERS } from "@/lib/featureFlags";
import { classifyFinbotOutcome, maySendToFinbot, OUTCOME, OUTCOME_MESSAGE } from "@/lib/finbotOutcome";

/**
 * SELECTING WHAT TO CREDIT ON ONE INVOICE.
 *
 * ============================================================================
 * THIS DIALOG CANNOT YET ISSUE ANYTHING, AND SAYS SO
 * ============================================================================
 * Everything here is selection, arithmetic and validation. It writes no credit
 * note, reserves nothing, and never calls Finbot. The submit control is held
 * shut and names what is missing.
 *
 * It is held shut because three things about Finbot's API are not known, and
 * each would produce a WRONG TAX DOCUMENT at a customer rather than a bug to
 * fix later:
 *
 *   1. `credit` is an undocumented number. The whole-invoice flow sends the
 *      gross total, and in a full credit an error there cancels out against
 *      the original document. In a partial credit nothing cancels: ₪200 gross
 *      and ₪200 net differ by the VAT.
 *   2. /income refuses a receipt whose items do not sum to its payments
 *      ("סכום הפריטים אינו תואם לסכום התקבולים"). Whether the same rule binds
 *      `credit` against the item sum on a credit document, and at what
 *      rounding, is not stated anywhere.
 *   3. `payments` is marked required on IncomeDto and the edge function never
 *      sends it. Invoices work regardless, so the provider tolerates its
 *      absence there; for a credit document that tolerance is untested.
 *
 * None of those is guessable from the spec, and a credit document cannot be
 * withdrawn from here once issued. So the selection is built and checked now,
 * and the sending waits for answers in writing.
 */

/**
 * The reasons issuing is shut, from the flag module so the screen and the
 * switch cannot say different things.
 */
export const SUBMISSION_BLOCKED = PARTIAL_CREDIT_BLOCKERS.map(b => `לא מאומת: ${b}`);

export default function PartialCreditDialog({ open, onOpenChange, invoice, creditNotes = [] }) {
  // line index -> { kind, quantity | correctedUnitPrice }
  const [selections, setSelections] = useState({});
  const [reason, setReason] = useState("");

  const info = useMemo(
    () => creditableInvoice(invoice || {}, creditNotes),
    [invoice, creditNotes]);
  const result = useMemo(
    () => buildPartialCredit({ invoice: invoice || {}, creditNotes, selections }),
    [invoice, creditNotes, selections]);
  // THE DRY RUN. Built from the same adapter the live call would use, so the
  // preview cannot drift from what would actually be posted. Nothing is sent.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const queryClient = useQueryClient();
  // One id for the whole attempt, generated when the dialog opens so a retried
  // click lands on the credit note that already exists.
  const operationIdRef = useRef(null);
  const request = useMemo(
    () => buildFinbotCreditRequest({ invoice: invoice || {}, credit: result, reason }),
    [invoice, result, reason]);
  const preview = useMemo(() => describeFinbotCreditRequest(request), [request]);

  if (!invoice) return null;

  const setLine = (index, patch) => setSelections(prev => {
    const next = { ...prev };
    if (patch === null) delete next[index];
    else next[index] = { ...(next[index] || {}), ...patch };
    return next;
  });
  const errorFor = (index) => result.errors.find(e => e.index === index)?.message || null;
  const globalErrors = result.errors.filter(e => e.index === undefined);

  const close = (v) => {
    if (issuing) return;
    if (!v) { setSelections({}); setReason(""); operationIdRef.current = null; }
    onOpenChange(v);
  };

  /**
   * Issue the partial credit: reserve, send to Finbot once, record what
   * happened. The same three steps the whole-invoice flow uses, with the
   * selected lines instead of all of them.
   *
   * HELD SHUT BY THE FLAG. While PARTIAL_CREDIT_ISSUE_ENABLED is false this
   * returns immediately, so there is no path from this screen to a live credit
   * document even if the button were somehow clickable.
   */
  const issue = async () => {
    if (!PARTIAL_CREDIT_ISSUE_ENABLED) return;
    if (!result.ok || !request.ok) return;
    if (!operationIdRef.current) {
      operationIdRef.current = globalThis.crypto?.randomUUID?.()
        ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
    }
    setIssuing(true);
    try {
      // ---- 1. RESERVE: atomic, idempotent, no stock, no invoice ---------
      // The cap inside it is what stops cumulative credits passing the
      // invoice, whatever this screen believes.
      const { data: reserved, error: reserveErr } = await supabase.rpc("credit_note_reserve", {
        p_operation_id: operationIdRef.current,
        p_invoice_id: invoice.id,
        p_credit_note_number: `זיכוי-${displayInvoiceNumber(invoice)}-${Date.now().toString(36)}`,
        p_items: result.lines,
        p_total: result.gross,
        p_reason: reason || `זיכוי חלקי עבור חשבונית ${displayInvoiceNumber(invoice)}`,
        p_order_id: invoice.order_id ?? null,
        p_created_by: null,
      });
      if (reserveErr) throw reserveErr;
      const creditNoteId = reserved?.credit_note_id;
      if (!creditNoteId) throw new Error("credit_note_reserve returned no credit note");

      if (reserved.finbot_status === "confirmed") {
        toast.success(`הזיכוי כבר הופק (מסמך ${reserved.external_credit_note_number})`);
        finish();
        return;
      }
      // An operation that already came back unknown is never sent again.
      if (!maySendToFinbot(reserved.finbot_status)) {
        toast.error(OUTCOME_MESSAGE[OUTCOME.UNCERTAIN]);
        finish();
        return;
      }

      // ---- 2. FINBOT, once, with the body the dry run showed -----------
      const { data: fbData, error: fbErr } =
        await supabase.functions.invoke("finbot-invoice", { body: request.body });
      const outcome = classifyFinbotOutcome({ invokeError: fbErr, data: fbData });

      // ---- 3. RECORD IT ------------------------------------------------
      if (outcome.kind === OUTCOME.CONFIRMED) {
        // The only path that returns stock, and only for the returned lines.
        const { error: confirmErr } = await supabase.rpc("credit_note_confirm", {
          p_credit_note_id: creditNoteId,
          p_external_number: outcome.number,
          p_external_url: outcome.url,
          p_source: "api",
          p_document_date: request.body.invoice.date,
        });
        if (confirmErr) throw confirmErr;
        toast.success(`זיכוי ${outcome.number} הופק${result.restoresStock ? ", והמלאי הוחזר" : ""}`);
      } else {
        const { error: resolveErr } = await supabase.rpc("credit_note_resolve", {
          p_credit_note_id: creditNoteId,
          p_status: outcome.kind,
          p_error: outcome.error,
          p_evidence: null,
        });
        if (resolveErr) throw resolveErr;
        toast.error(OUTCOME_MESSAGE[outcome.kind]);
      }
      finish();
    } catch (err) {
      if (err?.code === "23514" || /past its total/.test(err?.message || "")) {
        toast.error("לא ניתן לזכות מעל סכום החשבונית. ייתכן שקיים זיכוי שממתין לבדיקה בפינבוט.");
      } else {
        toast.error("שגיאה בהפקת הזיכוי: " + (err?.message || String(err)));
      }
    } finally {
      setIssuing(false);
    }
  };

  const finish = () => {
    queryClient.removeQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
    queryClient.invalidateQueries({ queryKey: ["credit_notes"] });
    setSelections({}); setReason(""); operationIdRef.current = null;
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>זיכוי חלקי — חשבונית #{displayInvoiceNumber(invoice)}</DialogTitle>
        </DialogHeader>

        {!PARTIAL_CREDIT_ISSUE_ENABLED ? (
          <div className="flex gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg p-3">
            <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium">הפקת זיכוי חלקי אינה זמינה כרגע</p>
              <ul className="list-disc pr-4 space-y-0.5 text-amber-900">
                {SUBMISSION_BLOCKED.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                אפשר לבחור ולבדוק את החישוב. לא נשלח דבר לפינבוט.
              </p>
            </div>
          </div>
        ) : (
          <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900">
            הנפקה חיה: לחיצה על ״הפק זיכוי״ תשלח בקשה לפינבוט ותיצור מסמך זיכוי אמיתי אם הבקשה תאושר. בדוק את המוצרים, הכמויות והסכום לפני ההנפקה.
          </div>
        )>

        {/* What is left to credit on this invoice at all. */}
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="bg-muted/40 rounded-lg p-2">
            <div className="text-muted-foreground">סך החשבונית</div>
            <div className="font-semibold">{formatCurrency(info.invoiceGrossAg / 100)}</div>
          </div>
          <div className="bg-muted/40 rounded-lg p-2">
            <div className="text-muted-foreground">זוכה עד כה</div>
            <div className="font-semibold">{formatCurrency(info.creditedGrossAg / 100)}</div>
          </div>
          <div className="bg-muted/40 rounded-lg p-2">
            <div className="text-muted-foreground">ניתן לזכות</div>
            <div className="font-semibold">{formatCurrency(info.remainingGrossAg / 100)}</div>
          </div>
        </div>

        {/* THE LINES */}
        <div className="space-y-2">
          {info.lines.map((line) => {
            const sel = selections[line.index];
            const mode = sel?.kind ?? null;
            const lineErr = errorFor(line.index);
            const exhausted = line.remainingQty <= 0;
            return (
              <div key={line.index}
                className={`border rounded-lg p-3 space-y-2 ${
                  lineErr ? "border-red-300 bg-red-50/40"
                          : mode ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{line.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {line.quantity} × {formatCurrency(line.unitPriceAg / 100)} לפני מע״מ
                      {line.discount ? ` · הנחה ${line.discount}%` : ""}
                      {" = "}{formatCurrency(line.lineNetAg / 100)}
                    </div>
                    {line.creditedQty > 0 && (
                      <div className="text-[11px] text-amber-700">
                        זוכו כבר {line.creditedQty} · ניתן לזכות עוד {line.remainingQty}
                      </div>
                    )}
                  </div>
                  {exhausted ? (
                    <span className="text-[11px] text-muted-foreground">זוכה במלואו</span>
                  ) : (
                    <div className="flex gap-1">
                      <Button size="sm" variant={mode === CREDIT_KIND.RETURN ? "default" : "outline"}
                        className="h-7 text-xs"
                        onClick={() => setLine(line.index, mode === CREDIT_KIND.RETURN
                          ? null
                          : { kind: CREDIT_KIND.RETURN, quantity: String(line.remainingQty),
                              correctedUnitPrice: undefined })}>
                        החזרת סחורה
                      </Button>
                      <Button size="sm" variant={mode === CREDIT_KIND.PRICE ? "default" : "outline"}
                        className="h-7 text-xs"
                        onClick={() => setLine(line.index, mode === CREDIT_KIND.PRICE
                          ? null
                          : { kind: CREDIT_KIND.PRICE, correctedUnitPrice: "",
                              quantity: undefined })}>
                        הפרש מחיר
                      </Button>
                    </div>
                  )}
                </div>

                {mode === CREDIT_KIND.RETURN && (
                  <div className="flex items-end gap-2 flex-wrap">
                    <div>
                      <Label className="text-xs">כמות לזיכוי</Label>
                      <Input type="number" min="0" step="any" className="h-9 w-28"
                        value={sel.quantity ?? ""}
                        onChange={(e) => setLine(line.index, { quantity: e.target.value })} />
                    </div>
                    <div className="text-xs text-muted-foreground pb-2">
                      מתוך {line.remainingQty} · הסחורה תחזור למלאי
                    </div>
                  </div>
                )}

                {mode === CREDIT_KIND.PRICE && (
                  <div className="flex items-end gap-2 flex-wrap">
                    <div>
                      <Label className="text-xs">המחיר שהיה צריך להיות (לפני מע״מ)</Label>
                      <Input type="number" min="0" step="0.01" className="h-9 w-32"
                        value={sel.correctedUnitPrice ?? ""}
                        onChange={(e) => setLine(line.index, { correctedUnitPrice: e.target.value })} />
                    </div>
                    <div className="text-xs text-muted-foreground pb-2">
                      במקום {formatCurrency(line.unitPriceAg / 100)} ·
                      ההפרש × {line.quantity} · <strong>המלאי לא זז</strong>
                    </div>
                  </div>
                )}

                {lineErr && <p className="text-xs text-red-700">{lineErr}</p>}
              </div>
            );
          })}
        </div>

        <div>
          <Label className="text-xs">סיבת הזיכוי</Label>
          <Textarea rows={2} className="text-sm" value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="לדוגמה: הוחזרו 3 יחידות פגומות" />
        </div>

        {/* THE MONEY, with VAT shown apart rather than folded in. */}
        <div className="border border-border rounded-lg divide-y divide-border text-sm">
          <div className="flex justify-between px-3 py-2">
            <span className="text-muted-foreground">סה״כ לזיכוי לפני מע״מ</span>
            <span className="font-medium">{formatCurrency(result.net)}</span>
          </div>
          <div className="flex justify-between px-3 py-2">
            <span className="text-muted-foreground">
              {result.vatRateKnown ? `מע״מ ${result.vatRate}%` : "מע״מ — שיעור לא רשום בחשבונית"}
            </span>
            <span className="font-medium">{formatCurrency(result.vat)}</span>
          </div>
          <div className="flex justify-between px-3 py-2 bg-muted/30">
            <span className="font-semibold">סה״כ זיכוי</span>
            <span className="font-bold">{formatCurrency(result.gross)}</span>
          </div>
          {result.restoresStock && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {result.stockLines === 1
                ? "שורה אחת תחזיר סחורה למלאי — רק לאחר שפינבוט יפיק את המסמך"
                : `${result.stockLines} שורות יחזירו סחורה למלאי — רק לאחר שפינבוט יפיק את המסמך`}
            </div>
          )}
        </div>

        {globalErrors.length > 0 && (
          <div className="space-y-1">
            {globalErrors.map((e, i) => (
              <p key={i} className="flex gap-2 text-xs text-red-700">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{e.message}
              </p>
            ))}
          </div>
        )}

        {/* A full credit reached by selecting everything is a different
            decision, and is named rather than slipped through. */}
        {result.isFullCredit && (
          <p className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-2">
            הבחירה מזכה את מלוא החשבונית. לביטול חשבונית שלמה השתמש בזיכוי המלא —
            זיכוי חלקי נועד לתיקון חלקי.
          </p>
        )}

        {/* THE DRY RUN — exactly what would be posted, from the same adapter
            the live call will use. Shown on request so it is available for
            checking against Finbot support without being in the way. */}
        {result.ok && (
          <div className="border border-border rounded-lg">
            <button type="button" className="w-full text-right px-3 py-2 text-xs font-medium hover:bg-muted/40"
              onClick={() => setPreviewOpen(v => !v)}>
              {previewOpen ? "▾" : "▸"} הצג את המסמך שיישלח (הרצה יבשה — לא נשלח דבר)
            </button>
            {previewOpen && (
              <div className="px-3 pb-3 space-y-2 text-xs">
                {request.blockers.length > 0 ? (
                  <div className="space-y-1">
                    {request.blockers.map((b, i) => (
                      <p key={i} className="text-red-700">{b.message}</p>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <span className="text-muted-foreground">סוג מסמך</span>
                      <span dir="ltr">type {preview.type}</span>
                      <span className="text-muted-foreground">מקושר למסמך</span>
                      <span dir="ltr">{preview.linkedDocument}</span>
                      <span className="text-muted-foreground">credit</span>
                      <span dir="ltr">
                        {preview.credit.toFixed(2)} ({preview.creditBasis})
                      </span>
                      <span className="text-muted-foreground">סכום הפריטים (נטו)</span>
                      <span dir="ltr">{preview.itemsNet.toFixed(2)}</span>
                      <span className="text-muted-foreground">vatType</span>
                      <span dir="ltr">true — פינבוט מוסיף מע״מ למחירי הפריטים</span>
                      <span className="text-muted-foreground">payments</span>
                      <span dir="ltr">לא נשלח</span>
                    </div>
                    <div className="border border-border rounded divide-y divide-border">
                      {preview.items.map((it, i) => (
                        <div key={i} className="flex justify-between gap-2 px-2 py-1">
                          <span className="truncate">{it.name}</span>
                          <span dir="ltr" className="shrink-0 text-muted-foreground">
                            {it.amount} × {it.price.toFixed(2)} = {it.lineNet.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {/* The uncertainty, stated on the preview itself rather than
                    only in a document somewhere. */}
                <div className="space-y-1 bg-amber-50 border border-amber-200 rounded p-2">
                  {request.uncertainties.map((u) => (
                    <p key={u.code} className="text-[11px] text-amber-900">{u.message}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap border-t border-border pt-3">
          <p className="text-[11px] text-muted-foreground">
            {result.ok
              ? (PARTIAL_CREDIT_ISSUE_ENABLED
                  ? "הבחירה תקינה. לחיצה על ״הפק זיכוי״ תנפיק מסמך אמיתי בפינבוט."
                  : "הבחירה תקינה. ההנפקה אינה זמינה כרגע.")
              : "השלם את הבחירה כדי לראות את החישוב המלא."}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => close(false)}>סגור</Button>
            {/* HELD SHUT BY THE FLAG, which carries the reasons. When the flag
                is false no input can open it — there is no path from this
                screen to a live credit document. */}
            <Button onClick={issue}
              disabled={!PARTIAL_CREDIT_ISSUE_ENABLED || !result.ok || !request.ok || issuing}
              title={PARTIAL_CREDIT_ISSUE_ENABLED ? undefined : SUBMISSION_BLOCKED.join(" · ")}>
              {!PARTIAL_CREDIT_ISSUE_ENABLED && <Lock className="w-3.5 h-3.5 ml-1" />}
              {issuing ? "מפיק..."
                : PARTIAL_CREDIT_ISSUE_ENABLED ? "הפק זיכוי" : "הפק זיכוי (חסום)"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
