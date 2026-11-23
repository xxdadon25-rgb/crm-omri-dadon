import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_EXCEPTION_APPROVERS,
  normalizeExceptionApprover,
  canSubmitExceptionDecision,
  exceptionDecisionTransition,
} from "../src/lib/agentExceptionApproval.js";

test("approver must explicitly select one of two shared-account labels", () => {
  assert.deepEqual(AGENT_EXCEPTION_APPROVERS, ["עומרי", "בן"]);
  assert.equal(normalizeExceptionApprover(" בן "), "בן");
  assert.equal(normalizeExceptionApprover("עומרי"), "עומרי");
  for (const input of ["", "אחר", "admin", null, undefined, 1]) {
    assert.equal(normalizeExceptionApprover(input), null);
  }
});

test("requires an authenticated manager, a pending request and a valid decision", () => {
  const valid = { authenticatedManager:true, status:"pending", selectedApprover:"בן", decision:"approved" };
  assert.equal(canSubmitExceptionDecision(valid), true);
  assert.equal(canSubmitExceptionDecision({...valid,authenticatedManager:false}), false);
  assert.equal(canSubmitExceptionDecision({...valid,status:"approved"}), false);
  assert.equal(canSubmitExceptionDecision({...valid,status:"rejected"}), false);
  assert.equal(canSubmitExceptionDecision({...valid,selectedApprover:""}), false);
  assert.equal(canSubmitExceptionDecision({...valid,decision:"pending"}), false);
  assert.equal(canSubmitExceptionDecision({...valid,decision:"rejected"}), true);
});

test("decision records selected approver without altering input request", () => {
  const original = { id:"request-123", status:"pending", request_hash:"abc" };
  const result = exceptionDecisionTransition(original, "approved", "עומרי");
  assert.equal(result.status,"approved");
  assert.equal(result.approved_by_label,"עומרי");
  assert.equal(result.request_hash,"abc");
  assert.equal(original.status,"pending");
  assert.equal(original.approved_by_label,undefined);
});

test("a request already decided cannot be decided again", () => {
  const first=exceptionDecisionTransition({id:"1",status:"pending"},"rejected","בן");
  assert.equal(first.status,"rejected");
  assert.equal(exceptionDecisionTransition(first,"approved","עומרי"),null);
});
