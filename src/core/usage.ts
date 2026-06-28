// Normalized, provider-agnostic usage record — the most important cross-provider
// contract. Every adapter must produce one of these so the budget kernel can meter
// spend identically regardless of which bot served the turn.

export interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  /** Server-side tool surcharge already expressed in cents (e.g. web search). */
  serverToolCents: number;
  /** The model that actually served the turn (matters for fallback repricing). */
  servedModel: string;
  /** True when usage was estimated (provider returned no usage) — softens the hard cap. */
  isEstimated: boolean;
}

export function emptyUsage(servedModel: string): UsageRecord {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    serverToolCents: 0,
    servedModel,
    isEstimated: false,
  };
}
