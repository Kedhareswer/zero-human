// The $0 free-tier demo: a 3-agent "research & content" company that exercises the
// whole harness on the ScriptedAdapter — org tree, delegation/handoff, budget CAS,
// the hard kill-switch, review queue — without a key or a single token.
//
//   CEO ──assign──▶ Researcher (web_search → web_fetch → submit cited report)
//       ──assign──▶ Writer     (write_doc → [BUDGET STOP before submit])
//       ──submit── Go-to-market package
//
// The Writer is given a deliberately tiny cap so the hard stop fires mid-work.

import type { Authorities } from "../core/types";
import { Engine, type ApprovalResolver } from "../kernel/engine";
import { InMemoryStore } from "../kernel/store";
import { defaultToolRegistry } from "../kernel/tools";
import { ScriptedAdapter, type Script } from "../providers/scripted";
import type { TurnRequest } from "../providers/adapter";

export const POS = { ceo: "ceo", researcher: "researcher", writer: "writer" } as const;

const auth = (over: Partial<Authorities>): Authorities => ({
  canHire: false,
  canDelegate: false,
  canApproveSpend: false,
  canApproveCrossTeam: false,
  canSpawnSubagent: false,
  maxSubordinates: 0,
  ...over,
});

export interface BuiltCompany {
  store: InMemoryStore;
  engine: Engine;
  root: string;
}

export async function buildResearchCompany(opts: { approvalResolver?: ApprovalResolver } = {}): Promise<BuiltCompany> {
  const store = new InMemoryStore();
  const meta = { orgId: "org", actor: "human" };

  await store.append(
    { type: "OrgCreated", goal: { title: "Produce a publish-ready market report + content plan for a note-taking app." }, aggregateCapCents: 500 },
    meta,
  );
  await store.append({ type: "ObjectiveAdded", objectiveId: "obj1", title: "Ship the go-to-market package", parentId: null, weight: 100 }, meta);

  // Roles
  await store.append({ type: "RoleDefined", roleId: "role_ceo", name: "CEO", authorities: auth({ canHire: true, canDelegate: true, canApproveSpend: true, maxSubordinates: 8 }) }, meta);
  await store.append({ type: "RoleDefined", roleId: "role_analyst", name: "Web Research / Analyst", authorities: auth({}) }, meta);
  await store.append({ type: "RoleDefined", roleId: "role_writer", name: "Content Writer", authorities: auth({}) }, meta);

  // Positions (org-chart spine)
  await store.append({ type: "PositionCreated", positionId: POS.ceo, roleId: "role_ceo", parentId: null }, meta);
  await store.append({ type: "PositionCreated", positionId: POS.researcher, roleId: "role_analyst", parentId: POS.ceo }, meta);
  await store.append({ type: "PositionCreated", positionId: POS.writer, roleId: "role_writer", parentId: POS.ceo }, meta);

  // Hire agents (all simulated). Writer gets a tiny cap to trigger the hard stop.
  // Agents are simulated (ScriptedAdapter makes no API calls = $0 real cost), but
  // priced as if served by the named model so the budget board shows real dollars.
  const sys = (pos: string, persona: string) => `[pos:${pos}] ${persona}`;
  await store.append({ type: "AgentHired", positionId: POS.ceo, agentId: "a_ceo", name: "Ada (CEO)", provider: "claude", model: "claude-opus-4-8", systemPrompt: sys(POS.ceo, "You run the company toward the goal."), monthlyCapCents: 100, capabilities: [] }, meta);
  await store.append({ type: "AgentHired", positionId: POS.researcher, agentId: "a_res", name: "Ravi (Analyst)", provider: "claude", model: "claude-opus-4-8", systemPrompt: sys(POS.researcher, "You produce cited research."), monthlyCapCents: 100, capabilities: ["web_search", "web_fetch", "write_doc"] }, meta);
  await store.append({ type: "AgentHired", positionId: POS.writer, agentId: "a_wri", name: "Wren (Writer)", provider: "claude", model: "claude-opus-4-8", systemPrompt: sys(POS.writer, "You turn research into content."), monthlyCapCents: 18, capabilities: ["write_doc"] }, meta);

  // Strategy approval gate -> RUNNING
  await store.append({ type: "StrategyApproved", approvedBy: "human", contentHash: "h0" }, meta);
  await store.append({ type: "OrgStateChanged", state: "RUNNING" }, meta);

  // Initialize the authoritative budget from each hire cap.
  await store.initBudget(POS.ceo, 100);
  await store.initBudget(POS.researcher, 100);
  await store.initBudget(POS.writer, 18);

  const u = (inT: number, outT: number) => ({ inputTokens: inT, outputTokens: outT });

  const script: Script = {
    [POS.ceo]: [
      { text: "Decomposing the goal and delegating.", toolCalls: [{ tool: "assign_task", input: { assignee: POS.researcher, task: "Produce a cited market report for the note-taking app." } }], usage: u(6000, 2000) },
      { toolCalls: [{ tool: "assign_task", input: { assignee: POS.writer, task: "Write a 90-day content plan from the market report." } }], usage: u(6000, 2000) },
      { toolCalls: [{ tool: "submit_work", input: { kind: "package", title: "Go-to-market package", citations: [] } }], usage: u(6000, 2000) },
    ],
    [POS.researcher]: [
      { toolCalls: [{ tool: "web_search", input: { query: "note-taking app market 2026" } }], usage: u(8000, 3000) },
      { toolCalls: [{ tool: "web_fetch", input: { url: "https://example.com/notes-market" } }], usage: u(8000, 3000) },
      { toolCalls: [{ tool: "submit_work", input: { kind: "report", title: "Note-app market report", citations: ["https://example.com/notes-market"] } }], usage: u(8000, 3000) },
    ],
    [POS.writer]: [
      { toolCalls: [{ tool: "write_doc", input: { title: "Content plan draft" } }], usage: u(8000, 3000) },
      // This second turn never runs — the cap stops the Writer first.
      { toolCalls: [{ tool: "submit_work", input: { kind: "content-plan", title: "90-day content plan" } }], usage: u(8000, 3000) },
    ],
  };

  const positionOf = (req: TurnRequest): string => {
    const m = /\[pos:([^\]]+)\]/.exec(req.system);
    return m ? m[1] : "unknown";
  };

  const adapter = new ScriptedAdapter(script, positionOf);
  const registry = defaultToolRegistry();
  const engine = new Engine(store, adapter, registry, { maxOutputTokens: 4000, maxTurnsPerAssignment: 6, approvalResolver: opts.approvalResolver });
  await engine.setup();

  return { store, engine, root: POS.ceo };
}
