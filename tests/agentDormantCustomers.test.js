import test from "node:test";
import assert from "node:assert/strict";
import { dormantAssignedCustomers } from "../src/lib/agentDormantCustomers.js";

const today=new Date("2026-11-24T12:00:00Z");
const people=[
 {id:"a",name:"New Customer"},
 {id:"b",name:"Old Customer"},
 {id:"c",name:"Recent Customer"},
];
test("prioritizes never-ordered and old assigned customers",()=>{
 const data=dormantAssignedCustomers(people,[
  {customer_id:"b",date:"2026-05-01"},{customer_id:"b",date:"2026-09-01"},
  {customer_id:"c",date:"2026-11-20"}
 ],60,today);
 assert.deepEqual(data.map(x=>x.id),["a","b"]);
 assert.equal(data[1].lastOrderDate,"2026-09-01");
});
test("does not treat malformed or future-dated records as recent orders",()=>{
 const data=dormantAssignedCustomers([people[0]],[
  {customer_id:"a",date:"2026-02-30"},{customer_id:"a",date:"2027-01-01"}
 ],60,today);
 assert.equal(data[0].lastOrderDate,null);
});
test("cutoff is selectable; never shows unassigned customer from order rows",()=>{
 const data=dormantAssignedCustomers([people[2]],[
  {customer_id:"foreign",date:"2026-11-23"},{customer_id:"c",date:"2026-10-01"}
 ],30,today);
 assert.deepEqual(data.map(x=>x.id),["c"]);
 assert.equal(dormantAssignedCustomers(people,[],0,today).length,0);
});
