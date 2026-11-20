import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/shared/EmptyState";
import { RotateCcw, FileText, AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/utils/formatCurrency";
import { toast } from "sonner";
import CreditNoteReconcileDialog, { unsettledCreditNotes } from "@/components/invoices/CreditNoteReconcileDialog";

export default function LedgerCreditNotesTab({ creditNotes = [], loading }) {
  // The reconciliation screen is reachable from where the credit notes already
  // are. It is the ONLY way an 'uncertain' credit can move on, so it is offered
  // whenever one exists rather than hidden behind a menu.
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const unsettled = unsettledCreditNotes(creditNotes);
  if (loading) {
    return (
      <div className="bg-card rounded-xl border border-border flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (creditNotes.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border">
        <EmptyState icon={RotateCcw} title="אין זיכויים" description="לא נמצאו הודעות זיכוי עבור לקוח זה" />
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      {unsettled.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap bg-orange-50 border-b border-orange-200 px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-orange-900">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              {/* A refusal and an unknown outcome both need attention, and
                  they need DIFFERENT attention: one invites another attempt,
                  the other has to be checked in Finbot first. Saying
                  "awaiting a check" about a refusal would send the owner
                  looking for a document that is known not to exist. */}
              {(() => {
                const checks = unsettled.filter(c => c.finbot_status !== "failed").length;
                const refused = unsettled.length - checks;
                const parts = [];
                if (checks > 0) {
                  parts.push(checks === 1
                    ? "זיכוי אחד ממתין לבדיקה בפינבוט"
                    : `${checks} זיכויים ממתינים לבדיקה בפינבוט`);
                }
                if (refused > 0) {
                  parts.push(refused === 1 ? "זיכוי אחד נדחה" : `${refused} זיכויים נדחו`);
                }
                return `${parts.join(" · ")} — המלאי לא הוחזר והחשבוניות לא סומנו`;
              })()}
            </span>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs"
            onClick={() => setReconcileOpen(true)}>
            בדוק וטפל
          </Button>
        </div>
      )}
      <CreditNoteReconcileDialog
        open={reconcileOpen}
        onOpenChange={setReconcileOpen}
        creditNotes={creditNotes}
      />
      <div className="overflow-x-auto">
        <Table className="min-w-[560px] [&_td]:py-2 md:[&_td]:py-4 [&_td]:px-2 md:[&_td]:px-4 [&_td]:text-sm md:[&_td]:text-base [&_th]:px-2 md:[&_th]:px-4">
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-right">מספר זיכוי</TableHead>
              <TableHead className="text-right">תאריך</TableHead>
              <TableHead className="text-right">חשבונית מקורית</TableHead>
              <TableHead className="text-right">סכום זיכוי</TableHead>
              <TableHead className="text-right w-24">פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {creditNotes.map(cn => (
              <TableRow key={cn.id} className="hover:bg-muted/30">
                <TableCell className="font-medium text-right text-purple-700">{cn.credit_note_number}</TableCell>
                <TableCell className="text-right">
                  {cn.created_at ? cn.created_at.slice(0, 10).split("-").reverse().join("/") : "—"}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {cn.credit_note_number?.includes("-") ? `#${cn.credit_note_number.split("-").pop()}` : "—"}
                </TableCell>
                <TableCell className="text-right font-bold text-red-600">
                  ({formatCurrency(Math.abs(cn.total || 0))})
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => cn.external_credit_note_url ? window.open(cn.external_credit_note_url, "_blank") : toast("הזיכוי לא נשלח לפינבוט")}
                    title="הפק PDF זיכוי"
                  >
                    <FileText className="w-3.5 h-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="px-4 py-3 border-t border-border bg-muted/30 text-sm text-muted-foreground text-left">
        סה״כ {creditNotes.length} זיכויים |
        סכום כולל: ({formatCurrency(creditNotes.reduce((s, cn) => s + Math.abs(cn.total || 0), 0))})
      </div>
    </div>
  );
}
