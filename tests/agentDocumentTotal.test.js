import test from "node:test";
import assert from "node:assert/strict";
import {previewAgentManualTotal} from "../src/lib/agentDocumentTotal.js";

test("exact 40% margin and VAT parity for unchanged order total",()=>{
 const r=previewAgentManualTotal({lineSubtotalNet:100,manualTotalGross:118,vatRatePercent:18,netCost:60});
 assert.equal(r.ok,true);
 assert.equal(r.adjustmentNet,0);
 assert.equal(r.vatAmount,18);
 assert.equal(r.effectiveRevenueNet,100);
 assert.equal(r.marginPercent,40);
 assert.equal(r.requiresManagerException,false);
});
test("gross total reduction is a NET taxable adjustment and must lower margin",()=>{
 const r=previewAgentManualTotal({lineSubtotalNet:100,manualTotalGross:106.2,vatRatePercent:18,netCost:60});
 assert.equal(r.ok,true);
 assert.equal(r.adjustmentNet,-10);
 assert.equal(r.vatAmount,16.2);
 assert.equal(r.effectiveRevenueNet,90);
 assert.equal(r.requiresManagerException,true);
 assert.equal(r2(r.effectiveRevenueNet+r.vatAmount),r.totalGross);
});
test("positive taxable total adjustment remains identifiable separately from line discounts",()=>{
 const r=previewAgentManualTotal({lineSubtotalNet:100,manualTotalGross:120,vatRatePercent:18,netCost:60});
 assert.equal(r.ok,true);
 assert.equal(r.storedSubtotalNet,100);
 assert.equal(r.totalGross,120);
 assert.equal(r.adjustmentNet,1.69);
 assert.equal(r.vatAmount,18.31);
 assert.equal(r2(r.effectiveRevenueNet+r.vatAmount),120);
});
test("reject missing cost, fractional cents, zero gross and invalid VAT",()=>{
 for(const props of [
  {lineSubtotalNet:100,manualTotalGross:118,vatRatePercent:18,netCost:null},
  {lineSubtotalNet:100,manualTotalGross:118.001,vatRatePercent:18,netCost:60},
  {lineSubtotalNet:100,manualTotalGross:0,vatRatePercent:18,netCost:60},
  {lineSubtotalNet:100,manualTotalGross:118,vatRatePercent:-1,netCost:60},
  {lineSubtotalNet:100,manualTotalGross:118,vatRatePercent:18,netCost:-1},
 ])assert.equal(previewAgentManualTotal(props).ok,false);
});
const r2=x=>Math.round(x*100)/100;
