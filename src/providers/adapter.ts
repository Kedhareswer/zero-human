// The one load-bearing cross-provider contract. Every provider (Claude, OpenAI-
// compatible, scripted) implements ProviderAdapter so the kernel can run the turn
// loop and meter spend identically. normalizeUsage is the most important method.

import type { UsageRecord } from "../core/usage";

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ConvBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolUseId: string; tool: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export interface ConvMessage {
  role: "user" | "assistant";
  blocks: ConvBlock[];
}

export interface TurnRequest {
  model: string;
  system: string;
  messages: ConvMessage[];
  tools: ToolSchema[];
  maxOutputTokens: number;
}

export interface NormalizedToolCall {
  toolUseId: string;
  tool: string;
  input: Record<string, unknown>;
}

export interface TurnResult {
  /** Visible text produced this turn. */
  text: string;
  /** Tool calls the agent wants executed (empty => the agent is done). */
  toolCalls: NormalizedToolCall[];
  usage: UsageRecord;
  /** "end_turn" | "tool_use" | "refusal" | "pause_turn" | ... */
  stopReason: string;
  /** Assistant blocks to append to the transcript before tool results. */
  assistantBlocks: ConvBlock[];
}

export interface ProviderAdapter {
  readonly name: string;
  /** Native token count for the input (never tiktoken). */
  countTokens(req: TurnRequest): Promise<number>;
  submitTurn(req: TurnRequest): Promise<TurnResult>;
}
