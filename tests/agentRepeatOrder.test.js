import test from "node:test";
import assert from "node:assert/strict";
import { repeatAgentOrderDraft } from "../src/lib/agentRepeatOrder.js";

const product={id:"product-1",name:"Test",unit:"חבילה",buy_price:6,sell_price:12,is_active:true};
const order={items:[{product_id:"product-1",quantity:2,unit_price:12,discount:0,total:24}]};

test("repeat draft retains quantity and price but takes product facts from current catalog",()=>{
 const result=repeatAgentOrderDraft(order,[product]);
 assert.equal(result.reason,null);
 assert.equal(result.items.length,1);
 assert.equal(result.items[0].quantity,2);
 assert.equal(result.items[0].unit_price,12);
 assert.equal(result.items[0].name,"Test");
 assert.equal(result.items[0].price_basis,"catalog_same_sold_unit_v1");
});
test("repeat draft never drops blocked or unknown items silently",()=>{
 assert.equal(repeatAgentOrderDraft(order,[]).reason,"unavailable_product");
 assert.equal(repeatAgentOrderDraft({...order,items:[...order.items,{product_id:"missing",quantity:1,unit_price:1,total:1}]},[product]).reason,"unavailable_product");
});
test("repeat draft refuses mixed packaging and unverified snapshots",()=>{
 assert.equal(repeatAgentOrderDraft({items:[{...order.items[0],sale_level:"unit",buy_level:"carton"}]},[product]).reason,"unverified_packaging");
 assert.equal(repeatAgentOrderDraft({items:[{...order.items[0],sale_level_review:true}]},[product]).reason,"unverified_packaging");
});
test("repeat draft rejects invalid totals and zero costs",()=>{
 assert.equal(repeatAgentOrderDraft({items:[{...order.items[0],total:240}]},[product]).reason,"changed_line_amount");
 assert.equal(repeatAgentOrderDraft(order,[{...product,buy_price:0}]).reason,"unavailable_product");
 assert.equal(repeatAgentOrderDraft({items:[]},[product]).reason,"missing_order_items");
});
