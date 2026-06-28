// Neon Postgres implementation of the Store. Same interface as InMemoryStore, so
// the engine, demo, and tests run over it unchanged.
//
// Two correctness anchors:
//  - append() runs in a transaction that locks the org's log_state row (FOR UPDATE)
//    to assign a gap-free seq and chain the hash deterministically.
//  - admit() is a SINGLE atomic UPDATE … WHERE (cap-used-reserved) >= amount
//    RETURNING — the hard budget kill-switch enforced by the database itself.

import { Pool } from "@neondatabase/serverless";
import { payloadOf, type EventMeta, type EventPayload, type StoredEvent } from "../core/events";
import { computeHash, GENESIS_HASH } from "../core/hashchain";
import { newId } from "../core/ids";
import type { AdmitResult, Budget, Store } from "../kernel/store";

const EPS = 1e-6;

export class PgStore implements Store {
  private readonly pool: Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async append(payload: EventPayload, meta: EventMeta): Promise<StoredEvent> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const st = await client.query(
        "SELECT next_seq, last_hash FROM zh_log_state WHERE org_id = $1 FOR UPDATE",
        [meta.orgId],
      );
      let seq: number;
      let lastHash: string;
      if (st.rows.length === 0) {
        seq = 0;
        lastHash = GENESIS_HASH;
        await client.query("INSERT INTO zh_log_state (org_id, next_seq, last_hash) VALUES ($1, $2, $3)", [meta.orgId, 0, GENESIS_HASH]);
      } else {
        seq = Number(st.rows[0].next_seq);
        lastHash = st.rows[0].last_hash as string;
      }
      const core = { seq, ts: seq, orgId: meta.orgId, actor: meta.actor, correlationId: meta.correlationId, payload };
      const hash = computeHash(lastHash, core);
      const id = newId("evt");
      await client.query(
        "INSERT INTO zh_events (id, seq, ts, org_id, actor, correlation_id, type, payload, prev_hash, hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [id, seq, seq, meta.orgId, meta.actor, meta.correlationId ?? null, payload.type, JSON.stringify(payload), lastHash, hash],
      );
      await client.query("UPDATE zh_log_state SET next_seq = $1, last_hash = $2 WHERE org_id = $3", [seq + 1, hash, meta.orgId]);
      await client.query("COMMIT");
      return { ...payload, id, seq, ts: seq, orgId: meta.orgId, actor: meta.actor, correlationId: meta.correlationId, prevHash: lastHash, hash } as StoredEvent;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async events(): Promise<StoredEvent[]> {
    const r = await this.pool.query("SELECT * FROM zh_events ORDER BY seq ASC");
    return r.rows.map((row: Record<string, unknown>) => ({
      ...(row.payload as Record<string, unknown>),
      id: row.id,
      seq: Number(row.seq),
      ts: Number(row.ts),
      orgId: row.org_id,
      actor: row.actor,
      correlationId: row.correlation_id ?? undefined,
      prevHash: row.prev_hash,
      hash: row.hash,
    })) as StoredEvent[];
  }

  async initBudget(positionId: string, capCents: number): Promise<void> {
    await this.pool.query(
      "INSERT INTO zh_budgets (position_id, cap_cents, used_cents, reserved_cents) VALUES ($1, $2, 0, 0) ON CONFLICT (position_id) DO UPDATE SET cap_cents = EXCLUDED.cap_cents",
      [positionId, capCents],
    );
  }

  async budget(positionId: string): Promise<Budget | undefined> {
    const r = await this.pool.query("SELECT cap_cents, used_cents, reserved_cents FROM zh_budgets WHERE position_id = $1", [positionId]);
    if (r.rows.length === 0) return undefined;
    const row = r.rows[0];
    return { capCents: Number(row.cap_cents), usedCents: Number(row.used_cents), reservedCents: Number(row.reserved_cents) };
  }

  async admit(positionId: string, amountCents: number): Promise<AdmitResult> {
    // THE atomic budget CAS — one statement, enforced by Postgres.
    const r = await this.pool.query(
      "UPDATE zh_budgets SET reserved_cents = reserved_cents + $2 WHERE position_id = $1 AND (cap_cents - used_cents - reserved_cents) >= $3 RETURNING (cap_cents - used_cents - reserved_cents) AS remaining",
      [positionId, amountCents, amountCents - EPS],
    );
    if (r.rows.length > 0) return { ok: true, remainingCents: Number(r.rows[0].remaining) };
    const cur = await this.pool.query("SELECT (cap_cents - used_cents - reserved_cents) AS remaining FROM zh_budgets WHERE position_id = $1", [positionId]);
    return { ok: false, remainingCents: cur.rows.length ? Number(cur.rows[0].remaining) : 0 };
  }

  async settle(positionId: string, reserveCents: number, actualCents: number): Promise<void> {
    await this.pool.query(
      "UPDATE zh_budgets SET reserved_cents = GREATEST(0, reserved_cents - $2), used_cents = used_cents + $3 WHERE position_id = $1",
      [positionId, reserveCents, actualCents],
    );
  }
}

void payloadOf; // available for chain-verification utilities over Pg rows
