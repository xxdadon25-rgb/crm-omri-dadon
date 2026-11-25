/**
 * Presentation-only agent order decision. Actual authorization, product
 * ownership, cost normalization, and 40% floor require trusted DB enforcement
 * before agent accounts are enabled.
 */
import { documentProfit } from "@/lib/documentProfit";
import { evaluateMarginResult } from "@/lib/agentMarginDecision";

export { AGENT_MIN_GROSS_MARGIN } from "@/lib/agentMarginDecision";
export {
  DEFAULT_AGENT_COMMISSION_PERCENT,
  commissionForSettledGrossPayment,
} from "@/lib/agentCommission";

export function evaluateAgentOrder(items) {
  return evaluateMarginResult(documentProfit(items));
}
