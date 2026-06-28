# zero-human — Harness Plan

> Run a company staffed almost entirely by AI agents. Define a business goal,
> hire agents (any model, any provider) into org-chart roles with token-salary
> budgets, approve the strategy, hit go, and govern from a dashboard — with
> **hard** budget caps, human approval gates, and an immutable audit trail.
>
> *Manage business goals, not pull requests.*

This document is the planning deliverable. It is the output of a multi-agent
design pass (feature extraction → 3 candidate architectures → independent
judging → synthesis → adversarial critique).

---

## 0. What the product is (read of the mockups)

Everything collapses into **three surfaces over one engine**:

1. **The Boardroom** — set up & govern: define goal, build org chart, hire
   agents, set budgets, approve strategy, view audit trail. *(pillars + 3-step
   flow + budget dashboard)*
2. **The Floor** — agents do work: flow/canvas, agent runtime, shared
   Knowledge Garden, live activity. *(flowith-inspired)*
3. **The Review Center** — verify work: QA queue, mark-correct / flag,
   citations, human escalation. *(Guru-inspired)*

Underneath them is **the harness**: the orchestration substrate that wraps
every agent. It owns the agentic turn loop, normalizes every provider behind
one adapter, **meters and hard-enforces budgets in the call path** (not the
dashboard), gates tool calls through a policy engine, and emits an append-only
event log that is *simultaneously* the audit trail, the live observability
feed, and the replay-test fixture. **Agents are untrusted; the harness is the
only thing that can touch a provider, spend a token, or affect the world.**

### Feature extraction (every point from the mockups)

| Source | Feature | Harness obligation |
|---|---|---|
| Pillar: manage agents as employees | hire/fire roster, per-agent profile | Agent + Position lifecycle |
| Pillar: define org structure | org-chart, reporting lines, delegation | Position tree, authority resolver |
| Pillar: track work in real time | live "what is each agent doing now" | derived-status + SSE feed |
| Pillar: control costs | token-salary, spend, burn-rate | normalized usage + budget ledger |
| Pillar: align to goals | mission cascades to agents | Goal→Objective→KR DAG, mission brief |
| Pillar: govern autonomy | approval gates, audit trail, enforcement | PDP + approval queue + hash-chained log |
| Flow: define the goal | single north-star objective | Goal object + strategy-approval gate |
| Flow: hire the team | "any bot, any provider" | multi-provider adapter layer |
| Flow: approve & run | review strategy, set budgets, monitor | approval SM + dashboard |
| Budget board | per-agent monthly cap, **hard auto-stop**, $used/$cap, aggregate total | pre-flight budget kill-switch |
| flowith | flow canvas, AGENT MODE toggle, model/mode selector, Knowledge Garden (KBs, files, "seeds", token usage) | knowledge module + seeds registry + token meter |
| Guru | agent activity center, status workflow (correct/flag/assign), citations, named specialist agents, Sources tab | review module + citation validator |

---

## 1. Core domain model (~10 load-bearing objects)

- **Org** — top-level container scoped to one Goal; run-state
  `DRAFT→PENDING_APPROVAL→RUNNING→PAUSED→STOPPED`; org-level aggregate budget
  cap. Anchors the kill-switch and strategy approval.
- **Role** (versioned catalog) — name, job description, default authorities
  (`can_hire`, `can_delegate`, `can_approve_spend`, `can_approve_cross_team`,
  `can_spawn_subagent`, `max_subordinates`), default capability bundle.
  Versioned so editing a role never rewrites history.
- **Position** — the org-chart slot (tree node): `role_ref`, **pinned
  `effective_role_version`**, `reporting_parent_id` (null only for root),
  lifecycle state, budget envelope ref. The unit of chain-of-command.
- **Agent (occupant)** — the bot bound to a Position: provider+model, system
  prompt, capability grants, monthly cap, lifecycle state. **Position ≠
  Agent** — fire-and-rehire (Claude→GPT) swaps the occupant without losing
  edges, history, or budget envelope.
- **Provider / ProviderCredential / ModelDescriptor** — provider kind + client
  params; write-only encrypted credential (org|agent scope); exact model_id,
  context window, max output, features, price-per-MTok by token class.
- **Goal / Objective / KeyResult** — single Goal → DAG of Objectives (parent
  edges carry contribution-weight %, sum ≤100%) → measurable KRs. An agent with
  no owned Objective is blocked from running.
