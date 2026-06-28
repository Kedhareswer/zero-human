// Pure deterministic policy decision point (PDP). Purity makes every governance
// decision replay-verifiable. Least privilege: a tool the agent wasn't granted is
// denied; irreversible/spend-incurring tools require human/manager approval.

import type { Decision } from "../core/types";

/** Tools always available to any agent (org-level communication/delegation). */
export const ALWAYS_ALLOWED = new Set(["submit_work", "ask_manager"]);

/** Tools whose execution requires an approval gate (irreversible / spend / hiring). */
export const REQUIRE_APPROVAL = new Set([
  "deploy",
  "send_email",
  "spend_ad",
  "charge_card",
  "merge_pr",
  "open_requisition",
]);

export interface PolicyContext {
  tool: string;
  /** Domain tools this agent was granted at hire time. */
  capabilities: string[];
  /** True if the agent's role may delegate (gates assign_task). */
  canDelegate: boolean;
}

export interface PolicyDecision {
  decision: Decision;
  matchedRule: string;
}

export function decide(ctx: PolicyContext): PolicyDecision {
  if (REQUIRE_APPROVAL.has(ctx.tool)) {
    return { decision: "REQUIRE_APPROVAL", matchedRule: `gated:${ctx.tool}` };
  }
  if (ctx.tool === "assign_task") {
    return ctx.canDelegate
      ? { decision: "ALLOW", matchedRule: "authority:can_delegate" }
      : { decision: "DENY", matchedRule: "authority:no_delegate" };
  }
  if (ALWAYS_ALLOWED.has(ctx.tool)) {
    return { decision: "ALLOW", matchedRule: "org-tool" };
  }
  if (ctx.capabilities.includes(ctx.tool)) {
    return { decision: "ALLOW", matchedRule: "capability-granted" };
  }
  return { decision: "DENY", matchedRule: "capability-not-granted" };
}
