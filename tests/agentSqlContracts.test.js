import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dir = new URL("../supabase/agent-foundation/", import.meta.url);
const read = name => readFileSync(new URL(name, dir), "utf8");

test("all database security changes remain explicitly unapplied", () => {
  const files = [
    "01_schema_NOT_APPLIED.sql",
    "02_exception_decisions_NOT_APPLIED.sql",
    "03_agent_read_rls_NOT_APPLIED.sql",
    "04_legacy_delete_hardening_NOT_APPLIED.sql",
  ];
  for (const file of files) {
    const sql=read(file);
    assert.match(sql,/DO NOT APPLY|DO NOT EXECUTE|NOT APPLIED|PREPARATION ONLY|STAGED ONLY/i,file);
    assert.match(sql,/\bbegin;/i,file);
    assert.match(sql,/\bcommit;/i,file);
  }
});

test("read policies cover assigned client history but no agent data mutation", () => {
  const sql=read("03_agent_read_rls_NOT_APPLIED.sql");
  const entities=[
    "customers","orders","invoices","payments","quotes",
    "credit_notes","products","customer_product_prices",
  ];
  for (const table of entities) {
    assert.match(sql,new RegExp('create policy "[^"]+" on public\\.'+table+'\\s+for select to authenticated',"i"),table);
  }
  assert.doesNotMatch(sql,/\bfor\s+(insert|update|delete|all)\b/i);
  assert.match(sql,/ap\.is_active = true/i);
  assert.match(sql,/ca\.agent_auth_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql,/ap\.owner_auth_id = (customers|orders|invoices|payments|quotes|credit_notes)\.user_id/i);
});

test("old public unrestricted DELETE policies are removed in staged hardening", () => {
  const sql=read("04_legacy_delete_hardening_NOT_APPLIED.sql");
  for(const table of ["customers","products"]){
    assert.match(sql,new RegExp('drop policy if exists " '+table+'_delete"'.trim().replace(' " ',' "'))); // overwritten below
    assert.match(sql,new RegExp('create policy "'+table+'_delete" on public\\.'+table+'\\s+for delete to authenticated\\s+using \\(user_id = \\(select auth\\.uid\\(\\)\\)\\)',"i"));
  }
  assert.doesNotMatch(sql,/\bcreate policy\b[\s\S]*\busing\s*\(true\)/i);
});

test("decision function demands a manager, current pending state and named approver", () => {
  const sql=read("02_exception_decisions_NOT_APPLIED.sql");
  assert.match(sql,/p_approver_label not in \('עומרי','בן'\)/);
  assert.match(sql,/e\.status = 'pending'/);
  assert.match(sql,/m\.auth_user_id = v_manager/);
  assert.match(sql,/m\.owner_auth_id = p\.owner_auth_id/);
  assert.match(sql,/return v_updated is not null/);
});
