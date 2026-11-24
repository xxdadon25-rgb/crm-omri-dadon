import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const customers=read("src/pages/AgentCustomers.jsx");
const orders=read("src/pages/AgentOrders.jsx");
const managerOrders=read("src/pages/Orders.jsx");
const collections=read("src/pages/AgentCollections.jsx");

test("agent sees assigned-customer orders, invoices, payments and credits read-only",()=>{
 assert.match(customers,/\.from\("orders"\)/);
 assert.match(customers,/\.from\("invoices"\)/);
 assert.match(customers,/\.eq\("customer_id",customerId\)/);
 assert.match(customers,/HistoryTable title="הזמנות"/);
 assert.match(customers,/HistoryTable title="חשבוניות"/);
 assert.match(customers,/HistoryTable title="תשלומים"/);
 assert.match(customers,/HistoryTable title="זיכויים"/);
 assert.match(customers,/\.from\("payments"\)/);
 assert.match(customers,/\.from\("credit_notes"\)/);
 assert.doesNotMatch(customers,/Invoice\.create|Payment\.create|CreditNote\.create/);
});
test("agent submits an order, while only manager has invoice creation flow",()=>{
 assert.match(orders,/sales_agent_create_order"/);
 assert.match(orders,/sales_agent_create_order_with_total"/);
 assert.match(orders,/sales_agent_create_approved_exception_order"/);
 assert.doesNotMatch(orders,/Invoice\.create|\.from\("invoices"\).*\.insert/);
 assert.match(managerOrders,/const handleCreateInvoice = async \(order\)/);
 assert.match(managerOrders,/base44\.entities\.Invoice\.create\(/);
 assert.match(managerOrders,/navigate\("\/invoices"\)/);
});
test("assigned customer debt view uses reads only, manager records collections",()=>{
 assert.match(collections,/AGENT_FEATURES_ENABLED && crmRole==="agent"/);
 assert.match(collections,/allVisibleRows\("invoices"/);
 assert.match(collections,/allVisibleRows\("payments"/);
 assert.doesNotMatch(collections,/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/);
 assert.match(collections,/רק המנהל רושם את התשלום/);
});
