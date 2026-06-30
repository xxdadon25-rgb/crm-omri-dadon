export default function DocumentTotals({ grossTotal, netSubtotal, discountTotal = 0, effectiveDiscountPercent = 0, vatRate, total, discountAmount = 0 }) {
  const vat = vatRate || 18;

  // Legacy callers (OrderCreateModal etc.) pass netSubtotal + discountAmount.
  // New callers (QuoteEditor) pass grossTotal + discountTotal + effectiveDiscountPercent.
  const gross = grossTotal != null ? grossTotal : (netSubtotal || 0) + (discountAmount || 0);
  const discountAmt = discountTotal > 0 ? discountTotal : (discountAmount || 0);
  const discountPct = effectiveDiscountPercent > 0 ? effectiveDiscountPercent : (gross > 0 && discountAmt > 0 ? (discountAmt / gross) * 100 : 0);
  const net = netSubtotal || 0;
  const vatAmount = net * (vat / 100);
  const grandTotal = total != null ? total : net + vatAmount;

  return (
    <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm max-w-xs ml-auto">
      <div className="flex justify-between">
        <span className="text-muted-foreground">סה״כ ללא מע״מ</span>
        <span className="font-medium">₪{gross.toFixed(2)}</span>
      </div>
      {discountAmt > 0.001 && (
        <div className="flex justify-between text-red-600">
          <span>הנחה ({discountPct.toFixed(1)}%)</span>
          <span className="font-medium">-₪{discountAmt.toFixed(2)}</span>
        </div>
      )}
      {discountAmt > 0.001 && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">סה״כ לאחר הנחה</span>
          <span className="font-medium">₪{net.toFixed(2)}</span>
        </div>
      )}
      <div className="flex justify-between">
        <span className="text-muted-foreground">מע״מ ({vat}%)</span>
        <span className="font-medium">₪{vatAmount.toFixed(2)}</span>
      </div>
      <div className="flex justify-between border-t border-border pt-2 text-base">
        <span className="font-bold">סה״כ לתשלום</span>
        <span className="font-bold">₪{grandTotal.toFixed(2)}</span>
      </div>
    </div>
  );
}
