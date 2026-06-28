// Drizzle schema for the Neon Postgres backend. The event log is append-only and
// hash-chained; budgets carry the authoritative cap/used/reserved that the atomic
// CAS guards. Use drizzle-kit to generate migrations, or apply migrations/0000_init.sql.

import { pgTable, text, doublePrecision, bigint, jsonb, index } from "drizzle-orm/pg-core";

export const events = pgTable(
  "zh_events",
  {
    id: text("id").primaryKey(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    orgId: text("org_id").notNull(),
    actor: text("actor").notNull(),
    correlationId: text("correlation_id"),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [index("zh_events_org_seq").on(t.orgId, t.seq)],
);

export const budgets = pgTable("zh_budgets", {
  positionId: text("position_id").primaryKey(),
  capCents: doublePrecision("cap_cents").notNull(),
  usedCents: doublePrecision("used_cents").notNull().default(0),
  reservedCents: doublePrecision("reserved_cents").notNull().default(0),
});

export const logState = pgTable("zh_log_state", {
  orgId: text("org_id").primaryKey(),
  nextSeq: bigint("next_seq", { mode: "number" }).notNull(),
  lastHash: text("last_hash").notNull(),
});
