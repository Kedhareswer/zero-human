// Folds a store's event log into a JSON-serializable snapshot for the dashboard
// (server component + /api/state). snapshotOf works over any Store; runDemoSnapshot
// builds + runs the $0 company first (used by the CLI and /api/state).

import { fold, subtreeUsedCents, type AgentView } from "../core/fold";
import type { Store } from "../kernel/store";
import { buildResearchCompany } from "./company";

export interface Snapshot {
  goal: string;
  state: string;
  ceoDone: boolean;
  agents: AgentView[];
  positions: Array<{ positionId: string; parentId: string | null; childIds: string[]; roleId: string }>;
  workItems: Array<{ workItemId: string; positionId: string; kind: string; title: string; status: string; citations: number }>;
  approvals: Array<{ approvalId: string; positionId: string; routedTo: string; status: string }>;
  feed: Array<{ seq: number; type: string; actor: string; summary: string }>;
  capBreaches: number;
  hardStops: number;
  totals: { usedCents: number; capCents: number };
}

export async function snapshotOf(store: Store, root: string): Promise<Snapshot> {
  const ws = fold(await store.events());
  const ceoDone = [...ws.assignments.values()].some((a) => a.assignee === root && a.status === "DONE");
  return {
    goal: ws.org.goal.title,
    state: ws.org.state,
    ceoDone,
    agents: [...ws.agents.values()],
    positions: [...ws.positions.values()].map((p) => ({ positionId: p.positionId, parentId: p.parentId, childIds: p.childIds, roleId: p.roleId })),
    workItems: [...ws.workItems.values()].map((w) => ({ workItemId: w.workItemId, positionId: w.positionId, kind: w.kind, title: w.title, status: w.status, citations: w.citations.length })),
    approvals: [...ws.approvals.values()].map((a) => ({ approvalId: a.approvalId, positionId: a.positionId, routedTo: a.routedTo, status: a.status })),
    feed: ws.feed.map((f) => ({ seq: f.seq, type: f.type, actor: f.actor, summary: f.summary })),
    capBreaches: ws.capBreaches,
    hardStops: ws.feed.filter((f) => f.type === "BudgetExhausted").length,
    totals: { usedCents: subtreeUsedCents(ws, root), capCents: ws.org.aggregateCapCents },
  };
}

export async function runDemoSnapshot(): Promise<Snapshot> {
  const { store, engine, root } = await buildResearchCompany();
  await engine.run(root);
  return snapshotOf(store, root);
}
