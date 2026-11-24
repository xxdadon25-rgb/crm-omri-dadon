import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentLine, agentOrderSignature, agentProductCanBeOrdered } from "../src/lib/agentOrderForm.js";
import { lineProfit } from "../src/lib/packagingMath.js";
import { cartLineForProfit } from "../src/lib/cartProfit.js";

const product={
  id:"99999999-9999-4999-8999-999999999999",
  name:"Test carton / sold unit",sku:"TEST-42",buy_price:6,
};

test("agent line uses same-unit catalog price basis and money rounding", () => {
  const line=buildAgentLine({
    product,quantity:10,unitPrice:10,discount:0,
  });
  assert.equal(line.total,100);
  assert.equal(line.price_basis,"catalog_same_sold_unit_v1");
  assert.equal(line.sale_level,"unit");
  assert.equal(line.buy_level,"unit");
  assert.equal(line.buy_price,undefined);
  const profit=lineProfit(cartLineForProfit({...line,buy_price:product.buy_price}));
  assert.equal(profit.ok,true);
  assert.equal(profit.cost,6000);
  assert.equal(profit.revenue,10000);
  assert.equal(profit.margin,0.4);
});

test("line discount lowers billed total and profit but not purchase cost", () => {
  const line=buildAgentLine({
    product,quantity:5,unitPrice:10,discount:20,
  });
  assert.equal(line.total,40);
  const result=lineProfit(cartLineForProfit({...line,buy_price:6}));
  assert.equal(result.cost,3000);
  assert.equal(result.revenue,4000);
  assert.equal(result.margin,0.25);
});

test("quote unit price rounds to agorot before multiplication", () => {
  const line=buildAgentLine({product,quantity:3,unitPrice:0.335});
  assert.equal(line.total,1.02);
});

test("reject malformed or unbillable line locally, but server remains authority", () => {
  for(const input of [
    {product:null,quantity:1,unitPrice:10},
    {product,quantity:0,unitPrice:10},
    {product,quantity:-1,unitPrice:10},
    {product,quantity:1,unitPrice:-2},
    {product,quantity:1,unitPrice:0},
    {product,quantity:1,unitPrice:10,discount:110},
    {product,quantity:1,unitPrice:10,discount:-2},
    {product,quantity:1,unitPrice:"NaN"},
  ]) {
    assert.equal(buildAgentLine(input),null);
  }
});

test("customer and item changes must invalidate the old margin preview key", () => {
  const line=buildAgentLine({product,quantity:1,unitPrice:10});
  const first=agentOrderSignature("customer-a",[line]);
  assert.notEqual(first,agentOrderSignature("customer-b",[line]));
  assert.notEqual(first,agentOrderSignature("customer-a",[
    buildAgentLine({product,quantity:2,unitPrice:10}),
  ]));
});

test("agent picker omits incomplete-cost entries without deleting catalog records", () => {
  const base={id:product.id,is_active:true,buy_price:6,sell_price:10,quantity:0};
  assert.equal(agentProductCanBeOrdered(base),true);
  assert.equal(agentProductCanBeOrdered({...base,buy_price:null}),false);
  assert.equal(agentProductCanBeOrdered({...base,buy_price:0}),false);
  assert.equal(agentProductCanBeOrdered({...base,buy_price:-1}),false);
  assert.equal(agentProductCanBeOrdered({...base,is_active:false}),false);
  assert.equal(agentProductCanBeOrdered({...base,buy_price:0.01,sell_price:4.15}),false);
  assert.equal(agentProductCanBeOrdered({...base,buy_price:60,sell_price:10}),false);
  assert.equal(agentProductCanBeOrdered({...base,buy_price:9.8,sell_price:13.9,quantity:0}),true);
});
