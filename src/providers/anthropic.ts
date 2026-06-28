// Real first-class adapter. Default model claude-opus-4-8, adaptive thinking,
// usage read off the final message, refusal checked before content. Used for live
// runs; the demo/tests run on ScriptedAdapter so no key or tokens are needed.
//
// SDK params are passed loosely (cast) so this compiles across SDK minor versions
// whose static types may lag the documented adaptive-thinking / effort surface.

import Anthropic from "@anthropic-ai/sdk";
import { emptyUsage, type UsageRecord } from "../core/usage";
import type {
  ConvBlock,
  ConvMessage,
  NormalizedToolCall,
  ProviderAdapter,
  TurnRequest,
  TurnResult,
} from "./adapter";

export interface AnthropicAdapterOptions {
  apiKey?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly name = "anthropic";
  private readonly client: Anthropic;
  private readonly effort: string;

  constructor(opts: AnthropicAdapterOptions = {}) {
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.effort = opts.effort ?? "high";
  }

  async countTokens(req: TurnRequest): Promise<number> {
    const params: any = {
      model: req.model,
      system: req.system,
      messages: toApiMessages(req.messages),
      tools: toApiTools(req.tools),
    };
    const res: any = await (this.client as any).messages.countTokens(params);
    return res.input_tokens ?? 0;
  }

  async submitTurn(req: TurnRequest): Promise<TurnResult> {
    const params: any = {
      model: req.model,
      max_tokens: req.maxOutputTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: this.effort },
      system: req.system,
      messages: toApiMessages(req.messages),
    };
    if (req.tools.length) params.tools = toApiTools(req.tools);

    // Stream for large outputs to avoid HTTP timeouts; collect the final message.
    let res: any;
    if (req.maxOutputTokens > 8000) {
      const stream = (this.client as any).messages.stream(params);
      res = await stream.finalMessage();
    } else {
      res = await (this.client as any).messages.create(params);
    }

    const stopReason: string = res.stop_reason ?? "end_turn";
    if (stopReason === "refusal") {
      return { text: "", toolCalls: [], usage: normalizeUsage(res, req.model), stopReason, assistantBlocks: [] };
    }

    let text = "";
    const toolCalls: NormalizedToolCall[] = [];
    const assistantBlocks: ConvBlock[] = [];
    for (const block of res.content ?? []) {
      if (block.type === "text") {
        text += block.text;
        assistantBlocks.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        const call = { toolUseId: block.id, tool: block.name, input: (block.input ?? {}) as Record<string, unknown> };
        toolCalls.push(call);
        assistantBlocks.push({ type: "tool_use", ...call });
      }
    }

    return { text, toolCalls, usage: normalizeUsage(res, req.model), stopReason, assistantBlocks };
  }
}

function normalizeUsage(res: any, model: string): UsageRecord {
  const u = res.usage ?? {};
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWrite5mTokens: u.cache_creation_input_tokens ?? 0,
    cacheWrite1hTokens: 0,
    serverToolCents: 0,
    servedModel: res.model ?? model,
    isEstimated: false,
  };
}

function toApiTools(tools: TurnRequest["tools"]): any[] {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
}

function toApiMessages(messages: ConvMessage[]): any[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.blocks.map((b) => {
      if (b.type === "text") return { type: "text", text: b.text };
      if (b.type === "tool_use") return { type: "tool_use", id: b.toolUseId, name: b.tool, input: b.input };
      return { type: "tool_result", tool_use_id: b.toolUseId, content: b.content, is_error: b.isError ?? false };
    }),
  }));
}

void emptyUsage; // referenced for parity with other adapters
