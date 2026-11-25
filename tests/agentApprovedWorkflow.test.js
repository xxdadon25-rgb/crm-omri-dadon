import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const customers=read("src/pages/AgentCustomers.jsx");
const orders=read("src/pages/AgentOrders.jsx");
const managerOrders=read("src/pages/Orders.jsx");
const collections=read("src/pages/AgentCollections.jsx");

test("agent sees assigned-customer orders, invoices, payments and credits read-only",()=>{
 assert.ok(customers.includes('fullCustomerHistory("orders"'));
 assert.ok(customers.includes('fullCustomerHistory("invoices"'));
 assert.match(customers,/\.eq\("customer_id",customerId\)/);
 assert.match(customers,/HistoryTable title="הזמנות"/);
 assert.match(customers,/HistoryTable title="חשבוניות"/);
 assert.match(customers,/HistoryTable title="תשלומים"/);
 assert.match(customers,/HistoryTable title="זיכויים"/);
 assert.ok(customers.includes('fullCustomerHistory("payments"'));
 assert.ok(customers.includes('fullCustomerHistory("credit_notes"'));
 assert.doesNotMatch(customers,/Invoice\.create|Payment\.create|CreditNote\.create/);
});
test("agent can inspect complete assigned-customer financial history, not only latest 100 rows",()=>{
 assert.match(customers,/async function fullCustomerHistory\(/);
 assert.match(customers,/\.eq\("customer_id",customerId\)/);
 assert.match(customers,/\.range\(page\*pageSize,\(page\+1\)\*pageSize-1\)/);
 assert.match(customers,/throw Error\("incomplete_assigned_customer_history"\)/);
 assert.doesNotMatch(customers,/\.limit\(100\)/);
 for(const table of ["orders","invoices","payments","credit_notes"]){
  assert.ok(customers.includes('fullCustomerHistory("'+table+'"'));
 }
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
test("manager order queue refreshes after agent orders only when feature enabled",()=>{
 assert.match(managerOrders,/import \{ AGENT_FEATURES_ENABLED \} from "@\/lib\/agentFeatureFlags"/);
 assert.match(managerOrders,/queryKey: \["orders"\],[\s\S]*?refetchInterval: AGENT_FEATURES_ENABLED \? 30_000 : false/);
 assert.match(managerOrders,/refetchOnWindowFocus: true/);
 assert.match(orders,/ההזמנה נשמרה והועברה לטיפול המנהל/);
 assert.match(orders,/ההזמנה המאושרת נוצרה והועברה לטיפול המנהל/);
});
test("assigned customer debt view uses reads only, manager records collections",()=>{
 assert.match(collections,/AGENT_FEATURES_ENABLED && crmRole==="agent"/);
 assert.match(collections,/allVisibleRows\("invoices"/);
 assert.match(collections,/allVisibleRows\("payments"/);
 assert.doesNotMatch(collections,/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/);
 assert.match(collections,/רק המנהל רושם את התשלום/);
});
