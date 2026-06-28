# zero-human — ULTRAPLAN (Operating Layer Addendum)

> The real-world operating layer on top of the supervisor-tree harness. PLAN.md
> decided the spine (kernel-as-sole-effector, hash-chained event log, all
> read-state = `fold(events)`, Position ≠ Agent, NCA approval routing, budget
> admission as the one synchronous atomic CAS). This document decides how the
> org actually *works in the world*: how it reflects and learns, where agents
> work, how it reaches external systems, who does what, how work changes hands,
> how agents talk, what interns are, how outputs stay grounded in reality, and
> the **final, locked tech stack** we build from.
>
> **One invariant governs everything below:** reflection, work, messages,
> handoffs, and effects are all *agent output*, and **agent output is
> untrusted.** Nothing an agent says causes an effect, a spend, or a config
> change. Every loop closes through either a **deterministic kernel check** or a
> **human/manager gate**. The grading pen is always on the kernel's side of the
> sandbox boundary.

---

## Table of contents

1. [Feedback & reflection loops](#1-feedback--reflection-loops)
2. [Where agents work](#2-where-agents-work)
3. [Integrations & real-world reach](#3-integrations--real-world-reach)
4. [Department / role catalog](#4-department--role-catalog)
5. [Handoffs & deliverables](#5-handoffs--deliverables)
6. [Hierarchical communication](#6-hierarchical-communication)
7. [Interns](#7-interns)
8. [Real-world grounding](#8-real-world-grounding)
9. [The definitive tech stack](#9-the-definitive-tech-stack)
10. [End-to-end scenario trace](#10-end-to-end-scenario-trace)

A note on conflict resolution: where domains overlapped, this synthesis makes a
single call and states it. The notable reconciliations: **comms, handoffs, and
effects all reuse the *same* NCA approval machinery** (no parallel gates);
**review-as-gate is one mechanism** consumed by feedback, handoffs, and
grounding; **budget admission stays the single synchronous CAS** while a second
synchronous exception (sandbox-slot admission) is added explicitly; and the
**leaf-only CAS + async ancestor roll-up** design from the stack red-team is
adopted as the canonical budget mechanic everywhere caps appear.

---

## 1. Feedback & reflection loops

**Principle:** reflection is more untrusted agent output. Self-critique never
gates an effect on its own. Memory and role-versions are *curated projections of
reviewer-attributed events*, never free-form agent self-edits. The event log is
the single source of truth for every loop.

### The five loops, by tightness and authority

| # | Loop | Trigger | Cadence | Who closes it | State written |
|---|---|---|---|---|---|
| 1 | Self-critique | before `submit_work` | per-turn / per-assignment | agent (advisory) + kernel (gate) | event log only |
| 2 | Review → rework | Review Center verdict | per-work-item | manager/human (gated) | event log → Assignment, Position memory |
| 3 | Standup / retro | objective/KR boundary or cadence | per-objective / weekly | manager agent → human approve | event log → strategy, role draft |
| 4 | Eval / learning | harness metrics cross threshold | nightly / per-release | human + CI | role version, policy version |
| 5 | Anti-gaming | always-on | continuous | kernel + harness (no agent path) | event log, quarantine |

### 1.1 Self-critique (before `submit_work`)

Two deliberately separated mechanisms:

- **Soft self-critique (untrusted, advisory).** The turn loop injects a
  reflection sub-prompt keyed to the Role rubric. Captured as
  `SelfCritiqueRecorded{work_item_id, self_score, self_flags[], revised}`. The
  agent may revise within the same Assignment, bounded by the turn/depth cap.
  Produces **no durable memory** — it's a per-turn artifact, evidentiary to
  reviewers (an agent that flagged its own weak citation and submitted anyway is
  a flag-worthy signal).
- **Hard pre-submit gate (kernel, deterministic).** `submit_work` runs the same
  deterministic checks the Review Center would, *before* queuing: citation
  validity (cited seed/KB ref resolves and supports the claim span),
  acceptance-criteria presence (machine-checkable checklist), output-schema
  conformance, and rework-budget headroom. The agent can lie in `self_score`; it
  **cannot** submit a citation that doesn't resolve.

### 1.2 Review → rework + durable memory

Review verdicts drive the WorkItem state machine:

| Verdict | Event | Effect | Automatic vs gated |
|---|---|---|---|
| mark-correct | `WorkApproved` | Assignment → DONE; result flows UP | action gated; propagation automatic |
| flag | `WorkFlagged{reasons[], rubric_deltas[]}` | spawns rework Assignment to **same Position** | flag gated; dispatch automatic |
| reassign-to-expert | `WorkReassigned{target}` | new Assignment to different Position | NCA-gated if cross-line |

Rework is a **new Assignment to the same Position** (preserves append-only),
carrying the original draft so the agent does delta-correction (saves budget).
Rework is budget-charged to that Position and bounded by `max_rework_rounds`
(default 3) → on exceedance, escalate to NCA.

**Durable memory — three layers, different write authority:**

| Layer | Scope | Write authority | Read into prompt |
|---|---|---|---|
| Episodic | one Assignment | kernel (event fold) | current turn only |
| Position memory | a Position (survives swap) | manager-approved or **auto from reviewer `rubric_delta`** | mission-brief assembler (token-bounded) |
| Role guidance | a Role version | **human-gated only** | every occupant of the Role |

The agent **never writes its own long-term memory or system prompt.**
Position lessons are derived *only* from reviewer-attributed deltas — so
fire-and-rehire keeps the lesson ("this seat keeps shipping stale dates") for
the next occupant. A cross-Position pattern becomes a *proposed* Role-version
diff a human approves (new version; never rewrites history).

### 1.3 Standups & retrospectives

A retro is just a manager Position running a special Assignment whose inputs are
the folded events of its subtree.

- **Standup (operational):** scheduled Assignment per manager; input = derived
  status + open WorkItems + burn-rate + blocked/approval-waiting; output =
  `StandupReport` (flows up) + re-prioritizations **within the manager's own
  subtree** (within authority, no approval). See §6.2 — this is a *synthesized
  digest turn*, not live multi-agent chat.
- **Retro (strategic):** at Objective/KR boundaries; output = `StrategyProposal`
  (re-weight Objective DAG, open/close requisitions, reallocate budget, propose
  Role-guidance changes). **Strategy changes are human-gated** through the
  existing strategy-approval state machine — a retro produces a diff for the
  governor, never a unilateral re-weight of the north star.

### 1.4 Eval / learning loop

Because all state is `fold(events)` and the PDP is pure, every metric is
computed by **re-folding recorded runs** — deterministic, zero-token.

| Metric | From event fold | Breach drives |
|---|---|---|
| **cap-breach count** | settled spend > envelope (must be **0** by invariant) | *bug class* → CI red, blocks release |
| **citation-failure rate** | failed citation validations ÷ submitted | per-Role rubric tightening; proposed Role diff |
| **rubber-stamp rate** | mark-correct with low dwell + untouched rubric | flags the *reviewer* → loop 5 |
| **alignment-flag rate** | goal-misalignment flags ÷ submitted | mission-brief tuning; Role guidance |

Every event carries `served_model`, `role_version`, `position_id`, so metrics
slice three ways: by **Agent/model** (re-hire decision — swap occupant, keep
Position), by **Role version** (validate or roll back a guidance change), by
**Position** (the task/structure is wrong regardless of occupant → org redesign
signal). The loop **emits proposals; a human approves**; approved versions
become golden replay fixtures so a "fix" that raises cap-breach or
citation-failure is caught in CI. The *content-quality* judge lane (LLM-as-judge)
is sampled, cached, and **out of the gating CI lane** — quality judgments inform
proposals, never break the build.

### 1.5 Anti-gaming (no marking your own homework)

| Attack | Defense |
|---|---|
| Inflated self-score | `submit_work` gate uses deterministic checks, not the score; chronic optimism is itself a metric |
| Reviews own work | authority resolver rejects review where reviewer == assignee (and, V1, in own chain for KR-feeding work) |
| Manager rubber-stamps subordinate | rubber-stamp metric targets the reviewer → sampling re-review by human governor; two-person co-sign on KR-feeding approvals (V2) |
| Fake citations | deterministic citation validator at the kernel gate |
| Goodhart the lessons | agents cannot write Position/Role memory; lessons derive only from reviewer deltas |
| Gaming a metric | metrics are multi-dimensional and adversarial; no single metric is an agent-controlled gate |
| Reflection budget drain | bounded by turn/depth cap + hard budget cap (pre-flight admission denies the next reflection turn when headroom is gone) |
| Tamper with the record | append-only hash-chained log + Merkle checkpoints (V2) |

**Structural guarantee:** there is **no code path** by which an agent's
self-assessment causes an effect, a budget change, or a config change.

**Phasing.** MVP: `OutputCaptured` + deterministic pre-submit gate; manual
review + rework dispatch; events emitted (not yet folded to dashboards). V1: LLM
self-critique + citation gate + bounded revision; review-as-gate; auto
Position-lessons; standups; the four metrics dashboarded with attribution;
separation-of-duties + rubber-stamp metric. V2: full retros with goal-DAG
re-weighting; A/B Role-version diffs; regression-fixture promotion; two-person
co-sign; Merkle checkpoints.

**Module homes:** `review/`, `knowledge/`, `goals/`, `eventlog/` + test harness,
`governance/`, `kernel/`.

---

## 2. Where agents work

A **Workspace** is not a new authority — it's a **scoped capability bundle + a
sandbox + a persistence root**, all still mediated by the kernel. The Position
decides *who* an agent is; the Workspace decides *what surface they touch*. Every
world-affecting operation in a workspace is a kernel tool call that hits the
event log. The agent never gets a shell, a browser, or a DB connection — it
emits tool calls; the kernel runs them *inside* the workspace sandbox.

### 2.1 The Workspace object

```
Workspace {
  workspace_id, org_id
  position_id            # owner Position (survives fire/rehire)
  type                   # CODE | RESEARCH | DOC_CANVAS | SUPPORT_INBOX | DATA_ANALYST | GENERIC
  lifecycle              # EPHEMERAL | SESSION | PERSISTENT
  sandbox_ref            # handle to the running isolate
  capability_grant_id    # exact tool subset the kernel exposes here
  mounts[]               # { kind, ref, mode:ro|rw }
  persistence_root       # object-store prefix + PG rows that outlive the sandbox
  budget_envelope_ref    # workspace sub-cap (rolls up to Position)
  state, content_hash_head
}
```

Lifecycle is event-sourced (`WorkspaceProvisioned → Activated → Checkpointed* →
Suspended/Resumed* → TornDown`); read-state is a projection. **Sandbox-slot
admission is a synchronous CAS** — the second documented exception alongside
budget — because compute oversubscription is as unrecoverable as a budget leak.

### 2.2 Workspace types

| Type | Default tools | Sandbox tier | Lifecycle | Seed produced |
|---|---|---|---|---|
| **CODE** | `fs`, `shell.exec`, `git.*`, `pkg.install`, `test.run`, `lint`, `lsp` | **T2 microVM**, egress = kernel proxy + allow-listed registries | EPHEMERAL (PERSISTENT for long-lived repos) | PR / branch diff |
| **RESEARCH** | `browser.*`, `web.search`, `web.fetch`, `kb.write_seed`, `cite.record` | **T1 container + headless browser**, filtering egress proxy | SESSION | cited brief / dataset |
| **DOC_CANVAS** | `doc.edit` (CRDT), `canvas.node.*`, `asset.*`, `export.*` | **T1 container**, no exec | PERSISTENT | published doc / asset |
| **SUPPORT_INBOX** | `ticket.*`, `kb.search`, `macro.apply`, `escalate` | **T1 container**, egress = ticket connector only | PERSISTENT | resolved ticket / macro |
| **DATA_ANALYST** | `sql.query` (read-replica), `df.*`, `chart.render`, `notebook.cell.run` | **T2 microVM**, kernel DB proxy enforces row/col policy | SESSION | chart / SQL-backed report |
| **GENERIC** | chat + `kb.search` + `ask_manager` | **T0 none** (pure LLM) | EPHEMERAL | text answer |

Org tools (`assign_task`, `submit_work`, `open_requisition`, `ask_manager`) are
layered onto **every** workspace by the kernel.

### 2.3 Isolation — three tiers, five invariants

Tiers: **T0** none (in-process, no exec); **T1** container (seccomp, read-only
rootfs, dropped caps); **T2** microVM (separate guest kernel). **Default rule:
any workspace that executes agent-authored code or untrusted tool output runs at
T2.** Browser-driving runs T1 + filtering egress proxy.

The five hard invariants:
1. **Single egress** — only route out is the kernel proxy; default-deny; a direct
   provider SDK call from agent code fails at the network boundary.
2. **Secrets never in the sandbox** — keys/creds/tokens live only in the kernel,
   injected at call time, redacted from the log. *(Strengthened by the stack
   red-team — see §3.4 and §9: prefer host-side proxying / egress-substitution so
   the sandbox ideally never holds a live credential.)*
3. **Mounts explicit and mode-checked** — a workspace touches only its `mounts[]`;
   cross-tenant mount impossible by `org_id` scoping.
4. **Resource caps = a second kill-switch** — CPU/mem/disk/wall-clock/PID limits
   stop fork-bombs and runaway installs (budget stops *token* spend).
5. **Sandbox disposable + reconstructible** — durable truth is the event log +
   `persistence_root`; a suspect sandbox is quarantined and torn down, never
   trusted-then-cleaned.

### 2.4 The Flow Canvas (The Floor)

The canvas is a **projection (a view), not the execution substrate.** Execution
happens in the supervisor-tree + workspaces; the canvas renders it and lets a
human inject work. Each node = a unit of work bound to a Position+Workspace;
edges = data/seed flow.

| flowith element | zero-human meaning |
|---|---|
| "Ask AI anything" | ad-hoc query → transient node, routed to most-fit Position or a GENERIC scratch workspace |
| AGENT MODE toggle | OFF = one metered GENERIC turn; ON = a goal-bearing Assignment that cascades, spins up typed workspaces, delegates — **and hits the budget gate before running** |
| Seeds | artifacts produced by nodes; dragging a seed into a new node = using a prior artifact as input |

Nodes inherit the derived-status state machine and the in-band token/cost
overlay; the canvas subscribes to the SSE fan-out. Approvals surface as
canvas affordances (approve/deny chip on a `WAITING_ON_APPROVAL` node). **The
canvas owns no separate execution path** — anything on it is expressible as org
events.

### 2.5 Ephemeral vs persistent + artifact/seed persistence

Two orthogonal axes: the **sandbox (compute)** is always disposable; the
**persistence root (data)** is what survives. `lifecycle` governs the *binding*,
not the sandbox. Because the Workspace binds to the **Position**, fire-and-rehire
keeps the repo / doc / ticket queue / KB partition for the new occupant.

Nothing durable lives only in a sandbox. Promotion is explicit:

| Durable thing | Store | Mechanism |
|---|---|---|
| Workspace checkpoint | git remote / object store + PG pointer | `WorkspaceCheckpointed` (content_hash) |
| Artifact | object store + PG metadata | produced by a tool (`git.push`, `export.pdf`) → event |
| Seed | Seeds registry | `kb.publish_seed(artifact_ref)` → entry + provenance + citations |
| Knowledge | KB / pgvector | `kb.write_seed` / ingestion |

A **seed** is the canonical unit that escapes workspace lifetime — it carries
`provenance` (event lineage) and `citations`, so the Review Center can audit it
and the Flow Canvas can re-wire it. Seeds are the cross-cutting currency: a
RESEARCH brief → DOC_CANVAS input → published artifact, each step a seed with
provenance back to the originating event.

**Phasing.** MVP: GENERIC + CODE (single container, deny-default egress,
in-process tool injection); EPHEMERAL + PERSISTENT; flat artifacts table. V1:
RESEARCH/DATA_ANALYST/DOC_CANVAS; real per-workspace sandbox; Seeds registry +
provenance; SESSION suspend/resume; canvas node-graph + seed drag-wiring. V2:
SUPPORT_INBOX + connectors; warm-pool microVMs; multi-workspace agents; content-
addressed seed dedup; flow templates.

**Module addition:** a `workspaces/` package (registry + lifecycle SM, sandbox
driver interface T0/T1/T2, capability bundles, mount resolver, checkpoint/
rehydrate, seed promotion). Only `kernel` invokes its sandbox dispatch.

---

## 3. Integrations & real-world reach

**Thesis:** every external system is reached through a typed, capability-gated
kernel tool. **The kernel — never the agent — holds tokens, calls out, and
writes the event. Side-effecting tools route through approval *before* the call,
never compensate after.** Agents emit intents; they never speak the integration
protocol directly.

### 3.1 The connector model — one shape

Three layers per integration:

| Layer | What | Trust |
|---|---|---|
| **Provider** | the external SaaS | untrusted boundary |
| **Connector** | a process speaking the integration protocol on one side, the provider API on the other | semi-trusted, sandboxed |
| **Capability** | a single typed action registered as a kernel tool | trusted spine |

Every connector ships a **manifest** the kernel ingests *before* any agent can
touch it — declaring per-capability `effect` class, `scopes_required`,
`approval` policy, `idempotency`, `rate_class`, `reversible`. **The manifest is
the law:** a capability with no effect class doesn't exist; CI rejects a write
cap without an approval policy.

### 3.2 Why this substrate (and the maturity caveat)

The agent-facing tool interface uses **MCP-style typed tool schemas** (clear
in/out schemas reduce hallucination; enumerable capability surface; process
isolation as a natural trust boundary). **But MCP standardizes the tool
interface, not the credential lifecycle** — so underneath, a code-first OAuth/
credential-and-sync substrate (**Nango**, locked in §9) owns the painful part:
dozens of OAuth flows, token refresh, rate-limit/retry. **The kernel is the only
client of both** — agents never hold a connector client or a credential.

> **Red-team amendment (adopted):** MCP's multi-tenant OAuth conventions are
> still settling, and hosted-MCP credential failures tend to surface late/async.
> That fights our fail-closed invariant. Therefore: (a) **credential failures
> are pre-flight and fail-closed at the kernel**, emitting a refusal event — never
> deferred to async runtime retries; (b) MCP multi-tenant OAuth is a **tracked
> risk**, and the tool seam is built so we can drop to **direct Nango-mediated
> typed tools** if MCP's auth story stalls.

### 3.3 Token storage, scoping, refresh

- **Tokens live only in the vault**, keyed by `(org, connector, [position])`,
  KMS envelope-encrypted; never in Redis, env vars, prompts, or log payloads.
  Agents reference an opaque **handle** (`conn_7f3a…`).
- **Injection happens at the kernel→connector boundary**, after the prompt is
  gone; token lifetime in memory = one call. Every result is **egress-scrubbed**
  for token-shaped strings before it can reach an agent-readable surface.
- **Two scoping grains:** *per-org* (company-wide credential — Stripe account,
  GitHub install) and *per-position* (the SDR's own HubSpot seat + mailbox, so
  sends are attributable and revocable per occupant). Per-position is the
  differentiator: fire-and-rehire keeps the *connection slot*, rotates the
  occupant's token.
- **Refresh daemon** (kernel, not agent/connector) refreshes at ~75% TTL; a
  failed refresh flips the connection to `degraded`, auto-disables its
  capabilities, and routes a governance event up the tree. Prefer least-privilege
  at the provider (GitHub App installs, scoped service accounts, Stripe
  restricted keys).

### 3.4 Effect taxonomy → approval (automatic from the manifest)

| Effect class | Default approval | Examples |
|---|---|---|
| `read` | none | search, list, get, GA4 report, scrape |
| `write.internal` | manager auto-policy (often none) | create Linear issue, email draft, update Notion page |
| `write.external` | **required** | send email, CRM sequence send, public ticket reply |
| `write.public` | **required** | Slack post to external channel, social post |
| `write.code.merge` | **required** | merge PR, deploy |
| `write.money` | **required (board-level)** | Stripe refund/charge, payout |
| `write.money.ads` | **required + budget-linked** | raise ad budget, launch campaign |

Approval requirement is a **property of the effect class**, not a per-agent
toggle. Approvals route to the **nearest-common-ancestor** with authority for
that class (same machinery as everything else); `write.money*` escalates to the
human board. The approval card carries a **dry-run/preview of the actual content**
(email body, refund amount) — the human approves content, not an abstraction.
The connector call **has not happened** while approval is pending. *(See §8.3 for
risk-tiering, the two-person rule on CRITICAL effects, and host-side secret
proxying that strengthens §2.3 invariant #2.)*

### 3.5 Idempotency + webhooks → KRs

**Idempotency** (so a crash between call and log-write never double-sends):
`idem_key = hash(connection, capability, canonical(args), assignment, turn_seq)`,
reserved in an `external_effects` table *before* the call (`INSERT … ON CONFLICT
DO NOTHING`), and passed to the provider's native idempotency (Stripe
`Idempotency-Key`, Slack `client_msg_id`, email `Message-ID`). `reversible:false`
caps (refunds, sends, merges) get **no auto-retry without reconciliation**. This
makes the event log a true replay fixture: re-running history re-derives state
without re-firing effects.

**Webhooks** (the world pushes back) ingest to the **same hash-chained log**:
verify signature (manifest declares the scheme) → dedupe by provider event id →
append `connector.webhook.received` → ack fast → async route to subscriptions.
The payoff: a **KR declares a metric binding** (`on stripe.invoice.paid →
increment kr.mrr`), so KR progress is a fold over inbound events with **zero
agent action**. Other routes: `check_run.completed=failure` wakes a suspended
assignment; `app_mention` from the governor becomes an `ask_manager` inbound. For
providers without webhooks (GA4, Ads), a kernel **scheduled poller** emits the
same `connector.*.observed` shape — downstream routing is identical.

### 3.6 Connector matrix (phased)

MVP: **Slack, GitHub, Gmail, Notion/Docs, Linear, web search/scrape** (ship
software + communicate), plus signed webhooks for GitHub/Slack/Stripe and the
`invoice.paid → MRR` binding as proof-of-loop. V1: Stripe, HubSpot, GA4,
Zendesk, Jira, Outlook; full subscription router; standing/thresholded
approvals; analytics/ads pollers. V2: Salesforce, Google/Meta Ads, Mixpanel,
Greenhouse, Intercom; bi-directional CRM/CS sync.

**New subsystem:** `connectors/` (sibling of `knowledge/`) — manifest ingest +
`list_tools` drift check, capability compiler, vault + refresh daemon + egress
scrubber, webhook gateway, poller.

---

## 4. Department / role catalog

Conventions: **Reports/Hires are Positions**, not agents (fire-and-rehire swaps
occupants). **Gated** = human approval or NCA routing. Every role owns
Objectives→KRs; day-to-day = Assignments; each step = Turn. **Tool access is
per-Position**, granted by the kernel and inherited down the edge — capability =
`f(position, grant)`. Three universal gates apply to every role: (1) spend above
the Position's rolling budget slice, (2) any irreversible external side effect,
(3) hiring (`open_requisition`). Every deliverable is committed as a seed in the
Knowledge Garden.

| Role | Mission | Key tools / integrations | Deliverables | Reports to | Gated actions |
|---|---|---|---|---|---|
| **CEO** | Translate the human Goal into an OKR tree; allocate budget across C-suite; resolve cross-functional conflict; report to the board | `set_company_okr`, `allocate_budget`, `assign_task`, `request_board_decision`, dashboard rollup | strategy doc, OKR tree, budget table, board memo | **Human board** | strategy approval; budget re-alloc above threshold; new C-suite Position; pivot; spend over envelope |
| **CTO** | Own technical strategy, architecture, eng throughput | `assign_task`, GitHub (read), ADR, `request_deploy_approval`, budget | tech strategy + ADRs, roadmap, postmortems | CEO | prod deploys; infra/SaaS spend; merge to default; eng reqs; new integration creds to subtree |
| **COO** | Run the operating system — process, SLAs, ops/vendors | `assign_task`, dashboard rollup, `define_sla`, `vendor_contract_request`, cron | operating cadence, SLAs, runbooks, capacity plan | CEO | vendor contracts / recurring spend; customer-facing SLA changes |
| **CMO / Marketing** | Awareness + qualified pipeline within CAC | CMS, social, email, ad platforms (draft→gated send), GA4/Search Console, Research handoff | campaign brief, content seeds, editorial calendar, ROAS report, brand guidelines | CEO | any external publish/send; ad spend; legal-sensitive claims (→ Legal); influencer/vendor payments |
| **Sales** | Convert pipeline → revenue | CRM (r/w), email/sequencer, calendar, quote/proposal, DocuSign | pipeline report, proposals, forecast, outbound drafts | CEO/CRO | outbound to real prospects; discounts beyond policy; contract send; quotes over threshold |
| **Customer Success / Support** | Resolve issues fast + correctly; retention; loop to Product | helpdesk (Zendesk/Intercom), inbox, refund/credit (gated), CRM read, Knowledge Garden RAG | resolved tickets, KB articles, VoC report, churn-risk list | COO | refunds/credits; sensitive external sends; account/data deletion; any commitment |
| **HR / Recruiting** *(hires AI agents)* | Staff the org-chart at the right cost; perf-manage (fire/rehire occupants) | `open_requisition`, provider/model registry, **eval-harness runner** (replay golden objectives), scorecard, Position-graph mutation | requisition specs, candidate scorecards, eval reports, perf reviews | COO | **every hire/fire/Position create**; budget-cap setting (changes the runtime spine) |
| **Finance** | Steward money + tokens; budgets, burn, forecasts, the hard caps | budget ledger (folded), forecast, `set_budget_cap` (gated), invoicing/AP (gated), Stripe read, kill-switch config | budget, burn report, runway forecast, unit economics | CEO | real $ disbursement; raising a cap; changing kill-switch thresholds; payouts/invoices |
| **Web Research / Analyst** | Open questions → cited, decision-grade intelligence (shared service) | `web_search`, `web_fetch`, data APIs, Knowledge Garden (r/w), structured extraction, charting, **adversarial fact-checker** | market/competitor/TAM reports, analyses, reusable research seeds | CMO/COO | paid data-source spend; large scraping (cost + ToS); external publishing |
| **Product / Design** | Decide what to build + why; spec; usability; roadmap with CTO | PRD/spec editor, Linear/GitHub Issues (r/w), design-asset gen, analytics read, feedback ingest | PRDs, roadmap, stories, wireframes, acceptance criteria | CTO/CEO | creating real tracker issues; external release notes; committing the roadmap |
| **Engineering (ICs)** | Build, test, ship, maintain | GitHub (read; write/PR/merge gated), code sandbox, test runner, CI read, deps; secrets via kernel only | PRs/code seeds, tests, docs, deployable artifacts | CTO (via Eng lead V2) | merge to default; prod deploy; risky deps; spend; destructive ops |
| **Legal / Compliance** *(V1)* | Keep inside legal/regulatory/contractual lines; review risk-bearing artifacts | contract/policy review, clause library, regulatory research, redline gen, **approval-queue consumer** | redlines, risk memos, policies, compliance checklists | CEO | signing/executing; external legal commitments; filings |
| **Ops (Internal / IT / Platform)** | Keep the org's own machinery running — integrations, access, data hygiene, reliability of the agent org | connector management (gated cred binding), cron, ETL, event-log/dashboard monitoring, kill-switch ops | integration registry, access map, automation runbooks, data-quality reports | COO/CTO | binding any external credential to a Position; enabling a connector; cron with external effects; data deletion/migration |

**Cross-department gate summary — what always needs a human:** spend real $ /
raise a cap (Finance); hire/fire/create Position (HR); bind external credential
(Ops/CTO); external send to a real customer (Marketing/Sales/Support — relaxes to
policy-bounded by V2); merge-to-prod (Eng/CTO — relaxes to green-CI auto on
low-risk); sign/execute contract (Legal/Sales/CEO); change kill-switch
thresholds (Finance/Ops).

**Three reusable payoffs to enforce now:** (1) **HR screening = event-log replay**
— evaluating a candidate agent for a Position is replaying golden objectives and
scoring; reuse the audit log as the eval fixture. (2) **Research dept = the
`deep-research` harness** (fan-out + adversarial verification + cited synthesis)
— don't rebuild it. (3) **Legal/Review-Center is a shared queue** — flagged
claims, contracts, refunds, deletions from every dept route into one gate
pipeline.

**Phasing.** MVP: CEO, CTO, Eng ICs, Web Research, Support, HR (hire/fire only);
all external effects draft-only or hard-gated. V1: add COO, CMO, Sales, Finance,
Product/Design, Legal; low-risk auto-send; HR replay-based screening; Legal
first-pass routing. V2: Ops autonomy; policy-bounded autonomous external actions
within budget; progressive delivery in Eng; CRO/SRE/Security specializations.

---

## 5. Handoffs & deliverables

A handoff is the moment work crosses a reporting edge and changes owner. If that
seam is untyped and unvalidated, the org silently drifts — so the seam gets a
**contract**. This subsystem spans `knowledge/` (seeds registry + lineage),
`review/` (review-as-gate), `kernel/` (gated `submit_work`/`accept_work`). **No
agent writes a seed directly; the kernel does, on `submit_work`, after
validation.** A seed is `fold(SeedEvent[])`.

### 5.1 The artifact / seed model

Every seed has a `kind` (a closed discriminated union) determining payload
schema, default Definition-of-Done, validators, and demo surface: `doc`,
`report`, `code-pr`, `design`, `dataset`, `campaign`, `decision`, `poc`. Each
seed has a stable `seed_id`; **versions are immutable** — rework produces a new
version, never a mutation, so a consumer who accepted v2 keeps referring to v2.

Two distinct graphs, both load-bearing:
- **Lineage** = what this version was *built from* — edges point to **specific
  versions** (`derived_from: SeedRef[]`, version-pinned). Used for impact
  analysis and rework cascades.
- **Citations** = what evidence backs a *claim* — edges to KB docs / chunks /
  URLs with a `locator` and `claim_anchor`, validated by the citation validator
  (validated flag set by the kernel, not the agent).

> **Opinion (defended):** lineage edges are **version-pinned, full stop.** The
> #1 silent-break in multi-agent orgs is "the report I summarized got rewritten."
> Pinning converts silent corruption into a visible `UpstreamChanged` event.

### 5.2 The handoff protocol (state machine)

```
DRAFT ──submit_work──► SUBMITTED ──auto-validate (kernel, pure)──►
   ├─ fail ───────────────────────► REJECTED (auto)
   ├─ review-gate ──► IN_REVIEW ──► ACCEPTED ──► CONSUMED
   └─ no gate ───────────────────► ACCEPTED ──► CONSUMED
IN_REVIEW: accept_work | reject_work | request_changes(→ CHANGES_REQUESTED)
```

- **`submit_work` (producer):** kernel runs authority check → schema check →
  contract check (§5.4) → **machine-checkable DoD** (CI green, row_count>0,
  citations validated — kernel-run, not agent-claimed) → emit
  `SeedVersionSubmitted`. The agent's `self_check_report` is an untrusted hint
  shown to reviewers, never trusted for gating.
- **`accept_work` / `reject_work` / `request_changes` (consumer):**
  `request_changes` carries a structured `change_list[]` with severity
  (blocking/major/minor); **accepted sub-parts are pinned** so rework can't
  regress them; a handoff can't reach ACCEPTED while a `blocking` change is open;
  `minor` items can be accepted-with-debt (logged follow-up, not a blocker).
- **Routing:** `submit_work` delivers **up** to the assigner by default.
  Cross-line delivery (designer→engineer, peers) is **NCA-checked** like any
  cross-line assignment.
- **Bounded rework:** `max_rework_rounds` (default 3) → escalate to NCA, who can
  override-accept, reassign (fire-and-rehire), re-scope, or kill. Every rework
  round spends real tokens, so the loop is self-limiting by budget too.
- **Cascade:** when a consumed seed gets a new accepted version, `UpstreamChanged`
  fires on every pinned downstream → a `review-revalidation` assignment (V1; MVP
  = stale-lineage badge only).

> **Opinion (defended):** the DoD splits **machine-checkable** (gates for free,
> deterministic) vs **judgment** (needs a reviewer). Never spend a reviewer on
> what CI can decide — this keeps review from becoming the bottleneck the product
> exists to remove.

### 5.3 Review-as-gate vs auto-consume

A PDP policy decides per-handoff: `AUTO_CONSUME | GATE_REVIEW | GATE_HUMAN`.
Signals: `kind ∈ {decision, code-pr→prod, campaign, poc-promotion}` → gate;
crosses a line → gate; feeds a governed/customer-facing KR → human; passed
auto-validate + internal + same-team → auto-consume; low producer trust score →
gate; high spend → human.

- **AUTO_CONSUME:** immediately ACCEPTED; review happens async (a later flag
  triggers the §5.2 cascade). Keeps throughput high for low-risk internal work.
- **GATE_REVIEW / GATE_HUMAN:** the consumer's dependent assignment is **BLOCKED**
  until a reviewer accepts; the blocked Position shows `WAITING_ON_REVIEW`.

> **Default: AUTO_CONSUME for internal, GATE for anything that leaves the org or
> is irreversible.** Gating everything recreates the bottleneck zero-human
> removes; gating nothing lets one bad research report poison the CMO's strategy.

### 5.4 Producer↔consumer contracts

A versioned `HandoffContract` (parallel to the Role catalog): `name`, `semver`,
`kind`, `payload_schema`, `required_fields`, `acceptance_criteria` (each MACHINE
or JUDGMENT, blocking or not), `citation_policy`, `examples[]` (golden seeds that
double as contract tests). The Assignment binds `contract_ref = (name, version)`;
the producer claims it; the kernel validates payload at submit (drop a required
field → `REJECTED(contract_violation)` **before** any consumer sees it). The
consumer declares the version range it accepts; a mismatch is a visible
`ContractMismatch`, not a runtime surprise. Contract evolution is governed and
versioned (never rewrites history).

### 5.5 POC lifecycle (`kind: poc`)

A POC is a **claim + a runnable proof**; it's done when demonstrated and
promoted, not when submitted.

```
DRAFT → SUBMITTED → DEMOED ──(metrics pass + review)──► APPROVED ──► PROMOTED → PRODUCTIONIZED
                       └─ refuted / metrics-fail ──► ARCHIVED (kept as seed, lineage intact)
```

On `submit_work(kind=poc)` the kernel runs `demo_script` **in the sandbox**,
capturing an immutable, **re-runnable `DemoRun`** (reviewers watch the replayable
DemoRun, not a screenshare) and evaluates declared `metrics` against targets. POC
is **always gated**. On APPROVE → **PROMOTED**: the kernel auto-creates a
**productionization Assignment** with `derived_from: poc@v1`; the engineer ships
a *new* `code-pr` against the **real** repo citing the POC; on merge →
PRODUCTIONIZED.

> **Opinion (defended):** promotion **spawns new hardening work; it never
> relabels a branch.** POC code earns the right to be throwaway. Conflating it
> with prod is how "temporary" demos rot.

**New events** (all hash-chained, fold-able, zero new mutable tables):
`SeedVersionSubmitted, WorkSubmitted, WorkAutoValidated, WorkAccepted,
WorkRejected, ChangesRequested, WorkConsumed, LineageEdgeAdded, CitationValidated,
UpstreamChanged, DemoRunRecorded, PocPromoted, ContractBound, ContractMismatch,
ReviewGateDecided`.

**Phasing.** MVP: `doc/report/code-pr`; versioning; lineage (display only);
submit→accept/reject up-tree; boolean `requires_review`; contract schema check.
V1: `design/dataset/decision/poc`; validated citations enforced in DoD; partial
acceptance + bounded rework + NCA escalation + cross-line; full review-gate
policy + Review Center routing; versioned contract catalog + version-pinning +
upstream-change cascade; full POC lifecycle. V2: `campaign` + custom kinds;
trust-driven dynamic gating; replayable demo gallery.

---

## 6. Hierarchical communication

**Messages are events, not a chat system.** No separate messaging service, no
chat tables, no mailboxes as primary state. A message is an append-only
`CommEvent` on the existing hash-chained log, addressed along org edges. Inbox,
thread, channel, standup are **projections** (`fold(events)`). This buys audit,
replay, and authority **for free** — "can A talk to B" is the same
`PEP→PDP→authorize()` as a tool call — and there is no broadcast bus to melt.

### 6.1 Primitives

Six primitives. Each is a kernel-gated tool; the agent names an *intent + a
target Position*, never an address.

| Primitive | Tool | Direction | Authority rule |
|---|---|---|---|
| Assign down | `assign_task(target, brief, kr_ref)` | ↓ | `target ∈ descendants(self)` |
| Report up | `submit_work(...)` | ↑ | self is assignee |
| Ask manager / escalate | `ask_manager(question, blocking?)` | ↑ | recipient = **structural parent** (not chooseable) |
| Peer request | `request_peer(target, brief)` | ↔ | `target ∉ subtree(self)` → REQUIRE_APPROVAL @ NCA |
| Broadcast | `announce(scope, body)` | ↓ fan | `scope ⊆ subtree(self)`; rate-limited; **one event, read-side fan-out** |
| FYI / cc | `cc=[positions]` arg | ↓/↔ | each target reachable; **cc carries zero authority** |

Sharp rules: **`ask_manager` cannot choose its recipient** (always the parent —
kills the "ask the CEO directly" injection); skip-level is a chain of authorized
single hops via `escalate`, never a teleport. **There is no `send_to(any)`
primitive** — free addressing is what produces O(n²) chatter and authority leaks.
`blocking=true` parks the subordinate's Assignment (`WAITING_ON_MANAGER`) and the
scheduler stops claiming its turns until a reply lands — it holds no socket.
**`request_peer` is just NCA-gated `assign_task`** — on approve it becomes a
normal Assignment with `authority_basis=approved-cross-team`.

`CommEvent` carries `thread_id` (= correlation root; threads are derived),
`in_reply_to`, `kind`, `blocking`, `assignment_ref`, `body_ref`
(content-addressed; prose in blob store), `cc[]`, and the hash-chain fields.

### 6.2 Standups — synthesized digest turns, never live multi-agent chat

**Status is derived, pushed-by-execution, never polled.** There is no
`get_status` primitive; a manager reads the derived-status projection
(IDLE/THINKING/ACTING/WAITING/BLOCKED/BUDGET_STOPPED) for **zero tokens**.

A "standup" is a **manager-side digest turn over a deterministically-assembled
brief** — not N agents talking. The context assembler builds the digest (pure
`fold`: subordinate status + latest reports + open blocking asks + KR deltas +
burn-rate), the manager consumes it in **one turn**, and emits a `StandupReport`
up plus within-subtree re-prioritizations. Subordinates **push reports on their
own cadence; none spends a turn "attending."**

| | Digest turn (chosen) | Real multi-agent chat (rejected) |
|---|---|---|
| Token cost | 1 turn/manager/cycle | O(participants²) |
| Determinism | pure fold → replayable | nondeterministic → breaks replay-CI |
| Authority | each action edge-checked | side-channel "agreements" with no basis |

### 6.3 Shared vs private context — least-context by default

The mission-brief assembler gives a subordinate the **minimum** to do its job,
token-bounded, built only from `visible_to(viewer)`:

```
visible_to(viewer) := own_thread ∪ assigned_brief ∪ served_KR
                    ∪ distilled_ancestor_framing ∪ child_reports(if manager)
                    ∪ explicitly_shared_seeds ∪ messages where viewer ∈ {to, cc}
```

A subordinate **must not see**: sibling raw work / private threads; the full
Objective DAG or other branches; ancestors' raw deliberation (it gets a
*distilled framing*, never a transcript); credentials, other budgets, the hash
chain. **Sibling visibility is a deliberate parent decision** (`announce` or a
shared seed) — default = blind siblings. Least-context isn't a filter on a
firehose; the firehose is never assembled.

### 6.4 Cross-team / matrix — NCA-gated, snapshotted, audited

`request_peer` to a non-descendant returns REQUIRE_APPROVAL; the authority
resolver computes `NCA(self, target)` and routes the parked, TTL'd approval
there. On approve, `authority_basis` is **snapshotted** so a later reorg can't
retroactively illegalize in-flight work. Every cross-team message carries
`authority_basis + approval_ref` — the audit can answer "by what authority did
Marketing task Engineering?" with one chain walk. Matrix / dotted-line standing
edges are **V2**; until then cross-team is always per-request approval.

### 6.5 Anti-chatter bounds

Structural (free): no all-to-all; fan-out is read-side (`announce` = O(1) write +
scoped pull); status ≠ conversation; no standing channels to subscribe to.
Explicit governors: **cc cap** (≤K, MVP); **per-Assignment comm budget** (reuses
the turn/depth cap, MVP); ASK debounce/coalesce (V1); announce rate-limit (V1);
blocking-ASK TTL → auto-escalate (V1); ping-pong oscillation breaker → park +
raise to NCA (V1); token-bounded brief summarization (V1). **The deepest bound:
talking is metered like any effect** — chatter burns the agent's own
token-salary and hits its hard cap. The economic governor *is* the ultimate
anti-chatter mechanism.

**Net new surface:** ~4 event types (`MessagePosted`, `PeerRequestProposed`,
`StandupSynthesized`, `MessageCc`), 3 tools (`ask_manager`, `request_peer`,
`announce`), 2 projections (thread/inbox, standup digest), 1 read-scope resolver.
No new datastore, transport, or security model.

---

## 7. Interns

An Intern is a **policy preset over the existing Position+Agent model**, not a
new domain object: a leaf Position occupied by a low-tier, low-budget,
narrowly-granted Agent whose output is **review-gated to its mentor by default.**
It enters every new agent through an *airlock* — making "any provider, any model"
safe by default.

### 7.1 The preset

| Dimension | Full hire | Intern | Mechanism |
|---|---|---|---|
| Model tier | opus/sonnet | **haiku** | `Agent.model_id` |
| Monthly cap | normal | **tiny, fail-cheap** | existing BudgetEnvelope |
| Per-turn ceiling | normal | **tight** (depth_cap=1) | per-Assignment turn/depth cap |
| Capabilities | role bundle | **`kb.read`, `kb.retrieve`, `submit_work`, `ask_manager` only** (no `assign_task`, no `open_requisition`) | capability allow-list |
| Org authority | can delegate | **leaf only** (`max_subordinates=0`) | authority resolver |
| Output trust | ships on submit | **REVIEW_GATED by default** | review-as-gate |
| Lifecycle | hire→fire | **probation → promote → convert → auto-fire** | new lifecycle SM |

An intern is `Position.role_ref` → intern-flavored Role version **plus**
`Agent.intern_class != null`. This keeps fire-and-rehire: convert an intern to a
full hire **in the same Position** (keep slot, edges, history, budget envelope) or
swap the occupant.

**Why interns:** cheap grunt work (haiku is 10–30× cheaper); parallel exploration
(swarm); cost control (push the long tail of low-value turns to the cheapest
tier, reserve expensive tiers for review/decision); and the killer use —
**trialing a provider/model before a full hire** (hire DeepSeek/GPT as an intern
first; convert on merit). New providers enter through the intern airlock, never
straight into an authority-bearing seat.

### 7.2 Mentorship (review-gated by default)

`intern.submit_work` → `OutputCaptured` → because `output_policy ==
REVIEW_GATED`, the WorkItem parks `PENDING_MENTOR_REVIEW` (not released upstream)
and routes to `mentor_position_id` (defaults to the **direct reporting parent**, a
non-intern). The mentor acts via Review Center verbs (mark-correct → released up
the edge; flag → revision Assignment, counts against eval; edit+approve → diff
recorded as teaching signal; reject → discarded, counts hard). The mentor is a
**Position, not a person**; review is itself a metered (opus-class) turn — so the
system's cost is `cheap intern generation + expensive senior review`, still far
cheaper than doing everything at opus. **A jailbroken intern cannot self-approve**
— it has no `mark_correct` capability over its own WorkItem. **Trust ratchet
(V1):** a run of clean mark-corrects earns *sampled* review (X% gated). MVP =
100% gated.

### 7.3 Lifecycle SM (the one genuinely new state machine)

```
hire → PROBATION ──eval_avg ≥ promote_bar over ≥K assignments──► TRUSTED
                 └──eval < fire_bar OR flag_rate > F OR TTL OR budget-exhausted-low-value──► FIRED (auto)
TRUSTED ──governor/mentor approves convert_to_full_hire──► FULL HIRE (same Position; tier↑, cap↑, gate relaxed, authorities granted)
```

Driven by an `EvalScore` event (`outcome`, `rubric_score`, `cost`,
`value_estimate`); `eval_avg = fold(EvalScore)`. **Auto-fire is intentionally
aggressive and unapproved** (interns are disposable; review-gating means nothing
bad shipped) while **promotion-to-full-hire is gated** (it raises spend and grants
authority — routes through approval-on-hire). Conversion keeps the slot — exactly
Position ≠ Agent. There is **no path** from narrow-grant to authority except the
gated, audited `convert`.

### 7.4 Budget & org fit

Tiny caps + tight per-turn ceilings; same ledger, atomic CAS hard-stop. **Fail-
cheap:** a looping/hallucinating intern hits its cap fast and self-suspends via
the pre-flight kill-switch — and because output was gated, nothing shipped and
little was spent. Intern spend rolls up to the mentor's subtree, so a swarm of
interns under one mentor is naturally bounded by the **mentor's subtree budget**.
Org invariants (pure-function, property-testable): an intern Position may not be a
`reporting_parent` of anyone; its mentor must be a non-intern ancestor.

### 7.5 Intern swarm — cheap parallel exploration

`spawn → fan-out → score → promote-best → reap`: `open_requisition(intern_swarm,
count=N)` (one batch approval) → scheduler claims N (intern, variant) pairs via
`SELECT … FOR UPDATE SKIP LOCKED` → N haiku interns run concurrently → N
gated WorkItems park at the mentor → **one** comparative opus review turn scores
all N, marks the winner, rejects the rest → winning artifact promoted to a
Knowledge Garden seed; winning intern (or provider) optionally converted; losers
auto-fired, unused reserve refunded. **Generation is cheap (N×haiku), selection
is expensive-but-singular (1×opus)** — the opposite of running N opus agents, and
it doubles as a **provider bake-off**.

### 7.6 Model-tier ladder

| Org level | Tier | Use |
|---|---|---|
| Intern (leaf) | **haiku** | grunt work, swarm variants, drafts, extraction |
| Mid IC / full hire | **sonnet** | owns objectives, delegates, real work |
| Senior / mentor / reviewer | **opus** | review-gates intern output, decomposition, decisions |

Tier is just `Agent.model_id`; promotion optionally bumps it; the budget
pre-flight prices per model descriptor so haiku reservations are automatically
tiny.

**What's new:** `Agent.intern_class` + the preset; `output_policy=REVIEW_GATED`
default routing to mentor; `EvalScore` + projections; the lifecycle SM (reactor
in `supervisor/`); two org invariants; (V1) sampled-review ratchet; (V2) swarm
org-tool + judge scoring. Everything else is reused.

---

## 8. Real-world grounding

The hardest truth: **an LLM org will, by default, produce a beautiful,
internally-consistent simulation of having done the work.** The CEO reports
"shipped it, MRR is up"; the log faithfully records that it *said* so; everything
looks green; nothing happened. This layer makes that failure mode structurally
impossible. The organizing rule mirrors the kernel: **the same way agents can't
spend a token except through the kernel, they can't claim a real-world effect or
a KR number except through a grounded, kernel-mediated, independently-verified
path.**

### 8.1 Three things people conflate

| Concept | Definition | Trust source |
|---|---|---|
| **Claim** | agent text ("I published it / MRR is $4k") | agent (untrusted) |
| **Effect** | a real external mutation (HTTP 201, Stripe charge id, git SHA on `main`) | kernel's effector return + provider receipt |
| **Ground-truth metric** | a number read back from the system of record (Stripe MRR, GA signups) | external connector, agent never in the path |

**The agent that performs an action is never the same code path that confirms it
happened or measures its result.**

### 8.2 Outputs → effects, verified independently

Generalize "sole provider egress" to **sole world egress**: a registry of
**Effectors** (typed, capability-gated, idempotent adapters: `git.commit_pr`,
`ci.deploy`, `cms.publish`, `email.send`, `social.post`, `payments.charge`).
Every effect is a **two-phase, WAL-style intent**:

```
EffectIntentRecorded → [governance gate] → EffectAttempted → execute(idem_key) →
   EffectConfirmed{receipt} → (async) EffectVerified | EffectUnverified | EffectDisputed
   ⊥ EffectFailed
```

Crash between attempt and confirm → re-drive with the **same idempotency key** →
provider dedups → exactly-once. **`EffectReceipt` is the only thing that lets
`submit_work` close an effect-bearing assignment** — "done" with no receipt
cannot close.

**Verification is a separate readback by a different code path (ideally
read-only creds):** deploy → healthcheck + synthetic transaction; publish → GET
the URL, assert content hash; charge → retrieve, assert succeeded + amount; email
→ the *delivered* webhook (not "sent"). States `VERIFIED / UNVERIFIED / DISPUTED /
UNVERIFIABLE` are first-class dashboard statuses; `DISPUTED` auto-flags to Review;
`UNVERIFIABLE` forces human attestation. **Honest floor:** we can verify *it
exists and was delivered*, never *it was good* — quality rolls up into KRs and
reviewers, never into the effect verifier.

### 8.3 KRs measured from real data, not self-report

**A KR's value is a `fold` over `MetricObserved` events that originate from a
connector, never from a Turn.** Architecturally: the `goals` projection
subscribes only to `MetricObserved`, which only `connectors/` can emit — an agent
has **no tool that writes a KR number.** A KR is a query binding (`metric_ref,
connector, query_spec, target, baseline, attribution_window, confidence_policy`),
not prose. A goal with a KR that has **no bindable metric source** is flagged at
strategy-approval as a **vanity/ungrounded KR** ("this will rely on attestation")
— forcing honesty before go.

Ingestion is pull (poll the SoR) or push (signed webhook); **read-only
credentials** wherever supported (the thing that *measures* MRR must not be able
to *create* a charge); raw samples retained for reproducibility; cursor dedup so
re-delivery never double-counts. KR progress carries `{current, target, trend,
staleness, confidence}`. The **alignment gate** reconciles claim vs ground truth:
"I drove signups" + GA flat → the Assignment cannot reach Objective-KR complete;
it parks `DISPUTED`.

Data-quality honesty: staleness (never extrapolate; show `last_observed_at`);
attribution (default to **correlation, not causation, stated as such**); lagging
metrics (pair with leading indicators); gaming (pair every count KR with a
quality/guardrail KR — delivered+not-complained, signups+activation); vanity
(flagged at approval). **Attribution is genuinely unsolved in general — the
system reports "MRR is $X (observed)" and "agent did Y (verified)" as two
separate facts and refuses to assert causation it can't prove.**

### 8.4 High-stakes gates

`risk_tier(effect)` is **computed by the kernel, not self-declared**, from
`effector.base_tier × reversibility × blast_radius × novelty × spend`:

| Tier | Examples | Gate |
|---|---|---|
| LOW | feature-branch commit, unpublished draft | autonomous; audited |
| MEDIUM | publish post, send <N customers, deploy staging | single approval (manager-agent if authority permits, else human) |
| HIGH | charge a customer, public announcement, deploy prod, send >N | **human, mandatory** (agent approval insufficient) |
| CRITICAL | legal commitment, contract sign, payout/wire, irreversible+large | **two-person rule** (two distinct humans, same `content_hash`, optional time-lock) |

Routing reuses NCA; the request carries `content_hash`, a human-readable
diff/preview, and the dry-run result. HIGH/CRITICAL **always escalate past agents
to a human governor** regardless of agent authority — a hard rule, not a knob.
For `UNVERIFIABLE` effects, the loop requires an `EffectAttested{governor_id}`
event before the KR/Assignment credits. Independent rails: dry-run/preflight
shown to the approver; **sandbox-by-default for novel action classes** (staging
before prod is unlocked); per-effector **rate & amount circuit breakers**
(world-impact limits independent of token budget); **allow-listed targets** for
the riskiest classes (payouts only to pre-approved recipients).

> This is where §2.3 invariant #2 and §3.4 are strengthened by the stack
> red-team: for "untrusted code + secrets," **prefer host-side proxying /
> egress-substitution so the sandbox never holds a live credential**, with
> deny-by-default egress and short per-task secret lifetime.

### 8.5 Hallucination / over-claiming defenses

Three layers off `review/` + the citation validator: (1) **citation enforcement**
— every claim asserting external truth carries a citation to a seed, source, **or
an effect receipt / metric observation**; the validator is structural (MVP) then
**entailment-checked** (V1, NLI or reviewer agent confirms the cited span
supports the claim). (2) **Adversarial reviewer Positions** (fact-checker,
verifier, red-team) on a **separate code path and budget**; **a producer cannot
review or close its own work** (separation of duties), ideally a different
provider to decorrelate failure. (3) **Structural anti-over-claim:** receipts beat
prose; KR claims checked against the bound metric; no silent green
(`UNVERIFIED`/`DISPUTED` are first-class). The dashboard labels everything
**grounded** (receipt/metric-backed), **cited** (source + entailment), or
**asserted** (agent-only — treat with suspicion); never let "asserted" masquerade.

### 8.6 Honest limits — what it CAN and CANNOT do

CAN: ship + verify digital artifacts (code→PR→CI→deploy, SHA-on-main +
healthcheck — the strongest loop); generate + publish content (drafts
autonomous, publish gated); read ground truth and report it honestly (refusing to
claim causation); decompose/delegate/escalate within hard caps; maintain an
immutable, replayable audit; run continuously and surface exactly where it's
blocked.

CANNOT (where the human is irreplaceable): hold legal/financial accountability;
take irreversible high-stakes action unsupervised; establish causation or judge
"good"; own real-world trust relationships (investors, regulators); define what
actually matters (the Goal, vanity-vs-honest KRs); own unverifiable effects; be
trusted on its own claim. **Three structural reasons the human is permanent, not
a maturity gap:** the **accountability sink** (someone must be liable; agents
can't), the **ground-truth root of trust** (the highest-stakes/unverifiable root
is a person), and **goal authorship + value judgment.**

> **Market exactly this and not an inch more:** not "fire all your employees" but
> **"you become the board — set the goal, hold the budget, approve the dangerous
> moves, and let a verified, audited agent org do the gruntwork."** The grounding
> layer is what makes that claim *true* instead of a demo.

**Two harness invariants to add:** (1) **Grounding** — no Assignment reaches
Objective-KR complete whose bound KR shows no `MetricObserved` movement and no
`EffectVerified|EffectAttested` (the "no fake green" guarantee, parallel to
cap-breach=0). (2) **Egress-for-effects** — an agent attempting a real-world
action outside an Effector fails at the sandbox boundary.

**New subsystems:** `effectors/` (sibling of `providers/`) and `connectors/`
(sibling of `knowledge/`); extends `goals/`, `governance/`, `review/`, the test
harness.

### One-line thesis
Spend the token, perform the effect, measure the result — **three separate gated
paths, none of which the agent can shortcut with prose.** The agent proposes; the
kernel disposes; an independent path verifies; ground-truth connectors keep
score; and for everything irreversible or unmeasurable, a named, accountable
human signs.

---

## 9. The definitive tech stack

**Decision date: 2026-06-28. Final.** The governing shape is: the kernel is a
**many-agent, I/O-bound, streaming, atomic-CAS, event-sourced effect engine.**
That shape — not raw compute — picks the stack. The choices below are stated
plainly and incorporate the load-bearing amendments from the stack red-team.

> **Deployment update (2026-06-28): target is Vercel.** The infra/runtime rows
> below (runtime host, queue/scheduler, realtime, DB host, Redis, deploy) are
> **superseded by §11**. The *language, domain model, adapters, budget-CAS SQL,
> sandbox, and browser choices are unchanged* — only where/how it runs changes.

### 9.0 The headline decision, stated plainly

**The entire online backend — kernel, API, queue workers, projections,
integration layer — is written in TypeScript on Node.js (LTS 22+). Not Python.**

The decisive reason is **one shared type system end-to-end**: in an event-sourced
system *the event union is the contract*, and TS lets us define the event
discriminated union, the `fold`-to-read-state projections, the org-chart
node/edge shapes, and the budget/usage records **once** in a shared
`packages/core` (types + Zod schemas), shared by kernel, API, and the React
dashboard, with compile-time exhaustiveness over every event variant in the fold.
Secondary reasons: the workload is I/O-bound orchestration (hundreds of
concurrent provider streams, SSE/WebSocket multiplexing, DB/tool/sandbox
round-trips) — Node's event loop is its home turf; the Anthropic TS SDK is
first-class for the loop.

**Honest carve-outs (from the red-team):** (1) the Python SDK has MCP-conversion
helpers TS lacks — we route around this because the kernel mediates MCP via Nango,
not via SDK helpers, but the "no SDK gap" claim is *not* true as stated. (2) The
eval/trajectory-analysis ecosystem is Python-first; we therefore **explicitly
carve out a Python offline-eval/analytics sidecar** as expected, not as failure.
The **online kernel stays 100% TS**; the offline analytics may be Python.

### 9.1 The locked stack table

| Layer | Locked choice | Why (one line) |
|---|---|---|
| **Backend language/runtime** | **TypeScript on Node.js LTS 22+** (whole online backend) | one shared event-union type system with the dashboard; I/O-bound many-agent orchestration is Node's home turf |
| **Offline eval/analytics** | **Python sidecar** (trajectory analysis, cost/quality regression) | the eval ecosystem is Python-first; isolate it, keep the kernel TS |
| **Agent loop / provider SDK** | **Anthropic SDK behind a thin custom `ProviderAdapter`; own the loop; NOT Vercel AI SDK in the kernel.** Default `claude-opus-4-8`, adaptive thinking, stream + `.finalMessage()` | the kernel needs byte-level control of effect emission, budget CAS, kill-switch, replay determinism; Anthropic is the reference adapter, others implement the same interface |
| **Usage/cost normalization** | **Custom `UsageNormalizer` per adapter → one canonical `Usage`+`Cost` event; pricing tables versioned in `packages/core`. No inference aggregator (no OpenRouter).** | token-salary budgets demand one normalized, auditable, replayable cost shape; don't outsource the one thing the kernel must audit (spend) |
| **Integration substrate** | **MCP-style typed tool schemas (agent-facing) + Nango (OAuth/credential/sync, kernel-side) + kernel mediates every call.** Credential failures **fail-closed pre-flight, emit an event**; MCP multi-tenant OAuth is a tracked risk with a direct-Nango fallback path | buy the undifferentiated pain (OAuth/refresh/rate-limit); build the moat (kernel-mediated execution + audit); MCP standardizes the interface, not the credential lifecycle |
| **Sandbox (untrusted code + secrets)** | **E2B (Firecracker microVMs) primary, behind a swappable interface (Daytona fallback). microVMs, NOT containers.** **Don't inject raw secrets — host-side proxy / egress-substitute; deny-by-default egress; short per-task secret lifetime** | model-generated code needs hardware-level isolation (a container escape compromises co-tenants); the microVM protects co-tenants, the secret rules protect *your* credentials |
| **Browser automation** | **Browserbase (managed headless Chrome) driving Playwright, behind a swappable interface (Steel fallback). Design for self-hosted-pool + managed-burst on a real cost model. Record-once / replay-from-record for non-deterministic effects** | don't self-scale/patch Chrome; but browser fleets are a top cost line and the flakiest effect class — cost-model it and keep replay deterministic |
| **Primary datastore + ORM** | **PostgreSQL 16+ with `pgvector`, via Drizzle ORM** | one source of truth for the event log + atomic budget CAS + vectors; Drizzle is SQL-first so the correctness-critical CAS query is hand-written and auditable |
| **Budget CAS** | **Single atomic `UPDATE … WHERE spent+:est <= cap RETURNING` at the LEAF position row, `READ COMMITTED` (not SERIALIZABLE). Ancestor/org roll-ups computed ASYNC via projections. PgBouncer (transaction mode) from day one** | the leaf-only CAS removes the root-row serialization hotspot that wide fan-out would otherwise create; SERIALIZABLE would cause retry storms; this is the choice most likely to bite at success-scale |
| **Vector / search** | **`pgvector` (HNSW) for KB seeds + Postgres FTS for citation lookup; embeddings via provider API (Voyage/OpenAI/Cohere)** | keep vectors next to the events/artifacts they index — one store, one consistency model; no in-process ML |
| **Queue / scheduler** | **BullMQ on Redis** (delays, rate-limit, retries/backoff, repeatable jobs) | the turn loop, retries, scheduled checks, projection rebuilds are jobs; the event log already *is* the durable workflow, so no Temporal |
| **Realtime → dashboard** | **SSE primary (kernel→dashboard fan-out); WebSocket only for bidirectional surfaces (inline approvals, interactive review). Reconnect = paginated history fetch + dedupe-by-event-id, then tail** | the dashboard is overwhelmingly an observer of an ordered event stream — SSE's home; SSE has no replay, so the hash-chained log backfills lossless reconnect |
| **Frontend** | **Next.js (App Router) + React + TypeScript**, sharing `packages/core` | shared event/projection types; server components for heavy read-only audit views, client boundary for live SSE/WS |
| **Org-chart / canvas** | **React Flow (`@xyflow/react`) + Dagre/ELK auto-layout** | the org chart is the runtime spine the user manipulates; React Flow is the standard interactive node/edge canvas |
| **Human-governor auth** | **WorkOS or Auth0 (enterprise SSO/MFA/audit), short-lived signed session + RBAC; entirely separate from agent/provider credentials** | a system with kill-switch + spend authority needs real enterprise auth from day one; agents are untrusted and never carry governor identity |
| **Object storage** | **S3-compatible (AWS S3, or Cloudflare R2 for zero-egress); store content in object storage, references + content-hash in the event log** | seeds/files are blobs; keep them out of PG; the log covers *what* was produced via hash |
| **Observability** | **The hash-chained event log is primary** (audit + replay + live feed) **+ OpenTelemetry traces → Tempo/Honeycomb/Datadog + Sentry** for exceptions. Non-deterministic effect payloads recorded for replay | the architecture already emits an event per effect — that log *is* structured observability; OTel adds cross-service latency spans the log doesn't |
| **Deploy** | **Containerized Node services on Fly.io or AWS ECS/Fargate; managed Postgres (RDS/Neon) + managed Redis (Upstash/ElastiCache); sandboxes (E2B) and browsers (Browserbase) external by design** | stateless-ish Node scales horizontally; managed PG/Redis remove ops on the two stores that matter; dangerous workloads stay in external isolated services; the kernel holds long-lived streams so NOT Lambda |

### 9.2 How the stack enforces the architecture

- **Kernel as sole effector:** agents only emit MCP-style intents; the kernel is
  the only code holding a `ProviderAdapter`, a Nango connection, an E2B handle, or
  a Browserbase session.
- **Every effect → event:** provider call, token spend, tool run, sandbox spawn,
  browser action, connector call, effector call — each a hash-chained event;
  observability, audit, and replay all fall out of this one discipline.
- **Budget = the one synchronous CAS (now leaf-only + async roll-up):** a single
  `READ COMMITTED` atomic `UPDATE … RETURNING` at the leaf, kill-switch trips on
  CAS failure, ancestors folded from the log — no lock chain to the root.
  Sandbox-slot admission is the second documented synchronous CAS.
- **Position ≠ Agent:** `positions` (slot/edges/budget) and `agent_occupancies`
  (who fills it, when) are separate tables; fire-and-rehire writes occupancy
  events.
- **Supervisor-tree runtime = React Flow over the same edges:** the Postgres
  reporting edges drive both the runtime mission-cascade and the dashboard canvas
  — one model, two consumers, identical types.
- **Conformance tests, not promises:** "swappable interface" is a deliverable —
  the named fallback (Daytona/Steel) must pass a per-interface conformance suite
  for the untrusted-code and browser effect classes before we depend on the
  primary in production.

### 9.3 The three amendments that are not polish

Per the red-team, three corrections separate "demos" from "survives its own
fan-out," and are adopted as build requirements: (1) **leaf-only budget CAS +
async ancestor roll-up + `READ COMMITTED` + PgBouncer** — the real scaling wall;
(2) **don't inject raw secrets into the sandbox** — host-side proxy /
egress-substitution + deny-by-default egress + short secret lifetime; (3)
**fail-closed, pre-flight credential failures** emitting events — never async
retries. The rest of the table is directionally correct and built on as-is.

---

## 10. End-to-end scenario trace

**Goal:** "Build the #1 note-taking app to $1M MRR." **Org:** Lumen Notes.
**Governor:** human (board seat above CEO). Every world-touching line is a
kernel-emitted, hash-chained event; `fold(events)` is what the dashboard
renders. **Agents emit intents; the kernel validates, admits budget via leaf CAS,
executes the effect, appends the event.**

### W0 — Genesis

`RUN_CREATED` (genesis block) → `POSITION_CREATED pos.ceo` → `OCCUPANT_HIRED
pos.ceo ← agent.ceo.v1 (Opus)`. The human sees one card: **CEO hired, awaiting
decomposition** — nothing else can happen, there's nowhere for mission to
cascade.

CEO's first turn produces a *plan artifact*, not actions. Every proposed KR must
**bind to a real metric source** or it's inadmissible (§8.3):
`OBJECTIVE_PROPOSED obj.1` with KR1 mrr→stripe, KR2 wau→ga4, KR3 rank→research,
KR4 nps→zendesk-csat. Genesis objective is human-gated → `APPROVAL_REQUESTED →
human approves, edits KR2 down to 150k → OBJECTIVE_RATIFIED`. (Only two things are
human-gated by default in MVP: the genesis objective+envelope, and money leaving
the org.)

### W0–W1 — CEO builds the executive layer

CEO opens three requisitions. The kernel's **leaf budget CAS** rejects the third:
CEO cap $4,000, committed $7,500 → `ADMISSION_REJECTED reason=PARENT_BUDGET_
INSUFFICIENT` *synchronously on the same turn* (this is why the CAS is the
synchronous exception — the agent must learn immediately it can't afford
something). CEO re-plans within $4,000: CTO $2,000, CMO $1,200, COO $700.
Requisitions admit; occupants bind; CEO cascades mission down the new edges via
`assign_task` (the down-channel), encoding a dependency in prose ("don't spend on
ads until product is live" — V1 makes this a structured edge the kernel
auto-latches).

### W1–W2 — CTO staffs eng; the build starts

CTO recursively hires under its own cap (same roll-up rule one level down):
`pos.eng1 ($900)`, `pos.eng2 ($600)`. eng1 requests an **intern** (haiku, $300) —
**reporting to eng1, not the CTO** (interns are a senior's leverage; the senior
owns the review). The **CODE workspace** (T2 microVM) is where kernel-run tools
execute; the agent emits `run_tool` intents, the kernel runs them in the sandbox
and logs stdout/exit/diff as events — which is what makes the run a replayable
fixture.

Intern ships `PR#1` (scaffold) via `submit_work`; because `output_policy ==
REVIEW_GATED`, it parks at eng1. eng1 flags it (flaky tests, no offline coverage,
uncited config choices) → revision Assignment → intern reworks cheaply →
`REVIEW_MARKED_CORRECT` (this is loop #2 + §7.2). eng1 builds the editor on the
green harness, opens `PR#7` up to CTO; CTO **review-gates** the merge
(`REVIEW_MARKED_CORRECT` → kernel performs the merge tool → `main`). eng2 lands
auth+billing+Stripe. By end W3: deployed to prod (`lumen.app`), Stripe live keys
held **by the kernel** (agents call `stripe.create_price`, the kernel injects the
key), GA4 installed, `KR_SOURCE_BOUND`. CTO reports complete **up** to CEO.

### W3 — CEO unlatches marketing; Research feeds the campaign

CEO releases the dependency (go-signal task). CMO tasks **Web Research**, which
uses `web.search`/`web.fetch` and publishes a **cited seed** to the Knowledge
Garden. CMO **flags** the report (two uncited prices, one stale feature claim) and
uses Review Center **assign-to-expert** — the expert is the CTO, in another
branch, so the request **escalates to NCA = CEO**, who authorizes the CTO's time.
CTO fixes the stale claim; Research reworks; `seed.comp.v2` is marked correct —
now a trusted, version-pinned input the CMO's campaign derives from.

CMO drafts a Google Ads campaign (state PAUSED) and requests **$8,000/mo** —
exceeds its own cap *and* is external money → routes to the **human** (external
spend is always human-gated in MVP). The approval card shows the campaign draft,
target keywords, and projected CAC from the seed. Human approves **$5,000/mo**
(trimmed). Ad spend is a **separate currency envelope** from the token-salary cap;
the pre-flight kill-switch checks the earmark before every `ads.*` mutate.

### W4–W6 — Ops live; an agent hits its cap

Traffic arrives → real tickets → real MRR. CS-agent (haiku, SUPPORT_INBOX
workspace) resolves tickets via the Zendesk connector. It detects 12 tickets that
are actually one **offline-sync data-loss bug** — it can't fix code, so it
**escalates up its own line to COO**, who must reach **across the tree to CTO** →
NCA = CEO routes the Sev1. eng1 hotfixes (`PR#21` → marked correct → deploy); CS
bulk-replies and closes; `KR4_TICK csat 47 → 52` (now green) — and that tick comes
from the **Zendesk connector**, not the agent's claim.

The firefight burns the CS agent's tokens. The **pre-flight kill-switch** runs
before every action: when `next_turn_est=$15 > remaining=$9`, it emits
`PREFLIGHT_BLOCK reason=WOULD_EXCEED_CAP` and `OCCUPANT_SUSPENDED
reason=BUDGET_CAP_REACHED`. **The cap is a hard pre-flight stop, not a post-hoc
alarm — the agent cannot overspend by even one turn.** The Position is suspended,
**not fired**: edges, history, and the 19-ticket backlog persist on `pos.cs`.

### W6 — KRs update from real data; HR screens; human tops up

The kernel's metric-poller pulls Stripe + GA4 on schedule and emits KR ticks; the
dashboard **folds the ticks** (never queries Stripe live → reproducible, audit-
true): MRR $41.3k, WAU 38.9k, rank PH#1 (partial), CSAT 52.

CEO decides to hire a stronger CS lead. **HR's "screening" = replaying golden
objectives** (the eval-harness reuses the event log): `eval.run(cs.sonnet.v2) →
0.91`, `eval.run(cs.haiku.v2) → 0.74`; HR recommends the Sonnet. CEO assembles
the **up-flow board report** (folds child reports + KR ticks) and requests a
**+$1,250/mo** ops top-up. The human opens the dashboard, clicks MRR to see the
exact `stripe.report` event behind the number and "CS suspended" to see the
`PREFLIGHT_BLOCK`, and approves.

`OCCUPANT_SWAPPED pos.cs: agent.cs.v1 → agent.cs.sonnet.v2` (**Position kept its
edges + the 19-ticket backlog; only the occupant changed**) → `OCCUPANT_RESUMED`
→ drains the backlog. The intern, having shipped clean PRs all month, is promoted
by the same mechanic — `OCCUPANT_SWAPPED` on `pos.intern` to a mid-tier occupant
with a raised cap, justified by its folded `REVIEW_MARKED_CORRECT` history (§7.3
convert).

### What the trace proves

| Mechanism | Where it fired |
|---|---|
| Org chart = runtime spine | every `assign_task` down / report up / budget roll-up |
| Budget roll-up + leaf CAS | CEO `ADMISSION_REJECTED`; CS `PREFLIGHT_BLOCK` (pre-flight-hard, not an alarm) |
| NCA escalation routing | CS→COO→CEO→CTO; cross-tree expert review of the report |
| Kernel-only effects + secret injection | Stripe/GA4/Zendesk/Ads/git all kernel-run; no agent holds a live key |
| `fold(events)` = all read-state | every KR number on the dashboard, reproducible to the event |
| Position ≠ Agent | CS suspend→swap→resume; intern promotion — edges/budget/queue/history kept |
| Three complete-levels | Turn (each tool call) / Assignment (PR accepted) / Objective-KR (KR ticks) |
| Review Center + Knowledge Garden | intern review, `seed.comp.v1→v2` with citations |
| Grounding | KR4/MRR ticks come from connectors, not claims; nothing reads "done" without a verified effect |
| Human governance = 2 gates | genesis objective, external spend, top-up |

**The single most load-bearing claim:** because every effect is one hash-chained
event and all state is `fold(events)`, this entire 6-week, 10-agent, 4-integration
run is **one replayable fixture** — re-run it against a new kernel build and
assert the company comes out identical. That is simultaneously the audit log, the
observability feed, and the regression test, and it is the whole difference
between *running a company* and *writing a convincing story about running a
company*.

---

## 11. Deployment architecture — Vercel

**Decision: deploy on Vercel.** This supersedes the infra/runtime rows of §9.
The domain model, event-sourcing, supervisor-tree, leaf budget-CAS *SQL*,
kernel-as-sole-effector, Position≠Agent, TypeScript, the Anthropic adapter, E2B,
and Browserbase are all **unchanged**. What changes is the execution topology,
because Vercel is serverless: **functions are time-bounded and there are no
always-on workers.**

### 11.1 The one hard constraint and the fix

Vercel Functions (with Fluid Compute) cap at **800s on Pro** (1800s beta), **300s
on Hobby**; I/O wait (model calls, DB) is **not** billed as active CPU — good for
agent work. But a full agent loop is *many* turns plus approval waits that can
last **hours or days** — that cannot live inside one invocation, and there is no
persistent process to host BullMQ.

**Fix: split the control plane from the execution plane.**

```
                    ┌──────────────────── VERCEL ────────────────────┐
  Human  ─────────► │ Next.js dashboard (RSC) · API route handlers ·  │
  (browser)         │ webhook ingest (Stripe/GA/GitHub) · Vercel Cron │
                    └───────┬───────────────────────────────┬─────────┘
                            │ emits events / commands         │ subscribes
                            ▼                                 ▼
                   ┌──────────────────┐            ┌────────────────────┐
                   │ INNGEST (durable │            │ Managed realtime    │
                   │ execution)       │            │ (Ably / Pusher)     │
                   │ = the agent turn │            │ kernel→dashboard     │
                   │   loop, as steps │            │ live event fan-out  │
                   └───┬────────┬─────┘            └────────────────────┘
       kernel logic    │        │ external effects (HTTP, callable from serverless)
   (runs AS Inngest    │        ├─► Anthropic (provider streams)
    functions on       │        ├─► E2B microVM sandbox (untrusted code)
    Vercel infra)      │        ├─► Browserbase (browser)
                       ▼        └─► Nango → SaaS connectors
              ┌──────────────────┐        ┌──────────────────┐
              │ Neon Postgres    │        │ Upstash Redis     │
              │ (event log,      │        │ (hot read-model,  │
              │  budget CAS,     │        │  rate buckets,    │
              │  pgvector)       │        │  leases)          │
              └──────────────────┘        └──────────────────┘
```

The kernel code still lives in the repo; it just **executes as Inngest step
functions** (deployed on Vercel) instead of as a long-lived worker.

### 11.2 The turn loop as durable steps (this is the win)

Each agent turn = one Inngest **step** (memoized, retried independently). The loop
the kernel ran in-process becomes a durable function:

```
inngest.createFunction({ id: "agent-turn-loop",
  concurrency: [{ key: "event.data.providerKey", limit: N },     // per-provider rate cap
                { key: "event.data.orgId" }] },                  // per-org fairness
  { event: "agent/assignment.dispatched" },
  async ({ event, step }) => {
    while (!done) {
      // pre-flight budget CAS — single SQL UPDATE over Neon HTTP driver (autocommit)
      const ok = await step.run("budget-admit", () => admitCAS(agent, estimate))
      if (!ok) return step.run("suspend", () => suspend(agent, "BudgetExhausted"))
      // provider call — mostly I/O wait, fits in one Fluid-Compute invocation
      const turn = await step.run("provider-turn", () => adapter.submitTurn(req))
      for (const call of turn.toolCalls) {
        const decision = await step.run("pdp", () => pdp(call))           // deterministic gate
        if (decision === "REQUIRE_APPROVAL")
          await step.waitForEvent("approval", {                          // ⭐ parks for DAYS,
            event: "approval/granted", match: "data.callId", timeout: "3d" }) //  holds NO process
        await step.run("tool", () => kernel.runTool(call))
      }
      await step.run("settle", () => settleBudget(agent, turn.usage))     // post-turn meter
    }
  })
```

Why this is *better* than the BullMQ design, not just a workaround:
- **`step.waitForEvent` = "approvals park durably, never block the org"** — for
  free, surviving hours/days, holding zero compute. The hardest property in §6/§8
  becomes a primitive.
- **Step memoization = idempotency on retry** — a completed `tool`/`settle` step
  isn't re-run, hardening the "don't double-fire an irreversible effect" rule.
- **Concurrency keys** give per-provider rate-limit admission and per-org
  fairness — closing the "shared provider rate-limit" gap the critique flagged.
- **Fan-out** (`step.sendEvent` to dispatch subordinate assignments) is native →
  the supervisor-tree's downward cascade maps to event fan-out.

### 11.3 Revised stack rows (delta vs §9)

| Layer | §9 (was) | §11 (Vercel) | Why |
|---|---|---|---|
| **Runtime host** | Node services on Fly/ECS holding long streams | **Vercel Functions (Fluid Compute)** for UI/API/short streams + **Inngest** for the durable turn loop | no always-on process on Vercel; durable engine owns the loop |
| **Queue / scheduler** | BullMQ on Redis | **Inngest** (steps, concurrency, throttle, cron, `waitForEvent`) + **Vercel Cron** for ticks | BullMQ needs a persistent worker; Inngest is serverless-native and event-driven like our log |
| **Realtime → dashboard** | self-run SSE fan-out | **Managed realtime (Ably or Pusher)**; kernel publishes, dashboard subscribes; reconnect = history-from-log + tail. Short single-agent token streams may still use a Route Handler stream | long-lived SSE in a time-bounded function is fragile |
| **Primary datastore** | Postgres (RDS/Neon) | **Neon** (serverless Postgres) + pgvector; **budget CAS via the Neon HTTP driver as a single autocommit `UPDATE…RETURNING`** (no long txn); pooled connection for multi-statement work | serverless fan-out → pooling is mandatory; the leaf-CAS is one statement, ideal for HTTP driver |
| **Redis** | self-managed Redis | **Upstash Redis** (HTTP/serverless) for hot read-model, rate buckets, leases | no persistent Redis client on serverless |
| **Auth** | WorkOS/Auth0 | **Clerk** (Vercel-native) or WorkOS | both fine; Clerk is the smoothest Vercel path |
| **Object storage** | S3/R2 | **Vercel Blob** or R2 | keep blobs off Postgres; refs+hash in the log |
| **Deploy** | containers on Fly/ECS | **Vercel** (app + API + Inngest fns) + Neon + Upstash + Ably + external E2B/Browserbase/Nango | one Vercel-centric control plane; dangerous/long work stays in external managed services |

**Unchanged from §9:** TypeScript everywhere · `packages/core` event union · Anthropic
SDK behind `ProviderAdapter` · leaf budget-CAS *logic* · E2B microVM sandbox ·
Browserbase + Playwright · Next.js + React Flow dashboard · the hash-chained
event log as the source of truth.

### 11.4 Honest trade-offs of going Vercel-first

- **Inngest (or Trigger.dev) is now mandatory, not optional** — it *is* the
  execution plane. If you'd rather keep one vendor and run long single tasks
  without step-splitting, **Trigger.dev** (dedicated infra, no timeout,
  self-hostable) is the swap-in; Inngest is recommended for the event-driven fit.
- **DB connections under fan-out** must go through the Neon pooler / HTTP driver,
  or wide agent fan-out exhausts connections — design for it from day one.
- **Realtime is a managed dependency** (Ably/Pusher) rather than self-run SSE.
- **Cost shape:** Fluid Compute bills active CPU (not I/O wait), so streaming a
  model is cheap; the new line items are Inngest runs + realtime messages — fine
  at MVP, model them at scale.
- **What does NOT change:** every safety property (kernel-sole-effector, hard
  budget cap, audit log, approval gates, replayable fixtures) is preserved —
  they're architecture, not host.

### 11.5 MVP deployment shape

Vercel (Next.js + API + Inngest functions) · Inngest Cloud · Neon · Upstash ·
Ably · E2B · Browserbase · Clerk · Vercel Blob. All managed, all serverless-
friendly, one `git push` to deploy the control plane.

---

## Appendix — Adversarial critique (gaps, new risks, MVP cuts, open decisions)

Output of a skeptical staff-engineer review pass. Track these; they are the
known soft spots in the operating layer above.

### Top gaps to close
- **Fixture rot:** no detector/re-baseline protocol for when a provider model
  deprecation or price change silently breaks golden eval fixtures.
- **Anti-gaming cold-start:** the "rubber-stamp" metric needs a per-Role baseline
  dwell-time distribution to mean anything on day one.
- **Workspace checkpointing:** disk-image checkpoint vs git-only checkpoint of a
  microVM with in-flight deps is undecided (big cost/correctness fork).
- **Unbounded growth:** no quota/GC for persistent workspaces + immutable seed
  versions (storage + lineage-traversal cost have no ceiling).
- **Connector manifest trust:** nothing verifies a manifest's declared `effect:
  read` doesn't actually write; no signer/auditor of manifests.
- **Capability algebra:** inheritance "down the edge" + per-Position grants has no
  conflict/override rule (can a child exceed an ancestor's grant?).
- **Handoff cascade:** `UpstreamChanged` revalidation fan-out is unbounded (one
  rewritten foundational seed can re-trigger the whole downstream graph).
- **Comms injection:** agent-authored message bodies are an unscanned
  prompt-injection surface into the next agent — must be treated as untrusted.
- **KR reversals:** webhook→KR binding is count-up biased; refunds/churn/
  chargebacks decrementing a KR is structurally easy to forget.

### Top new risks from real-world reach
- **Secret blast radius:** per-Position tokens × org size; the kernel becomes the
  single highest-value target — one injection bug exposes every org's live creds.
- **Sandbox escape:** microVMs reduce but don't eliminate escape; the egress
  proxy is the real perimeter and is itself untested attack surface (SSRF).
- **Double-send:** idempotency keys keyed on `turn_seq` mean a rework on a
  *different turn* mints a new key → can double-fire a `reversible:false` effect.
- **Reward-hacking gates:** deterministic gates are gameable — resolvable-but-
  irrelevant citations + machine-passing DoD with empty substance; the LLM-judge
  that'd catch it is (deliberately) out of the gating lane.
- **Shared rate-limit:** leaf-CAS protects token budget, nothing protects the
  *provider* rate-limit on one shared per-org credential under wide fan-out.
- **Standup cost:** digest assembly is O(subtree) per manager per cadence tick;
  deep trees re-fold overlapping subtrees — read-side cost, not removed.

### Highest-leverage MVP simplifications
- **Per-org credentials only** at MVP; defer per-Position tokens to V1.
- **Budget is the ONLY synchronous CAS**; make sandbox-slot admission a soft
  semaphore + queue, not a second invariant.
- **MVP grounding = digital effects only** (git/CI/deploy + Stripe-read); drop the
  attestation path for unverifiable effects entirely.
- **Two seed kinds** (`code-pr`, `report`), AUTO_CONSUME-or-human only — no
  agent-reviewer-as-gate tier in MVP.
- **Interns are the only multi-occupant trial**; cut the swarm + comparative-judge
  for MVP (unproven selection quality + reward-hack hole).
- **One uniform untrusted-string scrub** for every agent-authored string (message
  body, self-check, brief) — cheaper than per-surface defenses.

### Open decisions (still need your call)
1. Idempotency key for a re-attempted irreversible effect: turn-scoped (risks
   double-send) or assignment+args-scoped (risks blocking a legit re-send)?
2. What makes a human `EffectAttested` *honest* — required evidence + sampling —
   or do we accept it as a known rubber-stamp and market the limit?
3. Who verifies a connector manifest's `effect` class against real behavior, and
   what's the consequence of a production mismatch?
4. Does an LLM-reviewer ever block a real external effect in MVP, or is every
   irreversible effect human-gated until the reviewer earns measured trust?
5. How is shared provider rate-limit budgeted across concurrent agents on one
   credential — admission control, per-connector token bucket, or absorb 429s?
6. Storage/GC policy + cost ceiling for immutable seeds + persistent workspaces
   over a multi-month run — who pays?

---

*ULTRAPLAN addendum to PLAN.md. Build from this.*
