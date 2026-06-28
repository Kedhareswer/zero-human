// Deterministic, zero-token adapter. Record canned turns once and replay forever —
// the backbone of the test/eval harness and the $0 demo. Turns are keyed per
// position so a whole org run is reproducible without burning a single token.

import { newId } from "../core/ids";
import { emptyUsage, type UsageRecord } from "../core/usage";
import type {
  ConvBlock,
  NormalizedToolCall,
  ProviderAdapter,
  TurnRequest,
  TurnResult,
} from "./adapter";

export interface ScriptedTurn {
  text?: string;
  toolCalls?: Array<{ tool: string; input?: Record<string, unknown>; toolUseId?: string }>;
  usage?: Partial<UsageRecord>;
  stopReason?: string;
}

/** A script maps a position id to the ordered turns that agent will emit. */
export type Script = Record<string, ScriptedTurn[]>;

export class ScriptedAdapter implements ProviderAdapter {
  readonly name = "scripted";
  private readonly cursors = new Map<string, number>();

  constructor(private readonly script: Script, private readonly positionOf: (req: TurnRequest) => string) {}

  async countTokens(req: TurnRequest): Promise<number> {
    // Deterministic, cheap approximation (~4 chars/token) — never used for billing.
    const chars = req.system.length + req.messages.reduce((n, m) => n + JSON.stringify(m.blocks).length, 0);
    return Math.ceil(chars / 4);
  }

  async submitTurn(req: TurnRequest): Promise<TurnResult> {
    const pos = this.positionOf(req);
    const i = this.cursors.get(pos) ?? 0;
    const turn = this.script[pos]?.[i];
    this.cursors.set(pos, i + 1);

    if (!turn) {
      // No more scripted turns — the agent is done.
      return {
        text: "",
        toolCalls: [],
        usage: emptyUsage(req.model),
        stopReason: "end_turn",
        assistantBlocks: [],
      };
    }

    const toolCalls: NormalizedToolCall[] = (turn.toolCalls ?? []).map((tc) => ({
      toolUseId: tc.toolUseId ?? newId("toolu"),
      tool: tc.tool,
      input: tc.input ?? {},
    }));

    const assistantBlocks: ConvBlock[] = [];
    if (turn.text) assistantBlocks.push({ type: "text", text: turn.text });
    for (const tc of toolCalls) assistantBlocks.push({ type: "tool_use", toolUseId: tc.toolUseId, tool: tc.tool, input: tc.input });

    const usage: UsageRecord = { ...emptyUsage(req.model), ...turn.usage, servedModel: req.model };

    return {
      text: turn.text ?? "",
      toolCalls,
      usage,
      stopReason: turn.stopReason ?? (toolCalls.length ? "tool_use" : "end_turn"),
      assistantBlocks,
    };
  }
}
