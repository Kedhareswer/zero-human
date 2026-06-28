// The event log + the authoritative budget state. The kernel is the only thing
// that mutates either. Budget admission is a SYNCHRONOUS check-and-reserve (the
// one deliberate exception to the async log) — that's what makes the hard cap a
// real kill-switch and not a dashboard chart.
//
// The clock is logical (ts === seq): ordering is by harness-assigned seq, never
// wall-clock, so the whole log is deterministic and replayable.

import { payloadOf, type EventMeta, type EventPayload, type StoredEvent } from "../core/events";
import { computeHash, GENESIS_HASH } from "../core/hashchain";
import { newId } from "../core/ids";

export interface AdmitResult {
  ok: boolean;
  remainingCents: number;
}

export interface Store {
  append(payload: EventPayload, meta: EventMeta): StoredEvent;
  events(): StoredEvent[];
  initBudget(positionId: string, capCents: number): void;
  /** Atomic pre-flight: reserve `amountCents` iff it fits under the cap. */
  admit(positionId: string, amountCents: number): AdmitResult;
  /** Post-turn settlement: release the reservation, charge the actual spend. */
  settle(positionId: string, reserveCents: number, actualCents: number): void;
  budget(positionId: string): { capCents: number; usedCents: number; reservedCents: number } | undefined;
}

interface Budget {
  capCents: number;
  usedCents: number;
  reservedCents: number;
}

const EPS = 1e-6;

export class InMemoryStore implements Store {
  private readonly log: StoredEvent[] = [];
  private readonly budgets = new Map<string, Budget>();
  private seq = 0;
  private lastHash = GENESIS_HASH;

  append(payload: EventPayload, meta: EventMeta): StoredEvent {
    const seq = this.seq++;
    const core = {
      seq,
      ts: seq, // logical clock
      orgId: meta.orgId,
      actor: meta.actor,
      correlationId: meta.correlationId,
      payload,
    };
    const hash = computeHash(this.lastHash, core);
    const event = {
      ...payload,
      id: newId("evt"),
      seq,
      ts: seq,
      orgId: meta.orgId,
      actor: meta.actor,
      correlationId: meta.correlationId,
      prevHash: this.lastHash,
      hash,
    } as StoredEvent;
    this.lastHash = hash;
    this.log.push(event);
    return event;
  }

  events(): StoredEvent[] {
    return this.log;
  }

  initBudget(positionId: string, capCents: number): void {
    this.budgets.set(positionId, { capCents, usedCents: 0, reservedCents: 0 });
  }

  budget(positionId: string) {
    return this.budgets.get(positionId);
  }

  admit(positionId: string, amountCents: number): AdmitResult {
    // SYNCHRONOUS critical section — no await between read and write, so two
    // concurrent turns racing the last dollar can never both be admitted.
    const b = this.budgets.get(positionId);
    if (!b) return { ok: false, remainingCents: 0 };
    const remaining = b.capCents - b.usedCents - b.reservedCents;
    if (remaining - amountCents < -EPS) {
      return { ok: false, remainingCents: remaining };
    }
    b.reservedCents += amountCents;
    return { ok: true, remainingCents: b.capCents - b.usedCents - b.reservedCents };
  }

  settle(positionId: string, reserveCents: number, actualCents: number): void {
    const b = this.budgets.get(positionId);
    if (!b) return;
    b.reservedCents = Math.max(0, b.reservedCents - reserveCents);
    b.usedCents += actualCents;
  }
}

/** The canonical hashed core for an event — identical shape to what append() hashes. */
function eventCore(e: StoredEvent) {
  return { seq: e.seq, ts: e.ts, orgId: e.orgId, actor: e.actor, correlationId: e.correlationId, payload: payloadOf(e) };
}

/** Walk the hash chain: every link must match and each content hash must recompute. */
export function verifyChain(events: StoredEvent[]): boolean {
  let prev = GENESIS_HASH;
  for (const e of events) {
    if (e.prevHash !== prev) return false;
    if (computeHash(prev, eventCore(e)) !== e.hash) return false;
    prev = e.hash;
  }
  return true;
}
