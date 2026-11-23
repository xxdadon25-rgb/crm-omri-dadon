/**
 * Approval identity is a human-selected label within ONE shared manager login.
 * It is a recorded declaration, not cryptographic proof of who clicked.
 * All real approval requests still require server verification of the signed-in
 * manager, binding hash, current costs, assignment and pending state.
 */
export const AGENT_EXCEPTION_APPROVERS = Object.freeze(["עומרי", "בן"]);

export function normalizeExceptionApprover(value) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return AGENT_EXCEPTION_APPROVERS.includes(candidate) ? candidate : null;
}

/**
 * Local UI guard: does not authorize a transaction.
 */
export function canSubmitExceptionDecision({
  authenticatedManager = false,
  status = null,
  selectedApprover = null,
  decision = null,
} = {}) {
  return authenticatedManager === true &&
    status === "pending" &&
    normalizeExceptionApprover(selectedApprover) !== null &&
    (decision === "approved" || decision === "rejected");
}

/**
 * Deterministic, small state transition for UI/tests. The DB must use one
 * atomic UPDATE ... WHERE status='pending' and confirm exactly one row.
 */
export function exceptionDecisionTransition(request, decision, selectedApprover) {
  if (!request || !canSubmitExceptionDecision({
    authenticatedManager: true,
    status: request.status,
    selectedApprover,
    decision,
  })) return null;
  return {
    ...request,
    status: decision,
    approved_by_label: normalizeExceptionApprover(selectedApprover),
  };
}