- **Assignment** — a delegated unit of work: `assigner_position`,
  `assignee_position`, task ref, `authority_basis` (subtree | approved-cross-team
  | human), approval ref, status. The agent-to-agent control record.
- **Turn / UsageRecord** — one provider round-trip: served_model, stop_reason,
  request_id; normalized usage `{input, output, cache_read, cache_write_5m,
  cache_write_1h, server_tool_surcharge, served_model, is_estimated}` → spend.
- **BudgetLedgerEntry** — append-only: cap, used, reserved, remaining; delta +
  reason (`turn|estimate-hold|refund|reset`); `price_book_version`; `prev_hash`.
  Replaying it reconstructs every balance.
- **PolicyDecision / ApprovalRequest / AuditEvent** — PDP output
  (`ALLOW|DENY|REQUIRE_APPROVAL|TRANSFORM` + matched_rule + versions); durable
  parked approval (routed to nearest-common-ancestor manager or human, TTL,
  content_hash); append-only hash-chained event (actor, served_model, usage,
  request_id, correlation_id, seq).

**Relationships:** Org owns one root Position; Positions form a single-parent
acyclic tree; an Agent occupies a Position; a Position owns Objectives whose KRs
roll up to the Goal; Assignments flow down the tree (or cross-line via approval);
every Turn emits a UsageRecord → BudgetLedgerEntry + AuditEvent. Budgets roll
**up** the tree, mission cascades **down** it, approvals route to the
**nearest-common-ancestor**.

---

## 2. Architecture: supervisor-tree (chosen)

The org chart *is* the runtime spine — budget rollup, approval routing,
escalation, and mission lineage are all *the same edges*, so one structure
serves all four. (Judges' verdict: supervisor-tree 91 / blackboard 90 /
event-bus 88 — chosen for highest combined buildability + correctness.)

**Two nested loops:**
- **Org scheduler** drives the tree — claims runnable `(Position, Task)` pairs
  via `SELECT … FOR UPDATE SKIP LOCKED` (competing-consumer, crash-safe, no
  extra broker), injects the mission brief, runs one per-agent turn loop per
  claim.
- **Per-agent turn loop** = the manual agentic loop wrapped in governance.

**Key invariants:**
- **Delegation is authority-checked at the tool layer, never in the prompt.**
  `assign_task(target)` is allowed only if `target ∈ descendants(assigner)`;
  cross-line → `REQUIRE_APPROVAL` routed to the NCA. A jailbroken IC cannot
  command the CEO — it's a runtime guard, not a request in a system prompt.
- **Every effect goes through the metering/governance kernel — the only
  sanctioned provider client.** Network egress to provider endpoints is denied
  except through the kernel. One un-wrapped SDK call would void the hard-cap
  guarantee, so it's blocked at the sandbox boundary, not by convention.
- **All read-state is `fold(events)`.** Budgets, org chart, goal attainment,
  agent status, review queue are projections of one append-only, hash-chained
  log. Audit, live observability, and replay-testing fall out for free.
  *Exception:* budget admission is a **synchronous transactional CAS** — never
  make it eventually-consistent or the cap leaks.

---

## 3. Module / package layout

```
zero-human/
├── core/             # shared contracts: Event/Command schemas, UsageRecord,
│                     #   NormalizedEvent union, AdapterCapabilityProfile, PDP types.
│                     #   Versioned with upcasters (the log must replay forever).
├── eventlog/         # append (hash-chain + prev_hash), partitioned streams,
│                     #   projection runner, full-log replay + verify harness.
├── providers/        # ProviderAdapter interface + AnthropicAdapter,
│                     #   OpenAICompatAdapter, ProductSurfaceAdapter; client
│                     #   factory (first-party/Bedrock/Vertex/Foundry);
│                     #   capability discovery. managed_agents (V2). router (V1).
├── kernel/           # THE GATE — sole provider egress. PEP→PDP, pre-flight
│                     #   budget admission (atomic CAS), post-turn settlement,
│                     #   tool dispatch + sandbox, audit emit.
├── budget/           # versioned price book, atomic ledger, reserve/commit/
│                     #   refund, burn-rate, period reset, read-model, rollup.
├── governance/       # policy engine, durable approval queue, scope model,
│                     #   kill-switch/quarantine, hash-chain verifier.
├── org/              # Role/Position/Agent graph + invariants (single-root/
│                     #   acyclic/NCA), authority resolver (pure fn), templates.
├── goals/            # objective DAG + invariants, strategy-approval SM,
│                     #   mission-brief assembler (token-bounded), KR rollup.
├── knowledge/        # ingestion, org-partitioned vector index, retrieval tool,
│                     #   citation validator, seeds registry, layered memory.
├── review/           # OutputCaptured hook, WorkItem SM, review-as-gate, routing.
├── observability/    # derived-status SM, heartbeat/lease, SSE fan-out, spans.
├── scheduler/        # org work queue (SKIP LOCKED), runnable-position select,
│                     #   per-provider rate-limit token buckets.
├── supervisor/       # reactive event→command reactors (BudgetExhausted→suspend).
└── api-dashboard/    # read-only UI over projections + SSE feed + approvals.
```

