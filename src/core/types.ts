// Core domain primitives for zero-human.
// The org chart is the runtime spine: mission cascades down reporting edges,
// results flow up, budgets roll up, approvals route to the nearest-common-ancestor.

export type OrgState = "DRAFT" | "PENDING_APPROVAL" | "RUNNING" | "PAUSED" | "STOPPED";

export type AgentState =
  | "CONFIGURED"
  | "RUNNING"
  | "IDLE"
  | "SUSPENDED" // budget exhausted / manual pause
  | "TERMINATED";

export type Decision = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export type AuthorityBasis = "subtree" | "approved-cross-team" | "human";

/** What a Role is permitted to do. Granted at hire time, checked at the tool layer. */
export interface Authorities {
  canHire: boolean;
  canDelegate: boolean;
  canApproveSpend: boolean;
  canApproveCrossTeam: boolean;
  canSpawnSubagent: boolean;
  maxSubordinates: number;
}

export const DEFAULT_AUTHORITIES: Authorities = {
  canHire: false,
  canDelegate: false,
  canApproveSpend: false,
  canApproveCrossTeam: false,
  canSpawnSubagent: false,
  maxSubordinates: 0,
};

/** A business goal: the single north star the whole org serves. */
export interface Goal {
  title: string;
  description?: string;
}
