import { describe, it, expect } from "vitest";
import { fold } from "../src/core/fold";
import { verifyChain } from "../src/kernel/store";
import { buildResearchCompany } from "../src/demo/company";

describe("fold(events) is the single source of read-state", () => {
  it("is deterministic: folding the same log twice yields identical numbers", async () => {
    const { store, engine, root } = await buildResearchCompany();
    await engine.run(root);
    const events = await store.events();
    const a = fold(events);
    const b = fold(events);
    for (const [pos, av] of a.agents) {
      expect(b.agents.get(pos)!.usedCents).toBeCloseTo(av.usedCents, 9);
      expect(b.agents.get(pos)!.state).toBe(av.state);
    }
    expect(b.feed.length).toBe(a.feed.length);
  });

  it("reconstructs budgets that match the authoritative store", async () => {
    const { store, engine, root } = await buildResearchCompany();
    await engine.run(root);
    const ws = fold(await store.events());
    for (const [pos, av] of ws.agents) {
      const authoritative = (await store.budget(pos))!;
      expect(av.usedCents).toBeCloseTo(authoritative.usedCents, 9);
    }
  });
});

describe("tamper-evident audit log", () => {
  it("the hash chain verifies end to end", async () => {
    const { store, engine, root } = await buildResearchCompany();
    await engine.run(root);
    expect(verifyChain(await store.events())).toBe(true);
  });
});

describe("deterministic replay (structural)", () => {
  it("two independent runs produce the same event-type sequence and budgets", async () => {
    const run = async () => {
      const { store, engine, root } = await buildResearchCompany();
      await engine.run(root);
      const ws = fold(await store.events());
      return {
        types: (await store.events()).map((e) => e.type),
        used: [...ws.agents.values()].map((a) => Math.round(a.usedCents * 100)),
        breaches: ws.capBreaches,
      };
    };
    const a = await run();
    const b = await run();
    expect(b.types).toEqual(a.types);
    expect(b.used).toEqual(a.used);
    expect(a.breaches).toBe(0);
  });
});
