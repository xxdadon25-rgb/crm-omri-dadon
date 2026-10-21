import { useEffect, useState } from "react";
import { formatCurrency } from "@/utils/formatCurrency";

export default function DocumentTotals({ grossTotal, netSubtotal, discountTotal = 0, effectiveDiscountPercent = 0, vatRate, total, discountAmount = 0, totalOverride = null, editableTotal = false, onTotalChange }) {
  const vat = vatRate || 18;

  // Legacy callers (OrderCreateModal etc.) pass netSubtotal + discountAmount.
  // New callers (QuoteEditor) pass grossTotal + discountTotal + effectiveDiscountPercent.
  const gross = grossTotal != null ? grossTotal : (netSubtotal || 0) + (discountAmount || 0);
  const discountAmt = discountTotal > 0 ? discountTotal : (discountAmount || 0);
  const discountPct = effectiveDiscountPercent > 0 ? effectiveDiscountPercent : (gross > 0 && discountAmt > 0 ? (discountAmt / gross) * 100 : 0);
  const net = netSubtotal || 0;
  const vatAmount = net * (vat / 100);

  // The DERIVED total — what the lines and the VAT add up to. Unchanged for
  // every existing caller, which passes `total` and no override.
  const computedTotal = total != null ? total : net + vatAmount;

  // The amount actually payable. A manual total replaces the derived one; it
  // never alters a line, a quantity or the VAT rate.
  const payableTotal = totalOverride != null ? totalOverride : computedTotal;

  // Signed, and deliberately NOT a discount. A discount is a reduction applied
  // before VAT and shown as a percentage of the goods; this is a flat
  // correction to the final figure that can go either way, so it gets its own
  // row and its own wording.
  const adjustment = totalOverride != null ? totalOverride - computedTotal : 0;
  const hasAdjustment = Math.abs(adjustment) > 0.005;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Leaving edit mode whenever the figure changes underneath keeps a stale
  // draft from being committed over a total the user has since recalculated.
  useEffect(() => {
    setEditing(false);
  }, [computedTotal, totalOverride]);

  const beginEdit = () => {
    if (!editableTotal || !onTotalChange) return;
    setDraft(payableTotal != null ? String(Number(payableTotal).toFixed(2)) : "");
    setEditing(true);
  };

  const commit = () => {
    const raw = String(draft).trim();
    setEditing(false);
    // Blank means "go back to the calculated amount". Anything unparseable is
    // ignored rather than written as NaN.
    if (raw === "") {
      onTotalChange(null);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const rounded = Math.round(parsed * 100) / 100;
    // Matching the calculated amount is the same thing as having no override,
    // so it is stored as none. That keeps an order the user "edited" back to
    // its own derived figure indistinguishable from one never edited.
    onTotalChange(Math.abs(rounded - computedTotal) < 0.005 ? null : rounded);
  };

  return (
    <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm max-w-xs ml-auto">
      <div className="flex justify-between">
        <span className="text-muted-foreground">סה״כ ללא מע״מ</span>
        {/* <span className="font-medium">₪{gross.toFixed(2)}</span> */}
        <span className="font-medium">{formatCurrency(gross)}</span>
      </div>
      {discountAmt > 0.001 && (
        <div className="flex justify-between text-red-600">
          <span>הנחה ({discountPct.toFixed(1)}%)</span>
          {/* <span className="font-medium">-₪{discountAmt.toFixed(2)}</span> */}
          <span className="font-medium">-{formatCurrency(discountAmt)}</span>
        </div>
      )}
      {discountAmt > 0.001 && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">סה״כ לאחר הנחה</span>
          {/* <span className="font-medium">₪{net.toFixed(2)}</span> */}
          <span className="font-medium">{formatCurrency(net)}</span>
        </div>
      )}
      <div className="flex justify-between">
        <span className="text-muted-foreground">מע״מ ({vat}%)</span>
        {/* <span className="font-medium">₪{vatAmount.toFixed(2)}</span> */}
        <span className="font-medium">{formatCurrency(vatAmount)}</span>
      </div>

      {/* The derived figure stays on screen whenever a manual total replaces
          it, so the two are always visible together and the adjustment can be
          read against something. */}
      {hasAdjustment && (
        <>
          <div className="flex justify-between">
            <span className="text-muted-foreground">סה״כ מחושב</span>
            <span className="font-medium">{formatCurrency(computedTotal)}</span>
          </div>
          <div className={`flex justify-between ${adjustment < 0 ? "text-red-600" : "text-amber-700"}`}>
            <span>התאמת סכום</span>
            <span className="font-medium">
              {adjustment < 0 ? "-" : "+"}{formatCurrency(Math.abs(adjustment))}
            </span>
          </div>
        </>
      )}

      <div className="flex justify-between border-t border-border pt-2 text-base">
        <span className="font-bold">סה״כ לתשלום</span>
        {/* <span className="font-bold">₪{grandTotal.toFixed(2)}</span> */}
        {editing ? (
          <input
            type="number"
            step="0.01"
            min="0"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
            }}
            className="w-28 text-left font-bold rounded-md border border-input bg-background px-2 py-0.5"
          />
        ) : editableTotal && onTotalChange ? (
          <button
            type="button"
            onClick={beginEdit}
            title="לחץ לעריכת הסכום הסופי"
            className="font-bold underline decoration-dotted underline-offset-4 hover:text-primary"
          >
            {formatCurrency(payableTotal)}
          </button>
        ) : (
          <span className="font-bold">{formatCurrency(payableTotal)}</span>
        )}
      </div>

      {editableTotal && onTotalChange && (
        <p className="text-[11px] text-muted-foreground leading-snug">
          ניתן ללחוץ על הסכום ולהזין סכום סופי. השארת השדה ריק מחזירה לסכום המחושב.
        </p>
      )}
    </div>
  );
}