**Dependency rule:** everything depends on `core` + `eventlog`; only `kernel`
calls `providers`; domains communicate via events.

---

## 4. The four hardest subsystems

### 4a. Multi-provider adapter (the one load-bearing contract)

No unified cross-provider SDK exists; the abstraction must be narrow:

```
build_request(system, messages, tools, params) -> WireRequest
count_tokens(system, messages, tools) -> int          # native counter, NEVER tiktoken
submit_turn(req, stream) -> Iterator[NormalizedEvent]  # text|thinking|tool_use|stop|usage
normalize_usage(final_message) -> UsageRecord          # the most important method
capability() -> AdapterCapabilityProfile
classify_error(exc) -> retryable | non-retryable
```

- **AnthropicAdapter** (MVP first-class): client factory per surface
  (`Anthropic()` vs Bedrock vs Vertex vs Foundry — never fake via base_url);
  adaptive thinking; stream by default; read usage **only** off the final
  message.
- **OpenAICompatAdapter** (DeepSeek + OpenAI-style): `base_url`+key; no cache
  tiers → those fields 0.
- **ProductSurfaceAdapter** (OpenClaw/Cursor/Codex): declare only what's
  programmatically callable; no usage → estimate + `is_estimated=true`.
- **Five non-negotiable loop rules:** (1) parallel `tool_use` → execute
  concurrently → all results in ONE user turn; (2) `pause_turn` → resend
  without an injected message; (3) usage only off the final message; (4) append
  the full response content (preserve thinking/tool_use); (5) check
  `stop_reason` **before** `content[0]` (refusal can be empty content).

### 4b. Hard budget metering + kill-switch

Product copy is the spec: *"When they hit it, they stop. Automatically."*
Enforcement lives in the kernel's pre-flight admission gate — the only path to
a provider.

```
PRE-FLIGHT (atomic CAS on the budget projection):
  reserve = price(count_tokens(input)) + price(max_tokens ceiling)   # worst case
  if remaining - reserved - reserve < 0: DENY → BudgetExhausted → Suspend  # call NEVER issued
  else: reserved += reserve  (EstimateHeld event, same transaction)
DISPATCH: adapter.submit_turn(...)
POST-TURN (settle): used += price(normalize_usage(resp)); reserved -= reserve  (atomic)
```

- **Last-dollar race** closed by atomic CAS co-located with the log in one
  Postgres transaction — *a pure event log can't provide the synchronous CAS
  the kill-switch needs.*
- **Subtree rollup + org-level aggregate cap + approval-on-hire** closes the
  self-staffing runaway (per-agent caps alone are insufficient).
- **Streaming overshoot is irreducible:** reserve worst-case at stream start;
  partial output is still billed (stated honestly); V2 adds mid-stream abort.

### 4c. Governance / approval + audit

- **PDP is a pure deterministic function** `(action, identity+role+scope,
  budget_state, policy_version, org_tree) → decision`. Purity makes the audit
  **replay-verifiable**.
- **Authority resolver** `can_assign(a, b) := b ∈ descendants(a)` — pure, the
  most-tested function; authority is **snapshotted at dispatch** so a mid-flight
  reorg doesn't retroactively illegalize in-flight work.
- **Approvals park durably, never block the org** — other branches keep
  working; resume is idempotent and re-validates budget+scope; timeout →
  auto-deny or escalate to a **human-governor backstop**.
- **Audit log = the event log:** append-only, hash-chained, `INSERT`-only
  grants, periodic Merkle checkpoints; secrets redacted at write (store
  hash-of-original).

