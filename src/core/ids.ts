import { randomUUID } from "node:crypto";

/** Convenience id generator. Callers may also pass explicit ids (tests/demo do). */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}
