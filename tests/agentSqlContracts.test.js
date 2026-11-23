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
    "05_agent_direct_write_guard_NOT_APPLIED.sql",
    "06_agent_customer_rpc_NOT_APPLIED.sql",
    "07_trusted_margin_preview_NOT_APPLIED.sql",
    "08_agent_create_order_NOT_APPLIED.sql",
    "09_legacy_security_definer_guard_NOT_APPLIED.sql",
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
    assert.match(sql,new RegExp('drop policy if exists "'+table+'_delete" on public\\.'+table,"i"));
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

test("agent direct writes are denied even for self-owned rows", () => {
  const sql=read("05_agent_direct_write_guard_NOT_APPLIED.sql");
  for(const op of ["insert","update","delete"]){
    assert.match(sql,new RegExp("as restrictive for "+op+" to authenticated","i"));
  }
  for(const table of ["customers","orders","products","invoices","payments","quotes","credit_notes"]){
    assert.match(sql,new RegExp("['\"]"+table+"['\"]"));
  }
  assert.match(sql,/not exists \(select 1 from public\.sales_agent_profiles ap/);
  assert.match(sql,/ap\.auth_user_id = \(select auth\.uid\(\)\)/);
});

test("new-customer RPC uses owner ID from active profile and auto assignment", () => {
  const sql=read("06_agent_customer_rpc_NOT_APPLIED.sql");
  assert.match(sql,/v_agent_id uuid := auth\.uid\(\)/);
  assert.match(sql,/ap\.is_active = true/);
  assert.match(sql,/v_owner_id/);
  assert.match(sql,/unknown_customer_field/);
  assert.match(sql,/public\.sales_agent_customer_assignments/);
  assert.match(sql,/customer_request_id_in_use/);
  assert.doesNotMatch(sql,/p_customer->>'user_id'/);
  assert.match(sql,/revoke all on function public\.sales_agent_create_customer/);
});

test("server margin reads the existing product cost and rejects tampered totals", () => {
  const sql=read("07_trusted_margin_preview_NOT_APPLIED.sql");
  assert.doesNotMatch(sql,/sales_agent_verified_unit_costs/);
  assert.match(sql,/v_product\.buy_price/);
  assert.match(sql,/customer_not_assigned/);
  assert.match(sql,/cost_missing/);
  assert.match(sql,/sale_unit_needs_clarification/);
  assert.match(sql,/inconsistent_line_total/);
  assert.match(sql,/v_cost_agorot\s*:=\s*v_cost_agorot\s*\+\s*v_line_cost/);
  assert.match(sql,/40\*v_sales_agorot/);
  assert.match(sql,/revoke all on function public\.sales_agent_check_order_margin/);
});

test("agent order writer enforces 40%, immutable attribution and one delivery alert", () => {
  const sql=read("08_agent_create_order_NOT_APPLIED.sql");
  assert.match(sql,/ap\.is_active=true/);
  assert.match(sql,/customer_not_assigned/);
  assert.match(sql,/public\.sales_agent_check_order_margin/);
  assert.match(sql,/margin_below_minimum_request_exception/);
  assert.match(sql,/document_discount_not_yet_supported/);
  assert.match(sql,/public\.sales_agent_order_attributions/);
  assert.match(sql,/public\.sales_agent_delivery_alerts/);
  assert.match(sql,/on conflict\(order_id\) do nothing/);
  assert.match(sql,/false,false,v_agent_name/);
  assert.match(sql,/revoke all on function public\.sales_agent_create_order/);
  assert.doesNotMatch(sql,/public\.save_order_with_inventory\(/);
});

test("legacy privileged write APIs have a deny-agent gate", () => {
  const sql=read("09_legacy_security_definer_guard_NOT_APPLIED.sql");
  const names=[
    "create_order_with_inventory","save_order_with_inventory",
    "allocate_payment_across_invoices","credit_note_confirm",
    "credit_note_reserve","credit_note_resolve","credit_note_return_lines",
  ];
  for(const name of names) {
    assert.match(sql,new RegExp("CREATE OR REPLACE FUNCTION public\\."+name+"\\("));
  }
  assert.equal((sql.match(/agent_legacy_rpc_forbidden/g)||[]).length,7);
  assert.equal((sql.match(/SECURITY DEFINER/g)||[]).length,7);
  assert.equal((sql.match(/ap\.auth_user_id = \(SELECT auth\.uid\(\)\)/g)||[]).length,7);
});
