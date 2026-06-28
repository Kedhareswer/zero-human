// fold(events) -> WorldState. Every number the dashboard shows is a projection of
// the append-only log, reproducible to the event. Replaying the log and asserting
// capBreaches === 0 is the core correctness check (see test/budget-cap.test.ts).

import { buildTree, descendants, type OrgTree } from "./authority";
import type { StoredEvent } from "./events";
import type { AgentState, Authorities, Goal, OrgState } from "./types";

export interface AgentView {
  positionId: string;
  agentId: string;
  name: string;
  provider: string;
  model: string;
  capCents: number;
  usedCents: number;
  reservedCents: number;
  remainingCents: number;
  state: AgentState;
  capabilities: string[];
}

export interface PositionView {
  positionId: string;
  roleId: string;
  parentId: string | null;
  childIds: string[];
}

export interface ObjectiveView {
  objectiveId: string;
  title: string;
  parentId: string | null;
  weight: number;
  krValue: number;
}

export interface AssignmentView {
  assignmentId: string;
  assigner: string;
  assignee: string;
  task: string;
  status: "OPEN" | "DONE";
}

export interface WorkItemView {
  workItemId: string;
  assignmentId: string;
  positionId: string;
  kind: string;
  title: string;
  status: "PENDING_REVIEW" | "CORRECT" | "FLAGGED";
  citations: string[];
}

export interface ApprovalView {
  approvalId: string;
  toolUseId: string;
  positionId: string;
  routedTo: string;
  status: "PENDING" | "GRANTED" | "DENIED";
}

export interface LedgerEntry {
  seq: number;
  ts: number;
  positionId: string;
  kind: "reserve" | "settle" | "exhausted";
  deltaCents: number;
  reason: string;
}

export interface FeedItem {
  seq: number;
  ts: number;
  type: string;
  actor: string;
  summary: string;
}

export interface WorldState {
  org: { goal: Goal; state: OrgState; aggregateCapCents: number; usedCents: number };
  roles: Map<string, { name: string; authorities: Authorities }>;
  positions: Map<string, PositionView>;
  agents: Map<string, AgentView>;
  objectives: Map<string, ObjectiveView>;
  assignments: Map<string, AssignmentView>;
  workItems: Map<string, WorkItemView>;
  approvals: Map<string, ApprovalView>;
  ledger: LedgerEntry[];
  feed: FeedItem[];
  /** Number of times a settle drove usedCents above the cap — must be 0. */
  capBreaches: number;
  tree: OrgTree;
}

