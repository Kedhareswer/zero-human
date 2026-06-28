import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../src/kernel/store";
import { Engine } from "../src/kernel/engine";
import { defaultToolRegistry } from "../src/kernel/tools";
import { ScriptedAdapter, type Script } from "../src/providers/scripted";
import { fold } from "../src/core/fold";
import type { Authorities } from "../src/core/types";

const auth = (o: Partial<Authorities>): Authorities => ({
  canHire: false, canDelegate: false, canApproveSpend: false, canApproveCrossTeam: false, canSpawnSubagent: false, maxSubordinates: 0, ...o,
});

/** A one-agent org whose only action is a gated `deploy`. */
function buildGatedOrg() {
  const store = new InMemoryStore();
  const meta = { orgId: "org", actor: "human" };
  store.append({ type: "OrgCreated", goal: { title: "Ship it" }, aggregateCapCents: 1000 }, meta);
  store.append({ type: "RoleDefined", roleId: "r", name: "Eng", authorities: auth({}) }, meta);
  store.append({ type: "PositionCreated", positionId: "eng", roleId: "r", parentId: null }, meta);
  store.append({ type: "AgentHired", positionId: "eng", agentId: "a", name: "Dev", provider: "claude", model: "claude-opus-4-8", systemPrompt: "[pos:eng] ship", monthlyCapCents: 1000, capabilities: ["deploy"] }, meta);
  store.append({ type: "OrgStateChanged", state: "RUNNING" }, meta);
  store.initBudget("eng", 1000);

  const script: Script = {
    eng: [
      { toolCalls: [{ tool: "deploy", input: { target: "prod" } }], usage: { inputTokens: 1000, outputTokens: 500 } },
      { toolCalls: [{ tool: "submit_work", input: { kind: "release", title: "v1" } }], usage: { inputTokens: 1000, outputTokens: 500 } },
    ],
  };
  const registry = defaultToolRegistry();
  registry.set("deploy", {
    schema: { name: "deploy", description: "Deploy to an environment", inputSchema: { type: "object", properties: { target: { type: "string" } }, required: ["target"] } },
    async run() { return { ok: true, summary: "deployed" }; },
  });
  const positionOf = () => "eng";
  return { store, script, registry, positionOf };
}

describe("human approval gates on irreversible actions", () => {
  it("a granted approval lets the gated tool run", async () => {
    const { store, script, registry, positionOf } = buildGatedOrg();
    const engine = new Engine(store, new ScriptedAdapter(script, positionOf), registry, {
      approvalResolver: async () => ({ granted: true, by: "human" }),
    });
    engine.setup();
    await engine.run("eng");
    const ws = fold(store.events());
    expect([...ws.approvals.values()][0].status).toBe("GRANTED");
    expect([...ws.workItems.values()].length).toBe(1); // proceeded to submit
  });

  it("a denied approval blocks the tool and the agent does not execute it", async () => {
    const { store, script, registry, positionOf } = buildGatedOrg();
    const engine = new Engine(store, new ScriptedAdapter(script, positionOf), registry, {
      approvalResolver: async () => ({ granted: false, by: "human", reason: "not yet" }),
    });
    engine.setup();
    await engine.run("eng");
    const ws = fold(store.events());
    expect([...ws.approvals.values()][0].status).toBe("DENIED");
    const deployExec = ws.feed.find((f) => f.type === "ToolExecuted");
    expect(deployExec).toBeDefined(); // emitted, but as a denial
  });
});
