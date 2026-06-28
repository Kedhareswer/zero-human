// The supervisor-tree turn loop wrapped in governance. The kernel is the only
// component that calls a provider, spends a token, or runs a tool. Per turn:
// pre-flight budget admission (atomic CAS) -> provider call -> post-turn settle ->
// PDP-gated tool dispatch -> emit events. All read-state is fold(events).

import { canAssign, buildTree, type OrgTree } from "../core/authority";
import { isEvent, type EventMeta, type StoredEvent } from "../core/events";
import { newId } from "../core/ids";
import { estimateTurnCents, priceUsage } from "../core/pricing";
import type { Authorities } from "../core/types";
import type { ConvBlock, ConvMessage, ProviderAdapter } from "../providers/adapter";
import { decide } from "./policy";
import type { Store } from "./store";
import { ORG_TOOL_SCHEMAS, type ToolRegistry } from "./tools";

export interface ApprovalRequest {
  approvalId: string;
  toolUseId: string;
  positionId: string;
  tool: string;
  input: Record<string, unknown>;
  routedTo: string;
}

export type ApprovalResolver = (req: ApprovalRequest) => Promise<{ granted: boolean; by: string; reason?: string }>;

export interface EngineOptions {
  maxTurnsPerAssignment?: number;
  maxOutputTokens?: number;
  approvalResolver?: ApprovalResolver;
}

interface AgentInfo {
  name: string;
  model: string;
  systemPrompt: string;
  capabilities: string[];
  authorities: Authorities;
}

interface AssignmentOutcome {
  status: "done" | "suspended" | "maxturns";
  summary: string;
}

export class Engine {
  private readonly maxTurns: number;
  private readonly maxOutputTokens: number;
  private readonly approve: ApprovalResolver;
  private agents = new Map<string, AgentInfo>();
  private tree: OrgTree = { parent: new Map(), children: new Map() };
  private goalTitle = "";

  constructor(
    private readonly store: Store,
    private readonly adapter: ProviderAdapter,
    private readonly registry: ToolRegistry,
    opts: EngineOptions = {},
  ) {
    this.maxTurns = opts.maxTurnsPerAssignment ?? 6;
    this.maxOutputTokens = opts.maxOutputTokens ?? 4096;
    this.approve = opts.approvalResolver ?? (async () => ({ granted: true, by: "human" }));
  }

  /** Rebuild the engine's view of the org from the log. Call after setup, before run. */
  setup(): void {
    const events = this.store.events();
    const authoritiesByRole = new Map<string, Authorities>();
    const roleByPosition = new Map<string, string>();
    const edges: Array<{ positionId: string; parentId: string | null }> = [];

    for (const e of events) {
      if (isEvent(e, "OrgCreated")) this.goalTitle = e.goal.title;
      if (isEvent(e, "RoleDefined")) authoritiesByRole.set(e.roleId, e.authorities);
      if (isEvent(e, "PositionCreated")) {
        edges.push({ positionId: e.positionId, parentId: e.parentId });
        roleByPosition.set(e.positionId, e.roleId);
      }
      if (isEvent(e, "AgentHired")) {
        const roleId = roleByPosition.get(e.positionId) ?? "";
        this.agents.set(e.positionId, {
          name: e.name,
          model: e.model,
          systemPrompt: e.systemPrompt,
          capabilities: e.capabilities,
          authorities: authoritiesByRole.get(roleId) ?? defaultAuthorities(),
        });
      }
    }
    this.tree = buildTree(edges);
  }

  /** Dispatch and run the root (CEO) assignment for the goal. */
  async run(rootPositionId: string, task?: string): Promise<AssignmentOutcome> {
    const meta: EventMeta = { orgId: "org", actor: "human" };
    const assignmentId = newId("asg");
    this.store.append(
      {
        type: "AssignmentDispatched",
        assignmentId,
        assignerPositionId: "human",
        assigneePositionId: rootPositionId,
        objectiveId: null,
        task: task ?? this.goalTitle,
        authorityBasis: "human",
      },
      meta,
    );
    return this.runAssignment(assignmentId, rootPositionId, task ?? this.goalTitle);
  }

