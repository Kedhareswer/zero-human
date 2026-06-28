import { createHash } from "node:crypto";

/** Deterministic JSON: keys sorted recursively so the hash is reproducible. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Hash-chain link: sha256(prevHash + canonical(core)). Makes the log tamper-evident. */
export function computeHash(prevHash: string, core: unknown): string {
  return createHash("sha256").update(prevHash).update(stableStringify(core)).digest("hex");
}

export const GENESIS_HASH = "0".repeat(64);
