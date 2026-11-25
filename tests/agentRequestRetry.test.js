import test from "node:test";
import assert from "node:assert/strict";
import {getOrCreateAgentRequestId,clearAgentRequestId} from "../src/lib/agentRequestRetry.js";

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
