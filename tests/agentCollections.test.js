import test from "node:test";
import assert from "node:assert/strict";
import { rankCollections, agentCollectionPosition } from "../src/lib/agentCollections.js";

const customers=[
  {id:"customer-a",name:"Alpha"},
  {id:"customer-b",name:"Beta"},
  {id:"customer-c",name:"Gamma"},
];
const invoices=[
  {id:"invoice-a1",customer_id:"customer-a",total:1180},
  {id:"invoice-a2",customer_id:"customer-a",total:590},
  {id:"invoice-b",customer_id:"customer-b",total:236},
  {id:"invoice-c",customer_id:"customer-c",total:118},
];
const payments=[
  {id:"p-a1",customer_id:"customer-a",invoice_id:"invoice-a1",amount:590},
  {id:"p-a2",customer_id:"customer-a",invoice_id:"invoice-a2",amount:590},
  {id:"p-b",customer_id:"customer-b",invoice_id:"invoice-b",amount:236},
  // Unlinked should never be deducted from a customer's invoice balance.
  {id:"orphan",customer_id:"customer-a",invoice_id:"nonexistent",amount:999},
  // Same invoice belonging to another customer: do not use an unrelated row.
  {id:"wrong-customer",customer_id:"customer-b",invoice_id:"invoice-a1",amount:500},
];
const credits=[
  {id:"credit-b",invoice_id:"invoice-b",customer_id:"customer-b",total:118,finbot_status:"confirmed"},
  {id:"pending-c",invoice_id:"invoice-c",customer_id:"customer-c",total:118,finbot_status:"pending"},
];

test("collection totals reuse signed QuickStock invoice position without hiding refunds",()=>{
  const result=rankCollections(customers,invoices,payments,credits);
  assert.equal(result.length,3);
  assert.deepEqual(result.map(x=>x.customer.id),["customer-a","customer-c","customer-b"]);
  assert.equal(result[0].debt,590);
  assert.equal(result[0].perInvoice.reduce((n,x)=>n+x.position.paidAg,0),118000);
  assert.equal(result[0].paymentCount,2);
  assert.equal(result[1].debt,118);
  assert.equal(result[1].pending,118); // Pending credit is NOT issued.
  assert.equal(result[2].debt,0);
  assert.equal(result[2].refundDue,118);
});

test("manager-recorded payment moves customer's debt down on next refetch",()=>{
  const before=agentCollectionPosition(customers[0],invoices,payments,credits);
  const after=agentCollectionPosition(customers[0],invoices,[
    ...payments,
    {id:"new-manager-receipt",customer_id:"customer-a",invoice_id:"invoice-a1",amount:590}
  ],credits);
  assert.equal(before.debt,590);
  assert.equal(after.debt,0);
});

test("partial payments reduce only their own invoice; other customer records excluded",()=>{
  const r=agentCollectionPosition(customers[0],invoices,payments,credits);
  assert.equal(r.invoiceCount,2);
  assert.equal(r.paymentCount,2);
  assert.equal(r.refundDue,0);
});

test("confirmed credit with a fully-paid invoice shows refund side, not a negative debt",()=>{
  const r=agentCollectionPosition(customers[1],invoices,payments,credits);
  assert.equal(r.debt,0);
  assert.equal(r.refundDue,118);
  assert.equal(r.net,-118);
});

test("unassigned or nonexistent customer cannot be aggregated from an arbitrary ID",()=>{
  assert.equal(agentCollectionPosition(null,invoices,payments,credits),null);
  assert.deepEqual(rankCollections([],invoices,payments,credits),[]);
});
