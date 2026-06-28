// The append-only event union. Everything that happens is one of these, and all
// read-state is fold(events). The log is simultaneously the audit trail, the
// observability feed, and the replay-test fixture.

import type { AgentState, Authorities, AuthorityBasis, Decision, Goal, OrgState } from "./types";
import type { UsageRecord } from "./usage";

export interface EventMeta {
  orgId: string;
  /** positionId, "human", or "kernel". */
  actor: string;
  correlationId?: string;
}

/** Common envelope assigned by the store on append. */
export interface Envelope {
  id: string;
  seq: number;
  ts: number;
  orgId: string;
  actor: string;
  correlationId?: string;
  prevHash: string;
  hash: string;
}

export type EventPayload =
  | { type: "OrgCreated"; goal: Goal; aggregateCapCents: number }
  | { type: "ObjectiveAdded"; objectiveId: string; title: string; parentId: string | null; weight: number }
  | { type: "RoleDefined"; roleId: string; name: string; authorities: Authorities }
  | { type: "PositionCreated"; positionId: string; roleId: string; parentId: string | null }
  | {
      type: "AgentHired";
      positionId: string;
      agentId: string;
      name: string;
      provider: string;
      model: string;
      systemPrompt: string;
      monthlyCapCents: number;
      capabilities: string[];
    }
  | { type: "AgentStateChanged"; positionId: string; state: AgentState; reason?: string }
  | { type: "StrategyApproved"; approvedBy: string; contentHash: string }
  | { type: "OrgStateChanged"; state: OrgState }
  | {
      type: "AssignmentDispatched";
      assignmentId: string;
      assignerPositionId: string;
      assigneePositionId: string;
      objectiveId: string | null;
      task: string;
      authorityBasis: AuthorityBasis;
    }
  | { type: "TurnStarted"; turnId: string; assignmentId: string; positionId: string }
  | { type: "BudgetReserved"; turnId: string; positionId: string; amountCents: number }
  | {
      type: "BudgetSettled";
      turnId: string;
      positionId: string;
      reserveCents: number;
      actualCents: number;
      usage: UsageRecord;
    }
  | { type: "BudgetExhausted"; turnId: string; positionId: string; neededCents: number; remainingCents: number }
  | { type: "ToolRequested"; turnId: string; positionId: string; toolUseId: string; tool: string; input: Record<string, unknown> }
  | { type: "PolicyDecided"; toolUseId: string; decision: Decision; matchedRule: string }
  | { type: "ApprovalRequested"; approvalId: string; toolUseId: string; positionId: string; routedTo: string; contentHash: string }
  | { type: "ApprovalGranted"; approvalId: string; by: string }
  | { type: "ApprovalDenied"; approvalId: string; by: string; reason: string }
  | { type: "ToolExecuted"; toolUseId: string; turnId: string; ok: boolean; summary: string }
  | { type: "WorkSubmitted"; workItemId: string; assignmentId: string; positionId: string; kind: string; title: string; citations: string[] }
  | { type: "WorkApproved"; workItemId: string; by: string }
  | { type: "WorkFlagged"; workItemId: string; by: string; reasons: string[] }
  | { type: "AssignmentCompleted"; assignmentId: string; positionId: string }
  | { type: "KrUpdated"; objectiveId: string; value: number; source: string }
  | { type: "AuditNote"; message: string };

export type EventType = EventPayload["type"];

/** A persisted event = payload + envelope. */
export type StoredEvent = EventPayload & Envelope;

/** Narrow a stored event to a specific payload type. */
export function isEvent<T extends EventType>(
  e: StoredEvent,
  type: T,
): e is StoredEvent & Extract<EventPayload, { type: T }> {
  return e.type === type;
}

const ENVELOPE_KEYS = new Set(["id", "seq", "ts", "orgId", "actor", "correlationId", "prevHash", "hash"]);

/** Recover the payload portion of a stored event (strips the envelope). */
export function payloadOf(e: StoredEvent): EventPayload {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(e)) if (!ENVELOPE_KEYS.has(k)) out[k] = (e as unknown as Record<string, unknown>)[k];
  return out as EventPayload;
}
