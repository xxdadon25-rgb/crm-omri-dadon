import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const file=readFileSync(new URL("../src/pages/AgentDashboard.jsx",import.meta.url),"utf8");

test("agent dashboard counts the entire delivery queue, including null fulfilled states",()=>{
  assert.match(file,/supabase\.from\("orders"\)\.select\("id",\{count:"exact",head:true\}\)\s*\.or\("fulfilled\.is\.null,fulfilled\.eq\.false"\)/);
  assert.match(file,/pendingDeliveries:pendingDeliveries\.count\?\?0/);
  assert.doesNotMatch(file,/\.limit\(500\)/);
  assert.doesNotMatch(file,/orders\.data.*\.filter\(/);
});

test("dashboard remains restricted to authenticated active agent workspace",()=>{
  assert.match(file,/AGENT_FEATURES_ENABLED && crmRole==="agent"/);
  assert.match(file,/enabled:allowed/);
  assert.match(file,/if\(!allowed\)return/);
});
