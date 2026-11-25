import test from "node:test";
import assert from "node:assert/strict";
import {getOrCreateAgentRequestId,clearAgentRequestId,readPendingAgentDraft} from "../src/lib/agentRequestRetry.js";

function storage(){
 const entries=new Map();
 return {
  getItem:key=>entries.get(key)??null,
  setItem:(key,value)=>entries.set(key,value),
  removeItem:key=>entries.delete(key),
  entries,
 };
}
const who="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const nextId=(()=>{let n=0;return()=>`00000000-0000-4000-8000-${String(++n).padStart(12,"0")}`;})();

test("ambiguous network result: same agent order retried after reload keeps UUID",()=>{
 const tab=storage();
 const request={storage:tab,userId:who,kind:"order",signature:'{"customer":"A","items":[1]}',createId:nextId};
 const sent=getOrCreateAgentRequestId(request);
 assert.equal(getOrCreateAgentRequestId({...request,createId:()=>{throw Error("duplicate generated")}}),sent);
 clearAgentRequestId({...request,signature:"wrong",id:sent});
 assert.equal(getOrCreateAgentRequestId(request),sent);
 clearAgentRequestId({...request,id:sent});
 assert.notEqual(getOrCreateAgentRequestId(request),sent);
});
test("same browser never reuses a different agent, action or changed payload ID",()=>{
 const tab=storage();
 const base={storage:tab,userId:who,kind:"order",signature:"draft-1",createId:nextId};
 const original=getOrCreateAgentRequestId(base);
 assert.notEqual(getOrCreateAgentRequestId({...base,userId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}),original);
 assert.notEqual(getOrCreateAgentRequestId({...base,kind:"approved"}),original);
 assert.notEqual(getOrCreateAgentRequestId({...base,signature:"draft-2"}),original);
});
test("missing storage falls back to generated UUID without crashing",()=>{
 const bad={getItem(){throw Error("disabled")},setItem(){throw Error("disabled")},removeItem(){throw Error("disabled")}};
 const req={storage:bad,userId:who,kind:"order",signature:"draft-3",createId:nextId};
 assert.match(getOrCreateAgentRequestId(req),/^[0-9a-f-]{36}$/i);
 assert.doesNotThrow(()=>clearAgentRequestId({...req,id:nextId()}));
});

test("pending order draft survives reload only in the matching agent tab",()=>{
 const tab=storage();
 const draft={customerId:"11111111-1111-4111-8111-111111111111",
   items:[{product_id:"44444444-4444-4444-8444-444444444444",quantity:10,unit_price:10,total:100}],
   manualGrossTotal:"",reason:""};
 const signature=JSON.stringify({customerId:draft.customerId,items:draft.items})+":regular";
 const params={storage:tab,userId:who,kind:"order",signature,draft,createId:nextId};
 const id=getOrCreateAgentRequestId(params);
 assert.deepEqual(readPendingAgentDraft({storage:tab,userId:who}),
  {...draft,kind:"order",signature});
 assert.equal(readPendingAgentDraft({storage:tab,userId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}),null);
 assert.equal(getOrCreateAgentRequestId({...params,createId:()=>{throw Error("new ID")}}),id);
 clearAgentRequestId({...params,id});
 assert.equal(readPendingAgentDraft({storage:tab,userId:who}),null);
});
test("a corrupted or mismatched pending payload is not restored",()=>{
 const tab=storage();
 const draft={customerId:"11111111-1111-4111-8111-111111111111",items:[{quantity:1}],
   manualGrossTotal:"",reason:""};
 getOrCreateAgentRequestId({storage:tab,userId:who,kind:"order",signature:"not-matching",
   draft,createId:nextId});
 assert.equal(readPendingAgentDraft({storage:tab,userId:who}),null);
});
