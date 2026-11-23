/**
 * Frontend navigation gating ONLY. All data/API authorization must be
 * enforced server-side with RLS and hardened RPCs before activating agents.
 *
 * Explicit allowlist; new routes are forbidden for agents by default.
 * Managers keep every existing route (no regression).
 */
export const AGENT_ALLOWED_ROUTE_PATHS = Object.freeze([
  "/",
  "/sales-catalog",
  "/product-catalog",
  "/customers",
  "/orders",
  "/quotes",
  "/invoices",
  "/customer-ledger",
  "/debt-summary",
]);

function normalizePath(pathname) {
  if (typeof pathname !== "string") return null;
  const path = pathname.split("?")[0].split("#")[0];
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return path.length > 1 ? path.replace(/\/+$/, "") : "/";
}

/**
 * Roles are resolved using trusted staff/agent profile checks.
 * This is NOT a credential validator and MUST NOT be used as an API guard.
 * @param {'manager'|'agent'|'customer'|null|undefined} role
 */
export function canAccessCrmRoute(role, pathname) {
  const path = normalizePath(pathname);
  if (!path) return false;
  if (role === "manager") return true;
  if (role !== "agent") return false;
  if (AGENT_ALLOWED_ROUTE_PATHS.includes(path)) return true;
  // The customer profile is nested; never authorize arbitrary /customers/*
  // e.g. another manager's report route or a typo bypass.
  if (/^\/customers\/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(path)) {
    return true;
  }
  // Quote editor is reachable from a separate route.
  return path === "/quotes/new" || path === "/quotes/edit";
}

/**
 * Applies menu restriction to existing Sidebar group objects.
 * Never mutates imported navigation metadata.
 */
export function permittedNavigationGroups(groups, role) {
  if (!Array.isArray(groups)) return [];
  return groups
    .map(group => ({
      ...group,
      items: (group.items || []).filter(item => canAccessCrmRoute(role, item.path)),
    }))
    .filter(group => group.items.length > 0);
}

/**
 * Default-deny for untrusted or disabled agent state.
 * Both role AND active flag must be confirmed by the server.
 */
export function resolveCrmRole({ verifiedManager = false, activeAgent = false } = {}) {
  if (verifiedManager) return "manager";
  if (activeAgent) return "agent";
  return null;
}
