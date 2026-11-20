import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, FileSearch } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/utils/formatCurrency";
import { needsDateReview } from "@/lib/invoiceBalance";

/**
 * RESOLVING A CREDIT NOTE WHOSE FINBOT DOCUMENT IS IN DOUBT.
 *
 * ============================================================================
 * WHY THIS SCREEN HAS TO EXIST
 * ============================================================================
 * Finbot's API is three POST endpoints and nothing else: no document lookup, no
 * idempotency key. So when an attempt comes back unknown — a timeout, a 5xx, a
 * body we cannot parse — NO amount of code can establish whether the document
 * was created. The question is answerable only by a person opening Finbot and
 * looking.
 *
 * Without this screen an 'uncertain' credit note is recorded and then stuck for
 * ever: the credit button is gone, the database refuses the retry, and nothing
 * offers a way forward. The lifecycle would be honest and useless.
 *
 * ============================================================================
 * THE TWO ANSWERS, AND WHY ONE OF THEM DEMANDS A SENTENCE
 * ============================================================================
 *   "I found the document"   -> its number is the evidence. Confirming restores
 *                               the stock and marks the invoice, in one
 *                               transaction, exactly as an API confirmation
 *                               does. Recorded as established by a person.
 *
 *   "No document exists"     -> this unlocks a retry, and a retry of a request
 *                               that actually succeeded issues a SECOND tax
 *                               document. So it is the one judgement here that
 *                               can cause real harm, and it may not be made by
 *                               clicking: the note of what was checked is
 *                               required, stored, and refused by the database
 *                               if absent.
 *
 * A 'failed' row needs neither — nothing was created, so it simply offers
 * another attempt. A 'pending' row is treated like 'uncertain': it means an
 * attempt was started and never resolved, so a document may exist.
 */

const LABEL = {
  uncertain: { text: "לא ידוע", cls: "bg-orange-100 text-orange-800 border-orange-300" },
  pending: { text: "ממתין", cls: "bg-amber-100 text-amber-800 border-amber-300" },
  failed: { text: "נדחה", cls: "bg-red-100 text-red-800 border-red-300" },
};

/** The rows a person has to look at. 'confirmed' is settled; NULL is legacy. */
export function unsettledCreditNotes(creditNotes = []) {
  return (creditNotes || []).filter(
    cn => cn?.finbot_status === "uncertain"
       || cn?.finbot_status === "pending"
       || cn?.finbot_status === "failed",
  );
}

/**
 * Confirmed documents whose ACCOUNTING DATE is unknown.
 *
 * A different kind of review from the ones above: the document exists and the
 * money is settled, but period reporting cannot place it. Every credit note
 * created before `credit_notes.date` existed is in here, and so is any
 * confirmed from Finbot's own screen without a date being entered.
 */
export function creditNotesNeedingDate(creditNotes = []) {
  return (creditNotes || []).filter(needsDateReview);
}

