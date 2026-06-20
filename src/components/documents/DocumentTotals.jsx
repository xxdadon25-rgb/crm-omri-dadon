/**
 * DocumentTotals — NET-FIRST pricing model.
 *
 * netSubtotal = sum of all line totals (before VAT)
 * vat_amount  = netSubtotal × vatRate/100
 * total       = netSubtotal + vat_amount
 *
 * Always shows: סה״כ לפני מע״מ | מע״מ | סה״כ כולל מע״מ
 */
export default function DocumentTotals({ netSubtotal, vatRate, total, discountAmount = 0 }) {
  const vat = vatRate || 18;
  const net = (netSubtotal || 0) - (discountAmount || 0);
  const vatAmount = net * (vat / 100);
  const grandTotal = total != null ? total : net + vatAmount;

  return (
    <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm max-w-xs ml-auto">
      <div className="flex justify-between">
        <span className="text-muted-foreground">סה״כ לפני מע״מ</span>
        <span className="font-medium">₪{net.toFixed(2)}</span>
      </div>
      {discountAmount > 0 && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">הנחה</span>
          <span className="font-medium text-red-500">-₪{(discountAmount || 0).toFixed(2)}</span>
        </div>
      )}
      <div className="flex justify-between">
        <span className="text-muted-foreground">מע״מ ({vat}%)</span>
        <span className="font-medium">₪{vatAmount.toFixed(2)}</span>
      </div>
      <div className="flex justify-between border-t border-border pt-2 text-base">
        <span className="font-bold">סה״כ כולל מע״מ</span>
        <span className="font-bold">₪{grandTotal.toFixed(2)}</span>
      </div>
    </div>
  );
}