  private async runAssignment(assignmentId: string, positionId: string, task: string): Promise<AssignmentOutcome> {
    const agent = this.agents.get(positionId);
    if (!agent) return { status: "done", summary: `no agent at ${positionId}` };
    const meta: EventMeta = { orgId: "org", actor: positionId, correlationId: assignmentId };

    const transcript: ConvMessage[] = [
      { role: "user", blocks: [{ type: "text", text: this.missionBrief(agent.name, task) }] },
    ];
    const tools = this.toolsFor(agent);
    let lastSummary = "";

    for (let turn = 0; turn < this.maxTurns; turn++) {
      const turnId = newId("turn");
      const req = {
        model: agent.model,
        system: agent.systemPrompt,
        messages: transcript,
        tools,
        maxOutputTokens: this.maxOutputTokens,
      };

      // 1. Pre-flight budget admission (atomic CAS — the kill-switch).
      const inputTokens = await this.adapter.countTokens(req);
      const estimate = estimateTurnCents(agent.model, inputTokens, this.maxOutputTokens);
      const admit = this.store.admit(positionId, estimate);
      if (!admit.ok) {
        this.store.append({ type: "BudgetExhausted", turnId, positionId, neededCents: estimate, remainingCents: admit.remainingCents }, meta);
        this.store.append({ type: "AgentStateChanged", positionId, state: "SUSPENDED", reason: "budget exhausted" }, meta);
        return { status: "suspended", summary: `${agent.name} suspended (budget)` };
      }
      this.store.append({ type: "TurnStarted", turnId, assignmentId, positionId }, meta);
      this.store.append({ type: "BudgetReserved", turnId, positionId, amountCents: estimate }, meta);
      this.store.append({ type: "AgentStateChanged", positionId, state: "RUNNING" }, meta);

      // 2. Provider call (the only sanctioned egress).
      const result = await this.adapter.submitTurn(req);

      // 3. Post-turn settlement.
      const actual = priceUsage(result.usage);
      this.store.settle(positionId, estimate, actual);
      this.store.append({ type: "BudgetSettled", turnId, positionId, reserveCents: estimate, actualCents: actual, usage: result.usage }, meta);

      // 4. Append the assistant's turn to the transcript.
      if (result.assistantBlocks.length) transcript.push({ role: "assistant", blocks: result.assistantBlocks });

      if (result.stopReason === "refusal") {
        this.store.append({ type: "AuditNote", message: `${positionId} refusal` }, meta);
        break;
      }
      if (result.toolCalls.length === 0) {
        this.store.append({ type: "AgentStateChanged", positionId, state: "IDLE" }, meta);
        break; // end_turn
      }

      // 5. Dispatch tool calls; collect ALL results into ONE user turn.
      const toolResults: ConvBlock[] = [];
      let completed = false;

      for (const call of result.toolCalls) {
        this.store.append({ type: "ToolRequested", turnId, positionId, toolUseId: call.toolUseId, tool: call.tool, input: call.input }, meta);
        const pdp = decide({ tool: call.tool, capabilities: agent.capabilities, canDelegate: agent.authorities.canDelegate });
        this.store.append({ type: "PolicyDecided", toolUseId: call.toolUseId, decision: pdp.decision, matchedRule: pdp.matchedRule }, meta);

        if (pdp.decision === "DENY") {
          toolResults.push(this.toolResult(call.toolUseId, `DENIED (${pdp.matchedRule})`, true));
          this.store.append({ type: "ToolExecuted", toolUseId: call.toolUseId, turnId, ok: false, summary: `denied:${pdp.matchedRule}` }, meta);
          continue;
        }

        if (pdp.decision === "REQUIRE_APPROVAL") {
          const approvalId = newId("appr");
          const routedTo = this.routeApproval(positionId);
          this.store.append({ type: "ApprovalRequested", approvalId, toolUseId: call.toolUseId, positionId, routedTo, contentHash: newId("h") }, meta);
          const verdict = await this.approve({ approvalId, toolUseId: call.toolUseId, positionId, tool: call.tool, input: call.input, routedTo });
          if (verdict.granted) {
            this.store.append({ type: "ApprovalGranted", approvalId, by: verdict.by }, meta);
          } else {
            this.store.append({ type: "ApprovalDenied", approvalId, by: verdict.by, reason: verdict.reason ?? "denied" }, meta);
            toolResults.push(this.toolResult(call.toolUseId, `APPROVAL DENIED: ${verdict.reason ?? ""}`, true));
            this.store.append({ type: "ToolExecuted", toolUseId: call.toolUseId, turnId, ok: false, summary: "approval-denied" }, meta);
            continue;
          }
        }

        // Execute (org tool or domain tool).
        const exec = await this.execute(positionId, assignmentId, turnId, call.toolUseId, call.tool, call.input, meta);
        toolResults.push(this.toolResult(call.toolUseId, exec.summary, !exec.ok));
        this.store.append({ type: "ToolExecuted", toolUseId: call.toolUseId, turnId, ok: exec.ok, summary: exec.summary }, meta);
        lastSummary = exec.summary;
        if (exec.completed) completed = true;
      }

      transcript.push({ role: "user", blocks: toolResults });

      if (completed) {
        this.store.append({ type: "AssignmentCompleted", assignmentId, positionId }, meta);
        this.store.append({ type: "AgentStateChanged", positionId, state: "IDLE" }, meta);
        return { status: "done", summary: lastSummary };
      }
    }

    return { status: "maxturns", summary: lastSummary || `${agent.name} reached turn cap` };
  }

