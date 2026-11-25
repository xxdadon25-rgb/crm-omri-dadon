import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=(p)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const auth=read("src/lib/AuthContext.jsx");
const guard=read("src/components/ProtectedRoute.jsx");
const routes=read("src/lib/agentPermissions.js");
const login=read("src/pages/Login.jsx");

test("session transitions invalidate stale agent and manager role checks",()=>{
 assert.match(auth,/authRevision\s*=\s*useRef\(0\)/);
 assert.match(auth,/revision\s*=\s*\+\+authRevision\.current/);
 assert.match(auth,/if\s*\(revision !== authRevision\.current\) return/);
 assert.match(auth,/setIsLoadingAuth\(true\);\s*setIsStaff\(null\);\s*setCrmRole\(null\)/);
 assert.match(auth,/setCrmRole\(role\);\s*setIsStaff\(!!role\);\s*setIsLoadingAuth\(false\)/);
 assert.match(auth,/catch\s*\{[\s\S]*?applyRole\(null\)/);
 assert.match(auth,/authRevision\.current \+= 1; subscription\.unsubscribe\(\)/);
 assert.match(auth,/const logout[\s\S]*?authRevision\.current \+= 1/);
});
test("agent verification checks active trusted server profile, not user_metadata",()=>{
 assert.match(auth,/\.from\('sales_agent_profiles'\)/);
 assert.match(auth,/\.eq\('auth_user_id', u\.id\)/);
 assert.match(auth,/\.eq\('is_active', true\)/);
 assert.match(guard,/isLoadingAuth \|\| !authChecked \|\| isStaff === null/);
 assert.match(guard,/canAccessCrmRoute\(crmRole, location\.pathname\)/);
 assert.match(routes,/role !== "agent"/);
 assert.match(login,/supabase\.auth\.signInWithPassword/);
});
