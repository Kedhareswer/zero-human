// Tool registry. Domain tools (web_search, write_doc, …) run through handlers the
// kernel dispatches; org tools (assign_task, submit_work, ask_manager) are handled
// directly by the engine. In the $0 demo the domain handlers are simulated so the
// whole loop runs without network or tokens.

import type { ToolSchema } from "../providers/adapter";

export interface ToolHandler {
  schema: ToolSchema;
  run(input: Record<string, unknown>): Promise<{ ok: boolean; summary: string }>;
}

export type ToolRegistry = Map<string, ToolHandler>;

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
  additionalProperties: false,
});

/** Schemas for the org tools every agent can reach (subject to PDP). */
export const ORG_TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "assign_task",
    description: "Delegate a task to a subordinate position. Allowed only down your own subtree.",
    inputSchema: obj({ assignee: { type: "string" }, task: { type: "string" } }, ["assignee", "task"]),
  },
  {
    name: "submit_work",
    description: "Submit a finished deliverable for this assignment and mark it complete.",
    inputSchema: obj(
      { kind: { type: "string" }, title: { type: "string" }, citations: { type: "array", items: { type: "string" } } },
      ["kind", "title"],
    ),
  },
  {
    name: "ask_manager",
    description: "Escalate a question to your manager.",
    inputSchema: obj({ question: { type: "string" } }, ["question"]),
  },
];

/** Default registry of simulated domain tools used by the demo. */
export function defaultToolRegistry(): ToolRegistry {
  const reg: ToolRegistry = new Map();

  reg.set("web_search", {
    schema: {
      name: "web_search",
      description: "Search the web for information; returns titled snippets with source URLs.",
      inputSchema: obj({ query: { type: "string" } }, ["query"]),
    },
    async run(input) {
      const q = String(input.query ?? "");
      return { ok: true, summary: `3 results for "${q}" (simulated): competitor pricing, market size, top feature gaps.` };
    },
  });

  reg.set("web_fetch", {
    schema: {
      name: "web_fetch",
      description: "Fetch and read the content at a URL.",
      inputSchema: obj({ url: { type: "string" } }, ["url"]),
    },
    async run(input) {
      return { ok: true, summary: `Fetched ${String(input.url ?? "")} (simulated): 1,200 words extracted.` };
    },
  });

  reg.set("write_doc", {
    schema: {
      name: "write_doc",
      description: "Write a document/report artifact to the Knowledge Garden.",
      inputSchema: obj({ title: { type: "string" }, body: { type: "string" } }, ["title"]),
    },
    async run(input) {
      return { ok: true, summary: `Wrote doc "${String(input.title ?? "")}" (simulated).` };
    },
  });

  return reg;
}