  private async execute(
    positionId: string,
    assignmentId: string,
    turnId: string,
    toolUseId: string,
    tool: string,
    input: Record<string, unknown>,
    meta: EventMeta,
  ): Promise<{ ok: boolean; summary: string; completed?: boolean }> {
    if (tool === "assign_task") {
      const assignee = String(input.assignee ?? "");
      const subtask = String(input.task ?? "");
      if (!canAssign(this.tree, positionId, assignee)) {
        return { ok: false, summary: `cannot assign to ${assignee}: not in your subtree` };
      }
      const subId = newId("asg");
      this.store.append(
        { type: "AssignmentDispatched", assignmentId: subId, assignerPositionId: positionId, assigneePositionId: assignee, objectiveId: null, task: subtask, authorityBasis: "subtree" },
        { orgId: "org", actor: positionId, correlationId: assignmentId },
      );
      const outcome = await this.runAssignment(subId, assignee, subtask);
      return { ok: outcome.status !== "suspended", summary: `${assignee}: ${outcome.summary}` };
    }

    if (tool === "submit_work") {
      const workItemId = newId("work");
      const citations = Array.isArray(input.citations) ? (input.citations as string[]) : [];
      this.store.append(
        { type: "WorkSubmitted", workItemId, assignmentId, positionId, kind: String(input.kind ?? "doc"), title: String(input.title ?? "untitled"), citations },
        meta,
      );
      return { ok: true, summary: `submitted ${String(input.title ?? "work")}`, completed: true };
    }

    if (tool === "ask_manager") {
      return { ok: true, summary: "manager: proceed as planned" };
    }

    const handler = this.registry.get(tool);
    if (!handler) return { ok: false, summary: `unknown tool ${tool}` };
    return handler.run(input);
  }

  private toolsFor(agent: AgentInfo) {
    const tools = ORG_TOOL_SCHEMAS.filter((t) => t.name !== "assign_task" || agent.authorities.canDelegate).slice();
    for (const cap of agent.capabilities) {
      const h = this.registry.get(cap);
      if (h) tools.push(h.schema);
    }
    return tools;
  }

  private routeApproval(positionId: string): string {
    return this.tree.parent.get(positionId) ?? "human";
  }

  private missionBrief(name: string, task: string): string {
    return `You are ${name}. Company goal: ${this.goalTitle}. Your task: ${task}. Use your tools; delegate with assign_task if you manage a team; call submit_work when the deliverable is ready.`;
  }

  private toolResult(toolUseId: string, content: string, isError: boolean): ConvBlock {
    return { type: "tool_result", toolUseId, content, isError };
  }
}

function defaultAuthorities(): Authorities {
  return { canHire: false, canDelegate: false, canApproveSpend: false, canApproveCrossTeam: false, canSpawnSubagent: false, maxSubordinates: 0 };
}

// Re-export for convenience.
export { type StoredEvent };
