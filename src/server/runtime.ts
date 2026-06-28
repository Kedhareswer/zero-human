// Process-global runtime for the dashboard demo: build + run the $0 company once,
// then serve the same event log to the page and the Review Center mutation routes
// so mark-correct / flag actually persist within a running server.
//
// On Vercel this singleton is per-instance and ephemeral — fine for the demo;
// production persistence is the Neon store (src/db/pgstore.ts).

import type { InMemoryStore } from "../kernel/store";
import { buildResearchCompany } from "../demo/company";

let runtimeP: Promise<{ store: InMemoryStore; root: string }> | null = null;

export function getRuntime(): Promise<{ store: InMemoryStore; root: string }> {
  if (!runtimeP) {
    runtimeP = (async () => {
      const { store, engine, root } = await buildResearchCompany();
      await engine.run(root);
      return { store, root };
    })();
  }
  return runtimeP;
}
