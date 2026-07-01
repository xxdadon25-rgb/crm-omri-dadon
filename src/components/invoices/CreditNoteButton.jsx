import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/utils/formatCurrency";

export default function CreditNoteButton({ invoice }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  if (!invoice || invoice.credited_at) return null;

  const items = invoice.items || [];

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // 1. Create credit note record
      const creditNoteNumber = `זיכוי-${invoice.invoice_number}`;
      const creditedItems = items.map(item => ({
        ...item,
        total: -Math.abs(item.total || 0),
        unit_price: -Math.abs(item.unit_price || 0),
      }));

      const { data: creditNote, error: cnErr } = await supabase
        .from("credit_notes")
        .insert({
          user_id: user.id,
          credit_note_number: creditNoteNumber,
          invoice_id: invoice.id,
          customer_id: invoice.customer_id,
          items: creditedItems,
          total: -(invoice.total || 0),
          reason: `זיכוי עבור חשבונית מספר ${invoice.invoice_number}`,
        })
        .select()
        .single();

      if (cnErr) throw cnErr;

      // 2. Mark invoice as credited
      const { error: invErr } = await supabase
        .from("invoices")
        .update({
          credited_at: new Date().toISOString(),
          credit_note_id: creditNote.id,
          payment_status: "זוכה",
        })
        .eq("id", invoice.id);

      if (invErr) throw invErr;

      // 3. Restore inventory — same pattern as Orders.jsx restoreInventory
      for (const item of items) {
        const pid = item.product_id || item.id;
        if (!pid) continue;
        const { data: product } = await supabase
          .from("products")
          .select("id,quantity")
          .eq("id", pid)
          .single();
        if (!product) continue;
        const newQty = (product.quantity || 0) + (item.quantity || 0);
        await supabase.from("products").update({ quantity: newQty }).eq("id", pid);
      }

      // 4. Invalidate caches
      queryClient.removeQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["credit_notes"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });

      setOpen(false);
      toast.success(`זיכוי ${creditNoteNumber} נוצר בהצלחה`);
    } catch (err) {
      toast.error("שגיאה ביצירת זיכוי: " + err.message);
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
        onClick={() => setOpen(true)}
        title="צור זיכוי"
      >
        <RotateCcw className="w-3.5 h-3.5 ml-1" />
        זיכוי
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent dir="rtl" className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>אישור יצירת זיכוי</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-foreground">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                  <div><span className="text-muted-foreground">חשבונית:</span> <span className="font-semibold">#{invoice.invoice_number}</span></div>
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

                <p className="text-xs text-muted-foreground">
                  פעולה זו תסמן את החשבונית כ"זוכה", תיצור רשומת זיכוי ותחזיר את הסחורה למלאי. לא ניתן לבטל פעולה זו.
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
