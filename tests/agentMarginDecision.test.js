import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_MIN_GROSS_MARGIN, evaluateMarginResult } from "../src/lib/agentMarginDecision.js";

const profit = (margin, extra = {}) => ({
  ok:true, totalSalesNet:1000, profitMargin:margin, ...extra,
});

test("business rule is at least 40% gross margin, not 40% markup", () => {
  assert.equal(AGENT_MIN_GROSS_MARGIN,40);
  assert.equal(evaluateMarginResult(profit(40)).allowed,true);
  assert.equal(evaluateMarginResult(profit(55)).allowed,true);
  assert.equal(evaluateMarginResult(profit(39.99)).allowed,false);
});

test("an under-40% order requests a manager exception, never auto-approves", () => {
  const d=evaluateMarginResult(profit(35));
  assert.equal(d.allowed,false);
  assert.equal(d.requiresException,true);
  assert.match(d.reason,/40%/);
});

test("missing cost or uncertain packing blocks, not an exception", () => {
  const d=evaluateMarginResult({ok:false,profitMargin:null,message:"חסרים נתוני אריזה"});
  assert.equal(d.allowed,false);
  assert.equal(d.requiresException,false);
  assert.match(d.reason,/אריזה/);
});

test("zero or invalid net revenue is always rejected", () => {
  for (const sales of [0,-100,NaN,Infinity]) {
    const d=evaluateMarginResult(profit(50,{totalSalesNet:sales}));
    assert.equal(d.allowed,false);
    assert.equal(d.requiresException,false);
  }
});

test("invalid or absent percentage fails closed", () => {
  for (const margin of [null,undefined,NaN,Infinity,-Infinity]) {
    const d=evaluateMarginResult(profit(margin));
    assert.equal(d.allowed,false);
    assert.equal(d.requiresException,false);
  }
});
