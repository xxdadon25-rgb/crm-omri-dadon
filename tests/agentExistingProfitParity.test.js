import test from "node:test";
import assert from "node:assert/strict";
import { lineProfit } from "../src/lib/packagingMath.js";
import { cartLineForProfit } from "../src/lib/cartProfit.js";

const line = (quantity, buy_price, unit_price, discount = 0) => ({
  product_id: "99999999-9999-4999-8999-999999999999",
  quantity, buy_price, unit_price, discount,
  sale_level: "unit", buy_level: "unit",
  price_basis: "catalog_same_sold_unit_v1",
});

function currentCrmMargin(lines) {
  let revenue = 0, cost = 0;
  for (const item of lines) {
    const p = lineProfit(cartLineForProfit(item));
    assert.equal(p.ok, true);
    revenue += p.revenue;
    cost += p.cost;
  }
  return { revenue, cost, margin: (revenue-cost)*100/revenue };
}

test("exactly 40% combined margin is permitted with QuickStock arithmetic", () => {
  const p=currentCrmMargin([line(10,6,10)]);
  assert.deepEqual(p,{revenue:10000,cost:6000,margin:40});
});

test("sum of order lines, not each product, determines the threshold", () => {
  const p=currentCrmMargin([
    line(1,90,100), // 10% gross margin
    line(1,10,100), // 90% gross margin
  ]);
  assert.equal(p.margin,50);
});

test("40% is gross margin over revenue, not markup on purchase cost", () => {
  assert.equal(currentCrmMargin([line(1,100,150)]).margin < 40,true);
});

test("line discount reduces revenue but not purchase cost", () => {
  const p=currentCrmMargin([line(5,5,10,20)]);
  assert.equal(p.revenue,4000);
  assert.equal(p.cost,2500);
  assert.equal(p.margin,37.5);
});

test("same-unit rule works without additional product packaging metadata", () => {
  const p=lineProfit(cartLineForProfit({
    product_id:"99999999-9999-4999-8999-999999999999",
    quantity:3,buy_price:6,unit_price:10,discount:0,
  }));
  assert.equal(p.ok,true);
  assert.equal(p.cost,1800);
  assert.equal(p.revenue,3000);
});

test("agorot are rounded per existing quote price, not per product total", () => {
  const p=lineProfit(cartLineForProfit(line(3,0.085,0.335)));
  assert.equal(p.ok,true);
  // buy_price 0.085 x 3 => 0.255, rounded to 0.26.
  assert.equal(p.cost,26);
  // unit_price 0.335 rounds to 0.34, then 3 x 0.34 = 1.02.
  assert.equal(p.revenue,102);
});
