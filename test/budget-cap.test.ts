import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../src/kernel/store";
import { fold } from "../src/core/fold";
import { buildResearchCompany } from "../src/demo/company";

describe("hard budget kill-switch (atomic CAS)", () => {
  it("admits only what fits under the cap", () => {
    const s = new InMemoryStore();
    s.initBudget("p", 100);
    expect(s.admit("p", 60).ok).toBe(true); // reserves 60
    expect(s.admit("p", 60).ok).toBe(false); // only 40 left
    expect(s.admit("p", 40).ok).toBe(true); // exactly fits
    expect(s.admit("p", 0.01).ok).toBe(false); // nothing left
  });

  it("settlement frees the reservation and charges actual spend", () => {
    const s = new InMemoryStore();
    s.initBudget("p", 100);
    s.admit("p", 50);
    s.settle("p", 50, 12);
    const b = s.budget("p")!;
    expect(b.usedCents).toBe(12);
    expect(b.reservedCents).toBe(0);
    expect(s.admit("p", 88).ok).toBe(true);
    expect(s.admit("p", 0.01).ok).toBe(false);
  });

  it("the last-dollar race admits exactly one of two concurrent turns", async () => {
    const s = new InMemoryStore();
    s.initBudget("p", 100);
    // Both want 60; only one can fit. admit() is a synchronous critical section,
    // so even raced via Promise.all exactly one wins.
    const results = await Promise.all([
      (async () => s.admit("p", 60))(),
      (async () => s.admit("p", 60))(),
    ]);
    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(s.budget("p")!.reservedCents).toBe(60);
  });
});

describe("full-log replay verification", () => {
  it("a complete org run never breaches a cap and reconciles every budget", async () => {
    const { store, engine, root } = buildResearchCompany();
    await engine.run(root);

    const ws = fold(store.events());
    expect(ws.capBreaches).toBe(0);
    for (const a of ws.agents.values()) {
      expect(a.usedCents).toBeLessThanOrEqual(a.capCents + 1e-6);
    }
    // The Writer's deliberately tiny cap stops it mid-work.
    expect(ws.agents.get("writer")!.state).toBe("SUSPENDED");
    // The Researcher delivered a cited report.
    const report = [...ws.workItems.values()].find((w) => w.positionId === "researcher");
    expect(report?.citations.length).toBeGreaterThan(0);
  });
});
