# zero-human

**Run a company staffed by AI agents.** Define a business goal, hire agents (any
model, any provider) into org-chart roles with token-salary budgets, approve the
strategy, and govern from one dashboard — with **hard** budget caps that stop
agents automatically, human approval gates on irreversible actions, and an
immutable, replayable audit log.

> *Manage business goals, not pull requests.*

This repo is the working MVP of the harness described in **[PLAN.md](./PLAN.md)**
(the spine) and **[ULTRAPLAN.md](./ULTRAPLAN.md)** (operating layer, tech stack,
Vercel §11, free-tier §12). It is TypeScript end-to-end, runs at **$0** out of the
box (simulated provider), and deploys to **Vercel Hobby**.

---

## Quick start

```bash
pnpm install
pnpm demo        # run the $0 simulated company, print the dashboard view
pnpm test        # 25 tests: budget kill-switch, authority, pricing, replay, approvals
pnpm typecheck   # tsc --noEmit
pnpm dev         # the Vercel dashboard at http://localhost:3000
```

No API key is needed — the demo runs on the `ScriptedAdapter` (deterministic,
zero tokens). Set `ANTHROPIC_API_KEY` to run real agents under the **same** hard
budget caps (see `.env.example`).

## What the demo shows

A 3-agent **research-&-content company** (the $0 free-tier demo from ULTRAPLAN §12.4):

```
CEO ──assign──▶ Researcher  (web_search → web_fetch → submit cited report)
    ──assign──▶ Writer      (write_doc → ✋ BUDGET STOP before submit)
    ──submit── Go-to-market package
```

The Writer has a deliberately tiny cap, so the kernel **hard-stops it mid-work** —
the literal *"when they hit it, they stop"* promise. The run ends with
`cap-breaches: 0`.

## The four guarantees (and where they live)

| Guarantee | Code |
|---|---|
| **Hard budget kill-switch** — atomic pre-flight check-and-reserve, the one synchronous CAS | `src/kernel/store.ts` (`admit`) |
| **Authority** — delegation only down one's own subtree; an IC can't command the CEO | `src/core/authority.ts` (`canAssign`) |
| **Governance + tamper-evident audit** — pure PDP + hash-chained, append-only log | `src/kernel/policy.ts`, `src/core/hashchain.ts`, `verifyChain` |
| **All read-state = `fold(events)`** — dashboard, audit, and replay from one log | `src/core/fold.ts` |

## Structure

```
src/
  core/        types · events (union) · fold(events)→WorldState · authority ·
               pricing (price book + cost) · hashchain (tamper-evidence) · ids
  providers/   ProviderAdapter contract · ScriptedAdapter ($0) · AnthropicAdapter (live)
  kernel/      store (in-memory event log + atomic budget CAS) · factory (store
               selection) · policy (PDP) · tools (registry) · engine (turn loop)
  db/          Drizzle schema · PgStore (Neon, atomic CAS in SQL) · migrations
  inngest/     client + durable run-company function (execution plane)
  server/      runtime singleton (dashboard) · governor auth guard
  demo/        the research-&-content company · runner · JSON snapshot
app/           Next.js dashboard (Boardroom / budget board / interactive Review
               Center / feed) + /api/state · /api/review · /api/inngest
test/          budget-cap · authority · pricing · policy · approval · fold-replay ·
               review  (26 tests)
```

## Backends — one `Store`, two implementations

The engine, demo, and tests run unchanged over either store; `makeStore()` picks
by `DATABASE_URL`:

- **InMemoryStore** (default, $0) — atomic CAS via a synchronous critical section.
- **PgStore** (Neon) — the budget kill-switch is a single
  `UPDATE … WHERE (cap-used-reserved) >= amount RETURNING` (DB-enforced); the
  append is a `FOR UPDATE`-locked transaction that assigns a gap-free `seq` and
  chains the hash. Apply `src/db/migrations/0000_init.sql`, set `DATABASE_URL`.

## Execution plane — Inngest (Vercel §11)

Vercel functions are time-bounded with no always-on workers, so the durable agent
loop runs on **Inngest**: `src/inngest/functions.ts` + `app/api/inngest/route.ts`.
Trigger a run with the `zh/company.run` event. The production refinement
(per-turn `step.run` + `step.waitForEvent` for approval parking) is documented
inline; this MVP runs the loop in one durable step.

## The turn loop (one agent, one assignment)

```
claim (Position, Task)
  → pre-flight budget admission (atomic CAS)   ── insufficient? SUSPEND ✋
  → provider call (the only sanctioned egress)
  → post-turn settle (meter actual, release reserve)
  → for each tool call: PDP gate → [approval?] → execute → emit events
  → submit_work completes the assignment
```

Three "complete" levels: **Turn** (one provider round-trip), **Assignment**
(`submit_work`), **Objective/KR**. Everything emits one hash-chained event.

## The test/eval harness (the namesake)

- **Atomic CAS / last-dollar race** — two concurrent turns race the last dollar;
  exactly one is admitted (`test/budget-cap.test.ts`).
- **Full-log replay** — re-fold a whole org run, assert `cap-breaches === 0` and
  every budget reconciles.
- **Authority property test**, **cost golden tests**, **PDP determinism**,
  **approval grant/deny**, **hash-chain verification**, **structural replay**
  (two runs → identical event-type sequence + budgets).

All deterministic, no network, **$0**.

## Deploying (free tier)

The dashboard deploys to **Vercel Hobby** as-is (`pnpm build` is a clean Next
build). The current build runs the simulated company per request. The production
path (durable multi-turn loop, Neon Postgres event log, Inngest) is specified in
**ULTRAPLAN §11 (Vercel)** and **§12 (free-tier: Vercel + Inngest + Neon)** — the
domain model here is unchanged by that move; only where the loop executes changes.

⚠️ Vercel Hobby is **non-commercial only** — fine for a prototype; move to Pro the
day this is a real product.

## Status

**Done & verified:** core domain model, event log + hash chain, `fold`, authority
resolver, price book + metering, the kernel turn loop with the hard budget CAS,
PDP + approval gates, ScriptedAdapter + AnthropicAdapter, the $0 demo, the Next.js
dashboard with an **interactive Review Center** (mark-correct / flag), the **Neon
PgStore** (atomic CAS in SQL) behind a store factory, the **Inngest** durable
runtime + `/api/inngest`, a governor auth guard, and the test suite (**26 tests**,
green). `pnpm build` is a clean production build.

**Next (per the plan):** decompose the loop into per-turn Inngest `step.run` +
`step.waitForEvent` approval parking; swap the governor guard for Auth.js; dynamic
hiring (`open_requisition`); MCP/Nango connectors; the flow-canvas workspace.
Tracked in `ULTRAPLAN.md` §11/§12 + §Appendix.
