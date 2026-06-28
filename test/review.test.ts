import { describe, it, expect } from "vitest";
import { buildResearchCompany } from "../src/demo/company";
import { snapshotOf } from "../src/demo/snapshot";

// The Review Center loop: a human marks a deliverable correct or flags it, which
// appends WorkApproved / WorkFlagged to the same log the dashboard reads (what
// POST /api/review does at runtime).
describe("Review Center mark-correct / flag", () => {
  it("mutates the folded work-item status via appended events", async () => {
    const { store, engine, root } = await buildResearchCompany();
    await engine.run(root);

    let s = await snapshotOf(store, root);
    const pending = s.workItems.filter((w) => w.status === "PENDING_REVIEW");
    expect(pending.length).toBeGreaterThanOrEqual(2);

    await store.append({ type: "WorkApproved", workItemId: pending[0].workItemId, by: "human" }, { orgId: "org", actor: "human" });
    await store.append({ type: "WorkFlagged", workItemId: pending[1].workItemId, by: "human", reasons: ["add a competitor table"] }, { orgId: "org", actor: "human" });

    s = await snapshotOf(store, root);
    expect(s.workItems.find((w) => w.workItemId === pending[0].workItemId)!.status).toBe("CORRECT");
    expect(s.workItems.find((w) => w.workItemId === pending[1].workItemId)!.status).toBe("FLAGGED");
  });
});
