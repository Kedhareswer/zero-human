-- zero-human · Neon Postgres schema (free-tier path, ULTRAPLAN §12).
-- Apply with: psql "$DATABASE_URL" -f src/db/migrations/0000_init.sql

CREATE TABLE IF NOT EXISTS zh_events (
  id              TEXT PRIMARY KEY,
  seq             BIGINT NOT NULL,
  ts              BIGINT NOT NULL,
  org_id          TEXT NOT NULL,
  actor           TEXT NOT NULL,
  correlation_id  TEXT,
  type            TEXT NOT NULL,
  payload         JSONB NOT NULL,
  prev_hash       TEXT NOT NULL,
  hash            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS zh_events_org_seq ON zh_events (org_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS zh_events_org_seq_uniq ON zh_events (org_id, seq);

CREATE TABLE IF NOT EXISTS zh_budgets (
  position_id     TEXT PRIMARY KEY,
  cap_cents       DOUBLE PRECISION NOT NULL,
  used_cents      DOUBLE PRECISION NOT NULL DEFAULT 0,
  reserved_cents  DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS zh_log_state (
  org_id     TEXT PRIMARY KEY,
  next_seq   BIGINT NOT NULL,
  last_hash  TEXT NOT NULL
);

-- Audit integrity: grant only INSERT on the event log to the app role (no UPDATE/
-- DELETE), so the hash chain cannot be silently rewritten. Example:
--   REVOKE UPDATE, DELETE ON zh_events FROM app_role;
--   GRANT  INSERT, SELECT ON zh_events TO app_role;
