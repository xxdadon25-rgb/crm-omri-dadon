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
    "10_margin_exception_request_NOT_APPLIED.sql",
    "11_approved_exception_order_NOT_APPLIED.sql",
    "12_delivery_alert_sync_NOT_APPLIED.sql",
    "13_commission_preview_NOT_APPLIED.sql",
    "14_commission_rate_snapshot_NOT_APPLIED.sql",
    "15_commission_reconciliation_NOT_APPLIED.sql",
    "16_manager_agent_registry_NOT_APPLIED.sql",
    "17_commission_payout_record_NOT_APPLIED.sql",
    "18_commission_balance_NOT_APPLIED.sql",
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
  assert.ok((sql.match(/SECURITY DEFINER/g)||[]).length >= 7);
  assert.equal((sql.match(/ap\.auth_user_id = \(SELECT auth\.uid\(\)\)/g)||[]).length,7);
});

test("approved exception creates only one order against unchanged cost snapshot", () => {
  const sql=read("11_approved_exception_order_NOT_APPLIED.sql");
  assert.match(sql,/for update/i);
  assert.match(sql,/created_order_id/);
  assert.match(sql,/exception_already_consumed/);
  assert.match(sql,/exception_not_approved/);
  assert.match(sql,/exception_payload_or_prices_changed/);
  assert.match(sql,/sales_agent_check_order_margin/);
  assert.match(sql,/extensions\.digest/);
  assert.match(sql,/sales_agent_order_attributions/);
  assert.match(sql,/sales_agent_delivery_alerts/);
  assert.match(sql,/false,false,v_agent_name/);
  assert.match(sql,/revoke all on function public\.sales_agent_create_approved_exception_order/);
  assert.doesNotMatch(sql,/save_order_with_inventory\(/);
});


test("server builds trusted catalogue item fields, not browser-supplied labels", () => {
  for (const file of [
    "08_agent_create_order_NOT_APPLIED.sql",
    "11_approved_exception_order_NOT_APPLIED.sql",
  ]) {
    const sql=read(file);
    for (const field of ["name","sku","unit","buy_price","meters_per_roll"]) {
      assert.match(sql,new RegExp("'"+field+"',p\\."+field),file);
    }
    assert.match(sql,/jsonb_build_object\(\s*'product_id',p\.id/);
    assert.doesNotMatch(sql,/x\.value\s*-\s*'buy_price'/);
  }
});

test("commission preview is auth-scoped and refuses credit and overpaid ambiguity", () => {
  const sql=read("13_commission_preview_NOT_APPLIED.sql");
  for(const fragment of [
    "not_authorized","missing_historical_agent_rate",
    "invoice_overpaid_needs_allocation","credit_note_needs_reconciliation",
    "multi_order_invoice_needs_allocation","commission_pct_attributed",
  ])assert.ok(sql.includes(fragment),fragment);
  assert.doesNotMatch(sql,/\binsert into public\.sales_agent_commission_entries\b/i);
});

test("commission ledger is append-only and manager-only with one reversal source key", () => {
  const sql=read("15_commission_reconciliation_NOT_APPLIED.sql");
  assert.match(sql,/m\.auth_user_id=auth\.uid\(\)/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/'settlement:'\|\|v_row\.payment_id/);
  assert.match(sql,/'reversal:'\|\|v_entry\.id/);
  assert.match(sql,/before update or delete on public\.sales_agent_commission_entries/);
});

test("new agents remain disabled and portal identities cannot become sales agents", () => {
  const sql=read("16_manager_agent_registry_NOT_APPLIED.sql");
  assert.match(sql,/portal_identity_cannot_be_agent/);
  assert.match(sql,/customer_not_owned/);
  assert.match(sql,/p_commission_pct,false\)/);
  assert.match(sql,/public\.sales_agent_disable/);
  assert.doesNotMatch(sql,/is_active\s*=\s*true/);
});

test("recorded commission payout is never a bank transaction", () => {
  const sql=read("17_commission_payout_record_NOT_APPLIED.sql");
  assert.match(sql,/commission_payout_exceeds_available/);
  assert.match(sql,/sales_agent_reconcile_commissions/);
  assert.match(sql,/recorded_by_label/);
  assert.match(sql,/p_payout_id/);
  assert.match(sql,/not_manager/);
  assert.doesNotMatch(sql,/from public\.payments|insert into public\.payments/i);
});

test("commission balance uses complete server ledger and payout totals", () => {
  const sql=read("18_commission_balance_NOT_APPLIED.sql");
  assert.match(sql,/sales_agent_commission_entries/);
  assert.match(sql,/sales_agent_commission_payouts/);
  assert.match(sql,/not_authorized/);
  assert.match(sql,/current_balance/);
  assert.doesNotMatch(sql,/\blimit\s+\d+\b/i);
});

test("order request UUID replay rejects changed monetary fields and notes", () => {
  const sql=read("08_agent_create_order_NOT_APPLIED.sql");
  assert.match(sql,/create or replace function public\.sales_agent_same_order_request/);
  assert.equal((sql.match(/order_request_payload_changed/g)||[]).length,2);
  assert.match(sql,/p_saved\.notes is distinct from p_notes/);
  for(const f of ["quantity","unit_price","discount","total","product_id"]) {
    assert.match(sql,new RegExp("'"+f+"'"));
  }
  assert.match(sql,/revoke all on function public\.sales_agent_same_order_request/);
});

test("server rejects unverified packaging price bases and fractional-cent totals", () => {
  const sql=read("07_trusted_margin_preview_NOT_APPLIED.sql");
  assert.match(sql,/v_product\.buy_price <= 0/);
  assert.match(sql,/v_product\.buy_price > v_unit_price\*3/);
  assert.match(sql,/v_product\.sell_price > v_product\.buy_price\*12/);
  assert.match(sql,/v_unit_price > v_product\.buy_price\*12/);
  assert.match(sql,/v_line_total is distinct from round\(v_line_total,2\)/);
  assert.match(sql,/sale_unit_needs_clarification/);
  assert.match(sql,/inconsistent_line_total/);
});


test("agent-only product block cannot alter owner catalogue and is checked by server", () => {
  const sql=read("19_agent_only_product_blocks_NOT_APPLIED.sql");
  assert.match(sql,/create table if not exists public\.sales_agent_product_blocks/);
  assert.match(sql,/public\.sales_agent_is_manager\(owner_auth_id\)/);
  assert.match(sql,/auth_user_id=v_owner and m\.owner_auth_id=v_owner/);
  assert.match(sql,/public\.sales_agent_set_product_block/);
  assert.doesNotMatch(sql,/\bupdate\s+public\.products\b/i);
  assert.doesNotMatch(sql,/\bdelete\s+from\s+public\.products\b/i);
  const margin=read("07_trusted_margin_preview_NOT_APPLIED.sql");
  assert.match(margin,/from public\.sales_agent_product_blocks b/);
  assert.match(margin,/agent_product_blocked/);
});
