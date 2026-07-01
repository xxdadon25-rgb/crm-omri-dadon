import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/shared/EmptyState";
import { RotateCcw, FileText } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";
import { formatCurrency } from "@/utils/formatCurrency";

export default function LedgerCreditNotesTab({ creditNotes = [], loading }) {
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
                <TableCell className="text-right">{formatDate(cn.date)}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {cn.invoice_number ? `#${cn.invoice_number}` : "—"}
                </TableCell>
                <TableCell className="text-right font-bold text-red-600">
                  ({formatCurrency(Math.abs(cn.total || 0))})
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => window.open(`/credit-note-pdf/${cn.id}`, "_blank")}
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
