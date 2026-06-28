// Store factory: Neon Postgres when DATABASE_URL is set, else the in-memory store.
// The Pg dependency is loaded lazily so the $0 demo and tests never import it.

import { InMemoryStore, type Store } from "./store";

export async function makeStore(): Promise<Store> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { PgStore } = await import("../db/pgstore");
    return new PgStore(url);
  }
  return new InMemoryStore();
}
