// Run the $0 demo company and print the dashboard view (folded from the event log).
//   pnpm demo

import { fold, subtreeUsedCents } from "../core/fold";
import { dollars } from "../core/pricing";
import { buildResearchCompany } from "./company";

async function main(): Promise<void> {
  const { store, engine, root } = await buildResearchCompany();

  console.log("\n=== zero-human · $0 simulated run ===\n");
  const outcome = await engine.run(root);

  const ws = fold(await store.events());

  console.log(`Goal:  ${ws.org.goal.title}`);
  console.log(`State: ${ws.org.state}   ·   CEO outcome: ${outcome.status} (${outcome.summary})\n`);

  // Budget board (the mockup's per-agent used/cap table)
  console.log("AGENT                 PROVIDER/MODEL     BUDGET USED            STATE");
  console.log("─".repeat(78));
  for (const a of ws.agents.values()) {
    const pct = a.capCents ? a.usedCents / a.capCents : 0;
    const bar = "█".repeat(Math.round(pct * 14)).padEnd(14, "░");
    const name = a.name.padEnd(21);
    const pm = `${a.provider}/${a.model}`.padEnd(18);
    const used = `${bar} ${dollars(a.usedCents)}/${dollars(a.capCents)}`.padEnd(22);
    console.log(`${name} ${pm} ${used} ${a.state}`);
  }
  const orgUsed = subtreeUsedCents(ws, root);
  console.log("─".repeat(78));
  console.log(`TOTAL${" ".repeat(56)}${dollars(orgUsed)}/${dollars(ws.org.aggregateCapCents)}\n`);

  // Review Center (Guru-style queue)
  console.log("REVIEW CENTER");
  for (const w of ws.workItems.values()) {
    console.log(`  • [${w.status}] ${w.positionId}: ${w.kind} — "${w.title}"  cites:${w.citations.length}`);
  }
  if (ws.workItems.size === 0) console.log("  (none)");

  // Governance signals
  const exhausted = ws.feed.filter((f) => f.type === "BudgetExhausted");
  console.log(`\nGOVERNANCE  ·  cap-breaches: ${ws.capBreaches}  ·  hard-stops: ${exhausted.length}`);
  for (const f of exhausted) console.log(`  ✋ ${f.summary}`);

  // Activity feed (tail)
  console.log("\nACTIVITY (tail)");
  for (const f of ws.feed.slice(-12)) {
    console.log(`  ${String(f.seq).padStart(3)} ${f.type.padEnd(20)} ${f.actor.padEnd(11)} ${f.summary}`);
  }

  console.log(
    `\nThe entire run is one hash-chained, replayable log of ${ws.feed.length} events. ` +
      `Re-fold it and the company comes out identical — that log is the audit trail, the dashboard, and the regression test.\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
