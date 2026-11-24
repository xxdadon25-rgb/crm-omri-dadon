/**
 * Read-only parity calculations for the existing QuickStock order total override.
 * Not wired to the agent order RPC: agents must NOT be allowed to submit
 * overrides until a trusted server implementation and restored-schema E2E pass.
 *
 * QuickStock manager UI represents a manually edited TOTAL as a taxable
 * adjustment, NOT a new line item or document discount. See OrderCreateModal.
 */
const r2 = n => Math.round(n * 100) / 100;
const cents = n => Number.isFinite(n) && n >= 0 && r2(n) === n;

export function previewAgentManualTotal({lineSubtotalNet,manualTotalGross,vatRatePercent,netCost}) {
  if([lineSubtotalNet,manualTotalGross,vatRatePercent,netCost].some(x=>x===null || x===undefined || x==="")){
    return {ok:false,reason:"invalid_document_total"};
  }
  const subtotal=Number(lineSubtotalNet);
  const gross=Number(manualTotalGross);
  const vat=Number(vatRatePercent);
  const cost=Number(netCost);

  if (![subtotal,gross,vat,cost].every(Number.isFinite) ||
      !cents(subtotal) || !cents(gross) || !cents(cost) ||
      vat<0 || vat>100 || subtotal<=0 || gross<=0 || cost<=0) {
    return {ok:false,reason:"invalid_document_total"};
  }
  const adjustmentNet=r2(gross/(1+vat/100)-subtotal);
  const vatAmount=r2(gross-subtotal-adjustmentNet);
  const effectiveRevenueNet=r2(subtotal+adjustmentNet);
  if(effectiveRevenueNet<=0 || vatAmount<0 ||
      r2(effectiveRevenueNet+vatAmount)!==gross) {
    return {ok:false,reason:"invalid_taxable_adjustment"};
  }
  const marginPercent=(effectiveRevenueNet-cost)*100/effectiveRevenueNet;
  return {
    ok:true,reason:null,storedSubtotalNet:subtotal,
    adjustmentNet,vatAmount,totalGross:gross,
    effectiveRevenueNet,netCost:cost,marginPercent,
    requiresManagerException: marginPercent<40,
  };
}
