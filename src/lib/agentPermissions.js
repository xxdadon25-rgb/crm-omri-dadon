/**
 * Frontend navigation gating ONLY. All data/API authorization must be
 * enforced server-side with RLS and hardened RPCs before activating agents.
 *
 * Explicit allowlist; new routes are forbidden for agents by default.
 * Managers keep every existing route (no regression).
 */
// Agent-facing screens are dedicated and read/write only through guarded RPCs.
// Legacy CRM pages contain manager mutations and must remain manager-only.
export const AGENT_ALLOWED_ROUTE_PATHS = Object.freeze([
  "/agent-dashboard",
  "/agent-orders",
  "/agent-customers",
  "/agent-collections",
  "/agent-commissions",
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
  return AGENT_ALLOWED_ROUTE_PATHS.includes(path);
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
