import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_ALLOWED_ROUTE_PATHS, canAccessCrmRoute,
  permittedNavigationGroups, resolveCrmRole,
} from "../src/lib/agentPermissions.js";

test("unknown roles cannot access manager or agent pages", () => {
  for (const role of [null, undefined, "customer", "staff", "admin", ""]) {
    for (const path of ["/", "/orders", "/customers"]) {
      assert.equal(canAccessCrmRoute(role, path), false);
    }
  }
});

test("manager retains all valid existing CRM pages", () => {
  for (const path of ["/", "/orders", "/inventory", "/settings", "/revach-admin", "/backup"]) {
    assert.equal(canAccessCrmRoute("manager", path), true);
  }
});

test("agent receives only dedicated safe workspace routes", () => {
  assert.deepEqual(AGENT_ALLOWED_ROUTE_PATHS, ["/agent-dashboard","/agent-orders","/agent-customers","/agent-collections","/agent-commissions"]);
  assert.equal(canAccessCrmRoute("agent","/agent-dashboard"),true);
  assert.equal(canAccessCrmRoute("agent","/agent-orders"),true);
  assert.equal(canAccessCrmRoute("agent","/agent-customers"),true);
  assert.equal(canAccessCrmRoute("agent","/agent-collections"),true);
  assert.equal(canAccessCrmRoute("agent","/agent-commissions"),true);
  for(const path of ["/","/orders","/quotes/new","/customers",
    "/invoices","/debt-summary","/customer-ledger",
    "/customers/01234567-89ab-4def-8123-456789abcdef"]) {
    assert.equal(canAccessCrmRoute("agent",path),false,path);
  }
});

test("agent denied admin, financial mutations and bypass URLs", () => {
  for (const path of [
    "/settings", "/inventory", "/suppliers", "/expenses", "/reports",
    "/api-settings", "/backup", "/revach-admin", "/quality-control",
    "/portal-access", "/documents", "/invoice-logs",
    "/import-products", "/price-migration", "/image-migration",
    "/customers/arbitrary", "/orders/someone-else", "/customers/../settings",
    "//settings", "settings", "/customers/a/b", "/unknown-route",
  ]) {
    assert.equal(canAccessCrmRoute("agent", path), false, path);
  }
});

test("navigation filtering leaves manager intact without mutating source", () => {
  const groups = [
    { label: "main", items: [{path:"/"},{path:"/settings"}] },
    { label: "sales", items: [{path:"/orders"},{path:"/suppliers"}] },
    { label: "hidden", items: [{path:"/backup"}] },
  ];
  const agent = permittedNavigationGroups(groups,"agent");
  assert.deepEqual(agent, []);
  assert.equal(groups[0].items.length,2);
  const manager=permittedNavigationGroups(groups,"manager");
  assert.deepEqual(manager.map(g=>g.items.length),[2,2,1]);
});

test("unverified or inactive profile is denied", () => {
  assert.equal(resolveCrmRole({verifiedManager:true}),"manager");
  assert.equal(resolveCrmRole({activeAgent:true}),"agent");
  assert.equal(resolveCrmRole({}),null);
  assert.equal(resolveCrmRole({activeAgent:false}),null);
});
