// Versioned price book + cost computation. Token "salary" is denominated in cents.
// Anthropic cache economics: read ~0.1x input, write ~1.25x (5m) / 2x (1h).
// Prices grounded from the Claude API skill (cents per 1M tokens).

import type { UsageRecord } from "./usage";

export interface ModelPrice {
  /** Cents per 1,000,000 input tokens. */
  inPerMTok: number;
  /** Cents per 1,000,000 output tokens. */
  outPerMTok: number;
}

export const PRICE_BOOK_VERSION = "2026-06-28";

export const PRICE_BOOK: Record<string, ModelPrice> = {
  // Anthropic
  "claude-opus-4-8": { inPerMTok: 500, outPerMTok: 2500 },
  "claude-opus-4-7": { inPerMTok: 500, outPerMTok: 2500 },
  "claude-sonnet-4-6": { inPerMTok: 300, outPerMTok: 1500 },
  "claude-haiku-4-5": { inPerMTok: 100, outPerMTok: 500 },
  "claude-fable-5": { inPerMTok: 1000, outPerMTok: 5000 },
  // OpenAI-compatible placeholder (DeepSeek etc.); refine per provider.
  "openai-compatible": { inPerMTok: 100, outPerMTok: 400 },
  // Simulated provider used by the $0 demo / tests.
  "scripted": { inPerMTok: 100, outPerMTok: 400 },
};

const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_5M_MULT = 1.25;
const CACHE_WRITE_1H_MULT = 2.0;

export function priceFor(model: string): ModelPrice {
  return PRICE_BOOK[model] ?? PRICE_BOOK["openai-compatible"];
}

/** Exact spend in cents for a settled turn, billed to the model that served it. */
export function priceUsage(usage: UsageRecord): number {
  const p = priceFor(usage.servedModel);
  const inM = p.inPerMTok / 1_000_000;
  const outM = p.outPerMTok / 1_000_000;
  return (
    usage.inputTokens * inM +
    usage.outputTokens * outM +
    usage.cacheReadTokens * inM * CACHE_READ_MULT +
    usage.cacheWrite5mTokens * inM * CACHE_WRITE_5M_MULT +
    usage.cacheWrite1hTokens * inM * CACHE_WRITE_1H_MULT +
    usage.serverToolCents
  );
}

/**
 * Pre-flight worst-case estimate: known input + the max_tokens output ceiling.
 * Output is unknown before the call, so we reserve the ceiling and refund on settle.
 */
export function estimateTurnCents(model: string, inputTokens: number, maxOutputTokens: number): number {
  const p = priceFor(model);
  return (inputTokens * p.inPerMTok) / 1_000_000 + (maxOutputTokens * p.outPerMTok) / 1_000_000;
}

export const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
