import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AGENT_COMMISSION_PERCENT,
  commissionForSettledGrossPayment,
} from "../src/lib/agentCommission.js";

test("default commission is the agreed 8% on net cash collected", () => {
  assert.equal(DEFAULT_AGENT_COMMISSION_PERCENT, 8);
  assert.equal(commissionForSettledGrossPayment(23600, 18), 1600);
});

test("a partial settled receipt earns commission only on that portion", () => {
  assert.equal(commissionForSettledGrossPayment(1180, 18), 80);
  assert.equal(commissionForSettledGrossPayment(590, 18), 40);
});

test("historical invoice VAT is not assumed to be today's VAT", () => {
  assert.equal(commissionForSettledGrossPayment(1170, 17), 80);
  assert.equal(commissionForSettledGrossPayment(1180, 18), 80);
  assert.equal(commissionForSettledGrossPayment(1000, 0), 80);
});

test("different authorized rates use the same VAT normalization", () => {
  assert.equal(commissionForSettledGrossPayment(1180, 18, 5), 50);
  assert.equal(commissionForSettledGrossPayment(1180, 18, 0), 0);
  assert.equal(commissionForSettledGrossPayment(1180, 18, 100), 1000);
});

test("invalid amounts and rates are rejected rather than silently counted", () => {
  const cases = [
    [-1, 18, 8], [100, -1, 8], [100, 101, 8],
    [100, 18, -1], [100, 18, 101], [Infinity, 18, 8],
    ["not-money", 18, 8], [100, NaN, 8],
  ];
  for (const args of cases) assert.equal(commissionForSettledGrossPayment(...args), null);
});

test("round once, to agorot, for a settled payment allocation", () => {
  assert.equal(commissionForSettledGrossPayment(1.18, 18), 0.08);
  assert.equal(commissionForSettledGrossPayment(11.8, 18), 0.8);
});

// Settlement status, invoice-owner mapping, monthly billing splits, refunds,
// grouped receipts, and payout deduplication are SERVER checks; these tests
// deliberately make no claim that raw payments have been verified as settled.