### 4d. Real-time observability

- **Single chokepoint:** the kernel emits every event; agent-reported status is
  an untrusted hint. **Derived status only** (IDLE/THINKING/ACTING/
  WAITING_ON_APPROVAL/BLOCKED/BUDGET_STOPPED/ERROR/OFFLINE) from spans +
  heartbeat/lease + budget + approval state.
- **Token/cost attached in-band** at emit time from the same `normalize_usage`
  the enforcer uses → live overlay never disagrees with enforcement.
- **SSE fan-out decoupled from execution;** reconnect via `Last-Event-ID`/`seq`;
  ordering by harness-assigned `seq`, never wall-clock. Audit/budget/approval
  events are never sampled or dropped.

---

## 5. Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | **Python 3.12 + asyncio** | first-class Anthropic SDK; agent loops are I/O-bound → cheap fan-out |
| Provider SDK | **official `anthropic`** + raw OpenAI-compatible via `httpx` | don't fake Anthropic via base_url; SDK auto-retries 429/5xx |
| Primary store | **PostgreSQL 16 + pgvector** | one ACID engine: transactional admit+reserve, org-invariant ancestor walks, INSERT-only audit, `SKIP LOCKED` claiming, org-partitioned vectors |
| Hot state / bus | **Redis** | budget-remaining reads, rate-limit buckets, lease TTLs, read-model, SSE pub/sub |
| Transport | **Postgres LISTEN/NOTIFY + SSE** (MVP) → Kafka at volume | projection model means swapping transport later doesn't touch domain logic |
| Token counting | provider `count_tokens` — **never tiktoken** | tiktoken undercounts → under-reserves → overshoot |
| Sandbox | per-agent container, egress allow-listed to kernel only | the metering wrapper is literally the only client an agent gets |
| Frontend | **React + TypeScript**, SSE client w/ Last-Event-ID | org chart, status board, budget table, review queue share the event schema |

---

## 6. Phased roadmap

**MVP — smallest demoable slice: define goal → hire 2 agents → run with budget
cap → watch live.**
- `goals`: single Goal + one-level objective tree; strategy-approval gate.
- `org`: Role catalog + 1 "Lean Startup" template; hire into Position;
  single-parent tree with in-transaction invariants; pure authority resolver.
- `providers`: AnthropicAdapter (first-class) + OpenAICompatAdapter; client
  factory + credential store + cheap validation probe at hire time.
- `kernel` + `budget`: manual turn loop with all five correctness rules;
  pre-flight reservation; atomic CAS hard-stop; post-turn settle; static price
  book; append-only ledger.
- `governance`: per-tool approval flag + block-until-decision; PEP→PDP gate;
  capability allow-list (least privilege).
