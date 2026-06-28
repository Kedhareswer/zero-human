import { describe, it, expect } from "vitest";
import { priceUsage, estimateTurnCents } from "../src/core/pricing";
import { emptyUsage } from "../src/core/usage";

describe("cost golden tests", () => {
  it("prices opus-4-8 input/output in cents", () => {
    const u = { ...emptyUsage("claude-opus-4-8"), inputTokens: 1_000_000, outputTokens: 1_000_000 };
    // $5/MTok in + $25/MTok out = 500 + 2500 cents
    expect(priceUsage(u)).toBeCloseTo(3000, 6);
  });

  it("applies cache economics: read 0.1x, write 1.25x (5m) / 2x (1h)", () => {
    const base = emptyUsage("claude-opus-4-8");
    expect(priceUsage({ ...base, cacheReadTokens: 1_000_000 })).toBeCloseTo(50, 6); // 500 * 0.1
    expect(priceUsage({ ...base, cacheWrite5mTokens: 1_000_000 })).toBeCloseTo(625, 6); // 500 * 1.25
    expect(priceUsage({ ...base, cacheWrite1hTokens: 1_000_000 })).toBeCloseTo(1000, 6); // 500 * 2.0
  });

  it("bills to the model that actually served the turn (fallback repricing)", () => {
    const u = { ...emptyUsage("claude-haiku-4-5"), inputTokens: 1_000_000, outputTokens: 1_000_000 };
    expect(priceUsage(u)).toBeCloseTo(600, 6); // $1/$5 -> 100 + 500
  });

  it("pre-flight estimate reserves the worst-case output ceiling", () => {
    // input 0 + 4000 output tokens at $25/MTok = 10 cents
    expect(estimateTurnCents("claude-opus-4-8", 0, 4000)).toBeCloseTo(10, 6);
  });
});
