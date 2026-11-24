import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const manifest=JSON.parse(root("supabase/agent-foundation/RELEASE_MANIFEST_REVIEW_ONLY.json"));
const workflow=root(".github/workflows/agent-foundation-tests.yml");
const released=manifest.phases.flatMap(p=>p.files);
const inCI=[...workflow.matchAll(/"([^"\n]*supabase\/agent-foundation\/[^"\n]*_NOT_APPLIED\.sql)"/g)]
 .map(x=>x[1]);

test("review-only manifest covers every CI-tested migration exactly once",()=>{
 assert.equal(manifest.production_execution,"PROHIBITED_UNTIL_SEPARATE_EXPLICIT_OWNER_APPROVAL");
 assert.equal(inCI.length,27);
 assert.equal(released.length,inCI.length);
 assert.equal(new Set(released).size,released.length);
 assert.deepEqual([...released].sort(),[...inCI].sort());
 assert.ok(released.every(p=>p.endsWith("_NOT_APPLIED.sql")));
 assert.ok(released.every(p=>!p.startsWith("tests/")));
});
test("release phases protect user-facing PDF links and manager number counters",()=>{
 const ids=manifest.phases.map(p=>p.id);
 assert.deepEqual(ids,["core","public_docs_security","legacy_counter_security"]);
 for(const phase of manifest.phases){
  assert.ok(Array.isArray(phase.requires)&&phase.requires.length>=3);
  assert.ok(phase.requires.some(x=>/approval|rehearsal|compatibility|verify/i.test(x)));
 }
 const publicPhase=manifest.phases[1];
 const counterPhase=manifest.phases[2];
 assert.ok(publicPhase.requires.some(x=>/3 Edge PDF/.test(x)));
 assert.ok(publicPhase.requires.some(x=>/anonymous customer/.test(x)));
 assert.ok(counterPhase.requires.some(x=>/manager identities seeded/.test(x)));
 const p25=publicPhase.files.findIndex(f=>f.includes("/25_public_quote_access"));
 const p27=publicPhase.files.findIndex(f=>f.includes("/27_public_business"));
 assert.ok(p25>=0&&p27>p25);
 const p24=counterPhase.files.findIndex(f=>f.includes("/24_legacy_sequences"));
 const p26=counterPhase.files.findIndex(f=>f.includes("/26_manager_only"));
 assert.ok(p24>=0&&p26>p24);
});
test("trusted SQL dependency order is documented and no launch flag is enabled",()=>{
 const core=manifest.phases[0].files;
 const index=n=>core.findIndex(f=>f.includes("/"+n+"_"));
 const before=(a,b)=>{
  assert.ok(index(a)>=0 && index(b)>=0 && index(a)<index(b),
    "missing dependency ordering "+a+" -> "+b);
 };
 before("01","03");before("06","08");before("07","08");
 before("14","08");before("08","10");before("10","11");
 before("13","15");before("16","20");before("20","21");
 before("21","22");before("15","17");before("17","18");
 assert.doesNotMatch(JSON.stringify(manifest),/VITE_ENABLE_SALES_AGENTS\s*=\s*true/);
});
