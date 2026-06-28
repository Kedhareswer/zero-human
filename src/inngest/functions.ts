// Durable execution plane. Triggered by `zh/company.run`, this runs an org to
// completion on Inngest infra (off Vercel's time-bounded functions).
//
// MVP shape: the run executes inside one durable step and returns a serializable
// summary. The production refinement (ULTRAPLAN §11.2) decomposes the loop so that
// EACH agent turn is its own `step.run` (memoized + retried) and every approval
// gate becomes `step.waitForEvent("zh/approval.resolved", { timeout: "3d" })` —
// which parks the gate durably for days while holding zero compute, and gives
// idempotency-on-retry and per-provider concurrency keys for free. Free-tier
// Inngest caps at 5 concurrent steps, so the org runs small (ULTRAPLAN §12).

import { fold } from "../core/fold";
import { buildResearchCompany } from "../demo/company";
import { inngest } from "./client";

export const runCompany = inngest.createFunction(
  {
    id: "run-company",
    triggers: [{ event: "zh/company.run" }],
    concurrency: [{ key: "event.data.orgId", limit: 5 }],
  },
  async ({ step }) => {
    return await step.run("run-company", async () => {
      // Production: load/seed from Neon via makeStore() keyed by event.data.orgId.
      const { store, engine, root } = await buildResearchCompany();
      const outcome = await engine.run(root);
      const ws = fold(await store.events());
      return {
        outcome,
        events: ws.feed.length,
        capBreaches: ws.capBreaches,
        hardStops: ws.feed.filter((f) => f.type === "BudgetExhausted").length,
      };
    });
  },
);

export const functions = [runCompany];