- `observability`: append-only event log + derived-status board + live SSE feed
  + per-agent used/cap rows and org total (the mockup's 140/240).
- `review`: synchronous exactly-once OutputCapture.
- **Demo:** define "Build the #1 note app to $1M MRR", hire CEO+CTO (caps
  80/40), approve, run; dashboard shows live status, burn, and a hard stop when
  an agent hits its cap.

**V1 — reliability, depth, governance.** Reserved-budget holds; soft-threshold
warnings; burn-rate projection; capability bundles + per-tool policies;
deny-with-reason; cross-functional assignment via NCA approval; gated dynamic
self-staffing; provider/model routing + fallback; live capability discovery; KR
progress ingestion + alignment gate; Knowledge Garden (ingestion, hybrid
retrieval, mandatory citation validation, seeds, layered memory); review-as-gate;
credential rotation; kill-switch/quarantine/global pause.

**V2 — scale & advanced surfaces.** Managed-agent execution mode; programmatic
tool calling for large tool sets; reorg/succession + in-flight Assignment
transfer; matrix reporting; Merkle checkpoints + compliance export;
reconcile-against-provider-invoice; cost-per-goal attribution; attainment
forecasting; multi-goal portfolio; promote-seed-to-KB learning loop.

---

## 7. The TEST / EVAL harness (the project's namesake)

Principle: **make agent behavior deterministic and replayable so the harness is
tested without burning tokens or depending on model nondeterminism.** Because
all state is `fold(events)` and the PDP is pure, the whole system is
reproducible.

- **7.1 Pure-function unit tests** — `authorize(assigner, assignee)` (property
  test over random org trees: an IC can never command the CEO); PDP determinism;
  org invariants; cost golden tests (cache 0.1×/1.25×/2.0×, batch 0.5×, refusal
  = $0); `fold(ledger) → balance` order-independence.
- **7.2 Recorded-provider replay** — a `ScriptedAdapter` serves canned
  `NormalizedEvent` streams + exact `UsageRecord`s keyed by request hash. Record
  once against real providers, replay forever (byte-stable, zero cost).
  Adversarial fixtures exercise every documented trap (empty-content refusal,
  `pause_turn`, usage-on-final-message, out-of-order batch, mid-stream fallback
  repricing, parallel tool_use). A `ChaosAdapter` injects retryable vs
  non-retryable errors and missing-usage.
- **7.3 Full-log replay verification** — re-fold a recorded org run to assert
  **cap-breach count = 0**, budgets reconcile, invariants hold, no orphaned
  work; re-run the PDP over recorded events → every historical decision
  reproduces; walk the hash chain → no tamper; time-travel reconstruction.
- **7.4 End-to-end scenario sims** (`SimulatedOrg` on `ScriptedAdapter` + a
  logical-clock scheduler): hard-cap under concurrency (two turns race the last
  dollar → exactly one admits); approval deadlock; reorg mid-flight;
  self-staffing runaway; cross-tenant isolation; kill-switch latency.
- **7.5 Egress-bypass guard test** — a direct un-wrapped SDK call from agent
  code fails at the sandbox network boundary.
- **7.6 Planner/decomposition-quality lane** — CEO-agent's goal decomposition
  scored by LLM-as-judge vs labeled golden decompositions; **sampled, cached,
  out of the deterministic CI lane** (flaky model behavior never breaks the
  build); tracked as a quality metric, not a gate.

**CI shape:** `unit` → `contract` (each adapter vs golden fixtures) →
`simulation` (full scenarios on ephemeral Postgres + ScriptedAdapter) →
`replay-verify`. All deterministic, no network. Nightly `live-capture`
re-records golden fixtures against real providers to catch upstream API drift.

---

## 8. Open decisions (answer before building)

These materially change the MVP scope:

1. **Real money or simulated budgets at MVP?** If real, idempotency/double-spend
   and the `is_estimated` soft-cap gap become blocking now; if simulated, most
   cost risk defers and the demo is far cheaper to prove.
2. **Single-tenant or multi-tenant?** Decides whether a Tenant root exists above
   Org and whether `org_id` isolation is a day-1 invariant.
3. **Local/self-hosted vs hosted SaaS?** Determines whether you control Postgres
   grants (audit-integrity assumption) and the sandbox model.
4. **What does "harness" mean primarily** — orchestration substrate, or also the
   eval/test framework? Both are scoped here; pick the primary or the MVP
   doubles.
5. **Multi-provider day-1 or Anthropic-first?** The adapter contract is the
   hardest seam; ≥2 providers at MVP front-loads the leakiest abstraction.
6. **Does the hard cap allow overshoot, and who eats it?** Streaming/fallback
   overshoot is admitted as irreducible — decide hard-stop-before vs
   reconcile-after, since it changes the kernel's core invariant.

### Known gaps the critique flagged (track these)
- Idempotency on the provider call across a crash (WAL-intent record / idem key).
- `estimate < actual` overshoot policy beyond "stated honestly."
- Tool-execution wall-clock/turn/depth ceilings (loop containment) — **add a
  dumb per-Assignment turn-count + depth cap in MVP**, cheap insurance.
- Context-window cost (input/context is the real cost driver, not output).
- Schema/upcaster migration contract + replay-against-old-versions test.
- Human-governor authz / two-person rule (privilege-escalation surface).
- Confused-deputy: arg-level tool policy, not just tool-identity authority.

### Highest-leverage MVP simplifications (from the critique)
- Ship **Anthropic-only** first-class; defer OpenAICompatAdapter.
- Reserve on a **flat per-turn cost ceiling** (skip the pre-flight
  `count_tokens` round-trip) for MVP.
- Drop containers for MVP; enforce single-egress via in-process capability
  injection + network deny-default + the egress test.
- **Budget is the only governance gate** at MVP (per-tool boolean approve-flag +
  hard cap); defer PDP/NCA depth.
- Single-tenant, single-org-per-process for MVP.