export function fold(events: StoredEvent[]): WorldState {
  const ws: WorldState = {
    org: { goal: { title: "" }, state: "DRAFT", aggregateCapCents: 0, usedCents: 0 },
    roles: new Map(),
    positions: new Map(),
    agents: new Map(),
    objectives: new Map(),
    assignments: new Map(),
    workItems: new Map(),
    approvals: new Map(),
    ledger: [],
    feed: [],
    capBreaches: 0,
    tree: { parent: new Map(), children: new Map() },
  };

  for (const e of events) {
    switch (e.type) {
      case "OrgCreated":
        ws.org.goal = e.goal;
        ws.org.aggregateCapCents = e.aggregateCapCents;
        break;
      case "ObjectiveAdded":
        ws.objectives.set(e.objectiveId, {
          objectiveId: e.objectiveId,
          title: e.title,
          parentId: e.parentId,
          weight: e.weight,
          krValue: 0,
        });
        break;
      case "RoleDefined":
        ws.roles.set(e.roleId, { name: e.name, authorities: e.authorities });
        break;
      case "PositionCreated":
        ws.positions.set(e.positionId, {
          positionId: e.positionId,
          roleId: e.roleId,
          parentId: e.parentId,
          childIds: [],
        });
        break;
      case "AgentHired":
        ws.agents.set(e.positionId, {
          positionId: e.positionId,
          agentId: e.agentId,
          name: e.name,
          provider: e.provider,
          model: e.model,
          capCents: e.monthlyCapCents,
          usedCents: 0,
          reservedCents: 0,
          remainingCents: e.monthlyCapCents,
          state: "CONFIGURED",
          capabilities: e.capabilities,
        });
        break;
      case "AgentStateChanged": {
        const a = ws.agents.get(e.positionId);
        if (a) a.state = e.state;
        break;
      }
      case "OrgStateChanged":
        ws.org.state = e.state;
        break;
      case "AssignmentDispatched":
        ws.assignments.set(e.assignmentId, {
          assignmentId: e.assignmentId,
          assigner: e.assignerPositionId,
          assignee: e.assigneePositionId,
          task: e.task,
          status: "OPEN",
        });
        break;
      case "BudgetReserved": {
        const a = ws.agents.get(e.positionId);
        if (a) {
          a.reservedCents += e.amountCents;
          a.remainingCents = a.capCents - a.usedCents - a.reservedCents;
        }
        ws.ledger.push({ seq: e.seq, ts: e.ts, positionId: e.positionId, kind: "reserve", deltaCents: e.amountCents, reason: "estimate-hold" });
        break;
      }
      case "BudgetSettled": {
        const a = ws.agents.get(e.positionId);
        if (a) {
          a.reservedCents -= e.reserveCents;
          a.usedCents += e.actualCents;
          a.remainingCents = a.capCents - a.usedCents - a.reservedCents;
          if (a.usedCents > a.capCents + 1e-6) ws.capBreaches++;
        }
        ws.org.usedCents += e.actualCents;
        ws.ledger.push({ seq: e.seq, ts: e.ts, positionId: e.positionId, kind: "settle", deltaCents: e.actualCents, reason: "turn" });
        break;
      }
      case "BudgetExhausted":
        ws.ledger.push({ seq: e.seq, ts: e.ts, positionId: e.positionId, kind: "exhausted", deltaCents: 0, reason: `needed ${e.neededCents.toFixed(2)} / ${e.remainingCents.toFixed(2)} left` });
        break;
      case "ApprovalRequested":
        ws.approvals.set(e.approvalId, {
          approvalId: e.approvalId,
          toolUseId: e.toolUseId,
          positionId: e.positionId,
          routedTo: e.routedTo,
          status: "PENDING",
        });
        break;
      case "ApprovalGranted": {
        const ap = ws.approvals.get(e.approvalId);
        if (ap) ap.status = "GRANTED";
        break;
      }
      case "ApprovalDenied": {
        const ap = ws.approvals.get(e.approvalId);
        if (ap) ap.status = "DENIED";
        break;
      }
      case "WorkSubmitted":
        ws.workItems.set(e.workItemId, {
          workItemId: e.workItemId,
          assignmentId: e.assignmentId,
          positionId: e.positionId,
          kind: e.kind,
          title: e.title,
          status: "PENDING_REVIEW",
          citations: e.citations,
        });
        break;
      case "WorkApproved": {
        const wi = ws.workItems.get(e.workItemId);
        if (wi) wi.status = "CORRECT";
        break;
      }
      case "WorkFlagged": {
        const wi = ws.workItems.get(e.workItemId);
        if (wi) wi.status = "FLAGGED";
        break;
      }
      case "AssignmentCompleted": {
        const asg = ws.assignments.get(e.assignmentId);
        if (asg) asg.status = "DONE";
        break;
      }
      case "KrUpdated": {
        const obj = ws.objectives.get(e.objectiveId);
        if (obj) obj.krValue = e.value;
        break;
      }
      default:
        break;
    }
    ws.feed.push({ seq: e.seq, ts: e.ts, type: e.type, actor: e.actor, summary: summarize(e) });
  }

  // Rebuild the org tree + child lists from positions.
  const edges = [...ws.positions.values()].map((p) => ({ positionId: p.positionId, parentId: p.parentId }));
  ws.tree = buildTree(edges);
  for (const p of ws.positions.values()) p.childIds = ws.tree.children.get(p.positionId) ?? [];

  return ws;
}

/** Subtree budget rollup: an agent's spend plus all its subordinates' spend. */
export function subtreeUsedCents(ws: WorldState, positionId: string): number {
  let total = ws.agents.get(positionId)?.usedCents ?? 0;
  for (const d of descendants(ws.tree, positionId)) total += ws.agents.get(d)?.usedCents ?? 0;
  return total;
}

function summarize(e: StoredEvent): string {
  switch (e.type) {
    case "OrgCreated":
      return `Goal: ${e.goal.title}`;
    case "AgentHired":
      return `Hired ${e.name} (${e.provider}/${e.model}) cap $${(e.monthlyCapCents / 100).toFixed(2)}`;
    case "AssignmentDispatched":
      return `${e.assignerPositionId} → ${e.assigneePositionId}: ${e.task}`;
    case "BudgetSettled":
      return `settled ${e.actualCents.toFixed(2)}¢ on ${e.positionId}`;
    case "BudgetExhausted":
      return `BUDGET STOP ${e.positionId} (needed ${e.neededCents.toFixed(2)}¢, ${e.remainingCents.toFixed(2)}¢ left)`;
    case "ApprovalRequested":
      return `approval ${e.approvalId} → ${e.routedTo}`;
    case "WorkSubmitted":
      return `${e.positionId} submitted ${e.kind}: ${e.title}`;
    case "AgentStateChanged":
      return `${e.positionId} → ${e.state}${e.reason ? ` (${e.reason})` : ""}`;
    case "OrgStateChanged":
      return `org → ${e.state}`;
    case "KrUpdated":
      return `KR ${e.objectiveId} = ${e.value} (${e.source})`;
    default:
      return e.type;
  }
}