export default function CreditNoteReconcileDialog({ open, onOpenChange, creditNotes = [] }) {
  const queryClient = useQueryClient();
  const rows = unsettledCreditNotes(creditNotes);
  const undated = creditNotesNeedingDate(creditNotes);

  // Which row is being answered, and with which answer. One at a time: each is
  // a separate accounting decision and batching them would invite a blanket
  // click through all of them.
  const [active, setActive] = useState(null);     // {id, mode: 'found'|'none'}
  const [docNumber, setDocNumber] = useState("");
  // The date printed on the document in Finbot. Asked for because it is what
  // period reporting uses, and because `created_at` is not it.
  const [docDate, setDocDate] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => { setActive(null); setDocNumber(""); setDocDate(""); setEvidence(""); };
  const invalidate = () => {
    queryClient.removeQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
    queryClient.invalidateQueries({ queryKey: ["credit_notes"] });
  };

  /** The document was found in Finbot. Its number is the evidence. */
  const confirmFound = async (cn) => {
    const num = docNumber.trim();
    if (!num) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("credit_note_confirm", {
        p_credit_note_id: cn.id,
        p_external_number: num,
        p_external_url: null,
        p_source: "manual",
        // Optional: without it the credit is confirmed but stays flagged as
        // undated, which is better than a date nobody read off the document.
        p_document_date: docDate.trim() || null,
      });
      if (error) throw error;
      invalidate();
      reset();
      toast.success(`${cn.credit_note_number} אושר כמסמך ${num} — המלאי הוחזר`);
    } catch (e) {
      toast.error("אישור הזיכוי נכשל: " + (e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  };

  /** Finbot holds no such document. Requires the note of what was checked. */
  const declareMissing = async (cn) => {
    const note = evidence.trim();
    if (!note) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("credit_note_resolve", {
        p_credit_note_id: cn.id,
        p_status: "failed",
        p_error: null,
        p_evidence: note,
      });
      if (error) throw error;
      invalidate();
      reset();
      toast.success(`${cn.credit_note_number} סומן כלא הופק — ניתן לנסות שוב`);
    } catch (e) {
      toast.error("עדכון הזיכוי נכשל: " + (e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { reset(); onOpenChange(v); } }}>
      <DialogContent dir="rtl" className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSearch className="w-5 h-5 text-orange-600" />
            זיכויים הממתינים לבדיקה בפינבוט
          </DialogTitle>
        </DialogHeader>

        {undated.length > 0 && (
          <div className="flex gap-2 text-xs bg-red-50 border border-red-200 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              {undated.length === 1
                ? "מסמך זיכוי אחד מאושר ללא תאריך מסמך"
                : `${undated.length} מסמכי זיכוי מאושרים ללא תאריך מסמך`} —
              הכסף נכון, אבל הם <strong>אינם משויכים לשום תקופה בדיווח</strong>.
              הזן את התאריך המודפס עליהם בפינבוט.
            </p>
          </div>
        )}

        {undated.map((cn) => (
          <div key={`d-${cn.id}`} className="border border-red-200 rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <div className="font-medium text-sm">{cn.credit_note_number}</div>
                <div className="text-xs text-muted-foreground">
                  {formatCurrency(Math.abs(cn.total || 0))} · מסמך {cn.external_credit_note_number}
                </div>
              </div>
              <span className="text-[11px] rounded-full border px-2 py-0.5 border-red-300 bg-red-50 text-red-800">
                חסר תאריך
              </span>
            </div>
            {active?.id === cn.id && active.mode === "date" ? (
              <div className="space-y-2 bg-muted/30 rounded-lg p-3">
                <Label className="text-xs">תאריך המסמך בפינבוט</Label>
                <Input type="date" value={docDate} dir="ltr" className="h-9"
                  onChange={(e) => setDocDate(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="sm" className="h-8 text-xs" disabled={busy || !docDate.trim()}
                    onClick={() => confirmFound(cn)}>
                    {busy ? "מעדכן..." : "שמור תאריך"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-xs"
                    disabled={busy} onClick={reset}>ביטול</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="outline" className="h-8 text-xs"
                onClick={() => { setActive({ id: cn.id, mode: "date" });
                                 setDocNumber(cn.external_credit_note_number || "");
                                 setDocDate(""); }}>
                הזן תאריך מסמך
              </Button>
            )}
          </div>
        ))}

        {rows.length === 0 && undated.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            אין זיכויים הממתינים לבדיקה.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2 text-xs bg-orange-50 border border-orange-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                לפינבוט אין ממשק לבדיקת מסמכים קיימים, ולכן המערכת אינה יכולה
                לדעת לבד אם המסמך הופק. <strong>פתח את פינבוט ובדוק.</strong>{" "}
                סימון "לא הופק מסמך" פותח שליחה חוזרת — ואם המסמך כן קיים,
                השליחה החוזרת תיצור מסמך זיכוי שני.
              </p>
            </div>

            {rows.map((cn) => {
              const tag = LABEL[cn.finbot_status] || LABEL.pending;
              const isActive = active?.id === cn.id;
              return (
                <div key={cn.id} className="border border-border rounded-lg p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="space-y-0.5">
                      <div className="font-medium text-sm">{cn.credit_note_number}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatCurrency(Math.abs(cn.total || 0))}
                        {cn.created_at ? ` · ${String(cn.created_at).slice(0, 10).split("-").reverse().join("/")}` : ""}
                      </div>
                      {cn.finbot_error && (
                        <div className="text-[11px] text-muted-foreground" dir="ltr">
                          {cn.finbot_error}
                        </div>
                      )}
                    </div>
                    <span className={`text-[11px] rounded-full border px-2 py-0.5 ${tag.cls}`}>
                      {tag.text}
                    </span>
                  </div>

                  {!isActive && (
                    <div className="flex gap-2 flex-wrap">
                      <Button size="sm" variant="outline" className="h-8 text-xs"
                        onClick={() => { setActive({ id: cn.id, mode: "found" }); setDocNumber(""); }}>
                        מצאתי את המסמך בפינבוט
                      </Button>
                      <Button size="sm" variant="outline"
                        className="h-8 text-xs text-red-700 hover:bg-red-50"
                        onClick={() => { setActive({ id: cn.id, mode: "none" }); setEvidence(""); }}>
                        לא הופק מסמך
                      </Button>
                    </div>
                  )}

                  {isActive && active.mode === "found" && (
                    <div className="space-y-2 bg-muted/30 rounded-lg p-3">
                      <Label className="text-xs">מספר המסמך כפי שהוא מופיע בפינבוט</Label>
                      <Input value={docNumber} onChange={(e) => setDocNumber(e.target.value)}
                        placeholder="לדוגמה 20057" className="h-9" dir="ltr" />
                      <Label className="text-xs">תאריך המסמך (לדיווח תקופתי)</Label>
                      <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)}
                        className="h-9" dir="ltr" />
                      <p className="text-[11px] text-muted-foreground">
                        התאריך המודפס על המסמך בפינבוט — לא תאריך הרישום במערכת.
                        בלעדיו הזיכוי יאושר אך יסומן כחסר תאריך ולא ישויך לתקופה.
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        אישור יחזיר את הסחורה למלאי ויסמן את החשבונית כזוכה, אם
                        הזיכוי הוא על מלוא החשבונית.
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" className="h-8 text-xs"
                          disabled={busy || !docNumber.trim()}
                          onClick={() => confirmFound(cn)}>
                          {busy ? "מעדכן..." : "אשר"}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 text-xs"
                          disabled={busy} onClick={reset}>ביטול</Button>
                      </div>
                    </div>
                  )}

                  {isActive && active.mode === "none" && (
                    <div className="space-y-2 bg-red-50/60 border border-red-100 rounded-lg p-3">
                      <Label className="text-xs">מה בדקת בפינבוט?</Label>
                      <Textarea value={evidence} onChange={(e) => setEvidence(e.target.value)}
                        rows={2} className="text-sm"
                        placeholder="לדוגמה: חיפוש במסמכי פינבוט לתאריך 19/11/2026 — אין זיכוי מול חשבונית 10073" />
                      <p className="text-[11px] text-red-800">
                        ההסבר נשמר ברשומה. בלעדיו המערכת לא תאפשר את הסימון —
                        זה מה שפותח שליחה חוזרת.
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="destructive" className="h-8 text-xs"
                          disabled={busy || !evidence.trim()}
                          onClick={() => declareMissing(cn)}>
                          {busy ? "מעדכן..." : "סמן כלא הופק"}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 text-xs"
                          disabled={busy} onClick={reset}>ביטול</Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
